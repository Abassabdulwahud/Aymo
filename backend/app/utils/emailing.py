import smtplib
from email.message import EmailMessage
from typing import Optional

from ..config import get_settings


def password_reset_email_ready() -> bool:
    settings = get_settings()
    return all(
        [
            settings.smtp_host,
            settings.smtp_from_email,
            settings.password_reset_base_url,
        ]
    )


def build_password_reset_link(token: str) -> Optional[str]:
    settings = get_settings()
    if not settings.password_reset_base_url:
        return None

    separator = "&" if "?" in settings.password_reset_base_url else "?"
    return f"{settings.password_reset_base_url}{separator}resetToken={token}"


def send_password_reset_email(recipient_email: str, reset_link: str) -> None:
    settings = get_settings()
    if not password_reset_email_ready():
        raise ValueError("Password reset email is not configured.")

    message = EmailMessage()
    from_name = settings.smtp_from_name or "AYMO Notebook"
    message["Subject"] = "Reset your AYMO Notebook password"
    message["From"] = f"{from_name} <{settings.smtp_from_email}>"
    message["To"] = recipient_email
    message.set_content(
        "\n".join(
            [
                "We received a request to reset your AYMO Notebook password.",
                "",
                f"Open this link to choose a new password: {reset_link}",
                "",
                "If you did not request this, you can ignore this email.",
            ]
        )
    )

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
        if settings.smtp_use_tls:
            server.starttls()
        if settings.smtp_username and settings.smtp_password:
            server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(message)
