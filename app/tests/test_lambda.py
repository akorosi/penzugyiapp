import base64
import json

import pytest

from conftest import HDR, USER_A

pytestmark = pytest.mark.needs_db


def event(method, path, headers=None, body=None, b64=False, cookies=None):
    ev = {
        "version": "2.0",
        "rawPath": path,
        "rawQueryString": "",
        "headers": {k.lower(): v for k, v in (headers or {}).items()},
        "requestContext": {"http": {"method": method, "path": path, "protocol": "HTTP/1.1", "sourceIp": "1.2.3.4"}},
        "body": body,
        "isBase64Encoded": b64,
    }
    if cookies:
        ev["cookies"] = cookies
    return ev


def session_cookie():
    import auth

    return [f"{auth.SESSION_COOKIE}={auth.make_session(USER_A)}"]


def decode(resp):
    assert resp["isBase64Encoded"] is True
    return json.loads(base64.b64decode(resp["body"]))


def test_function_url_roundtrip(app_client):
    from lambda_handler import handler

    r = handler(event("GET", "/api/transactions", cookies=session_cookie()), None)
    assert r["statusCode"] == 200 and decode(r) == []
    assert r["headers"]["Content-Type"].startswith("application/json")

    r = handler(event("GET", "/api/transactions"), None)
    assert r["statusCode"] == 401


def test_set_cookie_is_returned_as_cookies(app_client):
    from lambda_handler import handler

    r = handler(event("GET", "/api/auth/login", cookies=session_cookie()), None)
    assert r["statusCode"] == 302
    assert any(c.startswith("pz_auth=") for c in r["cookies"])


def test_function_url_upload_base64(app_client):
    from conftest import make_xlsx
    from lambda_handler import handler

    boundary = "XyZ"
    payload = make_xlsx([("2026-01-05", "T", "LIDL", -999)])
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"t.xlsx\"\r\n"
        "Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + payload + f"\r\n--{boundary}--\r\n".encode()
    headers = {**HDR, "Content-Type": f"multipart/form-data; boundary={boundary}"}
    r = handler(event("POST", "/api/upload", headers, base64.b64encode(body).decode(), True, session_cookie()), None)
    assert r["statusCode"] == 200, base64.b64decode(r["body"])
    assert decode(r)["inserted"] == 1


def test_migrate_action_is_idempotent(app_client, monkeypatch):
    from lambda_handler import handler

    monkeypatch.setenv("LEGACY_DATA_OWNER", USER_A)
    assert handler({"action": "migrate"}, None)["status"] == "ok"
    assert handler({"action": "migrate"}, None)["status"] == "ok"
