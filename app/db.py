"""Adatbázis-kapcsolat: Amazon Aurora DSQL (AWS) vagy sima PostgreSQL (helyi fejlesztés).

Konfiguráció környezeti változókkal:
  - DSQL_ENDPOINT  → Aurora DSQL klaszter végpontja (pl. abc123.dsql.eu-central-1.on.aws).
                     A jelszó egy rövid életű IAM auth token, amit a boto3 generál a
                     futtató szerepkör (Lambda execution role) jogosultságaival.
  - DATABASE_URL   → hagyományos PostgreSQL kapcsolati URL (helyi Docker Compose).

Aurora DSQL sajátosságok, amelyekhez a séma és a lekérdezések igazodnak:
  - nincs idegen kulcs, szekvencia/SERIAL → UUID elsődleges kulcsok, a kapcsolatokat
    az alkalmazás tartja karban;
  - DDL és DML nem keveredhet egy tranzakcióban, indexet CREATE INDEX ASYNC hoz létre;
  - optimista konkurenciakezelés → ütközéskor (SQLSTATE 40001) a tranzakciót újra kell
    próbálni (lásd run_in_transaction);
  - egy tranzakció legfeljebb 3000 sort módosíthat → a nagy importot darabolva írjuk.
"""

from __future__ import annotations

import os
import random
import time
from typing import Callable, TypeVar

import psycopg
from psycopg import errors
from psycopg.rows import dict_row

T = TypeVar("T")

DSQL_ENDPOINT = os.environ.get("DSQL_ENDPOINT", "").strip()
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
IS_DSQL = bool(DSQL_ENDPOINT)

# A DSQL kapcsolatok legfeljebb 1 óráig élhetnek; ennél jóval korábban újranyitjuk.
_MAX_CONN_AGE_S = 45 * 60
_conn: psycopg.Connection | None = None
_conn_opened_at = 0.0


def _region() -> str:
    region = os.environ.get("DSQL_REGION") or os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
    if region:
        return region
    # <id>.dsql.<region>.on.aws
    parts = DSQL_ENDPOINT.split(".")
    if len(parts) >= 3 and parts[1] == "dsql":
        return parts[2]
    raise RuntimeError("Nem állapítható meg az AWS régió a DSQL kapcsolathoz (AWS_REGION).")


def _connect() -> psycopg.Connection:
    if IS_DSQL:
        import boto3  # csak AWS módban szükséges

        token = boto3.client("dsql", region_name=_region()).generate_db_connect_admin_auth_token(
            DSQL_ENDPOINT, _region()
        )
        return psycopg.connect(
            host=DSQL_ENDPOINT,
            port=5432,
            dbname="postgres",
            user="admin",
            password=token,
            sslmode=os.environ.get("DSQL_SSLMODE", "verify-full"),
            sslrootcert=os.environ.get("DSQL_SSLROOTCERT", "system"),
            connect_timeout=10,
            autocommit=True,
            row_factory=dict_row,
        )
    if DATABASE_URL:
        return psycopg.connect(DATABASE_URL, autocommit=True, row_factory=dict_row, connect_timeout=10)
    raise RuntimeError("Nincs adatbázis beállítva: adj meg DSQL_ENDPOINT vagy DATABASE_URL környezeti változót.")


def get_conn() -> psycopg.Connection:
    """Folyamatonként egy, újrahasznosított kapcsolat (a Lambda meleg indításai között is)."""
    global _conn, _conn_opened_at
    expired = time.monotonic() - _conn_opened_at > _MAX_CONN_AGE_S
    if _conn is None or _conn.closed or _conn.broken or expired:
        if _conn is not None and not _conn.closed:
            try:
                _conn.close()
            except Exception:
                pass
        _conn = _connect()
        _conn_opened_at = time.monotonic()
    return _conn


def reset_conn() -> None:
    global _conn
    if _conn is not None:
        try:
            _conn.close()
        except Exception:
            pass
    _conn = None


def run_in_transaction(fn: Callable[[psycopg.Connection], T], retries: int = 4) -> T:
    """fn(conn) futtatása egy tranzakcióban; konkurencia-ütközésnél (40001) és
    megszakadt kapcsolatnál újrapróbálja, exponenciális várakozással."""
    attempt = 0
    while True:
        conn = get_conn()
        try:
            with conn.transaction():
                return fn(conn)
        except (errors.SerializationFailure, psycopg.OperationalError) as e:
            attempt += 1
            if isinstance(e, psycopg.OperationalError) and not isinstance(e, errors.SerializationFailure):
                reset_conn()
            if attempt > retries:
                raise
            time.sleep(min(2.0, 0.05 * 2**attempt) * (0.5 + random.random()))


# ---------- séma ----------

SCHEMA_TABLES = [
    """
    CREATE TABLE IF NOT EXISTS transactions (
        id              UUID PRIMARY KEY,
        date            DATE NOT NULL,
        tx_type         TEXT,
        description     TEXT,
        amount          DOUBLE PRECISION NOT NULL,
        main_category   TEXT,
        category_source TEXT NOT NULL DEFAULT 'none',
        tx_hash         TEXT NOT NULL UNIQUE,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS attributes (
        id             UUID PRIMARY KEY,
        transaction_id UUID NOT NULL,
        parent_id      UUID,
        name           TEXT NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
]

# (index neve, tábla, oszlopok)
SCHEMA_INDEXES = [
    ("ix_transactions_date", "transactions", "date"),
    ("ix_transactions_main_category", "transactions", "main_category"),
    ("ix_attributes_transaction_id", "attributes", "transaction_id"),
]


def migrate() -> list[str]:
    """Idempotens sémalétrehozás. Minden DDL külön (autocommit) utasítás — DSQL-ben
    ez kötelező. Visszaadja a végrehajtott lépések listáját."""
    conn = get_conn()
    done: list[str] = []
    for ddl in SCHEMA_TABLES:
        conn.execute(ddl)
        done.append(" ".join(ddl.split())[:60] + "…")
    for name, table, cols in SCHEMA_INDEXES:
        exists = conn.execute("SELECT 1 FROM pg_indexes WHERE indexname = %s", (name,)).fetchone()
        if exists:
            continue
        # DSQL-ben az index aszinkron épül; sima PostgreSQL-ben nincs ASYNC kulcsszó.
        kw = "INDEX ASYNC" if IS_DSQL else "INDEX"
        conn.execute(f"CREATE {kw} {name} ON {table} ({cols})")
        done.append(f"CREATE {kw} {name}")
    return done
