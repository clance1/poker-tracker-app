# Making changes and releasing them live

Use this workflow: **change locally → test → commit and review → back up production → deploy → verify**.
Development is your practice copy. Production is the source of record for actual games.
Release application code; never replace production records with development records.

This guide uses PowerShell and the Docker configuration currently in this repository.
Commands are instructions for you to run, not actions already performed.

## 1. Know which environment you are using

| | Development | Production |
|---|---|---|
| Address | http://localhost:3002 | https://www.carsonsgame.com |
| Compose file | `compose.dev.yml` | `docker-compose.yml` |
| App service | `app` | `poker-tracker` |
| Database and uploads | Separate Docker volume | `data/` in the production checkout |
| Source changes | React refreshes; API needs a restart | Requires a rebuilt image and recreated container |
| Credentials | Local development settings | Production `.env` |
| External integrations | No keys supplied | Cloudflare and any configured Telegram/AI services |

Always specify the Compose file. An unqualified `docker compose` command uses the
production configuration in this repository.

The current development image uses Node 22 on Debian; production uses Node 20 on
Alpine. Passing development tests alone does not establish production compatibility.
The production-image check below matters until those environments are aligned.

## 2. Start a small, focused change

Work in your development checkout. First inspect your existing work:

```powershell
git status
```

Keep any existing uncommitted changes; do not discard them to follow this guide.
Finish or deliberately separate unrelated work before starting a release. For a
new change, create a branch with a descriptive name, for example:

```powershell
git switch -c codex/improve-game-summary
docker compose -f compose.dev.yml up --build -d
docker compose -f compose.dev.yml logs -f app
```

Open http://localhost:3002 once React finishes compiling. Ctrl+C leaves the log
view without stopping the detached container. A fresh database currently creates
an `admin` account with password `admin` and requires a password change.

Make one change at a time. An example request to Codex is:

> Update the game summary to show total buy-ins. Use the development environment,
> preserve existing game calculations, test the changed behavior, and do not deploy.

Saving React files updates the browser automatically. After editing server files:

```powershell
docker compose -f compose.dev.yml restart app
```

