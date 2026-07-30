# Poker Tracker — Production Roadmap

## Executive Summary

Poker Tracker is a platform for home poker groups to manage their games, track money, and celebrate their players. The vision is a mobile-first app where groups of friends can create a shared space — invite codes get everyone in, and from there the app handles session tracking (buy-ins, rebuys, cashouts), running leaderboards, player stats, a rules wiki for dealer's-choice variants, and a Balatro-aesthetic achievement system that rewards memorable moments at the table. AI is already woven in: Claude analyzes hands in real time during play, and Gemini generates artwork for custom achievements. The goal of this document is to lay out what exists, what's missing, and a phased path from the current local-only prototype to a shippable multi-group mobile product.

---

## Current State Assessment

### What's Built

The codebase is a monorepo: a React 18 frontend (Create React App, ~2,800 lines in a single `App.js`) backed by a Node/Express API (~1,330 lines in `server/index.js`) and a SQLite database via `better-sqlite3`. Everything runs on port 3001 and is exposed externally via a Cloudflare Tunnel (`cloudflared`).

**Auth.** Custom JWT with bcrypt, 30-day tokens, three roles (`user`, `owner`, `admin`). Registration is open. A default `admin/admin` account is seeded on first boot.

**Players & Games.** Players are either linked to registered user accounts or exist as "guests." Games have a date, location, start/end time, and an owner. Each game tracks buy-ins, rebuys, and cashouts per player. When a game is marked complete, results are broadcast to Telegram and achievements are evaluated.

**Leaderboard & Stats.** A leaderboard view uses Recharts to render per-game bar charts and cumulative profit/loss line charts. Each user has a profile stats tab showing total buy-in, total cashout, and game-by-game history.

**Rules Wiki.** Any user can create a dealer's-choice game rule entry with structured fields (overview, key considerations, betting type, setup, winning hierarchy, how to play, how it ends). All edits are versioned. Users can leave comments; admins can delete them.

**Achievements.** Five built-in achievements (Double Up, High Roller, Hat Trick, Comeback Kid, I Never Heard No Bell) are defined with a structured `criteriaJson` DSL that supports game-scoped conditions (comparisons between player metrics) and streak-scoped conditions (consecutive wins). Achievements are auto-awarded on game completion. Users can submit achievement recommendations with an optional reference image; admins approve or reject them. On approval, Gemini (`gemini-2.0-flash-preview-image-generation`) generates Balatro-style card artwork. Admins can manually grant/revoke achievements, edit criteria, and regenerate art with feedback prompts.

**Ask Claude.** An admin-only hand analysis feature sends hole cards, community cards, player count, and the applicable game rules to `claude-opus-4-8` with adaptive thinking enabled. The response streams back via SSE and is rendered with suit-colored card notation.

**Telegram Integration.** A Telegram bot long-polls for updates. It sends notifications for new games, buy-ins, rebuys, cashouts, game-over result summaries, and achievement unlocks. It responds to `/game` with a live pot summary. This is the only notification channel.

**Deployment.** The app is Dockerized (Node 20 Alpine, React build served by Express). Cloudflare Tunnel handles HTTPS. There is no CI/CD pipeline, no staging environment, and no automated tests.

### What's Missing for Production

The biggest structural gap is that there is no concept of a **group**. The entire database is a single shared namespace — all users see all games, all players, all achievements. This is fine for one household running it locally, but it's the first thing that must change before the app can serve multiple groups of strangers.

