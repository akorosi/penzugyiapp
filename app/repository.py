"""Adat-hozzáférési réteg (sima SQL, DSQL-kompatibilis: nincs idegen kulcs,
nincs tömb-paraméter, a tranzakciók rövidek és darabolt írásúak)."""

from __future__ import annotations

import uuid
from typing import Iterable

import psycopg

from db import get_conn, run_in_transaction

# Egy DSQL tranzakció legfeljebb 3000 sort módosíthat; tételenként legfeljebb
# 2 sort írunk (tranzakció + opcionális al-attribútum), így ez bőven belefér.
IMPORT_CHUNK = 500


def _placeholders(n: int) -> str:
    return ", ".join(["%s"] * n)


def _chunks(seq: list, size: int) -> Iterable[list]:
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


# ---------- szerializálás ----------

def _build_tree(rows: list[dict]) -> dict[str, list[dict]]:
    """attribute sorok → {transaction_id: [gyökér csomópontok fa-szerkezetben]}"""
    nodes = {
        r["id"]: {"id": str(r["id"]), "name": r["name"], "parent_id": str(r["parent_id"]) if r["parent_id"] else None, "children": [], "_tx": r["transaction_id"]}
        for r in rows
    }
    roots: dict[str, list[dict]] = {}
    for r in rows:  # a sorok létrehozási sorrendben jönnek → stabil megjelenítés
        node = nodes[r["id"]]
        parent = nodes.get(r["parent_id"]) if r["parent_id"] else None
        if parent is not None:
            parent["children"].append(node)
        elif r["parent_id"] is None:
            roots.setdefault(str(r["transaction_id"]), []).append(node)
        # árva csomópont (törölt szülő) → nem jelenítjük meg
    for n in nodes.values():
        n.pop("_tx", None)
    return roots


def kind_of(amount: float, main_category: str | None) -> str:
    """bevétel / kiadás / megtakarítás — utóbbi akkor, ha a fő attribútum
    (bármilyen előjelű összeg esetén) 'megtakarítás'."""
    if (main_category or "").strip().lower() == "megtakarítás":
        return "megtakarítás"
    return "bevétel" if amount >= 0 else "kiadás"


def _serialize_tx(row: dict, attrs: list[dict]) -> dict:
    return {
        "id": str(row["id"]),
        "date": row["date"].isoformat(),
        "tx_type": row["tx_type"],
        "description": row["description"],
        "amount": row["amount"],
        "kind": kind_of(row["amount"], row["main_category"]),
        "main_category": row["main_category"],
        "category_source": row["category_source"],
        "attributes": attrs,
    }


_TX_COLS = "id, date, tx_type, description, amount, main_category, category_source"
_ATTR_COLS = "id, transaction_id, parent_id, name"


# ---------- olvasás ----------

def list_transactions() -> list[dict]:
    conn = get_conn()
    txs = conn.execute(
        f"SELECT {_TX_COLS} FROM transactions WHERE is_active ORDER BY date DESC, created_at DESC, id DESC"
    ).fetchall()
    attrs = conn.execute(
        f"""SELECT a.{_ATTR_COLS.replace(', ', ', a.')}
            FROM attributes a JOIN transactions t ON t.id = a.transaction_id
            WHERE t.is_active
            ORDER BY a.created_at, a.id"""
    ).fetchall()
    trees = _build_tree(attrs)
    return [_serialize_tx(t, trees.get(str(t["id"]), [])) for t in txs]


def get_transaction(conn: psycopg.Connection, tx_id: str) -> dict | None:
    row = conn.execute(f"SELECT {_TX_COLS} FROM transactions WHERE id = %s AND is_active", (tx_id,)).fetchone()
    if not row:
        return None
    attrs = conn.execute(
        f"SELECT {_ATTR_COLS} FROM attributes WHERE transaction_id = %s ORDER BY created_at, id", (tx_id,)
    ).fetchall()
    return _serialize_tx(row, _build_tree(attrs).get(str(row["id"]), []))


def list_categories() -> list[str]:
    rows = get_conn().execute(
        "SELECT DISTINCT main_category FROM transactions WHERE is_active AND main_category IS NOT NULL"
    ).fetchall()
    return sorted({r["main_category"] for r in rows if r["main_category"]})


# ---------- import ----------

def existing_hashes(hashes: list[str]) -> set[str]:
    """Szándékosan NINCS is_active szűrés: a törölt (soft delete) tételek hash-e is
    számít, így egy korábban törölt tétel újrafeltöltéskor sem kerül vissza."""
    found: set[str] = set()
    conn = get_conn()
    for chunk in _chunks(hashes, IMPORT_CHUNK):
        rows = conn.execute(
            f"SELECT tx_hash FROM transactions WHERE tx_hash IN ({_placeholders(len(chunk))})", chunk
        ).fetchall()
        found.update(r["tx_hash"] for r in rows)
    return found


