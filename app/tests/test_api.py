import io

import pytest

from conftest import HDR, SAMPLE_ROWS, USER_A, USER_B, login, make_xlsx

pytestmark = pytest.mark.needs_db


def upload(client, rows=SAMPLE_ROWS):
    return client.post(
        "/api/upload",
        data={"file": (io.BytesIO(make_xlsx(rows)), "tranzakciok.xlsx")},
        headers=HDR,
        content_type="multipart/form-data",
    )


def test_me(client):
    assert client.get("/api/me").json == {"email": USER_A, "auth": "cognito"}


def test_upload_categorizes_and_deduplicates(client):
    r = upload(client)
    assert r.status_code == 200, r.json
    assert r.json == {"inserted": 4, "skipped": 0, "total_parsed": 4}

    txs = client.get("/api/transactions").json
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
    assert client.get("/api/categories").json == ["bevásárlás", "bevétel", "gyerekek"]


def test_main_category_and_savings(client):
    upload(client)
    tx = client.get("/api/transactions").json[0]
    r = client.patch(f"/api/transactions/{tx['id']}", json={"main_category": "  Megtakarítás "}, headers=HDR)
    assert r.status_code == 200
    assert r.json["main_category"] == "Megtakarítás"
    assert r.json["category_source"] == "manual"
    assert r.json["kind"] == "megtakarítás"

    r = client.patch(f"/api/transactions/{tx['id']}", json={"main_category": ""}, headers=HDR)
    assert r.json["main_category"] is None


def test_attribute_tree_crud(client):
    upload(client)
    tx = client.get("/api/transactions").json[0]
    tid = tx["id"]
    root = client.post(f"/api/transactions/{tid}/attributes", json={"name": "a"}, headers=HDR).json
    child = client.post(f"/api/transactions/{tid}/attributes", json={"name": "b", "parent_id": root["id"]}, headers=HDR).json
    client.post(f"/api/transactions/{tid}/attributes", json={"name": "c", "parent_id": child["id"]}, headers=HDR)

    renamed = client.patch(f"/api/attributes/{child['id']}", json={"name": "B"}, headers=HDR).json
    assert renamed["name"] == "B" and [c["name"] for c in renamed["children"]] == ["c"]

    tx = next(t for t in client.get("/api/transactions").json if t["id"] == tid)
    assert tx["attributes"][0]["name"] == "a"
    assert tx["attributes"][0]["children"][0]["children"][0]["name"] == "c"

    # Szülő más tranzakcióból → hiba
    other = client.get("/api/transactions").json[1]["id"]
    r = client.post(f"/api/transactions/{other}/attributes", json={"name": "x", "parent_id": root["id"]}, headers=HDR)
    assert r.status_code == 400

    deleted = client.delete(f"/api/attributes/{root['id']}", headers=HDR).json["deleted"]
    assert len(deleted) == 3
    tx = next(t for t in client.get("/api/transactions").json if t["id"] == tid)
    assert tx["attributes"] == []


def test_soft_delete_survives_reupload(client):
    upload(client)
    txs = client.get("/api/transactions").json
    assert client.delete(f"/api/transactions/{txs[0]['id']}", headers=HDR).status_code == 200
    assert client.delete(f"/api/transactions/{txs[0]['id']}", headers=HDR).status_code == 404
    assert len(client.get("/api/transactions").json) == 3
    assert upload(client).json["inserted"] == 0
    assert len(client.get("/api/transactions").json) == 3


def test_invalid_ids_and_files(client):
    assert client.patch("/api/transactions/123", json={"main_category": "x"}, headers=HDR).status_code == 404
    assert client.delete("/api/attributes/not-a-uuid", headers=HDR).status_code == 404
    r = client.post(
        "/api/upload",
        data={"file": (io.BytesIO(b"x"), "a.csv")},
        headers=HDR,
        content_type="multipart/form-data",
    )
    assert r.status_code == 400


# ---------- hitelesítés és CSRF ----------

