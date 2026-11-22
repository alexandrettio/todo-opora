#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DEBUG=1
# Local development always uses its own SQLite database unless explicitly overridden.
export DATABASE_URL="${DATABASE_URL:-sqlite:///$(pwd)/backend/db.sqlite3}"
python3 - <<'PY'
import socket
for port in (8000, 5173):
    with socket.socket() as sock:
        try:
            sock.bind(('127.0.0.1', port))
        except PermissionError:
            raise SystemExit('Нет разрешения на запуск локального сервера в этой среде.')
        except OSError:
            raise SystemExit(f'Порт {port} уже занят. Останови предыдущий запуск и повтори команду.')
PY
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
if ! .venv/bin/python -c 'import django, rest_framework, drf_spectacular, psycopg, dj_database_url, gunicorn, requests, cryptography' 2>/dev/null; then
  .venv/bin/python -m pip --disable-pip-version-check install -r backend/requirements.lock
fi
if [ ! -x frontend/node_modules/.bin/vite ] || [ ! -x frontend/node_modules/.bin/tsc ]; then
  npm ci --prefix frontend
fi
.venv/bin/python backend/manage.py migrate --noinput
.venv/bin/python backend/manage.py bootstrap
if ! .venv/bin/python backend/manage.py shell -c "from django.contrib.auth import get_user_model; import sys; sys.exit(0 if get_user_model().objects.exists() else 1)"; then
  printf '\nПервый запуск: создай своё имя пользователя и пароль.\n\n'
  .venv/bin/python backend/manage.py createsuperuser
fi
api_pid=''
web_pid=''
calendar_pid=''
cleanup() {
  trap - EXIT INT TERM
  [ -z "$calendar_pid" ] || kill "$calendar_pid" 2>/dev/null || true
  [ -z "$web_pid" ] || kill "$web_pid" 2>/dev/null || true
  [ -z "$api_pid" ] || kill "$api_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
.venv/bin/python backend/manage.py runserver 127.0.0.1:8000 --noreload &
api_pid=$!
(
  trap 'exit 0' TERM INT
  while true; do
    .venv/bin/python backend/manage.py sync_calendars || true
    sleep 3600 &
    wait $!
  done
) &
calendar_pid=$!
node frontend/node_modules/vite/bin/vite.js frontend --host 127.0.0.1 --port 5173 --strictPort &
web_pid=$!
printf '\nОпора: http://127.0.0.1:5173\nОстановить: Ctrl+C\n\n'
# Exit if either server stops so the other one is cleaned up as well.
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 1
done
exit 1
