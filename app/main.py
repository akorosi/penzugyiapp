import os
from datetime import datetime

from flask import Flask, request, jsonify, send_from_directory, abort
from werkzeug.utils import secure_filename

from db import Base, engine, SessionLocal
from models import Transaction, Attribute
from excel_parser import parse_cib_statement, make_hash
from categorize import auto_categorize

Base.metadata.create_all(bind=engine)


def _ensure_schema():
    """Ha egy korábbi verzióból származó adatbázison hiányzik az 'is_active'
    oszlop (soft delete-hez), pótoljuk — create_all csak hiányzó táblákat hoz
    létre, meglévő táblát nem módosít."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(transactions)").fetchall()]
        if "is_active" not in cols:
            conn.exec_driver_sql("ALTER TABLE transactions ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1")
            conn.commit()


_ensure_schema()

# A webes felület a frontend/ könyvtárban lévő React (Radix UI) alkalmazás
# statikus build kimenete (npm run build → frontend/dist). Docker-ben a
# multi-stage build ide (/app/web) másolja; helyi futtatásnál a
# frontend/dist könyvtárat használjuk.
_HERE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.environ.get("WEB_DIR") or next(
    (d for d in (os.path.join(_HERE, "web"), os.path.join(_HERE, "..", "frontend", "dist")) if os.path.isdir(d)),
    os.path.join(_HERE, "web"),
)

app = Flask(__name__, static_folder=None)
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/app/uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
ALLOWED_EXT = {".xls", ".xlsx"}


# ---------- szerializálás ----------

def serialize_attribute(attr: Attribute) -> dict:
    children = sorted(attr.children, key=lambda a: a.id)
    return {
        "id": attr.id,
        "name": attr.name,
        "parent_id": attr.parent_id,
        "children": [serialize_attribute(c) for c in children],
    }


def serialize_transaction(tx: Transaction) -> dict:
    top_level = sorted([a for a in tx.attributes if a.parent_id is None], key=lambda a: a.id)
    return {
        "id": tx.id,
        "date": tx.date.isoformat(),
        "tx_type": tx.tx_type,
        "description": tx.description,
        "amount": tx.amount,
        "kind": tx.kind,
        "main_category": tx.main_category,
        "category_source": tx.category_source,
        "attributes": [serialize_attribute(a) for a in top_level],
    }


# ---------- webes felület (statikus SPA build) ----------

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def web(path):
    if path.startswith("api/"):
        abort(404)
    full = os.path.join(WEB_DIR, path)
    if path and os.path.isfile(full):
        return send_from_directory(WEB_DIR, path)
    if not os.path.isfile(os.path.join(WEB_DIR, "index.html")):
        return (
            "A webes felület nincs lebuildelve. Futtasd: cd frontend && npm ci && npm run build",
            503,
            {"Content-Type": "text/plain; charset=utf-8"},
        )
    # Ismeretlen útvonal → index.html (kliens oldali nézetek)
    return send_from_directory(WEB_DIR, "index.html")


# ---------- feltöltés ----------

@app.route("/api/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return jsonify({"error": "Nincs fájl csatolva."}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Üres fájlnév."}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        return jsonify({"error": "Csak .xls vagy .xlsx fájl tölthető fel."}), 400

    filename = secure_filename(file.filename)
    filepath = os.path.join(UPLOAD_DIR, f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{filename}")
    file.save(filepath)

    try:
        records = parse_cib_statement(filepath)
    except Exception as e:
        return jsonify({"error": f"Hiba a fájl feldolgozása közben: {e}"}), 400

    # Nincs dátum/hónap szerinti szűrés: a fájl A11-től kezdődő teljes
    # tartalma betöltésre kerül. Az egyetlen kizáró tényező a duplikátum-
    # ellenőrzés (tx_hash) — ami már korábban (akár törölve) bekerült az
    # adatbázisba, az nem kerül be újra.
    session = SessionLocal()
    inserted, skipped = 0, 0
    try:
        for rec in records:
            h = make_hash(rec)
            # Szándékosan NINCS is_active szűrés: a hash-ellenőrzés a törölt
            # (soft delete-elt) rekordokat is figyelembe veszi, így egy korábban
            # törölt tétel újrafeltöltéskor sem kerül vissza duplikátumként.
            if session.query(Transaction).filter_by(tx_hash=h).first():
                skipped += 1
                continue

            tx = Transaction(
                date=rec["date"],
                tx_type=rec["tx_type"],
                description=rec["description"],
                amount=rec["amount"],
                tx_hash=h,
            )

            sub_cat = None
            if rec["amount"] < 0:
                main_cat, sub_cat = auto_categorize(rec["description"])
                if main_cat:
                    tx.main_category = main_cat
                    tx.category_source = "auto"
            else:
                # Bevétel rekordoknál automatikusan "bevétel" fő attribútum kerül
                # beállításra; a felhasználó ezt utólag bármikor felülírhatja.
                tx.main_category = "bevétel"
                tx.category_source = "auto"

            session.add(tx)
            session.flush()  # hogy legyen tx.id az al-attribútumhoz

            if sub_cat:
                session.add(Attribute(transaction_id=tx.id, parent_id=None, name=sub_cat))

            inserted += 1
        session.commit()
    finally:
        session.close()

    return jsonify({"inserted": inserted, "skipped": skipped, "total_parsed": len(records)})


# ---------- listázás ----------

@app.route("/api/transactions", methods=["GET"])
def list_transactions():
    session = SessionLocal()
    try:
        txs = (
            session.query(Transaction)
            .filter(Transaction.is_active.is_(True))
            .order_by(Transaction.date.desc(), Transaction.id.desc())
            .all()
        )
        return jsonify([serialize_transaction(t) for t in txs])
    finally:
        session.close()


@app.route("/api/categories", methods=["GET"])
def list_categories():
    session = SessionLocal()
    try:
        rows = (
            session.query(Transaction.main_category)
            .filter(Transaction.is_active.is_(True), Transaction.main_category.isnot(None))
            .distinct()
            .all()
        )
        return jsonify(sorted({r[0] for r in rows if r[0]}))
    finally:
        session.close()


# ---------- fő attribútum szerkesztés (azonnali mentés) ----------

@app.route("/api/transactions/<int:tx_id>", methods=["PATCH"])
def update_transaction(tx_id):
    data = request.get_json(force=True, silent=True) or {}
    session = SessionLocal()
    try:
        tx = session.get(Transaction, tx_id)
        if not tx:
            return jsonify({"error": "A tranzakció nem található."}), 404
        if "main_category" in data:
            value = (data["main_category"] or "").strip()
            tx.main_category = value or None
            tx.category_source = "manual"
        tx.updated_at = datetime.utcnow()
        session.commit()
        return jsonify(serialize_transaction(tx))
    finally:
        session.close()


# ---------- al-attribútum fa kezelése (azonnali mentés) ----------

@app.route("/api/transactions/<int:tx_id>/attributes", methods=["POST"])
def add_attribute(tx_id):
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get("name") or "").strip()
    parent_id = data.get("parent_id")
    if not name:
        return jsonify({"error": "Az attribútum neve nem lehet üres."}), 400

    session = SessionLocal()
    try:
        tx = session.get(Transaction, tx_id)
        if not tx:
            return jsonify({"error": "A tranzakció nem található."}), 404
        if parent_id:
            parent = session.get(Attribute, parent_id)
            if not parent or parent.transaction_id != tx_id:
                return jsonify({"error": "Érvénytelen szülő attribútum."}), 400
        attr = Attribute(transaction_id=tx_id, parent_id=parent_id, name=name)
        session.add(attr)
        session.commit()
        return jsonify(serialize_attribute(attr))
    finally:
        session.close()


@app.route("/api/attributes/<int:attr_id>", methods=["PATCH"])
def rename_attribute(attr_id):
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Az attribútum neve nem lehet üres."}), 400

    session = SessionLocal()
    try:
        attr = session.get(Attribute, attr_id)
        if not attr:
            return jsonify({"error": "Az attribútum nem található."}), 404
        attr.name = name
        session.commit()
        return jsonify(serialize_attribute(attr))
    finally:
        session.close()


def _collect_ids(attr: Attribute) -> list[int]:
    ids = [attr.id]
    for c in attr.children:
        ids.extend(_collect_ids(c))
    return ids


@app.route("/api/attributes/<int:attr_id>", methods=["DELETE"])
def delete_attribute(attr_id):
    session = SessionLocal()
    try:
        attr = session.get(Attribute, attr_id)
        if not attr:
            return jsonify({"error": "Az attribútum nem található."}), 404
        ids = _collect_ids(attr)
        session.query(Attribute).filter(Attribute.id.in_(ids)).delete(synchronize_session=False)
        session.commit()
        return jsonify({"deleted": ids})
    finally:
        session.close()


# ---------- tranzakció törlése ----------

@app.route("/api/transactions/<int:tx_id>", methods=["DELETE"])
def delete_transaction(tx_id):
    session = SessionLocal()
    try:
        tx = session.get(Transaction, tx_id)
        if not tx:
            return jsonify({"error": "A tranzakció nem található."}), 404
        # Soft delete: a rekord megmarad az adatbázisban (inaktívként), hogy
        # egy későbbi újrafeltöltés ne hozza vissza ugyanazt a tételt.
        tx.is_active = False
        tx.updated_at = datetime.utcnow()
        session.commit()
        return jsonify({"deleted": tx_id})
    finally:
        session.close()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
