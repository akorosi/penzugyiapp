"""A CloudFront Function (infra/functions/auth_gate.js) a Python által kiállított
munkamenet-sütit fogadja el — Node.js-sel futtatva (ha elérhető)."""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

GATE = Path(__file__).resolve().parents[2] / "infra" / "functions" / "auth_gate.js"

pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node nem elérhető")

HARNESS = r"""
const code = require('fs').readFileSync(0, 'utf8');
const handler = new Function('require', code + '\nreturn handler;')(require);
const cases = JSON.parse(process.env.CASES);
const out = cases.map(c => {
  const cookies = c === null ? {} : { pz_session: { value: c } };
  const r = handler({ request: { uri: '/assets/app.js', cookies } });
  return r.statusCode ? r.headers.location.value : 'PASS';
});
console.log(JSON.stringify(out));
"""


def test_gate_accepts_only_valid_sessions():
    import auth

    secret = os.environ["SESSION_SECRET"]
    code = GATE.read_text().replace("${session_secret}", secret)
    valid = auth.make_session("anna@example.com")
    cases = [
        valid,
        valid[:-1] + ("0" if valid[-1] != "0" else "1"),       # hamis aláírás
        auth.make_session("anna@example.com", ttl=-5),          # lejárt
        "garbage",
        None,
    ]
    out = subprocess.run(
        ["node", "-e", HARNESS], input=code, capture_output=True, text=True, check=True,
        env={**os.environ, "CASES": json.dumps(cases)},
    )
    result = json.loads(out.stdout)
    assert result[0] == "PASS"
    assert result[1:] == ["/api/auth/login?next=%2Fassets%2Fapp.js"] * 4
