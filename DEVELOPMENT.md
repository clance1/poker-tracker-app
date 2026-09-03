# Docker development

For the complete change, test, backup, deployment, and rollback workflow, see
[RELEASE-GUIDE.md](RELEASE-GUIDE.md).

Start Docker Desktop with Linux containers (the WSL 2 backend on Windows).
From the project directory, run:

```powershell
docker compose -f compose.dev.yml up --build -d
```

Open http://localhost:3002 after React finishes compiling. The React development
server forwards API requests to Express inside the same container. Only the
React port is published, and it is bound to your computer's loopback address.

This uses Node 22 and a separate Compose project named `poker-tracker-dev`.
The existing production Dockerfile currently uses Node 20; validate production
builds separately before deploying.

## Development data and credentials

Development starts with a separate SQLite database in the Docker volume
`poker-tracker-dev_dev-data`. Uploaded files live there too. Data survives normal
stops, restarts, and image rebuilds. The live `data/` folder, root `.env`, and
Cloudflare credentials are neither mounted nor copied into the development image.
Telegram and paid AI integrations are disabled because their keys are not supplied.
The JWT secret in the development configuration is for local use only.

## Everyday commands

```powershell
# Follow frontend and API logs (Ctrl+C exits the log view)
docker compose -f compose.dev.yml logs -f app

# Restart the API after editing server files
docker compose -f compose.dev.yml restart app

# Build the React files required by the backend's SPA-serving tests
docker compose -f compose.dev.yml exec app npm run build

# Run backend tests after the build succeeds
docker compose -f compose.dev.yml exec -e DATA_DIR=/tmp/poker-tests app npm run test:server

# Stop development, preserving the development database
docker compose -f compose.dev.yml down
```

React automatically refreshes when you save files in `src/` or `public/`.
Polling supports edits made on the Windows filesystem. Server files are mounted
live, but require the restart command above. Dependencies stay inside the image;
after changing `package.json` and `package-lock.json`, run the startup command
again to rebuild.

Always include `-f compose.dev.yml` for development commands. The default
`docker-compose.yml` operates the live deployment, including its Cloudflare tunnel.
Do not add `-v` to the stop command unless you intend to delete development data.

The React development server serves files from memory; it does not create
`build/index.html`. Backend tests for `/` and client-side routes require that file,
so run the build command before backend tests. Rebuild after frontend changes or
container recreation. The compiled files stay inside the development container.
