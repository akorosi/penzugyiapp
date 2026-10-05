"""Adat-hozzáférési réteg (sima SQL, DSQL-kompatibilis: nincs idegen kulcs,
nincs tömb-paraméter, a tranzakciók rövidek és darabolt írásúak).

Minden művelet egy tulajdonosra (a bejelentkezett felhasználó e-mail címére)
szűkít: egy felhasználó csak a saját tételeit és al-attribútumait látja és
módosíthatja. Az al-attribútumok tulajdonosa a hozzájuk tartozó tranzakcióé.
"""

from __future__ import annotations

import uuid
from typing import Iterable

import psycopg

from db import get_conn, run_in_transaction

# Egy DSQL tranzakció legfeljebb 3000 sort módosíthat; tételenként legfeljebb
# 2 sort írunk (tranzakció + opcionális al-attribútum), így ez bőven belefér.
IMPORT_CHUNK = 500


class NotFound(Exception):
    pass


class Invalid(Exception):
    pass


def _placeholders(n: int) -> str:
    return ", ".join(["%s"] * n)


def _chunks(seq: list, size: int) -> Iterable[list]:
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


# ---------- szerializálás ----------

def _build_tree(rows: list[dict]) -> dict[str, list[dict]]:
    """attribute sorok → {transaction_id: [gyökér csomópontok fa-szerkezetben]}"""
    nodes = {
        r["id"]: {"id": str(r["id"]), "name": r["name"], "parent_id": str(r["parent_id"]) if r["parent_id"] else None, "children": []}
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


def _tx_attrs(conn: psycopg.Connection, tx_id: str) -> list[dict]:
    return conn.execute(
        f"SELECT {_ATTR_COLS} FROM attributes WHERE transaction_id = %s ORDER BY created_at, id", (tx_id,)
    ).fetchall()


def _owned_tx_id_of_attribute(conn: psycopg.Connection, owner: str, attr_id: str) -> str:
    """Az attribútum tranzakciójának azonosítója — ha a tranzakció a felhasználóé."""
    row = conn.execute(
        """SELECT a.transaction_id FROM attributes a JOIN transactions t ON t.id = a.transaction_id
           WHERE a.id = %s AND t.owner = %s AND t.is_active""",
        (attr_id, owner),
    ).fetchone()
    if not row:
        raise NotFound("Az attribútum nem található.")
    return str(row["transaction_id"])


# ---------- olvasás ----------

def list_transactions(owner: str) -> list[dict]:
    conn = get_conn()
    txs = conn.execute(
        f"SELECT {_TX_COLS} FROM transactions WHERE owner = %s AND is_active ORDER BY date DESC, created_at DESC, id DESC",
        (owner,),
    ).fetchall()
    attrs = conn.execute(
        """SELECT a.id, a.transaction_id, a.parent_id, a.name
           FROM attributes a JOIN transactions t ON t.id = a.transaction_id
           WHERE t.owner = %s AND t.is_active
           ORDER BY a.created_at, a.id""",
        (owner,),
    ).fetchall()
    trees = _build_tree(attrs)
    return [_serialize_tx(t, trees.get(str(t["id"]), [])) for t in txs]


def get_transaction(conn: psycopg.Connection, owner: str, tx_id: str) -> dict | None:
    row = conn.execute(
        f"SELECT {_TX_COLS} FROM transactions WHERE id = %s AND owner = %s AND is_active", (tx_id, owner)
    ).fetchone()
    if not row:
        return None
    return _serialize_tx(row, _build_tree(_tx_attrs(conn, tx_id)).get(str(row["id"]), []))


def list_categories(owner: str) -> list[str]:
    rows = get_conn().execute(
        "SELECT DISTINCT main_category FROM transactions WHERE owner = %s AND is_active AND main_category IS NOT NULL",
        (owner,),
    ).fetchall()
    return sorted({r["main_category"] for r in rows if r["main_category"]})


# ---------- import ----------

def existing_hashes(owner: str, hashes: list[str]) -> set[str]:
    """Szándékosan NINCS is_active szűrés: a törölt (soft delete) tételek hash-e is
    számít, így egy korábban törölt tétel újrafeltöltéskor sem kerül vissza."""
    found: set[str] = set()
    conn = get_conn()
    for chunk in _chunks(hashes, IMPORT_CHUNK):
        rows = conn.execute(
            f"SELECT tx_hash FROM transactions WHERE owner = %s AND tx_hash IN ({_placeholders(len(chunk))})",
            [owner, *chunk],
        ).fetchall()
        found.update(r["tx_hash"] for r in rows)
    return found


def insert_transactions(owner: str, items: list[dict]) -> int:
    """items: {date, tx_type, description, amount, tx_hash, main_category,
    category_source, sub_category}. Darabonként külön tranzakcióban ír."""
    inserted = 0
    for chunk in _chunks(items, IMPORT_CHUNK):
        tx_rows, attr_rows = [], []
        for it in chunk:
            tx_id = uuid.uuid4()
            tx_rows.append(
                (tx_id, owner, it["date"], it["tx_type"], it["description"], it["amount"],
                 it.get("main_category"), it.get("category_source", "none"), it["tx_hash"])
            )
            if it.get("sub_category"):
                attr_rows.append((uuid.uuid4(), tx_id, None, it["sub_category"]))

        def write(conn: psycopg.Connection, tx_rows=tx_rows, attr_rows=attr_rows) -> None:
            conn.execute(
                "INSERT INTO transactions (id, owner, date, tx_type, description, amount, main_category, category_source, tx_hash) VALUES "
                + ", ".join(["(%s, %s, %s, %s, %s, %s, %s, %s, %s)"] * len(tx_rows)),
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


def adopt_legacy_rows(owner: str, hash_fn) -> int:
    """A többfelhasználós verzió előtti (tulajdonos nélküli) tételek átadása egy
    felhasználónak; a duplikátum-azonosítót a tulajdonossal együtt újraszámolja."""
    if not owner:
        return 0
    adopted = 0
    while True:
        rows = get_conn().execute(
            f"SELECT id, date, tx_type, description, amount FROM transactions WHERE owner IS NULL LIMIT {IMPORT_CHUNK}"
        ).fetchall()
        if not rows:
            return adopted

        def write(conn: psycopg.Connection, rows=rows) -> None:
            for r in rows:
                rec = {"date": r["date"], "tx_type": r["tx_type"] or "", "description": r["description"] or "", "amount": r["amount"]}
                conn.execute(
                    "UPDATE transactions SET owner = %s, tx_hash = %s WHERE id = %s AND owner IS NULL",
                    (owner, hash_fn(rec, owner), r["id"]),
                )

        run_in_transaction(write)
        adopted += len(rows)


# ---------- módosítás ----------

def set_main_category(owner: str, tx_id: str, value: str | None) -> dict | None:
    def op(conn: psycopg.Connection):
        cur = conn.execute(
            """UPDATE transactions SET main_category = %s, category_source = 'manual', updated_at = now()
               WHERE id = %s AND owner = %s AND is_active""",
            (value, tx_id, owner),
        )
        if cur.rowcount == 0:
            return None
        return get_transaction(conn, owner, tx_id)

    return run_in_transaction(op)


def soft_delete_transaction(owner: str, tx_id: str) -> bool:
    def op(conn: psycopg.Connection) -> bool:
        cur = conn.execute(
            "UPDATE transactions SET is_active = FALSE, updated_at = now() WHERE id = %s AND owner = %s AND is_active",
            (tx_id, owner),
        )
        return cur.rowcount > 0

    return run_in_transaction(op)


def add_attribute(owner: str, tx_id: str, name: str, parent_id: str | None) -> dict:
    def op(conn: psycopg.Connection) -> dict:
        if not conn.execute(
            "SELECT 1 FROM transactions WHERE id = %s AND owner = %s AND is_active", (tx_id, owner)
        ).fetchone():
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


def rename_attribute(owner: str, attr_id: str, name: str) -> dict:
    def op(conn: psycopg.Connection) -> dict:
        tx_id = _owned_tx_id_of_attribute(conn, owner, attr_id)
        conn.execute("UPDATE attributes SET name = %s WHERE id = %s", (name, attr_id))
        tree = _build_tree(_tx_attrs(conn, tx_id))

        def find(nodes: list[dict]) -> dict | None:
            for n in nodes:
                if n["id"] == attr_id:
                    return n
                hit = find(n["children"])
                if hit:
                    return hit
            return None

        return find(tree.get(tx_id, [])) or {"id": attr_id, "name": name, "parent_id": None, "children": []}

    return run_in_transaction(op)


def delete_attribute(owner: str, attr_id: str) -> list[str]:
    """Törli a csomópontot és a teljes alatta lévő ágat (idegen kulcs/kaszkád
    nélkül, ezért az alkalmazás gyűjti össze a leszármazottakat)."""

    def op(conn: psycopg.Connection) -> list[str]:
        tx_id = _owned_tx_id_of_attribute(conn, owner, attr_id)
        rows = conn.execute("SELECT id, parent_id FROM attributes WHERE transaction_id = %s", (tx_id,)).fetchall()
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


# ---------- tömeges fő attribútum beállítás ----------

def bulk_set_main_category(owner: str, tx_ids: list[str], value: str | None) -> int:
    """Több tétel fő attribútumának egyszerre történő (kézi) beállítása.
    Darabolva írunk, hogy egy DSQL tranzakció sormódosítási korlátja ne teljen be."""
    updated = 0
    for chunk in _chunks(list(dict.fromkeys(tx_ids)), IMPORT_CHUNK):

        def op(conn: psycopg.Connection, chunk=chunk) -> int:
            cur = conn.execute(
                f"""UPDATE transactions SET main_category = %s, category_source = 'manual', updated_at = now()
                    WHERE owner = %s AND is_active AND id IN ({_placeholders(len(chunk))})""",
                (value, owner, *chunk),
            )
            return cur.rowcount

        updated += run_in_transaction(op)
    return updated


# ---------- saját kategorizálási szabályok ----------

_RULE_COLS = "id, pattern, main_category, created_at"


def _serialize_rule(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "pattern": row["pattern"],
        "main_category": row["main_category"],
        "created_at": row["created_at"].isoformat(),
    }


def list_rules(owner: str) -> list[dict]:
    rows = get_conn().execute(
        f"SELECT {_RULE_COLS} FROM category_rules WHERE owner = %s ORDER BY lower(pattern), id", (owner,)
    ).fetchall()
    return [_serialize_rule(r) for r in rows]


def rules_for_matching(owner: str) -> list[tuple[str, str]]:
    """(kisbetűs minta, fő attribútum) párok; a hosszabb (specifikusabb) minta nyer."""
    rules = [(r["pattern"].lower(), r["main_category"]) for r in list_rules(owner)]
    return sorted(rules, key=lambda r: -len(r[0]))


def match_rule(rules: list[tuple[str, str]], description: str | None) -> str | None:
    desc = (description or "").lower()
    if not desc:
        return None
    return next((cat for pattern, cat in rules if pattern in desc), None)


def save_rule(owner: str, pattern: str, main_category: str) -> dict:
    """Új szabály; ha ugyanez a minta (kis/nagybetűtől függetlenül) már létezik,
    annak fő attribútumát írja felül."""

    def op(conn: psycopg.Connection) -> dict:
        row = conn.execute(
            f"""UPDATE category_rules SET pattern = %s, main_category = %s
                WHERE owner = %s AND lower(pattern) = lower(%s) RETURNING {_RULE_COLS}""",
            (pattern, main_category, owner, pattern),
        ).fetchone()
        if row is None:
            row = conn.execute(
                f"""INSERT INTO category_rules (id, owner, pattern, main_category) VALUES (%s, %s, %s, %s)
                    RETURNING {_RULE_COLS}""",
                (str(uuid.uuid4()), owner, pattern, main_category),
            ).fetchone()
        return _serialize_rule(row)

    return run_in_transaction(op)


def delete_rule(owner: str, rule_id: str) -> bool:
    def op(conn: psycopg.Connection) -> bool:
        cur = conn.execute("DELETE FROM category_rules WHERE id = %s AND owner = %s", (rule_id, owner))
        return cur.rowcount > 0

    return run_in_transaction(op)


def apply_rule_to_existing(owner: str, pattern: str, main_category: str) -> list[str]:
    """A szabály alkalmazása a már meglévő, fő attribútum nélküli kiadásokra.
    Visszaadja a módosított tételek azonosítóit."""
    rules = [(pattern.lower(), main_category)]
    rows = get_conn().execute(
        """SELECT id, description FROM transactions
           WHERE owner = %s AND is_active AND amount < 0
             AND (main_category IS NULL OR btrim(main_category) = '')""",
        (owner,),
    ).fetchall()
    ids = [str(r["id"]) for r in rows if match_rule(rules, r["description"])]
    for chunk in _chunks(ids, IMPORT_CHUNK):

        def op(conn: psycopg.Connection, chunk=chunk) -> None:
            conn.execute(
                f"""UPDATE transactions SET main_category = %s, category_source = 'rule', updated_at = now()
                    WHERE owner = %s AND is_active AND (main_category IS NULL OR btrim(main_category) = '')
                      AND id IN ({_placeholders(len(chunk))})""",
                (main_category, owner, *chunk),
            )

        run_in_transaction(op)
    return ids
