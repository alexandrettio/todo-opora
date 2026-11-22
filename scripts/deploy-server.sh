#!/usr/bin/env bash
set -euo pipefail
umask 077
revision="${1:?Commit SHA required}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
root=/home/alexandret/opora
mkdir -p "$root/releases" "$root/backups"
exec 9>"$root/deploy.lock"
flock -w 1800 9
release="$root/releases/$revision"
# Retries use a fresh directory; the active release is never overwritten.
release=$(mktemp -d "$release.XXXXXX")
tar -xz -C "$release"
ln -s "$root/.env" "$release/.env"
cd "$release"
compose=(docker compose --project-name opora -f compose.yaml -f deploy/compose.server.yaml)
export DEPLOY_REVISION="$revision"
"${compose[@]}" config --quiet
gzip -dc images.tar.gz | docker load
rm images.tar.gz
if "${compose[@]}" ps --status running --services | grep -qx db; then
  "${compose[@]}" exec -T db pg_dump -U opora -d opora -Fc > "$root/backups/$(date -u +%Y%m%dT%H%M%SZ)-$revision.dump"
fi
if ! "${compose[@]}" up -d --no-build --wait --wait-timeout 240; then
  "${compose[@]}" ps
  "${compose[@]}" logs --tail=80 api web worker
  echo 'Deployment failed; inspect logs and database migrations before rollback.' >&2
  exit 1
fi
curl --fail --silent --show-error --retry 10 --retry-delay 3 -H 'Host: 62.113.113.45' http://127.0.0.1:8088/api/session/ > /dev/null
ln -sfn "$release" "$root/current"
printf '%s\n' "$revision" > "$root/deployed-revision"
"${compose[@]}" ps
