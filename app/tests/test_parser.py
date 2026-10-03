from datetime import date

from conftest import SAMPLE_ROWS, make_xlsx
from excel_parser import make_hash, parse_cib_statement


def test_parses_from_row_11_without_filtering():
    recs = parse_cib_statement(make_xlsx(SAMPLE_ROWS))
    assert len(recs) == 4  # a dátum nélküli sor kimarad
    assert recs[0] == {
        "date": date(2026, 9, 28),
        "tx_type": "Kártyás vásárlás",
        "description": "SPAR 123 BUDAPEST",
        "amount": -12345.0,
    }
    # szöveges dátum és szóközös összeg
    assert recs[3]["date"] == date(2026, 9, 25)
    assert recs[3]["amount"] == -1500.0


def test_hash_is_stable():
    rec = {"date": date(2026, 1, 2), "tx_type": "a", "description": "b", "amount": -1.0}
    assert make_hash(rec) == make_hash(dict(rec))
    assert make_hash(rec) != make_hash({**rec, "amount": -2.0})


def test_rejects_garbage():
    import pytest

    with pytest.raises(ValueError):
        parse_cib_statement(b"not an excel file")
