import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "pre_signup", Path(__file__).resolve().parents[2] / "infra" / "functions" / "pre_signup.py"
)
pre_signup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pre_signup)


def ev(email):
    return {"triggerSource": "PreSignUp_ExternalProvider", "request": {"userAttributes": {"email": email}}, "response": {}}


def test_allows_listed_emails(monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAILS", "hundjmada@gmail.com,dferenczi@gmail.com")
    assert pre_signup.handler(ev("HundJMada@gmail.com"), None)["request"]["userAttributes"]["email"]


@pytest.mark.parametrize("email", ["someone@gmail.com", "", None])
def test_rejects_everyone_else(monkeypatch, email):
    monkeypatch.setenv("ALLOWED_EMAILS", "hundjmada@gmail.com,dferenczi@gmail.com")
    with pytest.raises(Exception):
        pre_signup.handler(ev(email), None)