def test_requires_session(app_client):
    import auth

    assert app_client.get("/api/transactions").status_code == 401
    assert app_client.get("/api/me").status_code == 401
    # hamisított aláírás
    forged = auth.make_session(USER_A)[:-1] + ("0" if auth.make_session(USER_A)[-1] != "0" else "1")
    app_client.set_cookie(auth.SESSION_COOKIE, forged)
    assert app_client.get("/api/transactions").status_code == 401
    # lejárt munkamenet
    app_client.set_cookie(auth.SESSION_COOKIE, auth.make_session(USER_A, ttl=-10))
    assert app_client.get("/api/transactions").status_code == 401
    # érvényes aláírás, de nem engedélyezett cím (pl. időközben kivették a listából)
    app_client.set_cookie(auth.SESSION_COOKIE, auth.make_session("mallory@example.com"))
    assert app_client.get("/api/transactions").status_code == 401
    # a nyilvános végpontok elérhetők
    assert app_client.get("/api/health").status_code == 200


def test_mutations_require_csrf_header(client):
    upload(client)
    tx = client.get("/api/transactions").json[0]
    assert client.patch(f"/api/transactions/{tx['id']}", json={"main_category": "x"}).status_code == 403
    assert client.delete(f"/api/transactions/{tx['id']}").status_code == 403


# ---------- felhasználók elkülönítése ----------

def test_users_only_see_and_change_their_own_data(app_client):
    login(app_client, USER_A)
    upload(app_client)
    a_txs = app_client.get("/api/transactions").json
    a_tx = a_txs[0]
    a_attr = app_client.post(f"/api/transactions/{a_tx['id']}/attributes", json={"name": "titok"}, headers=HDR).json

    login(app_client, USER_B)
    assert app_client.get("/api/transactions").json == []
    assert app_client.get("/api/categories").json == []
    # Ugyanaz a kivonat B-nél is teljesen beimportálódik (külön duplikátum-tér)
    assert upload(app_client).json["inserted"] == 4
    b_ids = {t["id"] for t in app_client.get("/api/transactions").json}
    assert b_ids.isdisjoint({t["id"] for t in a_txs})

    # A tételeihez B nem fér hozzá
    assert app_client.patch(f"/api/transactions/{a_tx['id']}", json={"main_category": "x"}, headers=HDR).status_code == 404
    assert app_client.delete(f"/api/transactions/{a_tx['id']}", headers=HDR).status_code == 404
    assert app_client.post(f"/api/transactions/{a_tx['id']}/attributes", json={"name": "x"}, headers=HDR).status_code == 404
    assert app_client.patch(f"/api/attributes/{a_attr['id']}", json={"name": "x"}, headers=HDR).status_code == 404
    assert app_client.delete(f"/api/attributes/{a_attr['id']}", headers=HDR).status_code == 404

    login(app_client, USER_A)
    after = app_client.get("/api/transactions").json
    assert len(after) == 4
    assert next(t for t in after if t["id"] == a_tx["id"])["attributes"][0]["name"] == "titok"


def test_legacy_rows_are_adopted(app_client):
    import uuid
    from datetime import date

    import db
    import repository
    from excel_parser import make_hash

    conn = db.get_conn()
    conn.execute(
        "INSERT INTO transactions (id, date, tx_type, description, amount, tx_hash) VALUES (%s, %s, %s, %s, %s, %s)",
        (uuid.uuid4(), date(2025, 1, 2), "T", "SPAR", -100.0, "old-hash-without-owner"),
    )
    assert repository.adopt_legacy_rows(USER_A, make_hash) == 1
    assert repository.adopt_legacy_rows(USER_A, make_hash) == 0

    login(app_client, USER_A)
    txs = app_client.get("/api/transactions").json
    assert [t["description"] for t in txs] == ["SPAR"]
    # az újraszámolt azonosító miatt ugyanaz a tétel nem importálódik újra
    r = upload(app_client, [(date(2025, 1, 2), "T", "SPAR", -100)])
    assert r.json["inserted"] == 0


COCA = "5473 **** **** 2388A20260930 083633 650.00 HUF 5499 660741HU Budapest NYX CocaColaHBCMag NX286830 8909142"


