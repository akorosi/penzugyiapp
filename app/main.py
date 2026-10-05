"""Pénzügyek REST API (Flask).

Futtatási módok:
  - AWS: Lambda függvény (lambda_handler.py), CloudFronton keresztül; az
    adatbázis Aurora DSQL, a belépés Amazon Cognito (Google), lásd auth.py.
  - Helyi: `python main.py` (Docker Compose), PostgreSQL-lel, belépés nélkül
    (AUTH_MODE=none); ilyenkor a lebuildelt felületet is ez a szerver szolgálja ki.
"""

import html
import os
import secrets
import uuid

from flask import Flask, abort, g, jsonify, make_response, redirect, request, send_from_directory

import auth
import repository as repo
from categorize import auto_categorize
from excel_parser import make_hash, parse_cib_statement

ALLOWED_EXT = {".xls", ".xlsx"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # a Lambda Function URL kérésmérete max. 6 MB
MAX_BULK_IDS = 5000
MIN_RULE_PATTERN = 3
PUBLIC_API_PATHS = ("/api/auth/", "/api/health")

# Helyi futtatásnál a lebuildelt React felület (frontend/dist) kiszolgálása.
_HERE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.environ.get("WEB_DIR") or next(
    (d for d in (os.path.join(_HERE, "web"), os.path.join(_HERE, "..", "frontend", "dist")) if os.path.isdir(d)),
    os.path.join(_HERE, "web"),
)

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
app.json.ensure_ascii = False


def _error(msg: str, status: int):
    return jsonify({"error": msg}), status


def _uuid_or_404(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError):
        abort(404)


# ---------- hitelesítés minden /api kérésre ----------

@app.before_request
def authenticate():
    if not request.path.startswith("/api/") or request.path.startswith(PUBLIC_API_PATHS):
        return None
    if auth.AUTH_MODE == "none":
        if auth.ON_LAMBDA:  # AWS-en tilos belépés nélkül futni
            return _error("A szerver nincs megfelelően beállítva.", 503)
        g.user = auth.DEV_USER_EMAIL
    elif auth.AUTH_MODE == "cognito":
        email = auth.verify_session(request.cookies.get(auth.SESSION_COOKIE))
        if not email:
            return _error("Bejelentkezés szükséges.", 401)
        g.user = email
    else:
        return _error("Ismeretlen AUTH_MODE.", 503)

    # CSRF védelem: a módosító kéréseknek egyedi fejlécet kell küldeniük (egy
    # idegen oldal ezt böngészőből nem tudja beállítani). A süti SameSite=Lax.
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get(auth.CSRF_HEADER) != auth.CSRF_VALUE:
        return _error("Hiányzó vagy érvénytelen kérés-fejléc.", 403)
    return None


@app.errorhandler(404)
def not_found(_e):
    return _error("Nem található.", 404)


@app.errorhandler(413)
def too_large(_e):
    return _error("A fájl túl nagy (legfeljebb 5 MB).", 413)


@app.errorhandler(repo.NotFound)
def repo_not_found(e):
    return _error(str(e), 404)


@app.errorhandler(repo.Invalid)
def repo_invalid(e):
    return _error(str(e), 400)


# ---------- belépés / kilépés (Cognito + Google) ----------

def _page(title: str, body: str, status: int = 200):
    doc = f"""<!doctype html><html lang="hu"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,"><title>{html.escape(title)} — Pénzügyek</title>
<style>
  :root {{ color-scheme: light dark; --bg:#f8f9fb; --fg:#1c2024; --muted:#60646c; --card:#fff; --border:#e0e1e6; --accent:#0d74ce; }}
  @media (prefers-color-scheme: dark) {{ :root {{ --bg:#111113; --fg:#edeef0; --muted:#b0b4ba; --card:#18191b; --border:#2e3135; --accent:#3b9eff; }} }}
  body {{ margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg);
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding:16px; box-sizing:border-box; }}
  main {{ background:var(--card); border:1px solid var(--border); border-radius:12px; padding:32px; max-width:420px; width:100%; text-align:center; }}
  h1 {{ font-size:20px; margin:0 0 8px; }} p {{ color:var(--muted); margin:0 0 24px; }}
  a.btn {{ display:inline-block; background:var(--accent); color:#fff; text-decoration:none; padding:10px 18px; border-radius:8px; font-weight:600; }}
  a.btn:focus-visible {{ outline:2px solid var(--accent); outline-offset:3px; }}
</style></head><body><main>{body}</main></body></html>"""
    resp = make_response(doc, status)
    resp.headers["Content-Type"] = "text/html; charset=utf-8"
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _secure_cookies() -> bool:
    return auth.AUTH_MODE == "cognito"


@app.route("/api/auth/login", methods=["GET"])
def auth_login():
    if auth.AUTH_MODE != "cognito":
        return redirect(auth.safe_next(request.args.get("next")))
    cfg = auth.cognito_config()
    state = secrets.token_urlsafe(24)
    verifier, challenge = auth.pkce_pair()
    resp = redirect(auth.authorize_url(cfg, state, challenge))
    resp.set_cookie(
        auth.STATE_COOKIE,
        auth.make_state_cookie(state, verifier, auth.safe_next(request.args.get("next"))),
        max_age=auth.STATE_TTL_S, path="/api/auth", secure=True, httponly=True, samesite="Lax",
    )
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _denied_page(message: str):
    cfg = auth.cognito_config()
    body = (
        "<h1>Nincs hozzáférésed</h1>"
        f"<p>{html.escape(message)}</p>"
        f'<a class="btn" href="{html.escape(auth.logout_url(cfg))}">Belépés másik fiókkal</a>'
    )
    resp = _page("Nincs hozzáférésed", body, 403)
    resp.delete_cookie(auth.STATE_COOKIE, path="/api/auth", secure=True, httponly=True, samesite="Lax")
    return resp


@app.route("/api/auth/callback", methods=["GET"])
def auth_callback():
    if auth.AUTH_MODE != "cognito":
        return redirect("/")
    if request.args.get("error"):
        # pl. a Cognito pre sign-up trigger elutasította a nem engedélyezett címet
        return _denied_page("Ezzel a Google-fiókkal nem lehet belépni az alkalmazásba.")

    state = auth.read_state_cookie(request.cookies.get(auth.STATE_COOKIE))
    if not state or not secrets.compare_digest(state["s"], request.args.get("state", "")):
        # lejárt / hiányzó állapot → új belépési kísérlet
        return redirect("/api/auth/login")
    code = request.args.get("code")
    if not code:
        return redirect("/api/auth/login")

    cfg = auth.cognito_config()
    try:
        tokens = auth.exchange_code(cfg, code, state["v"])
        email = auth.verified_email(auth.id_token_claims(cfg, tokens.get("id_token", "")))
    except auth.AuthError as e:
        app.logger.warning("Sikertelen belépés: %s", e)
        return _page("Sikertelen belépés", '<h1>Sikertelen belépés</h1><p>Próbáld újra.</p><a class="btn" href="/">Újra</a>', 400)

    if not email or not auth.is_allowed(email):
        app.logger.warning("Nem engedélyezett felhasználó próbált belépni.")
        return _denied_page("Ezzel a Google-fiókkal nem lehet belépni az alkalmazásba.")

    resp = redirect(state.get("n") or "/")
    resp.set_cookie(
        auth.SESSION_COOKIE, auth.make_session(email),
        max_age=auth.SESSION_TTL_S, path="/", secure=True, httponly=True, samesite="Lax",
    )
    resp.delete_cookie(auth.STATE_COOKIE, path="/api/auth", secure=True, httponly=True, samesite="Lax")
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/api/auth/logout", methods=["GET"])
def auth_logout():
    if auth.AUTH_MODE != "cognito":
        return redirect("/")
    resp = redirect(auth.logout_url(auth.cognito_config()))
    resp.delete_cookie(auth.SESSION_COOKIE, path="/", secure=True, httponly=True, samesite="Lax")
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/api/auth/logged-out", methods=["GET"])
def auth_logged_out():
    return _page(
        "Kijelentkeztél",
        '<h1>Kijelentkeztél</h1><p>Sikeresen kijelentkeztél a Pénzügyek alkalmazásból.</p><a class="btn" href="/">Belépés</a>',
    )


@app.route("/api/me", methods=["GET"])
def me():
    return jsonify({"email": g.user, "auth": auth.AUTH_MODE})


# ---------- állapot ----------

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


# ---------- feltöltés ----------

@app.route("/api/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return _error("Nincs fájl csatolva.", 400)
    file = request.files["file"]
    if not file.filename:
        return _error("Üres fájlnév.", 400)
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        return _error("Csak .xls vagy .xlsx fájl tölthető fel.", 400)

    try:
        records = parse_cib_statement(file.read())
    except Exception as e:
        return _error(f"Hiba a fájl feldolgozása közben: {e}", 400)

    # Nincs dátum/hónap szerinti szűrés: a fájl A11-től kezdődő teljes
    # tartalma betöltésre kerül. Az egyetlen kizáró tényező a duplikátum-
    # ellenőrzés (tx_hash) — ami már korábban (akár törölve) bekerült a
    # felhasználó adatai közé, az nem kerül be újra. A fájlon belüli
    # ismétlődéseket is kiszűrjük.
    by_hash: dict[str, dict] = {}
    for rec in records:
        by_hash.setdefault(make_hash(rec, g.user), rec)
    existing = repo.existing_hashes(g.user, list(by_hash))

    # A felhasználó saját szabályai elsőbbséget élveznek a beépített listával szemben.
    user_rules = repo.rules_for_matching(g.user)
    new_items = []
    for h, rec in by_hash.items():
        if h in existing:
            continue
        item = {**rec, "tx_hash": h, "main_category": None, "category_source": "none", "sub_category": None}
        if rec["amount"] < 0:
            if rule_cat := repo.match_rule(user_rules, rec["description"]):
                item.update(main_category=rule_cat, category_source="rule")
            else:
                main_cat, sub_cat = auto_categorize(rec["description"])
                if main_cat:
                    item.update(main_category=main_cat, category_source="auto", sub_category=sub_cat)
        else:
            # Bevétel rekordoknál automatikusan "bevétel" fő attribútum kerül
            # beállításra; a felhasználó ezt utólag bármikor felülírhatja.
            item.update(main_category="bevétel", category_source="auto")
        new_items.append(item)

    inserted = repo.insert_transactions(g.user, new_items)
    return jsonify({"inserted": inserted, "skipped": len(records) - inserted, "total_parsed": len(records)})


# ---------- listázás ----------

@app.route("/api/transactions", methods=["GET"])
def list_transactions():
    return jsonify(repo.list_transactions(g.user))


@app.route("/api/categories", methods=["GET"])
def list_categories():
    return jsonify(repo.list_categories(g.user))


# ---------- fő attribútum szerkesztés (azonnali mentés) ----------

@app.route("/api/transactions/<tx_id>", methods=["PATCH"])
def update_transaction(tx_id):
    tx_id = _uuid_or_404(tx_id)
    data = request.get_json(force=True, silent=True) or {}
    if "main_category" not in data:
        return _error("Nincs módosítandó mező.", 400)
    value = (data.get("main_category") or "").strip() or None
    tx = repo.set_main_category(g.user, tx_id, value)
    if not tx:
        return _error("A tranzakció nem található.", 404)
    return jsonify(tx)


@app.route("/api/transactions/bulk-main-category", methods=["POST"])
def bulk_update_main_category():
    data = request.get_json(force=True, silent=True) or {}
    ids = data.get("ids")
    if not isinstance(ids, list) or not ids:
        return _error("Nincs kijelölt tétel.", 400)
    if len(ids) > MAX_BULK_IDS:
        return _error(f"Egyszerre legfeljebb {MAX_BULK_IDS} tétel módosítható.", 400)
    try:
        ids = [str(uuid.UUID(str(i))) for i in ids]
    except ValueError:
        return _error("Érvénytelen tétel-azonosító.", 400)
    value = (data.get("main_category") or "").strip() or None
    return jsonify({"updated": repo.bulk_set_main_category(g.user, ids, value)})


# ---------- saját kategorizálási szabályok ----------

@app.route("/api/rules", methods=["GET"])
def list_rules():
    return jsonify(repo.list_rules(g.user))


@app.route("/api/rules", methods=["POST"])
def create_rule():
    data = request.get_json(force=True, silent=True) or {}
    pattern = " ".join((data.get("pattern") or "").split())
    main_category = (data.get("main_category") or "").strip()
    if len(pattern) < MIN_RULE_PATTERN:
        return _error(f"A minta legalább {MIN_RULE_PATTERN} karakter legyen.", 400)
    if not main_category:
        return _error("A fő attribútum nem lehet üres.", 400)
    rule = repo.save_rule(g.user, pattern, main_category)
    applied = repo.apply_rule_to_existing(g.user, pattern, main_category) if data.get("apply_existing", True) else []
    return jsonify({"rule": rule, "applied": len(applied)})


@app.route("/api/rules/<rule_id>", methods=["DELETE"])
def delete_rule(rule_id):
    rule_id = _uuid_or_404(rule_id)
    if not repo.delete_rule(g.user, rule_id):
        return _error("A szabály nem található.", 404)
    return jsonify({"deleted": rule_id})


# ---------- al-attribútum fa kezelése (azonnali mentés) ----------

@app.route("/api/transactions/<tx_id>/attributes", methods=["POST"])
def add_attribute(tx_id):
    tx_id = _uuid_or_404(tx_id)
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return _error("Az attribútum neve nem lehet üres.", 400)
    parent_id = data.get("parent_id")
    if parent_id:
        try:
            parent_id = str(uuid.UUID(str(parent_id)))
        except ValueError:
            return _error("Érvénytelen szülő attribútum.", 400)
    return jsonify(repo.add_attribute(g.user, tx_id, name, parent_id or None))


@app.route("/api/attributes/<attr_id>", methods=["PATCH"])
def rename_attribute(attr_id):
    attr_id = _uuid_or_404(attr_id)
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return _error("Az attribútum neve nem lehet üres.", 400)
    return jsonify(repo.rename_attribute(g.user, attr_id, name))


@app.route("/api/attributes/<attr_id>", methods=["DELETE"])
def delete_attribute(attr_id):
    attr_id = _uuid_or_404(attr_id)
    return jsonify({"deleted": repo.delete_attribute(g.user, attr_id)})


# ---------- tranzakció törlése ----------

@app.route("/api/transactions/<tx_id>", methods=["DELETE"])
def delete_transaction(tx_id):
    tx_id = _uuid_or_404(tx_id)
    # Soft delete: a rekord megmarad az adatbázisban (inaktívként), hogy
    # egy későbbi újrafeltöltés ne hozza vissza ugyanazt a tételt.
    if not repo.soft_delete_transaction(g.user, tx_id):
        return _error("A tranzakció nem található.", 404)
    return jsonify({"deleted": tx_id})


# ---------- webes felület (csak helyi futtatásnál; AWS-en S3 szolgálja ki) ----------

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def web(path):
    if auth.ON_LAMBDA or path.startswith("api/"):
        abort(404)
    if path and os.path.isfile(os.path.join(WEB_DIR, path)):
        return send_from_directory(WEB_DIR, path)
    if not os.path.isfile(os.path.join(WEB_DIR, "index.html")):
        return (
            "A webes felület nincs lebuildelve. Futtasd: cd frontend && npm ci && npm run build",
            503,
            {"Content-Type": "text/plain; charset=utf-8"},
        )
    return send_from_directory(WEB_DIR, "index.html")


if __name__ == "__main__":
    import db

    db.migrate()
    repo.adopt_legacy_rows(os.environ.get("LEGACY_DATA_OWNER", auth.DEV_USER_EMAIL).strip().lower(), make_hash)
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)
