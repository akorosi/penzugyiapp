import base64
import json

import pytest

from conftest import AUTH

pytestmark = pytest.mark.needs_db


def event(method, path, headers=None, body=None, b64=False):
    return {
        "version": "2.0",
        "rawPath": path,
        "rawQueryString": "",
        "headers": {k.lower(): v for k, v in (headers or {}).items()},
        "requestContext": {"http": {"method": method, "path": path, "protocol": "HTTP/1.1", "sourceIp": "1.2.3.4"}},
        "body": body,
        "isBase64Encoded": b64,
    }


def decode(resp):
    assert resp["isBase64Encoded"] is True
    return json.loads(base64.b64decode(resp["body"]))


def test_function_url_roundtrip(client):
    from lambda_handler import handler

    r = handler(event("GET", "/api/transactions", AUTH), None)
    assert r["statusCode"] == 200 and decode(r) == []
    assert r["headers"]["Content-Type"].startswith("application/json")

    r = handler(event("GET", "/api/transactions"), None)
    assert r["statusCode"] == 401


def test_function_url_upload_base64(client):
    from conftest import make_xlsx
    from lambda_handler import handler

    boundary = "XyZ"
    payload = make_xlsx([("2026-01-05", "T", "LIDL", -999)])
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"t.xlsx\"\r\n"
        "Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + payload + f"\r\n--{boundary}--\r\n".encode()
    headers = {**AUTH, "Content-Type": f"multipart/form-data; boundary={boundary}"}
    r = handler(event("POST", "/api/upload", headers, base64.b64encode(body).decode(), True), None)
    assert r["statusCode"] == 200, base64.b64decode(r["body"])
    assert decode(r)["inserted"] == 1


def test_migrate_action_is_idempotent(client):
    from lambda_handler import handler

    assert handler({"action": "migrate"}, None)["status"] == "ok"
    assert handler({"action": "migrate"}, None)["status"] == "ok"
