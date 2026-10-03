"""Pénzügyek REST API (Flask).

Futtatási módok:
  - AWS: Lambda függvény (lambda_handler.py), Function URL-en keresztül; az
    adatbázis Aurora DSQL, a webes felület S3-ról érkezik.
  - Helyi: `python main.py` (Docker Compose), PostgreSQL-lel; ilyenkor a
    lebuildelt felületet is ez a szerver szolgálja ki.
"""

import hmac
import os
import uuid

from flask import Flask, abort, jsonify, request, send_from_directory

import repository as repo
from categorize import auto_categorize
from excel_parser import make_hash, parse_cib_statement

ALLOWED_EXT = {".xls", ".xlsx"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # a Lambda Function URL kérésmérete max. 6 MB

# Hozzáférési kulcs: ha be van állítva, minden /api kérésnek
# "Authorization: Bearer <kulcs>" fejlécet kell küldenie. AWS-en kötelező
# (Terraform generálja); helyi futtatásnál elhagyható.
ACCESS_KEY = os.environ.get("ACCESS_KEY", "")
ON_LAMBDA = bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))

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


@app.before_request
def require_access_key():
    if not request.path.startswith("/api/") or request.method == "OPTIONS":
        return None
    if not ACCESS_KEY:
        if ON_LAMBDA:
            return _error("A szerver nincs megfelelően beállítva (hiányzó hozzáférési kulcs).", 503)
        return None
    header = request.headers.get("Authorization", "")
    token = header[7:] if header.lower().startswith("bearer ") else ""
    if not token or not hmac.compare_digest(token.encode(), ACCESS_KEY.encode()):
        return _error("Érvénytelen vagy hiányzó hozzáférési kulcs.", 401)
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
    # ellenőrzés (tx_hash) — ami már korábban (akár törölve) bekerült az
    # adatbázisba, az nem kerül be újra. A fájlon belüli ismétlődéseket is kiszűrjük.
    by_hash: dict[str, dict] = {}
    for rec in records:
        by_hash.setdefault(make_hash(rec), rec)
    existing = repo.existing_hashes(list(by_hash))

    new_items = []
    for h, rec in by_hash.items():
        if h in existing:
            continue
        item = {**rec, "tx_hash": h, "main_category": None, "category_source": "none", "sub_category": None}
        if rec["amount"] < 0:
            main_cat, sub_cat = auto_categorize(rec["description"])
            if main_cat:
                item.update(main_category=main_cat, category_source="auto", sub_category=sub_cat)
        else:
            # Bevétel rekordoknál automatikusan "bevétel" fő attribútum kerül
            # beállításra; a felhasználó ezt utólag bármikor felülírhatja.
            item.update(main_category="bevétel", category_source="auto")
        new_items.append(item)

    inserted = repo.insert_transactions(new_items)
    return jsonify({"inserted": inserted, "skipped": len(records) - inserted, "total_parsed": len(records)})


# ---------- listázás ----------

@app.route("/api/transactions", methods=["GET"])
def list_transactions():
    return jsonify(repo.list_transactions())


@app.route("/api/categories", methods=["GET"])
def list_categories():
    return jsonify(repo.list_categories())


# ---------- fő attribútum szerkesztés (azonnali mentés) ----------

@app.route("/api/transactions/<tx_id>", methods=["PATCH"])
def update_transaction(tx_id):
    tx_id = _uuid_or_404(tx_id)
    data = request.get_json(force=True, silent=True) or {}
    if "main_category" not in data:
        return _error("Nincs módosítandó mező.", 400)
    value = (data.get("main_category") or "").strip() or None
    tx = repo.set_main_category(tx_id, value)
    if not tx:
        return _error("A tranzakció nem található.", 404)
    return jsonify(tx)


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
    return jsonify(repo.add_attribute(tx_id, name, parent_id or None))


@app.route("/api/attributes/<attr_id>", methods=["PATCH"])
def rename_attribute(attr_id):
    attr_id = _uuid_or_404(attr_id)
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return _error("Az attribútum neve nem lehet üres.", 400)
    return jsonify(repo.rename_attribute(attr_id, name))


@app.route("/api/attributes/<attr_id>", methods=["DELETE"])
def delete_attribute(attr_id):
    attr_id = _uuid_or_404(attr_id)
    return jsonify({"deleted": repo.delete_attribute(attr_id)})


# ---------- tranzakció törlése ----------

@app.route("/api/transactions/<tx_id>", methods=["DELETE"])
def delete_transaction(tx_id):
    tx_id = _uuid_or_404(tx_id)
    # Soft delete: a rekord megmarad az adatbázisban (inaktívként), hogy
    # egy későbbi újrafeltöltés ne hozza vissza ugyanazt a tételt.
    if not repo.soft_delete_transaction(tx_id):
        return _error("A tranzakció nem található.", 404)
    return jsonify({"deleted": tx_id})


# ---------- webes felület (csak helyi futtatásnál; AWS-en S3 szolgálja ki) ----------

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def web(path):
    if ON_LAMBDA or path.startswith("api/"):
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
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)
