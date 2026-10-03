"""Hitelesítés: Amazon Cognito (Google social login) + aláírt munkamenet-süti.

Folyamat (AWS, AUTH_MODE=cognito):
  1. Hitelesítetlen kérésnél a CloudFront Function (infra/functions/auth_gate.js)
     — vagy az API 401 válasza után a frontend — a /api/auth/login címre irányít.
  2. /api/auth/login: state + PKCE generálás (aláírt, rövid életű sütiben), majd
     átirányítás a Cognito /oauth2/authorize végpontjára, közvetlenül a Google-höz.
  3. /api/auth/callback: a kódot a Lambda (bizalmas kliens, client secret) cseréli
     tokenre a Cognito token végpontján, ellenőrzi az ID token állításait és az
     engedélyezett e-mail címek listáját, majd beállítja a munkamenet-sütit.
  4. A munkamenet-süti (HttpOnly, Secure, SameSite=Lax) formátuma:
         <lejárat epoch>~<e-mail>~<HMAC-SHA256 hex>
     Ugyanezt ellenőrzi a CloudFront Function (statikus tartalom) és az API is.
     A böngésző JavaScriptje sosem lát tokent.

Helyi futtatásnál (AUTH_MODE=none) nincs belépés: minden kérés a DEV_USER_EMAIL
felhasználóhoz tartozik.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

SESSION_COOKIE = "pz_session"
STATE_COOKIE = "pz_auth"
SESSION_TTL_S = int(os.environ.get("SESSION_TTL_SECONDS", str(8 * 3600)))
STATE_TTL_S = 600
CSRF_HEADER = "X-Requested-With"
CSRF_VALUE = "penzugyek"

ON_LAMBDA = bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))
AUTH_MODE = os.environ.get("AUTH_MODE", "cognito" if ON_LAMBDA else "none").strip().lower()
DEV_USER_EMAIL = os.environ.get("DEV_USER_EMAIL", "dev@localhost").strip().lower()


def allowed_emails() -> set[str]:
    return {e.strip().lower() for e in os.environ.get("ALLOWED_EMAILS", "").split(",") if e.strip()}


def is_allowed(email: str | None) -> bool:
    return bool(email) and email.strip().lower() in allowed_emails()


def _session_secret() -> bytes:
    secret = os.environ.get("SESSION_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("SESSION_SECRET hiányzik vagy túl rövid.")
    return secret.encode()


def _sign(data: str) -> str:
    return hmac.new(_session_secret(), data.encode(), hashlib.sha256).hexdigest()


# ---------- munkamenet-süti ----------

def make_session(email: str, ttl: int = SESSION_TTL_S, now: float | None = None) -> str:
    exp = int((now or time.time()) + ttl)
    data = f"{exp}~{email.strip().lower()}"
    return f"{data}~{_sign(data)}"


def verify_session(value: str | None, now: float | None = None) -> str | None:
    """Visszaadja az e-mail címet, ha a süti érvényes, lejáratlan, és a cím
    (még mindig) engedélyezett — különben None."""
    if not value or value.count("~") < 2:
        return None
    data, _, sig = value.rpartition("~")
    if not hmac.compare_digest(_sign(data), sig):
        return None
    exp_s, _, email = data.partition("~")
    try:
        if int(exp_s) <= (now or time.time()):
            return None
    except ValueError:
        return None
    return email if is_allowed(email) else None


# ---------- állapot-süti (state + PKCE) ----------

def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _b64url_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make_state_cookie(state: str, verifier: str, next_path: str) -> str:
    payload = _b64url(json.dumps({"s": state, "v": verifier, "n": next_path, "x": int(time.time()) + STATE_TTL_S}).encode())
    return f"{payload}.{_sign(payload)}"


def read_state_cookie(value: str | None) -> dict | None:
    if not value or "." not in value:
        return None
    payload, _, sig = value.rpartition(".")
    if not hmac.compare_digest(_sign(payload), sig):
        return None
    try:
        data = json.loads(_b64url_decode(payload))
    except ValueError:
        return None
    return data if data.get("x", 0) > time.time() else None


def safe_next(value: str | None) -> str:
    """Csak saját, relatív útvonalra irányítunk vissza (nyílt átirányítás ellen)."""
    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value:
        return "/"
    return value


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge


# ---------- Cognito konfiguráció ----------

_cfg_cache: dict | None = None


def cognito_config() -> dict:
    """A Cognito kliens adatai és az alkalmazás címe. A Terraform SSM Parameter
    Store-ba írja őket (a Lambda ↔ CloudFront ↔ Cognito függőségi kör miatt nem
    lehetnek környezeti változók); tesztekhez környezeti változóval felülírhatók."""
    global _cfg_cache
    if _cfg_cache is not None:
        return _cfg_cache
    cfg = {
        "client_id": os.environ.get("COGNITO_CLIENT_ID"),
        "client_secret": os.environ.get("COGNITO_CLIENT_SECRET"),
        "app_url": os.environ.get("APP_URL"),
    }
    prefix = os.environ.get("SSM_PREFIX")
    if prefix and not all(cfg.values()):
        import boto3

        names = {f"{prefix}/{k}": k for k in ("client_id", "client_secret", "app_url")}
        resp = boto3.client("ssm").get_parameters(Names=list(names), WithDecryption=True)
        for p in resp["Parameters"]:
            cfg[names[p["Name"]]] = p["Value"]
    missing = [k for k, v in cfg.items() if not v]
    if missing:
        raise RuntimeError(f"Hiányzó Cognito beállítás: {', '.join(missing)}")
    cfg["app_url"] = cfg["app_url"].rstrip("/")
    cfg["domain"] = os.environ["COGNITO_DOMAIN"].rstrip("/")
    cfg["issuer"] = (
        f"https://cognito-idp.{os.environ.get('COGNITO_REGION') or os.environ.get('AWS_REGION')}"
        f".amazonaws.com/{os.environ['COGNITO_USER_POOL_ID']}"
    )
    _cfg_cache = cfg
    return cfg


def redirect_uri(cfg: dict) -> str:
    return f"{cfg['app_url']}/api/auth/callback"


def authorize_url(cfg: dict, state: str, challenge: str) -> str:
    query = urllib.parse.urlencode(
        {
            "response_type": "code",
            "client_id": cfg["client_id"],
            "redirect_uri": redirect_uri(cfg),
            "scope": "openid email profile",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "identity_provider": "Google",  # a Cognito felület kihagyása
        }
    )
    return f"{cfg['domain']}/oauth2/authorize?{query}"


def logout_url(cfg: dict) -> str:
    query = urllib.parse.urlencode({"client_id": cfg["client_id"], "logout_uri": f"{cfg['app_url']}/api/auth/logged-out"})
    return f"{cfg['domain']}/logout?{query}"


class AuthError(Exception):
    pass


def exchange_code(cfg: dict, code: str, verifier: str) -> dict:
    """Kód → tokenek a Cognito token végpontján (HTTPS, kliens-hitelesítéssel)."""
    body = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "client_id": cfg["client_id"],
            "code": code,
            "redirect_uri": redirect_uri(cfg),
            "code_verifier": verifier,
        }
    ).encode()
    basic = base64.b64encode(f"{cfg['client_id']}:{cfg['client_secret']}".encode()).decode()
    req = urllib.request.Request(
        f"{cfg['domain']}/oauth2/token",
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded", "Authorization": f"Basic {basic}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise AuthError(f"Token csere sikertelen ({e.code}).") from e
    except urllib.error.URLError as e:
        raise AuthError("A Cognito nem érhető el.") from e


def id_token_claims(cfg: dict, id_token: str) -> dict:
    """Az ID tokent közvetlenül a Cognito token végpontjától kaptuk TLS-en,
    kliens-hitelesítéssel — ilyenkor az OIDC Core 3.1.3.7 szerint az aláírás
    helyett a TLS szerverhitelesítés is elfogadható. Az állításokat ellenőrizzük."""
    try:
        claims = json.loads(_b64url_decode(id_token.split(".")[1]))
    except (IndexError, ValueError) as e:
        raise AuthError("Érvénytelen ID token.") from e
    if claims.get("iss") != cfg["issuer"]:
        raise AuthError("Érvénytelen kibocsátó.")
    if claims.get("aud") != cfg["client_id"] or claims.get("token_use") != "id":
        raise AuthError("Érvénytelen célközönség.")
    if int(claims.get("exp", 0)) <= time.time():
        raise AuthError("Lejárt token.")
    return claims


def verified_email(claims: dict) -> str | None:
    email = (claims.get("email") or "").strip().lower()
    if not email:
        return None
    verified = claims.get("email_verified")
    # A Google-fiókok @gmail.com címét a Google eleve hitelesíti.
    if verified in (True, "true") or email.endswith(("@gmail.com", "@googlemail.com")):
        return email
    return None
