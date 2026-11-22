#!/usr/bin/env python3
"""Create production environment without placing credentials in command arguments."""
from pathlib import Path
import base64, secrets

root = Path(__file__).resolve().parent.parent
path = root / ".env"
if path.exists():
    raise SystemExit(
        ".env уже существует. Измени его вручную; настройки не перезаписаны."
    )
domain = input("Домен приложения (например todo.example.com): ").strip()
if not domain or any(
    c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-"
    for c in domain
):
    raise SystemExit("Укажи только имя домена, без https:// и пути.")
username = input("Имя пользователя [owner]: ").strip() or "owner"
password = secrets.token_urlsafe(24)
text = (root / ".env.example").read_text()
for old, new in {
    "todo.example.com": domain,
    "replace-with-random-secret": secrets.token_urlsafe(64),
    "replace-with-random-hex-password": secrets.token_hex(32),
    "INITIAL_USERNAME=owner": f"INITIAL_USERNAME={username}",
    "replace-with-a-long-unique-password": password,
    "TOKEN_ENCRYPTION_KEY=": "TOKEN_ENCRYPTION_KEY="
    + base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
}.items():
    text = text.replace(old, new)
path.write_text(text)
path.chmod(0o600)
print(
    "Создан .env с уникальными ключами. Имя и первоначальный пароль находятся в INITIAL_USERNAME и INITIAL_PASSWORD. Не публикуй этот файл."
)
