#!/usr/bin/env bash
set -euo pipefail
export PATH="$PATH:/usr/bin:/bin"
export MSYS_NO_PATHCONV=1
image="${1:?Usage: bash scripts/check-image.sh IMAGE}"
container="poker-check-${GITHUB_RUN_ID:-local}-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$container" --tmpfs /app/data \
  -e JWT_SECRET=disposable-image-check "$image" >/dev/null
for ((attempt=0; attempt<40; attempt++)); do
  state="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
  if [[ "$state" == healthy ]]; then
    # docker cp avoids mounting the source checkout or any live data.
    source_file="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/tests/image-smoke.test.cjs"
    if command -v cygpath >/dev/null; then source_file="$(cygpath -w "$source_file")"; fi
    docker cp "$source_file" "$container:/tmp/image-smoke.test.cjs"
    docker exec "$container" node --test /tmp/image-smoke.test.cjs
    exit 0
  fi
  [[ "$state" != unhealthy ]] || break
  sleep 2
done
docker logs "$container"
echo 'Release image did not become healthy.' >&2
exit 1