def insert_transactions(items: list[dict]) -> int:
    """items: {date, tx_type, description, amount, tx_hash, main_category,
    category_source, sub_category}. Darabonként külön tranzakcióban ír."""
    inserted = 0
    for chunk in _chunks(items, IMPORT_CHUNK):
        tx_rows, attr_rows = [], []
        for it in chunk:
            tx_id = uuid.uuid4()
            tx_rows.append(
                (tx_id, it["date"], it["tx_type"], it["description"], it["amount"],
                 it.get("main_category"), it.get("category_source", "none"), it["tx_hash"])
            )
            if it.get("sub_category"):
                attr_rows.append((uuid.uuid4(), tx_id, None, it["sub_category"]))

        def write(conn: psycopg.Connection, tx_rows=tx_rows, attr_rows=attr_rows) -> None:
            conn.execute(
                "INSERT INTO transactions (id, date, tx_type, description, amount, main_category, category_source, tx_hash) VALUES "
                + ", ".join(["(%s, %s, %s, %s, %s, %s, %s, %s)"] * len(tx_rows)),
                [v for row in tx_rows for v in row],
            )
            if attr_rows:
                conn.execute(
                    "INSERT INTO attributes (id, transaction_id, parent_id, name) VALUES "
                    + ", ".join(["(%s, %s, %s, %s)"] * len(attr_rows)),
                    [v for row in attr_rows for v in row],
                )

        run_in_transaction(write)
        inserted += len(tx_rows)
    return inserted


# ---------- módosítás ----------

def set_main_category(tx_id: str, value: str | None) -> dict | None:
    def op(conn: psycopg.Connection):
        cur = conn.execute(
            """UPDATE transactions SET main_category = %s, category_source = 'manual', updated_at = now()
               WHERE id = %s AND is_active""",
            (value, tx_id),
        )
        if cur.rowcount == 0:
            return None
        return get_transaction(conn, tx_id)

    return run_in_transaction(op)


def soft_delete_transaction(tx_id: str) -> bool:
    def op(conn: psycopg.Connection) -> bool:
        cur = conn.execute(
            "UPDATE transactions SET is_active = FALSE, updated_at = now() WHERE id = %s AND is_active", (tx_id,)
        )
        return cur.rowcount > 0

    return run_in_transaction(op)


class NotFound(Exception):
    pass


class Invalid(Exception):
    pass


def add_attribute(tx_id: str, name: str, parent_id: str | None) -> dict:
    def op(conn: psycopg.Connection) -> dict:
        if not conn.execute("SELECT 1 FROM transactions WHERE id = %s AND is_active", (tx_id,)).fetchone():
            raise NotFound("A tranzakció nem található.")
        if parent_id:
            parent = conn.execute("SELECT transaction_id FROM attributes WHERE id = %s", (parent_id,)).fetchone()
            if not parent or str(parent["transaction_id"]) != tx_id:
                raise Invalid("Érvénytelen szülő attribútum.")
        new_id = uuid.uuid4()
        conn.execute(
            "INSERT INTO attributes (id, transaction_id, parent_id, name) VALUES (%s, %s, %s, %s)",
            (new_id, tx_id, parent_id, name),
        )
        return {"id": str(new_id), "name": name, "parent_id": parent_id, "children": []}

    return run_in_transaction(op)


def rename_attribute(attr_id: str, name: str) -> dict:
    def op(conn: psycopg.Connection) -> dict:
        row = conn.execute("SELECT transaction_id FROM attributes WHERE id = %s", (attr_id,)).fetchone()
        if not row:
            raise NotFound("Az attribútum nem található.")
        conn.execute("UPDATE attributes SET name = %s WHERE id = %s", (name, attr_id))
        attrs = conn.execute(
            f"SELECT {_ATTR_COLS} FROM attributes WHERE transaction_id = %s ORDER BY created_at, id",
            (row["transaction_id"],),
        ).fetchall()
        tree = _build_tree(attrs)

        def find(nodes: list[dict]) -> dict | None:
            for n in nodes:
                if n["id"] == attr_id:
                    return n
                hit = find(n["children"])
                if hit:
                    return hit
            return None

        return find(tree.get(str(row["transaction_id"]), [])) or {"id": attr_id, "name": name, "parent_id": None, "children": []}

    return run_in_transaction(op)


def delete_attribute(attr_id: str) -> list[str]:
    """Törli a csomópontot és a teljes alatta lévő ágat (idegen kulcs/kaszkád
    nélkül, ezért az alkalmazás gyűjti össze a leszármazottakat)."""

    def op(conn: psycopg.Connection) -> list[str]:
        row = conn.execute("SELECT transaction_id FROM attributes WHERE id = %s", (attr_id,)).fetchone()
        if not row:
            raise NotFound("Az attribútum nem található.")
        rows = conn.execute(
            "SELECT id, parent_id FROM attributes WHERE transaction_id = %s", (row["transaction_id"],)
        ).fetchall()
        children: dict[str, list[str]] = {}
        for r in rows:
            if r["parent_id"]:
                children.setdefault(str(r["parent_id"]), []).append(str(r["id"]))
        ids, stack = [], [attr_id]
        while stack:
            cur = stack.pop()
            ids.append(cur)
            stack.extend(children.get(cur, []))
        for chunk in _chunks(ids, IMPORT_CHUNK):
            conn.execute(f"DELETE FROM attributes WHERE id IN ({_placeholders(len(chunk))})", chunk)
        return ids

    return run_in_transaction(op)
