"""AWS Lambda belépési pont.

Két eseménytípust kezel:
  1. Lambda Function URL HTTP kérés (payload 2.0) → a Flask alkalmazásnak
     továbbítjuk egy minimális WSGI adapteren keresztül.
  2. {"action": "migrate"} → idempotens sémalétrehozás az Aurora DSQL-ben, és
     a tulajdonos nélküli (korábbi, egyfelhasználós) tételek átadása a
     LEGACY_DATA_OWNER felhasználónak. A Terraform hívja meg telepítéskor.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import sys
from urllib.parse import unquote

import db
import repository
from excel_parser import make_hash
from main import app

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def _wsgi_environ(event: dict) -> dict:
    http = event.get("requestContext", {}).get("http", {})
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    if event.get("cookies"):
        headers["cookie"] = "; ".join(event["cookies"])

    body = event.get("body") or ""
    body_bytes = base64.b64decode(body) if event.get("isBase64Encoded") else body.encode("utf-8")

    environ = {
        "REQUEST_METHOD": http.get("method", "GET"),
        "SCRIPT_NAME": "",
        "PATH_INFO": unquote(event.get("rawPath", "/")),
        "QUERY_STRING": event.get("rawQueryString", ""),
        "SERVER_NAME": headers.get("host", "lambda"),
        "SERVER_PORT": "443",
        "SERVER_PROTOCOL": http.get("protocol", "HTTP/1.1"),
        "REMOTE_ADDR": http.get("sourceIp", ""),
        "CONTENT_TYPE": headers.get("content-type", ""),
        "CONTENT_LENGTH": str(len(body_bytes)),
        "wsgi.version": (1, 0),
        "wsgi.url_scheme": headers.get("x-forwarded-proto", "https"),
        "wsgi.input": io.BytesIO(body_bytes),
        "wsgi.errors": sys.stderr,
        "wsgi.multithread": False,
        "wsgi.multiprocess": False,
        "wsgi.run_once": False,
    }
    for key, value in headers.items():
        if key in ("content-type", "content-length"):
            continue
        environ["HTTP_" + key.upper().replace("-", "_")] = value
    return environ


def _http(event: dict) -> dict:
    status_headers: dict = {}

    def start_response(status, response_headers, exc_info=None):
        status_headers["status"] = int(status.split(" ", 1)[0])
        status_headers["headers"] = response_headers

    chunks = app(_wsgi_environ(event), start_response)
    try:
        body = b"".join(chunks)
    finally:
        if hasattr(chunks, "close"):
            chunks.close()

    headers: dict[str, str] = {}
    cookies: list[str] = []
    for k, v in status_headers.get("headers", []):
        if k.lower() == "set-cookie":
            cookies.append(v)
        else:
            headers[k] = v
    # A CORS fejléceket a Function URL CORS-beállítása adja (Terraform), itt nem
    # állítjuk, hogy ne duplikálódjanak.
    resp = {
        "statusCode": status_headers.get("status", 500),
        "headers": headers,
        "body": base64.b64encode(body).decode("ascii"),
        "isBase64Encoded": True,
    }
    if cookies:
        resp["cookies"] = cookies
    return resp


def handler(event, context):
    if isinstance(event, dict) and event.get("action") == "migrate":
        steps = db.migrate()
        legacy_owner = os.environ.get("LEGACY_DATA_OWNER", "").strip().lower()
        adopted = repository.adopt_legacy_rows(legacy_owner, make_hash)
        logger.info("Séma migráció kész: %s; átadott régi tételek: %d", steps, adopted)
        return {"status": "ok", "steps": steps, "adopted_legacy_rows": adopted}
    if isinstance(event, dict) and "requestContext" in event:
        return _http(event)
    logger.warning("Ismeretlen esemény, figyelmen kívül hagyva.")
    return {"status": "ignored"}