Beyond that: SQLite cannot scale horizontally and is a poor fit for cloud deployment (file-locking issues, no connection pooling, data lives on the container's ephemeral disk). Local file storage for avatars and achievement images has the same problem. The Telegram bot is a clever hack but not a real push notification system — it requires every user to be in a specific chat and can't reach people on their phones. There are no rate limits, no email verification, no password reset flow, and the JWT secret defaults to a hardcoded string if the env var is missing. The frontend is a single massive file with no routing library, which makes deep-linking impossible and will become unmaintainable as the app grows.

---

## Target Architecture

### Mobile App

**Recommendation: React Native with Expo.**

The existing frontend is React, which means the component patterns, hooks, and most of the logic can be ported to React Native with moderate effort — the biggest diff is swapping HTML/CSS for RN primitives and Stylesheet. Flutter would produce a marginally better native feel and faster cold starts, but it requires learning Dart and rebuilding all UI from scratch, which erases the code reuse advantage.

Expo is the right wrapper. It provides a managed build pipeline (EAS Build), over-the-air update support via EAS Update, and first-class push notification APIs that bridge to APNs and FCM. You can start with Expo Go during development and graduate to bare workflow if you ever need native modules Expo doesn't support. The web target in Expo also means the same codebase can serve a progressive web app with minimal extra work.

### Web App

Keep a web version. The Rules Wiki and leaderboard are browsable content that people will want to share links to. With Expo's web target, you get this nearly for free. Consider adding React Navigation with URL support so individual game results and player profiles are deep-linkable.

### Backend API

The Express server is clean and well-structured; keep it. The main changes are extracting it into its own package (separate from the React frontend), adding proper middleware (rate limiting with `express-rate-limit`, helmet for security headers, structured logging with `pino`), enabling foreign key enforcement in SQLite/Postgres, and introducing a proper migration system (use `drizzle-orm` or `kysely` with a migrations folder rather than the current try/catch `ALTER TABLE` pattern).

The AI endpoints (Ask Claude, achievement image generation) should move behind a queue or at minimum add per-user rate limits — Gemini image generation can be slow and expensive at scale.

WebSockets for live game updates are worth adding in Phase 2. The Telegram bot already proves there's demand for real-time visibility into an active game. Socket.io would let the mobile app show a live buy-in feed without polling. The existing Express server can run Socket.io alongside the REST routes without a separate process.

### Database

**Migrate from SQLite to PostgreSQL on [Supabase](https://supabase.com).**

Supabase is the right choice here for several reasons. It gives you Postgres with a managed connection pooler (PgBouncer), a built-in auth system you can optionally adopt, real-time subscriptions via Postgres logical replication (useful for the live game feed), file storage (replaces local disk for avatars and achievement images), and a generous free tier. The SQL dialect difference from SQLite is minimal — the main gotchas are `TEXT PRIMARY KEY` vs `UUID` type, `INTEGER` vs `BOOLEAN`, and replacing `lower(hex(randomblob(8)))` with `gen_random_uuid()`.

The alternative is PlanetScale (MySQL-compatible, serverless), but Postgres is a better fit given the relational data model, and Supabase's ecosystem is more relevant to the features here.

### Auth

The current JWT-based auth works fine for a single-group app but lacks email verification, password reset, and OAuth (Sign in with Apple is required for App Store apps that offer social login). Two paths:

**Option A — Clerk.** Drop Clerk in front of the existing API. It handles all auth UI, email magic links, Apple/Google OAuth, session management, and JWTs that your Express middleware can verify. Easiest migration, best DX, ~$25/month at small scale.

**Option B — Supabase Auth.** Since you're already on Supabase for the database, using Supabase Auth keeps infrastructure consolidated. It supports email/password, magic links, and OAuth. The tradeoff is more manual integration work compared to Clerk's prebuilt components.

Either way, the Apple Sign In requirement for App Store submission makes OAuth non-optional if you offer any other social login method.

### File Storage

Move avatar and achievement image storage to Supabase Storage (or Cloudflare R2 if you want cheaper egress). Serve files through a CDN URL rather than the Express static file handler. The current `multer` upload routes stay largely the same — just swap the disk destination for an S3-compatible upload call.

### Hosting

- **API:** [Railway](https://railway.app) or [Render](https://render.com). Both support Node, auto-deploy from GitHub, and managed Postgres (though you'd use Supabase instead). Railway's pricing model (usage-based, no sleeping on free tier) is better for a persistent API with Telegram polling.
- **Web frontend:** Vercel. Zero config for React apps, global CDN, preview deploys per PR.
- **Mobile:** Expo EAS handles build and submit for both stores.

### Push Notifications

Replace the Telegram bot with [Expo Push Notifications](https://docs.expo.dev/push-notifications/overview/), which abstracts over APNs (iOS) and FCM (Android). Each device registers an `ExpoPushToken` at app launch; the server stores it in the `users` table and calls the Expo Push API when it needs to notify someone. The existing Telegram notification calls (`telegramNotify(...)`) become a thin wrapper around the Expo push service — same call sites, different transport.

Keep the Telegram bot as an optional power-user feature (the `/game` command is genuinely useful during a live session), but don't require it.

---

## Group System Design

The group is the central organizing unit of the production app. Here's how it should work:

A **group** has a name, an optional description, an avatar, a 6-character alphanumeric join code, and one or more admins. When a user creates a group, they become its first admin. They share the join code (or a deep link like `pokertrackerapp.com/join/ABC123`) with friends, who join with a single tap. All games, players, leaderboards, rules, and achievements are scoped to the group. A user can belong to multiple groups and switch between them in the app.

The database changes required are significant but straightforward. Every table that currently has no group context (`games`, `players`, `achievements`, `rules`) needs a `group_id` foreign key. A new `groups` table and `group_members` junction table (with a `role` column for group-level admin vs. member) replaces the current global `isAdmin`/`role` on `users`. The system-level `admin` role still exists for platform moderation, but group admins manage their own space independently.

Join codes should be regeneratable by group admins. Consider adding an expiry option (e.g., "this code expires in 24 hours") for groups that want to lock down membership after initial setup.

---

## Feature Roadmap

### Phase 1 — MVP (6–8 weeks)

The goal of Phase 1 is a working mobile app that a single group can use end-to-end. This means:

The **group system** described above is the foundational work — everything else depends on it. Create a group, get a join code, invite friends, set group admins. Without this, you can't have multiple groups on the same server.

**Mobile app scaffolding:** Set up the Expo project with React Navigation (tab navigator for the main sections, stack navigator for game detail, player profile, etc.), a shared API client that handles auth headers and token refresh, and a basic design system (the existing CSS variables map cleanly to a `colors.ts` theme file).

**Core session flow:** Create a game, add players with buy-ins, record rebuys and cashouts during play, end the game. This is the heart of the product. The existing API routes work; the main effort is rebuilding the UI in React Native.

**Leaderboard and basic stats.** The existing Recharts charts don't work in React Native; use `react-native-gifted-charts` or `victory-native` instead.

**Push notifications** for the events that already fire Telegram messages: new game started, game ended with results, achievement earned.

**Infrastructure migrations:** Supabase for Postgres and file storage, auth migration (Clerk or Supabase Auth), Railway for API hosting, Vercel for web.

### Phase 2 — Achievements & Rules (4–6 weeks)

Port the achievements system to mobile with the Balatro card aesthetic. This requires rendering the JokerCard component in React Native, which means reimplementing the CSS gradient borders and image framing as RN Animated or Skia (via `@shopify/react-native-skia`) elements.

Add the **Rules Wiki** to mobile. This is lower-friction since it's mostly read-only for most users — the full editor can live on web only initially.

Introduce **WebSockets for live game updates.** When a player buys in, rebuys, or cashes out, all connected group members see the update instantly in the game detail view. This makes the app genuinely useful during a session rather than just for post-game record-keeping.

**Leaderboard improvements:** all-time records, head-to-head history between two players, biggest single-game win/loss.

### Phase 3 — Social & Growth (ongoing)

**Public group pages** — opt-in shareable leaderboards at a URL like `pokertrackerapp.com/g/the-tuesday-crew`. Great for group identity and organic growth.

**Stats sharing.** Let users share a recap card (generated server-side as an image) for their best game, their current streak, or their all-time ranking. These are the kind of things people actually post to group chats.

**Multi-group experience.** Polish the group switcher, add group discovery (if the group is public), and let group admins customize their group with a color scheme or banner.

**Ask Claude on mobile.** The hand analysis feature is admin-only currently because it's expensive; in Phase 3, make it available to all users with a per-group or per-user rate limit.

---

## App Store Path

### What's Required

**Apple Developer Account** ($99/year). You'll need this before you can run builds on real iOS devices or submit to the App Store. Sign up at [developer.apple.com](https://developer.apple.com).

**Google Play Developer Account** ($25 one-time fee). Required for Play Store submission.

**Expo EAS.** `eas build` handles the Xcode/Gradle complexity. Set up `eas.json` with `development`, `preview`, and `production` build profiles. Use `eas submit` to push builds directly to App Store Connect and the Play Console.

**App Store Review requirements** that apply here: Sign in with Apple is mandatory if you support any other social login (Apple's rule 4.8). The app doesn't involve real-money gambling (it's record-keeping for a private game), so you should be fine under App Store guidelines — but include a clear description to that effect. Age rating will be 17+ due to gambling themes (even simulated), which is fine.

**Privacy policy and terms of service.** Required for App Store submission. You'll need a URL to both. Minimal versions are fine for launch.

**App icons and screenshots.** Expo's asset pipeline handles icon generation across sizes. You need App Store screenshots for at minimum iPhone 6.5" and iPad 12.9" if you support iPad.

### Timeline

Realistically, plan for 2–4 weeks of App Review time on first submission (Apple can be slow with new apps) and another 1–2 weeks for back-and-forth if they request changes. Submit early, before you consider Phase 1 "done," so review runs in parallel with Phase 2 work.

---

## Key Technical Migrations

### SQLite → PostgreSQL

The SQL is largely portable. Things to address during migration:

- `TEXT PRIMARY KEY` with `uuidv4()` works in Postgres; consider switching to `UUID DEFAULT gen_random_uuid()` as the column default.
- `INTEGER NOT NULL DEFAULT 0` for booleans becomes `BOOLEAN NOT NULL DEFAULT FALSE` in Postgres.
- `lower(hex(randomblob(8)))` for ID generation goes away.
- The `COLLATE NOCASE` on username lookups becomes `LOWER(username) = LOWER($1)` or a case-insensitive collation on the column.
- `INSERT OR IGNORE` becomes `INSERT ... ON CONFLICT DO NOTHING`.
- `better-sqlite3` (synchronous) gets replaced by `pg` or `postgres.js` (async). This touches every DB call in the server — use `async/await` throughout.
- Enable foreign key enforcement (`SET session_characteristics AS TRANSACTION ISOLATION LEVEL ...`) from day one in Postgres; don't carry over the `foreign_keys = OFF` pattern.
- Replace the try/catch `ALTER TABLE` migration pattern with a proper migration runner (Drizzle ORM's `drizzle-kit push`, or Flyway, or plain numbered SQL files run by a startup script).

### Single-User → Multi-Tenant

Every API route needs to be scoped to a group. The auth middleware should populate `req.group` based on a group ID in the request (header or path param), and every query should include `WHERE group_id = $groupId`. Use Postgres Row Level Security as a defense-in-depth measure if you adopt Supabase.

The existing data (your personal game history) can be seeded into a "founding group" during the migration without data loss.

### Telegram → Push Notifications

The Telegram integration is a clean one-file concern. The swap is:

1. Add `expo_push_token TEXT` to the `users` table.
2. Add a `POST /api/devices/register` route that saves the token on app launch.
3. Replace the `telegramNotify()` helper with a `pushNotify(userIds[], title, body)` function that calls the [Expo Push API](https://docs.expo.dev/push-notifications/sending-notifications/#http2-api).
4. Keep the Telegram bot as-is for power users who want the group chat integration.

### Monorepo Restructuring

Split the current single-directory project into:

```
packages/
  api/          # Express server (currently server/)
  app/          # Expo React Native app (new)
  web/          # React web app (currently src/ — or use Expo web target)
  shared/       # Types, constants, API client (new)
```

Use pnpm workspaces or Turborepo to manage the monorepo. This lets the API and apps share TypeScript types for API responses without duplicating them.

---

## Estimated Effort

| Phase | Scope | Estimate |
|---|---|---|
| **Phase 1 MVP** | Group system, DB migration, Expo app setup, core game session flow, push notifications, infra | 6–8 weeks (1 developer) |
| **Phase 2 Achievements & Live** | Achievement cards in RN, rules wiki, WebSockets, leaderboard depth | 4–6 weeks |
| **Phase 3 Social** | Public pages, share cards, group customization, Ask Claude on mobile | Ongoing / iterative |
| **App Store submission prep** | Icons, screenshots, privacy policy, EAS setup, review cycle | 2–3 weeks (overlaps with Phase 1) |

These are solo-developer estimates. A second person (especially someone with native mobile experience) would compress Phase 1 significantly. The database migration and group system are the highest-risk items and should be tackled first — they're load-bearing for everything else.

---

## What to Do First

If you're starting tomorrow, the order of operations is:

1. Set up a Supabase project and migrate the schema (write the Postgres DDL, port the seed data, verify queries work). This is the least glamorous work but unblocks everything.
2. Add the `groups` and `group_members` tables and scope the existing routes to a group. Even if there's only one group at first, the data model needs to be right before mobile.
3. Create the Expo project, wire up the API client and auth flow, and ship the game session screens. Get the core loop working on a real phone.
4. Set up EAS and submit a TestFlight build as early as possible — App Review timelines are unpredictable, and getting into the review queue early is free.

The AI features (hand analysis, achievement art generation) are differentiated and worth keeping, but they're not on the critical path for Phase 1. Ship the poker tracker first; the magic comes after.
