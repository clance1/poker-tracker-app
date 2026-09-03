const Database = require('better-sqlite3');
const paths = require('./paths');

require('fs').mkdirSync(paths.DATA_DIR, { recursive: true });
const db = new Database(paths.dbPath);

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

// Scheduled games
db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_games (
    id TEXT PRIMARY KEY,
    scheduledDate TEXT NOT NULL,
    scheduledTime TEXT NOT NULL,
    location TEXT,
    createdBy TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    reminderSent INTEGER NOT NULL DEFAULT 0
  )
`);

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
  {
    id: 'ach-first-steps',
    name: 'First Steps',
    description: 'Create your account and join the game.',
    criteria: 'profile_created',
    criteriaJson: JSON.stringify({ scope: 'profile', trigger: 'profile_created' }),
  },
  {
    id: 'ach-face-of-the-game',
    name: 'Face of the Game',
    description: 'Upload a profile picture.',
    criteria: 'profile_avatar',
    criteriaJson: JSON.stringify({ scope: 'profile', trigger: 'profile_avatar' }),
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
// user_achievements: whether the user has been notified (1 = seen, 0 = pending toast)
// Default 1 for existing rows so they don't spam on first deploy
addCol('user_achievements', 'seen', 'INTEGER NOT NULL DEFAULT 1');

// users: Telegram user ID for personal DM notifications
addCol('users', 'telegramUserId', 'TEXT');

// users: forced-rotation flag set when an admin resets someone else's password
// via PATCH /api/users/:id (distinct from `passwordChanged`, which is already
// overloaded by /api/register and seedAdmin's default-password bootstrap check)
addCol('users', 'mustChangePassword', 'INTEGER NOT NULL DEFAULT 0');

// --- Invite-gated registration ---------------------------------------------
// Account creation requires an unrevoked, unexhausted code. Codes are stored in
// plaintext on purpose: an admin has to be able to read one back to share it.
// They are not credentials, and the entropy (80 bits) plus the existing
// per-IP register rate limit is what makes guessing impractical.
db.exec(`
  CREATE TABLE IF NOT EXISTS invite_codes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    label TEXT,
    createdBy TEXT,
    createdAt TEXT NOT NULL,
    revokedAt TEXT,
    maxUses INTEGER,
    useCount INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS invite_redemptions (
    id TEXT PRIMARY KEY,
    codeId TEXT NOT NULL,
    userId TEXT NOT NULL,
    username TEXT NOT NULL,
    redeemedAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_invite_redemptions_code
    ON invite_redemptions(codeId);
`);

// players: an admin can attach an email to a guest so that whoever registers
// with that address inherits the guest's game history instead of starting over.
// Cleared the moment it is claimed, so a claim can only ever happen once.
addCol('players', 'claimEmail', 'TEXT');

// game_players: per-player Time In / Time Out. Time In is stamped either when
// the owner presses "Start Timer" (for players who were pre-selected at game
// creation) or immediately on buy-in if the timer is already running. Time Out
// is stamped the first time a cash-out is recorded.
addCol('game_players', 'timeIn', 'TEXT');
addCol('game_players', 'timeOut', 'TEXT');

// games: whether the owner has pressed "Start Timer" yet. Gates whether newly
// inserted game_players rows get an immediate timeIn.
addCol('games', 'timerStarted', 'INTEGER NOT NULL DEFAULT 0');

// users: Venmo handle for in-app Pay/Request deep links (see PATCH /api/profile).
addCol('users', 'venmoHandle', 'TEXT');

// game_players: when the owner has manually marked this player's net as
// settled (paid/requested, via Venmo or otherwise). null = not settled.
addCol('game_players', 'venmoSettledAt', 'TEXT');

module.exports = db;
