"""Amazon Cognito pre sign-up trigger: csak az engedélyezett e-mail címek
regisztrálhatnak (Google social login esetén az első belépéskor fut, triggerSource
= PreSignUp_ExternalProvider). Minden más fiók létrehozását elutasítja, így a
felhasználói készletbe sem kerül be.

Az engedélyezett címek: ALLOWED_EMAILS környezeti változó (vesszővel elválasztva).
"""

import os


def handler(event, context):
    allowed = {e.strip().lower() for e in os.environ.get("ALLOWED_EMAILS", "").split(",") if e.strip()}
    email = (event.get("request", {}).get("userAttributes", {}).get("email") or "").strip().lower()
    if not email or email not in allowed:
        print(f"Elutasított regisztráció ({event.get('triggerSource')})")
        raise Exception("Ezzel a fiókkal nem lehet belépni az alkalmazásba.")
    return event
