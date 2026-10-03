"""A Cognito + Google belépési folyamat (a Cognito token végpontja helyettesítve)."""

import base64
import json
import time
from urllib.parse import parse_qs, urlparse

import pytest

from conftest import USER_A, USER_B

pytestmark = pytest.mark.needs_db


def _id_token(**claims) -> str:
    base = {
        "iss": "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_TEST",
        "aud": "test-client",
        "token_use": "id",
        "exp": int(time.time()) + 3600,
        "email": USER_A,
        "email_verified": "true",
    }
    base.update(claims)
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{enc({'alg': 'RS256'})}.{enc(base)}.sig"


def _cookie(resp, name):
    for header in resp.headers.getlist("Set-Cookie"):
        if header.startswith(name + "="):
            return header
    return None


def _start_login(client, next_path="/#elemzes"):
    r = client.get("/api/auth/login", query_string={"next": next_path})
    assert r.status_code == 302
    loc = urlparse(r.headers["Location"])
    q = parse_qs(loc.query)
    return r, loc, q


def test_login_redirects_to_google_via_cognito_with_pkce(app_client):
    r, loc, q = _start_login(app_client)
    assert f"{loc.scheme}://{loc.netloc}{loc.path}" == "https://penzugyek.auth.eu-central-1.amazoncognito.com/oauth2/authorize"
    assert q["identity_provider"] == ["Google"]
    assert q["response_type"] == ["code"]
    assert q["redirect_uri"] == ["https://app.example.net/api/auth/callback"]
    assert q["code_challenge_method"] == ["S256"] and q["code_challenge"][0]
    state_cookie = _cookie(r, "pz_auth")
    assert "HttpOnly" in state_cookie and "Secure" in state_cookie and "Path=/api/auth" in state_cookie


def test_callback_sets_session_for_allowed_user(app_client, monkeypatch):
    import auth

    seen = {}

    def fake_exchange(cfg, code, verifier):
        seen.update(code=code, verifier=verifier)
        return {"id_token": _id_token(email=USER_B.upper())}

    monkeypatch.setattr(auth, "exchange_code", fake_exchange)
    _, _, q = _start_login(app_client)
    r = app_client.get("/api/auth/callback", query_string={"code": "abc", "state": q["state"][0]})
    assert r.status_code == 302 and r.headers["Location"] == "/#elemzes"
    assert seen["code"] == "abc" and len(seen["verifier"]) >= 43
    session = _cookie(r, "pz_session")
    assert "HttpOnly" in session and "Secure" in session and "SameSite=Lax" in session
    assert app_client.get("/api/me").json["email"] == USER_B


def test_callback_rejects_not_allowed_user(app_client, monkeypatch):
    import auth

    monkeypatch.setattr(auth, "exchange_code", lambda *a: {"id_token": _id_token(email="mallory@gmail.com")})
    _, _, q = _start_login(app_client)
    r = app_client.get("/api/auth/callback", query_string={"code": "abc", "state": q["state"][0]})
    assert r.status_code == 403
    assert _cookie(r, "pz_session") is None
    assert app_client.get("/api/me").status_code == 401


@pytest.mark.parametrize(
    "claims",
    [{"aud": "other-client"}, {"iss": "https://evil.example"}, {"exp": int(time.time()) - 1}, {"token_use": "access"}],
)
def test_callback_rejects_invalid_tokens(app_client, monkeypatch, claims):
    import auth

    monkeypatch.setattr(auth, "exchange_code", lambda *a: {"id_token": _id_token(**claims)})
    _, _, q = _start_login(app_client)
    r = app_client.get("/api/auth/callback", query_string={"code": "abc", "state": q["state"][0]})
    assert r.status_code == 400
    assert _cookie(r, "pz_session") is None


def test_callback_with_wrong_state_restarts_login(app_client, monkeypatch):
    import auth

    monkeypatch.setattr(auth, "exchange_code", lambda *a: pytest.fail("nem szabad tokent cserélni"))
    _start_login(app_client)
    r = app_client.get("/api/auth/callback", query_string={"code": "abc", "state": "hamis"})
    assert r.status_code == 302 and r.headers["Location"].endswith("/api/auth/login")


def test_callback_error_from_cognito_shows_denied_page(app_client):
    r = app_client.get("/api/auth/callback", query_string={"error": "access_denied", "error_description": "PreSignUp failed"})
    assert r.status_code == 403 and "Nincs hozzáférésed" in r.get_data(as_text=True)


def test_open_redirect_is_blocked():
    import auth

    assert auth.safe_next("https://evil.example") == "/"
    assert auth.safe_next("//evil.example") == "/"
    assert auth.safe_next("/\\evil.example") == "/"
    assert auth.safe_next("/#elemzes") == "/#elemzes"


def test_logout_clears_session_and_goes_to_cognito(client):
    r = client.get("/api/auth/logout")
    assert r.status_code == 302
    loc = urlparse(r.headers["Location"])
    assert loc.path == "/logout"
    assert parse_qs(loc.query)["logout_uri"] == ["https://app.example.net/api/auth/logged-out"]
    assert "pz_session=;" in _cookie(r, "pz_session")
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/auth/logged-out").status_code == 200
