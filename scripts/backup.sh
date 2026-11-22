#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup_path="${1:?Укажи путь для резервной копии .dump}"
umask 077
docker compose exec -T db pg_dump -U opora -d opora -Fc > "$backup_path"
printf 'Резервная копия сохранена: %s\n' "$backup_path"
