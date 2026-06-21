import requests
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from jose import JWTError, jwt
from typing import Optional

from ..config import get_settings

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_KEYS_URL = f"{APPLE_ISSUER}/auth/keys"

settings = get_settings()


def verify_google_oauth_token(token: str) -> str:
    if not settings.google_client_id:
        raise ValueError("Google OAuth is not configured.")

    try:
        info = google_id_token.verify_oauth2_token(
            token, google_requests.Request(), settings.google_client_id
        )
    except Exception as exc:
        raise ValueError("Invalid Google token.") from exc

    email = info.get("email")
    if not email:
        raise ValueError("Google token does not include an email.")
    return email.lower()


def verify_apple_oauth_token(token: str) -> str:
    if not settings.apple_client_id:
        raise ValueError("Apple OAuth is not configured.")

    try:
        keys_response = requests.get(APPLE_KEYS_URL, timeout=10)
        keys_response.raise_for_status()
        keys = keys_response.json().get("keys", [])
    except requests.RequestException as exc:
        raise ValueError("Could not reach Apple key endpoint.") from exc

    last_error: Optional[Exception] = None
    for key in keys:
        try:
            payload = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                audience=settings.apple_client_id,
                issuer=APPLE_ISSUER,
            )
            email = payload.get("email")
            if not email:
                raise ValueError("Apple token does not include email.")
            return email.lower()
        except (JWTError, ValueError) as exc:
            last_error = exc

    raise ValueError("Invalid Apple token.") from last_error
