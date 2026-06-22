# Carson's Game — Poker Tracker

A private poker night tracker for Carson's group. Tracks games, players, buy-ins, rebuys, cash-outs, standings, game rules, achievements, and XP. Live at **[www.carsonsgame.com](https://www.carsonsgame.com)**.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Cloudflare DNS (CNAME → tunnel)            │
│  www.carsonsgame.com                        │
└──────────────┬──────────────────────────────┘
               │ HTTPS (Cloudflare tunnel)
┌──────────────▼──────────────────────────────┐
│  cloudflared (Docker service)               │
│  ./cloudflared/config.yml                   │
│  Routes → http://poker-tracker:3001         │
└──────────────┬──────────────────────────────┘
               │ HTTP (Docker network)
┌──────────────▼──────────────────────────────┐
│  Docker Container  (port 3001)              │
│  node:20-alpine                             │
│  ├─ Express API        /api/*               │
│  ├─ React SPA          /  (static build)    │
│  ├─ SQLite DB          /app/data/poker.db   │
│  ├─ Avatars            /app/data/avatars/   │
│  └─ Achievement images /app/data/ach-imgs/  │
└─────────────────────────────────────────────┘
```

### Key files

| Path | Purpose |
|---|---|
| `server/index.js` | Express API server — JWT auth, all REST routes, XP/achievement logic |
| `server/db.js` | SQLite schema, idempotent column migrations, startup seeding |
| `src/App.js` | React SPA — all components in a single file |
| `src/App.css` | Global styles (dark theme) |
| `data/poker.db` | SQLite database (persisted via Docker volume) |
| `data/avatars/` | Uploaded profile photos |
| `data/ach-imgs/` | Uploaded achievement artwork |
| `Dockerfile` | `npm install` → `npm run build` → `node server/index.js` |
| `docker-compose.yml` | Two services: `poker-tracker` + `cloudflared` (health-checked dependency) |
| `cloudflared/config.yml` | Cloudflare tunnel ingress config |

---

## Deployment

### Prerequisites
- Docker Desktop running
- Cloudflare tunnel credentials in `./cloudflared/credentials.json`

### Start / rebuild

```bash
# Rebuild image and restart both containers
docker compose down && docker compose up --build -d

# View logs
docker compose logs -f poker-tracker

# Stop
docker compose down
```

The `cloudflared` service depends on `poker-tracker` passing its health check (`GET /api/health`) before starting.

### Cloudflare Tunnel

Tunnel config at `./cloudflared/config.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: /etc/cloudflared/credentials.json

ingress:
  - hostname: www.carsonsgame.com
    service: http://poker-tracker:3001
  - service: http_status:404
```

DNS: `www.carsonsgame.com` → CNAME → `<tunnel-id>.cfargotunnel.com` (set in Cloudflare dashboard, proxied).

---

## Environment Variables

Set in a `.env` file at project root (loaded via `env_file` in `docker-compose.yml`):

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | Secret for signing JWTs. Change before production. |
| `ALLOWED_ORIGIN` | No | CORS allowed origin (defaults to `true` = any) |
| `TELEGRAM_BOT_TOKEN` | No | Bot token for game/achievement event notifications |
| `TELEGRAM_CHAT_ID` | No | Group chat ID to receive notifications |
| `ANTHROPIC_API_KEY` | No | Enables the "Ask Claude" poker advisor tab |
| `GEMINI_API_KEY` | No | Enables AI-generated achievement artwork via Gemini |
| `PORT` | No | HTTP port (default `3001`) |

---

## Role System

| Role | Permissions |
|---|---|
| **Admin** | Everything — manage users/roles, manage achievements, approve recommendations, delete games/comments |
| **Owner** | Create and edit games, create guest players, create/edit game rules |
| **User** | View everything, record buy-ins/rebuys/cash-outs on active games, post rule comments, suggest achievements |

The first user seeded on startup is `admin` / `admin123` with role `admin`. Change the password immediately after first login.

---

## Database Schema

Tables in `data/poker.db` (SQLite). New columns added to existing databases via idempotent `ALTER TABLE` migrations in `server/db.js` — safe to re-run on any version of the DB.

### Core tables

| Table | Key columns |
|---|---|
| `users` | `id, username, password_hash, isAdmin, role, firstName, lastName, email, avatarPath, passwordChanged, xp, createdAt` |
| `players` | `id, name, userId (nullable), createdAt` — `userId` NULL = guest player |
| `games` | `id, date, isComplete, notes, ownerId, location, startTime, endTime, createdAt` |
| `game_players` | `id, gameID, playerID, buyIn, rebuys, cashOut` |
| `rules` | `id, gameName, minPlayers, bettingType, setupInstructions, winningHierarchy, howItEnds, createdAt, createdBy, lastUpdated` |
| `rule_versions` | Full snapshot saved on every rule create/edit, with `version` integer and editor info |
| `rule_comments` | `id, ruleId, userId, username, body, createdAt` |

### XP tables

| Table | Key columns |
|---|---|
| `xp_events` | `id, userId, amount, reason, referenceId, createdAt` — append-only event log |
| `xp_config` | `key, value, label` — configurable XP values per action (editable in Admin Panel) |

### Achievement tables

| Table | Key columns |
|---|---|
| `achievements` | `id, name, description, criteria, criteriaJson, xpValue, imageSvg, imageFrame, isActive, createdAt` |
| `user_achievements` | `id, userId, achievementId, earnedAt, gameId, count` — `count` drives tier frame (Bronze/Silver/Gold/Diamond) |
| `achievement_recommendations` | `id, userId, username, name, description, referenceImagePath, status, submittedAt, reviewedBy, reviewedAt` |

---

## Features

### Standings (Leaderboard)
- Net profit/loss per player across all completed games
- Win/loss streak indicators
- XP badges showing each player's total XP

### Games
- Create games with owner, location, start time, default buy-in
- Track buy-ins, rebuys, and cash-outs per player per game
- End game captures end time and records a balanced pot summary
- Telegram notifications on game start, buy-ins, rebuys, cash-outs, and final results

### Players
- All registered users automatically appear as players
- Owners can add guest players (not linked to an account)
- Delete rules: 0 games → owner/admin; guest with history → admin only; linked account → blocked

### Rules
- Game rule entries: Game Name, Min Players, Betting Type, Setup, Winning Hierarchy, How It Ends
- Full version history — every save is snapshotted with editor name and timestamp
- Discussion section — all users can comment; admins can delete comments
- Admins can delete or duplicate entire rule entries

### Achievements
Joker-card style achievement system with tiered display frames.

**Earning achievements:**
- **Auto-award** — triggered on game completion; `awardAchievements()` evaluates all active achievements against each player's game result
- **Manual grant** — admins can grant/revoke achievements to any user from the Edit Achievement modal

**Criteria system:**
- Structured `criteriaJson` format supports `game` scope (condition sets) and `streak` scope (N consecutive wins/losses)
- Conditions support comparisons against numbers, multipliers, and other metrics (`net_profit`, `cash_out`, `total_invested`, `rebuy_amount`, `net_profit_rank`)
- Legacy string-based `criteria` field used as fallback for older entries

**Tier frames** (driven by `user_achievements.count`):

| Times earned | Frame |
|---|---|
| 1 | Default |
| 2 | 🥉 Bronze |
| 3 | 🥈 Silver |
| 4 | 🥇 Gold |
| 5+ | 💎 Diamond |

**Achievement artwork:**
- Upload a custom image (JPEG/PNG/GIF/WebP, max 5 MB) or generate AI artwork via Gemini with an optional inspiration image
- Interactive framer: drag to pan, scroll/pinch to zoom; frame position saved as `{ x, y, scale }` and applied identically on the card and in the editor (same 4:5 aspect ratio)
- Gold-border crop guide in the editor shows the exact card display boundary

**XP awards:**
- Each achievement can have a configurable `xpValue`
- XP is awarded both on auto-award and on manual admin grant (including re-grants)
- XP also awarded for: playing a game, being top winner, ending in profit (per $5), creating a profile, suggesting an achievement; each rebuy subtracts XP

**Recommendations:**
- Any user can suggest a new achievement (name, description, optional reference image)
- Admins see pending recommendations in the Achievements tab and can approve (creating the achievement) or reject

### XP System
- `users.xp` stores running total; `xp_events` is the append-only event log
- XP config values editable by admins in the Admin Panel (XP Settings section)
- XP history visible on each user's profile tab

### Profiles
- First Name, Last Name, Email, Avatar photo (stored in `data/avatars/`)
- XP total and event history
- Password change (forced on first login if `passwordChanged = 0`)
- Sign out clears the httpOnly auth cookie

### Admin Panel
**User Management:**
- View all users with role badges, email, and join date
- Promote/demote between Admin / Owner / User
- Reset any user's password
- Delete user accounts

**XP Settings:**
- Inline edit of all XP config values (play game, top winner, profit bonus, create profile, suggest achievement, rebuy penalty)

**Achievements Table:**
- Scrollable table of all achievements with Name, Description, XP Value, Criteria summary, and earned count (X / total users)
- Edit button opens the full `EditAchievementModal` inline

### Ask Claude Tab
- Poker hand advisor powered by Claude (Anthropic API)
- Visual card selector UI for hole cards, board cards, and optional villain range
- Streaming response with structured analysis: Bottom Line → Full Analysis
- Requires `ANTHROPIC_API_KEY` environment variable

### Telegram Bot
- Game event notifications: game start, buy-in, rebuy, cash-out, game-over results
- Achievement notifications: auto-earned and admin-granted
- `/game` command returns active game stats (long-poll)
- Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`

---

## API Reference

### Auth
| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/register` | — | Register new user (rate-limited: 5/hr) |
| POST | `/api/login` | — | Login, sets httpOnly `auth_token` cookie (rate-limited: 10/15min) |
| POST | `/api/logout` | — | Clears auth cookie |
| POST | `/api/change-password` | — | Change own password (used on forced first-login) |

### Profile
| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/profile` | User | Get current user profile + stats |
| PATCH | `/api/profile` | User | Update firstName, lastName, email |
| POST | `/api/profile/avatar` | User | Upload avatar image |
| GET | `/api/profile/stats` | User | Game stats for the current user's linked player |
| GET | `/api/xp/history` | User | XP event log for current user |

### Players & Games
| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/players` | User | All players with game history and XP |
| POST | `/api/players` | Owner | Create player |
| DELETE | `/api/players/:id` | Owner/Admin | Delete player |
| GET | `/api/games` | User | All games with players |
| POST | `/api/games` | Owner | Create game |
| PUT | `/api/games/:id` | Owner | Update game (end game, edit details) |
| DELETE | `/api/games/:id` | Admin | Delete game |
| GET | `/api/owners` | Owner | List eligible game owners |
| POST | `/api/game-players` | Owner | Add player to game |
| PATCH | `/api/game-players/:id` | Owner | Update buy-in/rebuy/cash-out |

### Rules
| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/rules` | User | All rules |
| GET | `/api/rules/:id` | User | Single rule with version history and comments |
| POST | `/api/rules` | Owner | Create rule |
| PUT | `/api/rules/:id` | Owner | Update rule (saves version snapshot) |
| POST | `/api/rules/:id/duplicate` | Owner | Duplicate rule |
| DELETE | `/api/rules/:id` | Admin | Delete rule |
| POST | `/api/rules/:id/comments` | User | Post comment |
| DELETE | `/api/rules/:id/comments/:commentId` | Admin | Delete comment |

### Achievements
| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/achievements` | User | All active achievements + current user's earned status and `earnerCount` |
| GET | `/api/achievements/user/:userId` | User | Achievements earned by a specific user |
| GET | `/api/achievements/all-users` | User | All users' earned achievements |
| GET | `/api/achievements/:id` | Admin | Single achievement |
| PATCH | `/api/achievements/:id` | Admin | Update name, description, xpValue, criteriaJson, imageSvg, imageFrame |
| GET | `/api/achievements/:id/users` | Admin | All users with earned status + count for this achievement |
| POST | `/api/achievements/:id/users/:userId` | Admin | Grant achievement (awards XP, increments count on re-grant) |
| DELETE | `/api/achievements/:id/users/:userId` | Admin | Revoke achievement |
| PATCH | `/api/achievements/:id/users/:userId/count` | Admin | Set earned count (min 1, drives tier frame) |
| POST | `/api/achievements/:id/upload-image` | Admin | Upload custom artwork |
| POST | `/api/achievements/:id/regenerate` | Admin | Regenerate artwork via Gemini AI |
| GET | `/api/achievements/recommendations` | Admin | Pending recommendations |
| POST | `/api/achievements/recommendations` | User | Submit achievement recommendation |
| POST | `/api/achievements/recommendations/:id/approve` | Admin | Approve recommendation (creates achievement) |
| POST | `/api/achievements/recommendations/:id/reject` | Admin | Reject recommendation |

### Admin & XP
| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/users` | Admin | All users |
| GET | `/api/users/:id` | Admin | Single user |
| PATCH | `/api/users/:id` | Admin | Update role or reset password |
| DELETE | `/api/users/:id` | Admin | Delete user |
| GET | `/api/admin/xp-config` | Admin | All XP config values |
| PATCH | `/api/admin/xp-config` | Admin | Bulk update XP config values |

### Health & AI
| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | — | Health check (used by Docker `healthcheck`) |
| POST | `/api/ask-claude` | User | Streaming poker hand analysis via Claude API |

---

## Security

- Passwords hashed with `bcrypt` (12 rounds)
- Auth via httpOnly `SameSite=Strict` cookie (not accessible to JS)
- JWT signed with `JWT_SECRET`; 401 responses trigger client-side reload to login screen
- Rate limiting on `/api/login` (10/15min) and `/api/register` (5/hr)
- Input sanitized server-side (`sanitizeStr`, `sanitizeEmail`) before DB writes
- `passwordChanged` flag forces password reset on first login for admin-created accounts

---

## Local Development

```bash
# Install dependencies
npm install --ignore-scripts

# Start the API server (port 3001)
node server/index.js

# In a separate terminal, start the React dev server (port 3000)
npm start
```

The React dev server proxies `/api/*` to `localhost:3001` (configured via `"proxy"` in `package.json`).

Copy `.env.example` to `.env` and fill in at minimum `JWT_SECRET`. API keys for Claude and Gemini are optional — the relevant tabs degrade gracefully without them.
