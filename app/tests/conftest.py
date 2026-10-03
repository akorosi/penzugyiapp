"""Teszt-beállítás: valódi PostgreSQL ellen futnak (TEST_DATABASE_URL), mert a
DSQL-kompatibilis SQL-t nem lehet SQLite-tal hitelesen tesztelni.

    TEST_DATABASE_URL=postgresql://postgres@localhost:5432/penzugy_test pytest
"""

import io
import os
import sys
from datetime import date

import pytest

TEST_DB = os.environ.get("TEST_DATABASE_URL")
if TEST_DB:
    os.environ["DATABASE_URL"] = TEST_DB
os.environ.pop("DSQL_ENDPOINT", None)
os.environ.pop("AWS_LAMBDA_FUNCTION_NAME", None)
os.environ["ACCESS_KEY"] = "test-key"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

AUTH = {"X-Access-Key": "test-key"}


def pytest_collection_modifyitems(config, items):
    if TEST_DB:
        return
    skip = pytest.mark.skip(reason="TEST_DATABASE_URL nincs beállítva")
    for item in items:
        if "needs_db" in item.keywords:
            item.add_marker(skip)


def pytest_configure(config):
    config.addinivalue_line("markers", "needs_db: PostgreSQL adatbázist igénylő teszt")


@pytest.fixture()
def client():
    import db
    from main import app

    db.migrate()
    conn = db.get_conn()
    conn.execute("DELETE FROM attributes")
    conn.execute("DELETE FROM transactions")
    return app.test_client()


def make_xlsx(rows: list[tuple]) -> bytes:
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.cell(1, 1, "CIB Bank — számlakivonat")
    for i, row in enumerate(rows):
        for j, v in enumerate(row):
            ws.cell(11 + i, 1 + j, v)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


SAMPLE_ROWS = [
    (date(2026, 9, 28), "Kártyás vásárlás", "SPAR 123 BUDAPEST", -12345),
    (date(2026, 9, 27), "Kártyás vásárlás", "MAGYAR ALLAMKINCSTAR", -50000),
    (date(2026, 9, 26), "Jóváírás", "MUNKABER ACME KFT", 650000),
    ("2026.09.25", "Kártyás vásárlás", "Ismeretlen bolt", "-1 500"),
    (None, None, "összesen sor, dátum nélkül", 0),
]
