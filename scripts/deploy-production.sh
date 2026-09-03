#!/usr/bin/env bash
# Invoke only after the hosted validation job accepts a successful main release.
set -euo pipefail
export PATH="$PATH:/usr/bin:/bin"
export MSYS_NO_PATHCONV=1
umask 077
: "${PROD_DIR:?Set PROD_DIR to the existing live checkout}"
: "${PROD_PROJECT:?Set PROD_PROJECT to the existing Compose project name}"
: "${PROD_BACKUP_DIR:?Set PROD_BACKUP_DIR outside the checkout}"
: "${PROD_HEALTH_URL:?Set PROD_HEALTH_URL to the public HTTPS health endpoint}"
: "${APP_IMAGE:?Set APP_IMAGE to a registry image digest}"
: "${RELEASE_COMMIT:?Set RELEASE_COMMIT to the reviewed commit}"
[[ "$APP_IMAGE" =~ ^ghcr\.io/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$ ]]
[[ "$RELEASE_COMMIT" =~ ^[a-f0-9]{40}$ ]]
[[ "$PROD_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]]
[[ "$PROD_HEALTH_URL" == https://* ]]
[[ "$(docker info --format '{{.OSType}}')" == linux ]]

native_path() {
  if command -v cygpath >/dev/null; then cygpath -w "$1"; else printf '%s\n' "$1"; fi
}
normalize_path() {
  printf '%s' "$1" | tr '\\' '/' | tr '[:upper:]' '[:lower:]' |
    sed -E 's@^/run/desktop/mnt/host@@; s@^/host_mnt@@; s@^([a-z]):/@/\1/@; s@/+$@@'
}
PROD_DIR="$(cd "$PROD_DIR" && pwd -P)"
[[ -f "$PROD_DIR/docker-compose.yml" && -f "$PROD_DIR/.env" ]]
[[ -f "$PROD_DIR/data/poker.db" ]]
mkdir -p "$PROD_BACKUP_DIR"
PROD_BACKUP_DIR="$(cd "$PROD_BACKUP_DIR" && pwd -P)"
case "$(normalize_path "$PROD_BACKUP_DIR")/" in
  "$(normalize_path "$PROD_DIR")/"*) echo 'Backups must be outside the checkout.' >&2; exit 1;;
esac
if [[ -n "${GITHUB_WORKSPACE:-}" ]]; then
  workspace="$(normalize_path "$GITHUB_WORKSPACE")/"
  case "$(normalize_path "$PROD_DIR")/" in
    "$workspace"*) echo 'Production must be outside the runner workspace.' >&2; exit 1;;
  esac
  case "$(normalize_path "$PROD_BACKUP_DIR")/" in
    "$workspace"*) echo 'Backups must be outside the runner workspace.' >&2; exit 1;;
  esac
fi
state_file="$PROD_BACKUP_DIR/current.compose.yml"
compose=(docker compose --project-directory "$(native_path "$PROD_DIR")"
  -p "$PROD_PROJECT" -f "$(native_path "$PROD_DIR/docker-compose.yml")")
if [[ -f "$state_file" ]]; then compose+=(-f "$(native_path "$state_file")"); fi
container="$("${compose[@]}" ps -q poker-tracker)"
[[ -n "$container" && "$container" != *$'\n'* ]]
[[ "$(docker inspect --format '{{.State.Running}}' "$container")" == true ]]
mount="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Type}}|{{.Source}}{{end}}{{end}}' "$container")"
[[ "$mount" == bind\|* ]]
[[ "$(normalize_path "${mount#*|}")" == "$(normalize_path "$PROD_DIR/data")" ]] || {
  echo 'Live container data mount does not match PROD_DIR/data. Nothing stopped.' >&2; exit 1;
}

# A second local invocation must not race GitHub's deployment concurrency lock.
lock="$PROD_BACKUP_DIR/deploy.lock"
mkdir "$lock" || { echo 'Deployment lock exists; investigate before retrying.' >&2; exit 1; }
phase=preflight
finish() {
  result=$?
  trap - EXIT
  if (( result != 0 )); then
    if [[ "$phase" == backup ]]; then
      # Only the old image has run. A backup failure can safely resume it.
      "${compose[@]}" start poker-tracker || true
    elif [[ "$phase" == deploying || "$phase" == verifying ]]; then
      # New code may have migrated SQLite. Never automatically run old code on it.
      "${candidate_compose[@]}" stop poker-tracker || true
      echo "Release failed. App stopped; inspect $release_dir before recovery." >&2
    fi
  fi
  rmdir "$lock"
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT TERM

docker pull "$APP_IMAGE"
# Validate startup without any production credentials or bind-mounted records.
"$BASH" "$(dirname "${BASH_SOURCE[0]}")/check-image.sh" "$APP_IMAGE"
stamp="$(date -u +%Y%m%dT%H%M%SZ)-${GITHUB_RUN_ID:-local}"
release_dir="$PROD_BACKUP_DIR/$stamp"
mkdir "$release_dir"
previous="$(docker inspect --format '{{.Image}}' "$container")"
rollback="poker-tracker-rollback:${stamp,,}"
docker tag "$previous" "$rollback"
printf '%s\n' 'services:' '  poker-tracker:' "    image: $rollback" > "$release_dir/rollback.compose.yml"
printf '%s\n' 'services:' '  poker-tracker:' "    image: $APP_IMAGE" > "$release_dir/release.compose.yml"
printf '%s\n' "commit=$RELEASE_COMMIT" "image=$APP_IMAGE" "previous=$previous" \
  "rollback=$rollback" "project=$PROD_PROJECT" "checkout=$PROD_DIR" > "$release_dir/release.txt"

phase=backup
"${compose[@]}" stop poker-tracker
[[ "$(docker inspect --format '{{.State.Running}}' "$container")" == false ]]
cp -a "$PROD_DIR/data" "$release_dir/data"
# Compare every backed-up file, including SQLite journal files and uploads.
(cd "$PROD_DIR/data" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$release_dir/data.sha256"
(cd "$release_dir/data" && sha256sum --check ../data.sha256)

candidate_compose=(docker compose --project-directory "$(native_path "$PROD_DIR")"
  -p "$PROD_PROJECT" -f "$(native_path "$PROD_DIR/docker-compose.yml")"
  -f "$(native_path "$release_dir/release.compose.yml")")
# Persist the requested image even if it fails: future commands must not silently
# revert to old code against a potentially migrated database.
cp "$release_dir/release.compose.yml" "$state_file"
phase=deploying
"${candidate_compose[@]}" up -d --no-deps --no-build --pull never --wait --wait-timeout 120 poker-tracker
phase=verifying
new_container="$("${candidate_compose[@]}" ps -q poker-tracker)"
expected="$(docker image inspect --format '{{.Id}}' "$APP_IMAGE")"
[[ "$(docker inspect --format '{{.Image}}' "$new_container")" == "$expected" ]]
curl --fail --silent --show-error --retry 5 --retry-delay 3 --retry-all-errors \
  --connect-timeout 10 --max-time 20 "$PROD_HEALTH_URL" > "$release_dir/health.json"
grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$release_dir/health.json"
phase=complete
printf 'verified\n' > "$release_dir/status.txt"
printf 'Deployed %s\nBackup: %s\n' "$APP_IMAGE" "$release_dir"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf 'Deployed `%s`\n\nCommit: `%s`\n\nBackup: `%s`\n' \
    "$APP_IMAGE" "$RELEASE_COMMIT" "$release_dir" >> "$GITHUB_STEP_SUMMARY"
fi
