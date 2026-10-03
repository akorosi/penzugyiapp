"""Egyszeri adatátköltöztetés a korábbi (SQLite-os) verzióból Aurora DSQL-be
vagy PostgreSQL-be.

Átviszi a tranzakciókat (a törölt / inaktív tételeket is, hogy a duplikátum-
védelem megmaradjon), a fő attribútumokat és a teljes al-attribútum fát, a
megadott felhasználó (--owner) tulajdonaként. A már meglévő tételeket (azonos
duplikátum-azonosító) kihagyja, így többször is futtatható.

Használat (AWS hitelesítő adatokkal, a Terraform kimenetéből vett végponttal):

    cd app
    DSQL_ENDPOINT=$(terraform -chdir=../infra output -raw dsql_endpoint) \\
        python import_sqlite.py --owner hundjmada@gmail.com /útvonal/penzugyek.db
"""

from __future__ import annotations

import argparse
import sqlite3
import uuid
from datetime import date, datetime, timezone

import db
from excel_parser import make_hash
from repository import IMPORT_CHUNK, existing_hashes


def _dt(value):
    """A régi adatbázis naiv UTC időbélyegeit időzóna-helyesen adjuk tovább."""
    if value is None:
        return None
    dt = value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sqlite_path")
    ap.add_argument("--owner", required=True, help="a tételek tulajdonosa (a felhasználó e-mail címe)")
    args = ap.parse_args()
    owner = args.owner.strip().lower()

    src = sqlite3.connect(args.sqlite_path)
    src.row_factory = sqlite3.Row
    txs = [dict(r) for r in src.execute("SELECT * FROM transactions ORDER BY id")]
    attrs = [dict(r) for r in src.execute("SELECT * FROM attributes ORDER BY id")]
    print(f"Forrás: {len(txs)} tranzakció, {len(attrs)} al-attribútum")

    db.migrate()
    # A duplikátum-azonosító a tulajdonost is tartalmazza → újraszámoljuk.
    for t in txs:
        t["tx_hash"] = make_hash(
            {"date": date.fromisoformat(str(t["date"])[:10]), "tx_type": t["tx_type"] or "",
             "description": t["description"] or "", "amount": float(t["amount"])},
            owner,
        )
    skip = existing_hashes(owner, [t["tx_hash"] for t in txs])
    tx_ids = {t["id"]: uuid.uuid4() for t in txs if t["tx_hash"] not in skip}
    attr_ids = {a["id"]: uuid.uuid4() for a in attrs if a["transaction_id"] in tx_ids}

    tx_rows = [
        (
            tx_ids[t["id"]], owner, date.fromisoformat(str(t["date"])[:10]), t["tx_type"], t["description"], float(t["amount"]),
            t["main_category"], t["category_source"] or "none", t["tx_hash"],
            bool(t.get("is_active", 1)), _dt(t.get("created_at")) or datetime.now(timezone.utc), _dt(t.get("updated_at")) or datetime.now(timezone.utc),
        )
        for t in txs
        if t["id"] in tx_ids
    ]
    attr_rows = [
        (attr_ids[a["id"]], tx_ids[a["transaction_id"]], attr_ids.get(a["parent_id"]), a["name"], _dt(a.get("created_at")) or datetime.now(timezone.utc))
        for a in attrs
        if a["id"] in attr_ids
    ]

    for i in range(0, len(tx_rows), IMPORT_CHUNK):
        chunk = tx_rows[i : i + IMPORT_CHUNK]
        db.run_in_transaction(
            lambda c, chunk=chunk: c.execute(
                "INSERT INTO transactions (id, owner, date, tx_type, description, amount, main_category, category_source,"
                " tx_hash, is_active, created_at, updated_at) VALUES "
                + ", ".join(["(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"] * len(chunk)),
                [v for row in chunk for v in row],
            )
        )
    for i in range(0, len(attr_rows), IMPORT_CHUNK):
        chunk = attr_rows[i : i + IMPORT_CHUNK]
        db.run_in_transaction(
            lambda c, chunk=chunk: c.execute(
                "INSERT INTO attributes (id, transaction_id, parent_id, name, created_at) VALUES "
                + ", ".join(["(%s, %s, %s, %s, %s)"] * len(chunk)),
                [v for row in chunk for v in row],
            )
        )
    print(f"Kész: {len(tx_rows)} tranzakció és {len(attr_rows)} al-attribútum átmásolva, {len(skip)} már létezett.")


if __name__ == "__main__":
    main()