After changing dependency manifests or development container configuration, rerun
the startup command with `--build`. A restart alone does not apply new container
environment settings. See [Docker's restart reference](https://docs.docker.com/reference/cli/docker/compose/restart/).

For dependency changes, update both `package.json` and `package-lock.json` in your
checkout. The current development container copies these files at build time;
editing them inside that container does not update your checkout.

## 3. Check the change before committing

Run these commands separately and stop if any fails:

```powershell
docker compose -f compose.dev.yml exec app npm run build
docker compose -f compose.dev.yml exec -e DATA_DIR=/tmp/poker-tests app npm run test:server
docker compose -f compose.dev.yml exec -e CI=true app npm test -- --watchAll=false
```

The build creates `build/index.html`, which the backend's SPA-serving tests require.
The React development server does not write that file to disk. Run the build again
after frontend changes or container recreation.

The explicit temporary data directory keeps backend test files outside even your
normal development records. Investigate failures before releasing; do not assume
that a failure is harmless because a test README describes older known issues.

Then check the feature in the browser with development records:

- Try the normal case and an invalid or empty input.
- Confirm the relevant admin, owner, and ordinary-user permissions.
- For game changes, check buy-ins, rebuys, cash-outs, and the final balance.
- Refresh the page and verify saved values remain correct.
- Check the changed screen on a narrow/mobile-sized window.

Database changes need extra care. Migrations must preserve existing records and
work on both a fresh database and an existing schema. For such a release, rehearse
against an isolated copy made from a consistent production backup, with production
integration keys omitted. Keep copied records private. Never mount the live data
directory into a test container or copy the rehearsal database back into production.

## 4. Save and review the exact release

Review the diff, stage only intended files, and commit. These filenames are an
example; substitute the files you actually changed:

```powershell
git diff
git add src/components/GameDetail.js
git diff --cached
git commit -m "Show total buy-ins in game summary"
git push -u origin HEAD
```

Open a pull request on GitHub and review the final changes. The repository's remote
default branch is `main`; confirm it is also your release branch before merging.
Do not include `.env`, database files, uploaded personal images, or tunnel credentials.

**A Git push uploads code to GitHub. It does not itself replace the running Docker
container.** No GitHub Actions deployment workflow was found in this checkout.
If you have configured automation elsewhere, account for it before merging.

## 5. Prepare the production release without stopping the site

Run the remaining deployment commands on the computer running the live containers,
from its existing production checkout. A separate checkout for production makes it
easier to keep experimental edits out of releases. Do not move an existing deployment
to another directory as part of a routine release: its data mount and Compose project
identity depend on its location/configuration.

Choose a time when nobody is entering game records. Keep this PowerShell session
open through deployment; later commands reuse its variables. Run each command/block
separately, inspect its output, and stop on any failure.

```powershell
git status
docker compose -f docker-compose.yml ps
```

Confirm this lists the existing live `poker-tracker` and `cloudflared` containers.
If it does not, stop and identify the correct checkout, Docker context, and Compose
project name. Do not create a second production stack. If the existing deployment
uses an explicit `-p` project name, include that same name in every production
Compose command in this guide.

With a clean production checkout and the approved change merged into `main`:

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
git log -1 --oneline
```

Confirm the displayed commit is the release you reviewed. If your release branch
is different, use that branch instead. Never resolve a dirty deployment checkout
by blindly resetting or discarding files.

Capture the release identity and preserve the currently running image:

```powershell
$releaseCommit = (git rev-parse HEAD).Trim()
$releaseStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$prodCheckout = (Get-Location).Path
$prodContainer = (docker compose -f docker-compose.yml ps -q poker-tracker).Trim()
$previousImage = (docker inspect --format '{{.Image}}' $prodContainer).Trim()
$rollbackImage = "poker-tracker-rollback:$releaseStamp"
$candidateImage = "poker-tracker-release:$releaseCommit"
docker image tag $previousImage $rollbackImage
```

Build from a clean export of the committed source. This deliberately excludes
untracked production data and credentials; the current production `.dockerignore`
does not exclude every sensitive folder from its build context.

```powershell
$releaseSource = Join-Path $env:TEMP "poker-release-$releaseStamp"
$releaseArchive = Join-Path $env:TEMP "poker-release-$releaseStamp.tar"
New-Item -ItemType Directory -Path $releaseSource -ErrorAction Stop
git archive --format=tar --output=$releaseArchive HEAD
tar -xf $releaseArchive -C $releaseSource
docker build -f "$releaseSource/Dockerfile" -t $candidateImage $releaseSource
```

This runs the production Dockerfile, including token linting and the React build.
The existing live container continues serving traffic while the image builds.
The export includes tracked files only, so verify secrets have never been committed.

Smoke-test that production image with disposable data and no production credentials:

```powershell
docker run -d --name poker-release-check --tmpfs /app/data -e JWT_SECRET=release-check-only $candidateImage
docker logs poker-release-check
docker exec poker-release-check node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>{console.log(r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```

Wait for the startup message before the health check. Expect status `200`; investigate
errors before proceeding. This checks production startup, not the complete application.
Production cookies require HTTPS, so a localhost HTTP login is not an equivalent
production authentication check. Remove the check container after reviewing results:

```powershell
docker rm -f poker-release-check
```

The disposable database in this specific container is discarded. If that container
name already exists, inspect it before removing or replacing it.

## 6. Back up the live records

The following step begins a brief outage. Stop only the application, then copy the
entire data directory while no application process is writing to it. Include uploads
and any SQLite companion files, not just `poker.db`. SQLite documents the hazards of
copying a database during writes in its [corruption guidance](https://www.sqlite.org/howtocorrupt.html).

```powershell
$backupRoot = Join-Path (Split-Path $prodCheckout -Parent) 'poker-tracker-backups'
$backupDir = Join-Path $backupRoot $releaseStamp
New-Item -ItemType Directory -Path $backupDir -ErrorAction Stop
docker compose -f docker-compose.yml stop poker-tracker
docker compose -f docker-compose.yml ps -a
```

Confirm the app has stopped and no other process writes to this same database, then:

```powershell
Copy-Item -LiteralPath (Join-Path $prodCheckout 'data') -Destination $backupDir -Recurse -ErrorAction Stop
Get-FileHash -LiteralPath (Join-Path $prodCheckout 'data/poker.db')
Get-FileHash -LiteralPath (Join-Path $backupDir 'data/poker.db')
@("Release commit: $releaseCommit", "Previous image: $previousImage", "Rollback tag: $rollbackImage") | Set-Content -LiteralPath (Join-Path $backupDir 'release.txt')
```

The two database hashes must match. Confirm uploaded folders were copied too. Keep
this backup private and retain an additional copy on another device or backup service.
Manage `.env` and Cloudflare credentials in a separate secure configuration backup.

If the copy or verification fails, do not deploy. Restart the unchanged container
with `docker compose -f docker-compose.yml start poker-tracker`, then resolve the backup issue.

## 7. Deploy the exact image you checked

Create a small release override outside the repository to select the image explicitly:

```powershell
$releaseOverride = Join-Path $backupDir 'release.compose.yml'
@("services:", "  poker-tracker:", "    image: $candidateImage") | Set-Content -LiteralPath $releaseOverride
docker compose -f docker-compose.yml -f $releaseOverride up -d --no-deps --no-build --pull never --wait --wait-timeout 120 poker-tracker
```

This recreates the application with the reviewed image and retains its production
data mount and environment. The Cloudflare container remains running. Docker's
[production guidance](https://docs.docker.com/compose/how-tos/production/) describes
replacing an individual service; the [up reference](https://docs.docker.com/reference/cli/docker/compose/up/)
documents the health wait and image-selection flags used here.

Avoid routine `down` followed by a rebuild: it extends the outage while the build runs.
Do not use development data as a replacement for production data.

## 8. Verify the live site

```powershell
docker compose -f docker-compose.yml -f $releaseOverride ps
docker compose -f docker-compose.yml -f $releaseOverride logs --tail 100 poker-tracker
Invoke-WebRequest -Uri 'https://www.carsonsgame.com/api/health'
```

Then open https://www.carsonsgame.com in a fresh browser session:

- Sign in and confirm the expected permissions.
- Confirm historical games, balances, and uploaded images remain present.
- Verify the changed feature and check mobile layout if relevant.
- Avoid fake financial entries in the live record; use read-only checks wherever possible.

A healthy container is necessary but does not prove the feature works. Record the
release commit, timestamp, backup location, image tag, and verification result.
Keep the previous image until you are confident in the release.

The image override is part of this release's configuration. Use both `-f` arguments
for later production `up` commands until the next deliberate deployment selects its
own image. Running the base file alone can switch back to its default image tag.

## 9. Roll back if verification fails

### Application-only rollback

Use this when the old code can read the database as it exists now. It preserves
records entered since deployment. Reuse the saved rollback image and the original
production configuration; if the release also changed Compose or environment settings,
review and restore compatible settings first.

```powershell
$rollbackOverride = Join-Path $backupDir 'rollback.compose.yml'
@("services:", "  poker-tracker:", "    image: $rollbackImage") | Set-Content -LiteralPath $rollbackOverride
docker compose -f docker-compose.yml -f $rollbackOverride up -d --no-deps --no-build --pull never --wait --wait-timeout 120 poker-tracker
```

Repeat the live verification checks. Use the rollback override for subsequent `up`
commands until the next release. If this is a new PowerShell session, recover the
backup path and rollback image tag from `release.txt` first.

### Database rollback

Old code may not work after a database migration. Restoring the pre-release backup
also removes records entered after that backup, so do not treat it as an automatic
fix. Stop new entries, identify the affected records, and decide whether a forward
fix or a restore with reconciliation is appropriate.

If restoring is necessary:

1. Stop the production app and confirm no process is writing to its database.
2. Preserve the failed-release data directory in a separate incident backup.
3. Verify the absolute source and destination paths before any move or replacement.
4. Restore the complete pre-release `data/` directory, including uploads. Do not
   overlay only `poker.db` onto newer SQLite journal/WAL files.
5. Start the saved old image with compatible production configuration.
6. Verify records and reconcile any entries made after the backup before resuming use.

Reverting a Git commit alone neither changes the running container nor restores a
database. A code revert is a new change that follows this same release process.

## Release checklist

- [ ] Intended changes reviewed and committed; release commit recorded.
- [ ] Development tests and relevant browser checks pass.
- [ ] Production image builds and starts with disposable data.
- [ ] Database changes rehearsed against an isolated existing database when applicable.
- [ ] Correct live checkout and Compose project confirmed.
- [ ] Previous image tagged; consistent production data backup verified.
- [ ] Exact checked image deployed; container and public health checks pass.
- [ ] Live feature and historical records checked; rollback information retained.

For everyday startup commands, see [DEVELOPMENT.md](DEVELOPMENT.md).
