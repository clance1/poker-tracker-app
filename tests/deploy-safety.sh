#!/usr/bin/env bash
# Exercise deployment ordering/recovery with fake Docker and curl, never the daemon.
set -euo pipefail
export PATH="/usr/bin:/bin:$PATH"
script="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/deploy-production.sh"
test_root="$(mktemp -d)"
mkdir "$test_root/bin"
cat > "$test_root/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$MOCK_ROOT/calls"
case "$1" in
  info) echo linux ;;
  pull|tag|run|cp|exec|rm|logs) : ;;
  image)
    if [[ "$2" == inspect ]]; then echo new-image; fi ;;
  inspect)
    case "$3" in
      *Health.Status*) echo healthy ;;
      *Mounts*) printf 'bind|%s/data\n' "${MOCK_MOUNT:-$PROD_DIR}" ;;
      *State.Running*)
        if [[ -f "$MOCK_ROOT/stopped" ]]; then echo false; else echo true; fi ;;
      *Image*)
        if [[ -f "$MOCK_ROOT/updated" ]]; then echo new-image; else echo old-image; fi ;;
    esac ;;
  compose)
    case " $* " in
      *' ps -q '*) echo prod-container ;;
      *' stop '*) touch "$MOCK_ROOT/stopped" ;;
      *' start '*) echo resumed >> "$MOCK_ROOT/resumed" ;;
      *' up '*)
        [[ "${MOCK_FAIL_UP:-0}" != 1 ]] || exit 1
        touch "$MOCK_ROOT/updated" ;;
    esac ;;
  *) echo "Unexpected docker command: $*" >&2; exit 1 ;;
esac
MOCK
cat > "$test_root/bin/curl" <<'MOCK'
#!/usr/bin/env bash
printf '{"ok":true}\n'
MOCK
chmod +x "$test_root/bin/docker" "$test_root/bin/curl"
cat > "$test_root/bin/cp" <<'MOCK'
#!/usr/bin/env bash
if [[ "${MOCK_FAIL_BACKUP:-0}" == 1 && "$*" == *'/data '* ]]; then exit 1; fi
exec /usr/bin/cp "$@"
MOCK
chmod +x "$test_root/bin/cp"
export PATH="$test_root/bin:$PATH"
export PROD_PROJECT=poker-test PROD_HEALTH_URL=https://example.test/api/health
export APP_IMAGE="ghcr.io/example/poker@sha256:$(printf '%064d' 1)"
export RELEASE_COMMIT=1111111111111111111111111111111111111111
unset GITHUB_WORKSPACE GITHUB_STEP_SUMMARY
for scenario in success wrong-mount failed-backup failed-update; do
  export MOCK_ROOT="$test_root/$scenario"
  mkdir -p "$MOCK_ROOT/prod/data/avatars"
  export PROD_DIR="$MOCK_ROOT/prod" PROD_BACKUP_DIR="$MOCK_ROOT/backups"
  printf 'database fixture\n' > "$PROD_DIR/data/poker.db"
  printf 'upload fixture\n' > "$PROD_DIR/data/avatars/photo"
  touch "$PROD_DIR/docker-compose.yml" "$PROD_DIR/.env"
  unset MOCK_MOUNT MOCK_FAIL_UP MOCK_FAIL_BACKUP
  if [[ "$scenario" == wrong-mount ]]; then export MOCK_MOUNT=/wrong-directory; fi
  if [[ "$scenario" == failed-update ]]; then export MOCK_FAIL_UP=1; fi
  if [[ "$scenario" == failed-backup ]]; then export MOCK_FAIL_BACKUP=1; fi
  if bash "$script" > "$MOCK_ROOT/output" 2>&1; then
    [[ "$scenario" == success ]] || { cat "$MOCK_ROOT/output"; exit 1; }
    backup="$(find "$PROD_BACKUP_DIR" -name release.txt -print)"
    cmp "$PROD_DIR/data/poker.db" "$(dirname "$backup")/data/poker.db"
    cmp "$PROD_DIR/data/avatars/photo" "$(dirname "$backup")/data/avatars/photo"
    [[ -f "$(dirname "$backup")/status.txt" ]]
  else
    [[ "$scenario" != success ]] || { cat "$MOCK_ROOT/output"; exit 1; }
    if [[ "$scenario" == wrong-mount ]]; then
      ! grep -q ' stop ' "$MOCK_ROOT/calls"
    elif [[ "$scenario" == failed-backup ]]; then
      [[ -f "$MOCK_ROOT/resumed" ]]
      ! grep -q ' up ' "$MOCK_ROOT/calls"
    else
      [[ "$(grep -c ' stop ' "$MOCK_ROOT/calls")" == 2 ]]
      [[ ! -f "$MOCK_ROOT/resumed" ]]
      [[ -f "$PROD_BACKUP_DIR/current.compose.yml" ]]
    fi
  fi
  [[ ! -d "$PROD_BACKUP_DIR/deploy.lock" ]]
  printf 'PASS %s\n' "$scenario"
done
printf 'Fixtures retained at %s\n' "$test_root"
