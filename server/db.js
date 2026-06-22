const Database = require('better-sqlite3');
const path = require('path');

const dbDir = path.join(__dirname, '../data');
require('fs').mkdirSync(dbDir, { recursive: true });
const db = new Database(path.join(dbDir, 'poker.db'));

// Keep FK enforcement off — we handle referential integrity in application code
db.pragma('foreign_keys = OFF');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    isAdmin INTEGER NOT NULL DEFAULT 0,
    role TEXT NOT NULL DEFAULT 'user',
    firstName TEXT,
    lastName TEXT,
    email TEXT,
    avatarPath TEXT,
    passwordChanged INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    userId TEXT,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    isComplete INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    ownerId TEXT,
    location TEXT,
    startTime TEXT,
    endTime TEXT,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS game_players (
    id TEXT PRIMARY KEY,
    gameID TEXT NOT NULL,
    playerID TEXT NOT NULL,
    buyIn REAL NOT NULL DEFAULT 0,
    rebuys REAL NOT NULL DEFAULT 0,
    cashOut REAL
  );

  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    gameName TEXT NOT NULL,
    minPlayers INTEGER,
    bettingType TEXT,
    setupInstructions TEXT,
    winningHierarchy TEXT,
    howItEnds TEXT,
    createdAt TEXT NOT NULL,
    createdBy TEXT,
    lastUpdated TEXT
  );

  CREATE TABLE IF NOT EXISTS rule_versions (
    id TEXT PRIMARY KEY,
    ruleId TEXT NOT NULL,
    version INTEGER NOT NULL,
    gameName TEXT,
    minPlayers INTEGER,
    bettingType TEXT,
    setupInstructions TEXT,
    winningHierarchy TEXT,
    howItEnds TEXT,
    editedAt TEXT NOT NULL,
    editedBy TEXT,
    editedByUsername TEXT
  );

  CREATE TABLE IF NOT EXISTS rule_comments (
    id TEXT PRIMARY KEY,
    ruleId TEXT NOT NULL,
    userId TEXT NOT NULL,
    username TEXT NOT NULL,
    body TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`);

// XP tables
db.exec(`
  CREATE TABLE IF NOT EXISTS xp_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    referenceId TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS xp_config (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL,
    label TEXT NOT NULL
  );
`);

// Seed XP config defaults (INSERT OR IGNORE so re-runs are safe)
const xpConfigDefaults = [
  ['play_game',               50,  'Play a Game'],
  ['top_winner',             100,  'Be the top winner'],
  ['profit_per_5',            10,  'End in profit (per $5 net)'],
  ['create_profile',         100,  'Create a profile'],
  ['suggest_achievement',     25,  'Suggest an Achievement'],
  ['additional_buyin_penalty', -10, 'Additional buy-in penalty'],
];
for (const [key, value, label] of xpConfigDefaults) {
  try { db.prepare('INSERT OR IGNORE INTO xp_config (key, value, label) VALUES (?, ?, ?)').run(key, value, label); } catch (_e) {}
}

// Achievements tables
db.exec(`
  CREATE TABLE IF NOT EXISTS achievements (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    criteria TEXT NOT NULL,
    imageSvg TEXT,
    isActive INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_achievements (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    achievementId TEXT NOT NULL,
    earnedAt TEXT NOT NULL,
    gameId TEXT,
    UNIQUE(userId, achievementId)
  );

  CREATE TABLE IF NOT EXISTS achievement_recommendations (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    username TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    referenceImagePath TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    submittedAt TEXT NOT NULL,
    reviewedBy TEXT,
    reviewedAt TEXT
  );
`);

// Seed built-in achievements with structured criteriaJson
const builtinAchievements = [
  {
    id: 'ach-double-up',
    name: 'Double Up',
    description: 'Cash out with at least 2× your total buy-in in a single game.',
    criteria: 'double_up',
    criteriaJson: JSON.stringify({
      scope: 'game',
      conditions: [
        { left: 'cash_out', op: '>=', rightType: 'multiplier', rightMultiplier: 2, rightBase: 'own_total_invested' },
      ],
    }),
  },
  {
    id: 'ach-never-heard-no-bell',
    name: 'I Never Heard No Bell',
    description: 'Re-buy 2+ times in a single game and still walk away in profit.',
    criteria: 'rebuy_profit',
    criteriaJson: JSON.stringify({
      scope: 'game',
      conditions: [
        { left: 'total_invested', op: '>=', rightType: 'multiplier', rightMultiplier: 3, rightBase: 'game_min_buy_in' },
        { left: 'cash_out', op: '>', rightType: 'metric', rightMetric: 'total_invested' },
      ],
    }),
  },
  {
    id: 'ach-high-roller',
    name: 'High Roller',
    description: 'Cash out with a net profit of $200 or more in a single game.',
    criteria: 'high_roller',
    criteriaJson: JSON.stringify({
      scope: 'game',
      conditions: [
        { left: 'net_profit', op: '>=', rightType: 'number', rightValue: 200 },
      ],
    }),
  },
  {
    id: 'ach-comeback-kid',
    name: 'Comeback Kid',
    description: 'Re-buy at least once and end up as the top winner of the game.',
    criteria: 'comeback_kid',
    criteriaJson: JSON.stringify({
      scope: 'game',
      conditions: [
        { left: 'net_profit_rank', op: '=', rightType: 'number', rightValue: 1 },
        { left: 'rebuy_amount', op: '>', rightType: 'number', rightValue: 0 },
      ],
    }),
  },
  {
    id: 'ach-hat-trick',
    name: 'Hat Trick',
    description: 'Win 3 games in a row.',
    criteria: 'hat_trick',
    criteriaJson: JSON.stringify({
      scope: 'streak',
      streakLength: 3,
      streakCondition: 'profit',
    }),
  },
];

for (const ach of builtinAchievements) {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO achievements (id, name, description, criteria, criteriaJson, isActive, createdAt)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(ach.id, ach.name, ach.description, ach.criteria, ach.criteriaJson, new Date().toISOString());
  } catch (_e) {}
  // Backfill criteriaJson for existing rows that don't have it yet
  try {
    db.prepare(`UPDATE achievements SET criteriaJson = ? WHERE id = ? AND criteriaJson IS NULL`).run(ach.criteriaJson, ach.id);
  } catch (_e) {}
}

// --- Safe column migrations (idempotent: no-op if column already exists) ---
function addCol(table, column, definition) {
  const cols = db.pragma(`table_info(${table})`).map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// users: xp total (maintained by awardXP)
addCol('users', 'xp', 'INTEGER NOT NULL DEFAULT 0');

// achievements: JSON criteria, XP reward, and image frame config
addCol('achievements', 'criteriaJson', 'TEXT');
addCol('achievements', 'xpValue', 'INTEGER NOT NULL DEFAULT 0');
addCol('achievements', 'imageFrame', 'TEXT');

// user_achievements: how many times a user has earned the same achievement
addCol('user_achievements', 'count', 'INTEGER NOT NULL DEFAULT 1');

module.exports = db;
