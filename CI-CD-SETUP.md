# GitHub Actions with Docker Desktop

The repository now contains the pipeline files. They take effect only after you
commit/push them and complete the GitHub and local-runner setup below. No runner
has been registered and no production deployment has been performed by adding them.

## What happens

| Trigger | Where it runs | Result |
|---|---|---|
| Pull request | GitHub-hosted Linux runner | React build, frontend test, production image build, HTTP smoke tests |
| Push/merge to `main` | GitHub-hosted Linux runner | Same checks, then publish the checked image to private GHCR |
| Manually run **Deploy production** on `main` | Hosted validation, then your Windows runner | Validate release, pull exact digest, smoke-test, back up data, replace app, verify health |

PR jobs never run on your computer. The local runner is used only by the deployment
job. Keep this repository private, restrict write access to trusted collaborators,
and review workflow changes: a self-hosted runner can access its Windows account's
files and Docker engine. A runner label routes jobs; it is not a security boundary.
See [GitHub's runner security guidance](https://docs.github.com/en/actions/reference/security/secure-use).

There is no separate shared staging service yet. Local development remains the
preview environment. The current `main` branch has one frontend login test and four
HTTP smoke checks; the broader backend regression suite from other development work
still needs to be merged and added as a CI gate. These checks are a starting point,
not proof that every game calculation is correct.

## 1. Review and commit the files

The Dockerfile now uses Node 22/Debian for both development and production, builds
SQLite's native dependency inside Linux, and fails if `npm ci` fails. The production
build context excludes local data and credentials. The existing production Compose
file is unchanged; deployment uses an image override stored beside the backups.

Review `Dockerfile`, `.dockerignore`, `compose.dev.yml`, `.gitattributes`,
`.github/workflows/`, `scripts/`, `tests/`, and the corrected `src/App.test.js`.
Commit the intended files on a feature branch and open a PR. No need to merge other
experimental features just to add the pipeline.

Protect `main` with a rule requiring the `verify` status check, when available on
your GitHub plan. Run the first PR to make that check appear in the selector.
Review changes to workflow files before merging. The deployment workflow itself
always requires selecting **Run workflow**; there is no automatic deployment on merge.

## 2. Check Docker Desktop and Git Bash

Use Docker Desktop's Linux containers and Git for Windows. Keep the computer awake
and Docker Desktop running while deployments run. In Git Bash:

```bash
export MSYS_NO_PATHCONV=1
docker info --format '{{.OSType}}'
docker compose version
curl --version
```

The first command should report `linux`. Use a recent Git for Windows (including
curl with `--retry-all-errors`) and current Docker Compose. All pipeline command
steps use Bash. The Windows deployment job explicitly uses
`C:\Program Files\Git\bin\bash.exe` so it cannot select Windows' WSL launcher.
If Git is installed elsewhere, update the deployment job's `defaults.run.shell`.
[GitHub shell reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)

## 3. Register the deployment runner

In the private repository, open **Settings → Actions → Runners → New self-hosted
runner**, choose **Windows / x64**, and follow GitHub's generated download and
registration instructions. Those instructions include a short-lived registration
token; do not commit or paste it into source files.

Install the runner in its own directory, such as `C:/actions-runner-poker`, outside
the production checkout. Add the custom label **poker-production**, in addition to
the default `self-hosted`, `Windows`, and `X64` labels.

For the first setup, run it interactively under the same Windows account that runs
Docker Desktop. In Git Bash, from the runner directory, Windows' supplied runner
program is launched with:

```bash
./run.cmd
```

Leave that terminal running. Registering a Windows service can be considered later,
after verifying which account can reach Docker Desktop. Do not point the runner's
work directory at your production checkout: Actions checkout cleans its workspace.
Use the latest runner release compatible with the pinned checkout action.
[GitHub runner setup](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)

## 4. Set repository variables

In **Settings → Secrets and variables → Actions → Variables**, create:

| Name | Value / how to find it |
|---|---|
| `PROD_DIR` | Git Bash path to the existing live checkout, e.g. `/c/Users/cmlan/Github/poker-tracker-app` |
| `PROD_PROJECT` | Existing Docker Compose project label, confirmed below |
| `PROD_BACKUP_DIR` | Private backup directory outside the checkout and runner workspace, e.g. `/c/Users/cmlan/poker-tracker-backups` |
| `PROD_HEALTH_URL` | `https://www.carsonsgame.com/api/health` |

Find the live project without printing credentials:

```bash
docker ps --filter label=com.docker.compose.service=poker-tracker \
  --format '{{.Names}} | project={{.Label "com.docker.compose.project"}}'
```

Confirm the selected container is the one serving the live website. The deployment
script also checks that its `/app/data` bind mount is exactly `PROD_DIR/data` and
refuses to stop it on a mismatch. Standard Docker Desktop Windows host paths are
supported. If your data lives in a WSL filesystem or another custom mount, adapt and
test that mapping deliberately instead of bypassing the check.

The production `.env`, data, and Cloudflare credentials stay on your computer.
Publishing/pulling uses the workflow's short-lived `GITHUB_TOKEN`, not a personal
access token. If registry access fails, verify the package grants this repository
Actions access. Verify the GHCR package is **private** after first publication.
[GHCR authentication and access](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

The workflow uses temporary Docker login configuration, preserving your normal
Docker Desktop settings, and logs out on completion. Backup folder permissions
should be restricted through Windows folder security; `umask` alone does not enforce
Windows ACLs. Keep another backup copy on a separate device.

## 5. Iterate locally

```bash
docker compose -f compose.dev.yml up --build -d
docker compose -f compose.dev.yml logs -f app
```

Open http://localhost:3002. React refreshes on edits; restart after backend edits:

```bash
docker compose -f compose.dev.yml restart app
```

To reproduce CI locally without modifying running containers or live data:

```bash
docker build --target build -t poker-tests .
docker run --rm -e CI=true poker-tests npm test -- --watchAll=false --runInBand
docker build -t poker-release .
bash scripts/check-image.sh poker-release
```

Run the commands in order and stop on failure. The image check uses a disposable
database in a temporary container with no production environment or mounts.
For database changes, separately rehearse migrations against an isolated, consistent
backup of existing data before releasing.

## 6. Deploy a release

1. Push your feature branch, review its passing CI checks, and merge to `main`.
2. Wait for **CI and release image** on the merged commit to succeed.
3. Copy its **Release run** number from the run summary (also in its URL).
4. In **Actions → Deploy production → Run workflow**, select `main` and enter that
   number as `release_run`. Choose a time when nobody is entering game records.
5. Watch the run. It validates the selected CI run on a hosted machine before
   scheduling work on your Windows runner.
6. Once complete, log in to the public site and verify the changed feature and
   historical records. HTTP health checks alone cannot verify game correctness.

Only one production workflow runs at a time. Do not cancel a deployment during
backup or replacement. A local lock also prevents two script invocations racing.
An interrupted process may leave `deploy.lock`; verify that no deployment is running
before manually removing that empty directory.

The release briefly stops only `poker-tracker`, leaving Cloudflare running. It copies
the entire data directory while the app is stopped, verifies every copied file's
SHA-256, and records the old image, new digest, and release commit. Ensure no other
process writes to the live SQLite database during this copy.

## 7. Operate and recover production

After the first deployment, the active image is selected by
`PROD_BACKUP_DIR/current.compose.yml`. Future manual `up` commands must include that
override. Otherwise the base Compose file can select an older locally built image.
For example, after setting these variables to your actual values in Git Bash:

```bash
export MSYS_NO_PATHCONV=1
docker compose --project-directory "$(cygpath -w "$PROD_DIR")" -p "$PROD_PROJECT" \
  -f "$(cygpath -w "$PROD_DIR/docker-compose.yml")" \
  -f "$(cygpath -w "$PROD_BACKUP_DIR/current.compose.yml")" ps
```

If image download, smoke testing, or mount validation fails, the live app is untouched.
If backup fails, the script attempts to restart the unchanged old container. If the
new image or public health check fails, the script stops the application and reports
the release backup location. It does not automatically restore data or run old code
against a database that may just have been migrated.

For an application-only rollback, first confirm old code supports the current database.
Set `RELEASE_DIR` to the failed release's backup folder. Use its saved rollback image:

```bash
docker compose --project-directory "$(cygpath -w "$PROD_DIR")" -p "$PROD_PROJECT" \
  -f "$(cygpath -w "$PROD_DIR/docker-compose.yml")" \
  -f "$(cygpath -w "$RELEASE_DIR/rollback.compose.yml")" \
  up -d --no-deps --no-build --pull never --wait --wait-timeout 120 poker-tracker
```

After a successful rollback, update the persistent image selection:

```bash
cp "$RELEASE_DIR/rollback.compose.yml" "$PROD_BACKUP_DIR/current.compose.yml"
```

Retain the tagged previous image and backup. A database restore loses entries made
after the backup: stop the app, preserve the failed state, restore the full matching
data directory only after deciding how to reconcile those entries, and then start
compatible code. Do not mix an old database file with newer SQLite journal files.

This setup intentionally leaves runner registration, repository variables, main-branch
protection, and first deployment as visible setup steps. It does not change GitHub
settings or deploy merely because these files exist.
