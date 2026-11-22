#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DEBUG=1
.venv/bin/python backend/manage.py check
.venv/bin/python backend/manage.py makemigrations --check --dry-run
.venv/bin/python backend/manage.py test core
.venv/bin/python backend/manage.py spectacular --file docs/schema.yaml --fail-on-warn
npm run build --prefix frontend
