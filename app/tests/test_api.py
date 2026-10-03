import io

import pytest

from conftest import AUTH, SAMPLE_ROWS, make_xlsx

pytestmark = pytest.mark.needs_db


def upload(client, rows=SAMPLE_ROWS):
    return client.post(
        "/api/upload",
        data={"file": (io.BytesIO(make_xlsx(rows)), "tranzakciok.xlsx")},
        headers=AUTH,
        content_type="multipart/form-data",
    )


def test_requires_access_key(client):
    assert client.get("/api/transactions").status_code == 401
    assert client.get("/api/transactions", headers={"X-Access-Key": "wrong"}).status_code == 401
    assert client.get("/api/transactions", headers=AUTH).status_code == 200
    # A CloudFront SigV4 aláírása (Authorization) nem helyettesíti a kulcsot
    assert client.get("/api/transactions", headers={"Authorization": "Bearer test-key"}).status_code == 401


def test_upload_categorizes_and_deduplicates(client):
    r = upload(client)
    assert r.status_code == 200, r.json
    assert r.json == {"inserted": 4, "skipped": 0, "total_parsed": 4}

    txs = client.get("/api/transactions", headers=AUTH).json
    assert [t["date"] for t in txs] == ["2026-09-28", "2026-09-27", "2026-09-26", "2026-09-25"]
    by_desc = {t["description"]: t for t in txs}
    assert by_desc["SPAR 123 BUDAPEST"]["main_category"] == "bevásárlás"
    assert by_desc["SPAR 123 BUDAPEST"]["category_source"] == "auto"
    kincstar = by_desc["MAGYAR ALLAMKINCSTAR"]
    assert kincstar["main_category"] == "gyerekek"
    assert [a["name"] for a in kincstar["attributes"]] == ["babakötvény"]
    assert by_desc["MUNKABER ACME KFT"]["main_category"] == "bevétel"
    assert by_desc["MUNKABER ACME KFT"]["kind"] == "bevétel"
    assert by_desc["Ismeretlen bolt"]["main_category"] is None

    # Ismételt feltöltés: minden tétel kimarad
    assert upload(client).json == {"inserted": 0, "skipped": 4, "total_parsed": 4}
    assert client.get("/api/categories", headers=AUTH).json == ["bevásárlás", "bevétel", "gyerekek"]


def test_main_category_and_savings(client):
    upload(client)
    tx = client.get("/api/transactions", headers=AUTH).json[0]
    r = client.patch(f"/api/transactions/{tx['id']}", json={"main_category": "  Megtakarítás "}, headers=AUTH)
    assert r.status_code == 200
    assert r.json["main_category"] == "Megtakarítás"
    assert r.json["category_source"] == "manual"
    assert r.json["kind"] == "megtakarítás"

    r = client.patch(f"/api/transactions/{tx['id']}", json={"main_category": ""}, headers=AUTH)
    assert r.json["main_category"] is None


def test_attribute_tree_crud(client):
    upload(client)
    tx = client.get("/api/transactions", headers=AUTH).json[0]
    tid = tx["id"]
    root = client.post(f"/api/transactions/{tid}/attributes", json={"name": "a"}, headers=AUTH).json
    child = client.post(f"/api/transactions/{tid}/attributes", json={"name": "b", "parent_id": root["id"]}, headers=AUTH).json
    client.post(f"/api/transactions/{tid}/attributes", json={"name": "c", "parent_id": child["id"]}, headers=AUTH)

    renamed = client.patch(f"/api/attributes/{child['id']}", json={"name": "B"}, headers=AUTH).json
    assert renamed["name"] == "B" and [c["name"] for c in renamed["children"]] == ["c"]

    tx = next(t for t in client.get("/api/transactions", headers=AUTH).json if t["id"] == tid)
    assert tx["attributes"][0]["name"] == "a"
    assert tx["attributes"][0]["children"][0]["children"][0]["name"] == "c"

    # Szülő más tranzakcióból → hiba
    other = client.get("/api/transactions", headers=AUTH).json[1]["id"]
    r = client.post(f"/api/transactions/{other}/attributes", json={"name": "x", "parent_id": root["id"]}, headers=AUTH)
    assert r.status_code == 400

    deleted = client.delete(f"/api/attributes/{root['id']}", headers=AUTH).json["deleted"]
    assert len(deleted) == 3
    tx = next(t for t in client.get("/api/transactions", headers=AUTH).json if t["id"] == tid)
    assert tx["attributes"] == []


def test_soft_delete_survives_reupload(client):
    upload(client)
    txs = client.get("/api/transactions", headers=AUTH).json
    assert client.delete(f"/api/transactions/{txs[0]['id']}", headers=AUTH).status_code == 200
    assert client.delete(f"/api/transactions/{txs[0]['id']}", headers=AUTH).status_code == 404
    assert len(client.get("/api/transactions", headers=AUTH).json) == 3
    assert upload(client).json["inserted"] == 0
    assert len(client.get("/api/transactions", headers=AUTH).json) == 3


def test_invalid_ids_and_files(client):
    assert client.patch("/api/transactions/123", json={"main_category": "x"}, headers=AUTH).status_code == 404
    assert client.delete("/api/attributes/not-a-uuid", headers=AUTH).status_code == 404
    r = client.post(
        "/api/upload",
        data={"file": (io.BytesIO(b"x"), "a.csv")},
        headers=AUTH,
        content_type="multipart/form-data",
    )
    assert r.status_code == 400
