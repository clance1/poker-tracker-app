'use strict';

// app.js calls dotenv.config() on import, but getApp() is lazy, so without this
// line JWT_SECRET below is captured BEFORE .env is read. The helper would then
// sign tokens with the fallback secret while the app verified with the real one,
// and every authenticated request in the suite would 401.
require('dotenv').config();

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const request = require('supertest');

const BCRYPT_ROUNDS = 12; // must match server/app.js:29
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret'; // must match server/app.js:28 fallback

/**
 * server/paths.js reads process.env.DATA_DIR exactly once, at module-load time
 * (`const DATA_DIR = process.env.DATA_DIR || ...`). Node's built-in test runner
 * (`node --test`) runs each matching test *file* in its own child process, so
 * setting process.env.DATA_DIR at the top of a test file -- before that file's
 * first require of ../app or ../db (directly, or indirectly through this helpers
 * module's getApp()/getDb()/makeAgent()/createUser()/etc.) -- gives that file's
 * process a private, throwaway SQLite database that no other test file can see,
 * share, or corrupt. This has been verified to work both when the whole suite is
 * run together (`node --test /app/server/tests/`) and when a single file is run
 * in isolation.
 *
 * Call this FIRST in every test file, before calling any other helper here.
 */
function isolateDataDir(label) {
  const root = process.env.DATA_DIR || os.tmpdir();
  const dir = path.join(root, `case-${label}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  process.env.DATA_DIR = dir;
  return dir;
}

let _app = null;
function getApp() {
  // Lazy + memoized: the first call is what actually triggers `require('../app')`
  // (which pulls in db.js, which mkdir's DATA_DIR and opens the sqlite file), so
  // as long as isolateDataDir() ran first in this process, this is isolated.
  if (!_app) _app = require('../app');
  return _app;
}

function getDb() {
  return require('../db');
}

function makeAgent() {
  return request(getApp());
}

// Exact payload shape the app signs at register (app.js:298) / login (app.js:322) /
// change-password (app.js:354): { userId, username, role }, 30d expiry.
function signToken({ userId, username, role }) {
  return jwt.sign({ userId, username, role }, JWT_SECRET, { expiresIn: '30d' });
}

function cookieFor(user) {
  return `auth_token=${signToken(user)}`;
}

let _seq = 0;
function uniqueName(prefix = 'x') {
  _seq += 1;
  return `${prefix}_${process.pid}_${_seq}_${Date.now().toString(36)}`;
}

/**
 * Inserts a user directly into the DB (bypassing POST /api/register, which sits
 * behind a 5/hour-per-IP limiter that every supertest request in a suite would
 * share) and returns a ready-to-use auth cookie signed with the exact payload
 * shape the app itself issues. Covers admin/owner/user via `role`.
 *
 * NOTE: seedAdmin() (app.js ~215) runs on first import of app.js/db.js and always
 * creates a literal 'admin' / 'admin' user with passwordChanged = 0. uniqueName()
 * never collides with that literal username, so admin-role fixtures created here
 * are independent, separate accounts from the seeded one.
 */
function createUser({ role = 'user', username, password = 'password123', passwordChanged = 1 } = {}) {
  const db = getDb();
  const id = uuidv4();
  const uname = username || uniqueName(role);
  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, isAdmin, role, passwordChanged, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, uname, hash, role === 'admin' ? 1 : 0, role, passwordChanged ? 1 : 0, new Date().toISOString());
  return { id, username: uname, password, role, cookie: cookieFor({ userId: id, username: uname, role }) };
}

function createPlayer({ userId = null, name } = {}) {
  const db = getDb();
  const id = uuidv4();
  const pname = name || uniqueName('player');
  db.prepare('INSERT INTO players (id, name, userId, createdAt) VALUES (?, ?, ?, ?)')
    .run(id, pname, userId, new Date().toISOString());
  return { id, name: pname, userId };
}

function createGame({ ownerId = null, date, isComplete = false, location = null, startTime = '19:00' } = {}) {
  const db = getDb();
  const id = uuidv4();
  const d = date || new Date().toISOString().slice(0, 10);
  db.prepare(
    'INSERT INTO games (id, date, isComplete, ownerId, location, startTime, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, d, isComplete ? 1 : 0, ownerId, location, startTime, new Date().toISOString());
  return { id, date: d, isComplete, ownerId, location, startTime };
}

function createGamePlayer({ gameID, playerID, buyIn = 20, rebuys = 0, cashOut = null }) {
  const db = getDb();
  const id = uuidv4();
  db.prepare('INSERT INTO game_players (id, gameID, playerID, buyIn, rebuys, cashOut) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, gameID, playerID, buyIn, rebuys, cashOut);
  return { id, gameID, playerID, buyIn, rebuys, cashOut };
}

/**
 * Minimal "rule row" insert that only touches columns server/db.js actually
 * creates. See rules.test.js: app.js's own POST /api/rules cannot create a row
 * at all on a fresh DB (missing-column bug), so read/comment/delete-path tests
 * need a way to get a rule row into the table without going through that route.
 */
function createRuleRow({ gameName, createdBy = null } = {}) {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO rules (id, gameName, minPlayers, bettingType, setupInstructions, winningHierarchy, howItEnds, createdAt, createdBy, lastUpdated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, gameName || uniqueName('game'), null, null, null, null, null, now, createdBy, now);
  return { id, gameName: gameName || uniqueName('game') };
}

/**
 * Direct-insert bypass for the achievements table. See achievements.test.js:
 * on a genuinely fresh database, server/db.js's builtin-achievement seed loop
 * runs its `INSERT OR IGNORE ... criteriaJson ...` BEFORE the later
 * `addCol('achievements', 'criteriaJson', 'TEXT')` migration that creates that
 * column -- so the seed throws "no such column: criteriaJson" on every INSERT,
 * which is silently swallowed by a `catch (_e) {}`, and the achievements table
 * ends up with ZERO rows after the very first boot. (It self-heals on the
 * *second* boot against the same DB file, once the column already exists.)
 * This helper lets the rest of the achievements-route tests exercise
 * list/unseen/counts/grant/revoke against a real row without depending on that
 * broken seed.
 */
function createAchievement({ name, description = 'test achievement', criteria, xpValue = 0 } = {}) {
  const db = getDb();
  const id = uuidv4();
  const n = name || uniqueName('achievement');
  db.prepare(
    'INSERT INTO achievements (id, name, description, criteria, isActive, createdAt, xpValue) VALUES (?, ?, ?, ?, 1, ?, ?)'
  ).run(id, n, description, criteria || uniqueName('criteria'), new Date().toISOString(), xpValue);
  return { id, name: n };
}

module.exports = {
  BCRYPT_ROUNDS,
  JWT_SECRET,
  isolateDataDir,
  getApp,
  getDb,
  makeAgent,
  signToken,
  cookieFor,
  uniqueName,
  createUser,
  createPlayer,
  createGame,
  createGamePlayer,
  createRuleRow,
  createAchievement,
};
