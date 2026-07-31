# Server tests

Characterization suite for the Express API. These assert **current** behavior,
so they act as a regression net: if a change alters a response shape or status
code, a test here fails.

Runner is Node's built-in `node --test` (no Jest — `react-scripts` pins its own
Jest internally and adding a second one causes resolution conflicts).

## Running them

`better-sqlite3` ships a native binding built for the container's Node 20. It
does **not** load under a newer host Node, so run the suite inside the image:

```bash
docker compose build          # only needed after dependency changes

MSYS_NO_PATHCONV=1 docker run --rm \
  -v "/c/Users/cmlan/Github/poker-tracker-app/server:/app/server:ro" \
  -e DATA_DIR=/tmp/pt-test \
  -e JWT_SECRET=test-secret-do-not-use-in-prod \
  poker-tracker-app-poker-tracker:latest \
  node --test /app/server/tests/
```

The bind mount runs your working-tree code against the image's `node_modules`,
so you don't need to rebuild between edits. `MSYS_NO_PATHCONV=1` stops Git Bash
mangling the container-side `/app/...` paths; drop it on Linux/macOS.

A single file: append `<name>.test.js` to the `node --test` path.

Inside a container with a working binding, `npm run test:server` also works.

## Safety

`DATA_DIR` (see `server/paths.js`) **must** point somewhere disposable. Every
test file calls `isolateDataDir()` before requiring `../app`, giving it a
private SQLite database — `node --test` runs one process per file, so they
never share state. Without `DATA_DIR` set, the suite would write to the live
`data/poker.db`.

Sessions are minted as signed JWTs directly rather than via `POST /api/login`,
because the login (10 per 15 min) and register (5 per hour) rate limiters key
on IP and every supertest request shares one.

## Known failures this suite documents

Two pre-existing bugs are asserted as-is rather than fixed, because they only
affect brand-new deployments and production has long since self-healed:

- **Rules CRUD 500s on a fresh database.** `app.js` reads and writes
  `rules.overview`, `keyConsiderations`, `cardsDealt` and `howToPlay`, but
  `db.js` never creates those columns.
- **Achievements seed silently no-ops on first boot.** The seed inserts
  `criteriaJson` (`db.js:252`) before the migration that adds the column
  (`db.js:274`), so every insert throws into a `catch (_e) {}`. The table is
  empty until the process restarts.