def test_bulk_main_category(client):
    from datetime import date

    upload(client)
    txs = client.get("/api/transactions").json
    ids = [t["id"] for t in txs[:2]]
    r = client.post("/api/transactions/bulk-main-category", json={"ids": ids, "main_category": " étel "}, headers=HDR)
    assert r.status_code == 200 and r.json == {"updated": 2}
    after = {t["id"]: t for t in client.get("/api/transactions").json}
    assert all(after[i]["main_category"] == "étel" and after[i]["category_source"] == "manual" for i in ids)

    # Üres érték törli a fő attribútumot
    client.post("/api/transactions/bulk-main-category", json={"ids": ids[:1], "main_category": ""}, headers=HDR)
    assert next(t for t in client.get("/api/transactions").json if t["id"] == ids[0])["main_category"] is None

    assert client.post("/api/transactions/bulk-main-category", json={"ids": []}, headers=HDR).status_code == 400
    assert client.post("/api/transactions/bulk-main-category", json={"ids": ["x"]}, headers=HDR).status_code == 400

    # Más felhasználó tételeit nem módosíthatja
    login(client, USER_B)
    upload(client, [(date(2026, 9, 1), "T", "B tétele", -1)])
    r = client.post("/api/transactions/bulk-main-category", json={"ids": ids, "main_category": "x"}, headers=HDR)
    assert r.json == {"updated": 0}


def test_rules_apply_to_existing_and_future_imports(client):
    from datetime import date

    rows = [
        (date(2026, 9, 30), "Kártyás vásárlás", COCA, -650),
        (date(2026, 9, 29), "Kártyás vásárlás", COCA.replace("650.00", "900.00"), -900),
        (date(2026, 9, 28), "Kártyás vásárlás", COCA.replace("650.00", "100.00"), -100),
        (date(2026, 9, 27), "Jóváírás", "visszatérítés budapest nyx cocacolahbcmag", 500),
    ]
    upload(client, rows)
    # Egy tételt kézzel már beállított → azt a szabály nem írja felül
    manual = next(t for t in client.get("/api/transactions").json if t["amount"] == -100)
    client.patch(f"/api/transactions/{manual['id']}", json={"main_category": "egyéb"}, headers=HDR)

    assert client.post("/api/rules", json={"pattern": "ab", "main_category": "x"}, headers=HDR).status_code == 400
    assert client.post("/api/rules", json={"pattern": "abc", "main_category": " "}, headers=HDR).status_code == 400

    r = client.post(
        "/api/rules", json={"pattern": "  budapest  NYX cocacolahbcmag ", "main_category": "üdítő"}, headers=HDR
    )
    assert r.status_code == 200, r.json
    assert r.json["applied"] == 2
    assert r.json["rule"]["pattern"] == "budapest NYX cocacolahbcmag"
    by_amount = {t["amount"]: t for t in client.get("/api/transactions").json}
    assert by_amount[-650]["main_category"] == "üdítő" and by_amount[-650]["category_source"] == "rule"
    assert by_amount[-100]["main_category"] == "egyéb"
    assert by_amount[500]["main_category"] == "bevétel"

    # Ugyanaz a minta újra → felülírja, nem duplikál
    client.post("/api/rules", json={"pattern": "Budapest NYX CocaColaHBCMag", "main_category": "bolt", "apply_existing": False}, headers=HDR)
    rules = client.get("/api/rules").json
    assert [(r["pattern"], r["main_category"]) for r in rules] == [("Budapest NYX CocaColaHBCMag", "bolt")]

    # Új import: a saját szabály elsőbbséget élvez a beépített listával szemben
    client.post("/api/rules", json={"pattern": "spar 123", "main_category": "saját bolt"}, headers=HDR)
    upload(client, [
        (date(2026, 10, 1), "Kártyás vásárlás", COCA.replace("650.00", "77.00"), -77),
        (date(2026, 10, 1), "Kártyás vásárlás", "SPAR 123 BUDAPEST", -12),
    ])
    by_amount = {t["amount"]: t for t in client.get("/api/transactions").json}
    assert by_amount[-77]["main_category"] == "bolt" and by_amount[-77]["category_source"] == "rule"
    assert by_amount[-12]["main_category"] == "saját bolt"

    # A szabályok felhasználónként külön vannak
    login(client, USER_B)
    assert client.get("/api/rules").json == []
    assert client.delete(f"/api/rules/{rules[0]['id']}", headers=HDR).status_code == 404

    login(client, USER_A)
    assert client.delete(f"/api/rules/{rules[0]['id']}", headers=HDR).status_code == 200
    assert [r["pattern"] for r in client.get("/api/rules").json] == ["spar 123"]
