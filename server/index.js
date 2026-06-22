require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const https = require('https');
const fs = require('fs');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./db');

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const BCRYPT_ROUNDS = 12;

// --- Avatar storage ---
const avatarDir = path.join(__dirname, '../data/avatars');
fs.mkdirSync(avatarDir, { recursive: true });

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, avatarDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? ext : '.jpg';
      cb(null, `${req.user.userId}${safeExt}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed.'));
  },
});

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || true,
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use('/avatars', express.static(avatarDir));
app.use(express.static(path.join(__dirname, '../build')));

// --- Health check (used by Docker healthcheck / load balancer) ---
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// --- Rate limiters ---
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many login attempts, try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many registration attempts, try again in 1 hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Cookie options ---
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

// --- Sanitization ---
const sanitizeStr = (val, maxLen = 100) =>
  typeof val === 'string' ? val.trim().slice(0, maxLen) : '';

const sanitizeEmail = (val) => {
  if (typeof val !== 'string') return null;
  const s = val.trim().toLowerCase().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null;
};

// --- Telegram ---
const telegramSend = (chatId, text) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  req.on('error', () => {});
  req.write(body);
  req.end();
};

const telegramNotify = (text) => telegramSend(process.env.TELEGRAM_CHAT_ID, text);

// --- XP helpers ---
function getXpConfig(key) {
  try {
    const row = db.prepare('SELECT value FROM xp_config WHERE key = ?').get(key);
    return row ? row.value : 0;
  } catch { return 0; }
}

function awardXP(userId, amount, reason, referenceId = null) {
  if (!userId || amount === 0) return;
  try {
    db.prepare('INSERT INTO xp_events (userId, amount, reason, referenceId) VALUES (?, ?, ?, ?)').run(userId, amount, reason, referenceId ?? null);
    db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(amount, userId);
  } catch (e) { console.error('awardXP error:', e.message); }
}

let tgLastUpdateId = 0;
function telegramPoll() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const qs = `offset=${tgLastUpdateId + 1}&timeout=30&allowed_updates=${encodeURIComponent('["message"]')}`;
  https.get(`https://api.telegram.org/bot${token}/getUpdates?${qs}`, (res) => {
    let raw = '';
    res.on('data', (c) => { raw += c; });
    res.on('end', () => {
      try {
        const json = JSON.parse(raw);
        if (json.ok) {
          for (const upd of json.result) {
            tgLastUpdateId = Math.max(tgLastUpdateId, upd.update_id);
            const msg = upd.message;
            if (msg?.text?.toLowerCase().startsWith('/game')) handleTgGameCommand(msg.chat.id);
          }
        }
      } catch (_e) {}
      telegramPoll();
    });
  }).on('error', () => setTimeout(telegramPoll, 10000));
}

function handleTgGameCommand(chatId) {
  const game = db.prepare('SELECT * FROM games WHERE isComplete = 0 ORDER BY createdAt DESC LIMIT 1').get();
  if (!game) return telegramSend(chatId, 'No active game right now.');
  const gps = db.prepare(`
    SELECT gp.buyIn, gp.rebuys, gp.cashOut, p.name
    FROM game_players gp JOIN players p ON gp.playerID = p.id
    WHERE gp.gameID = ?
  `).all(game.id);
  const pot = gps.reduce((s, gp) => s + gp.buyIn + (gp.rebuys || 0), 0);
  const lines = gps.map((gp) => {
    const totalIn = gp.buyIn + (gp.rebuys || 0);
    const rebuyNote = gp.rebuys > 0 ? ` (+$${gp.rebuys.toFixed(0)} rebuy)` : '';
    return `  ${gp.name}: $${totalIn.toFixed(0)}${rebuyNote}`;
  });
  telegramSend(chatId, `<b>🃏 Live Game — ${game.date}</b>\n${lines.join('\n')}\n\n💰 <b>Pot: $${pot.toFixed(0)}</b>`);
}

// --- Seed admin ---
function seedAdmin() {
  const existing = db.prepare('SELECT id, password_hash, passwordChanged FROM users WHERE username = ? COLLATE NOCASE').get('admin');
  if (!existing) {
    const hash = bcrypt.hashSync('admin', BCRYPT_ROUNDS);
    const adminId = uuidv4();
    // passwordChanged = 0 → forced rotation on first login
    db.prepare('INSERT INTO users (id, username, password_hash, isAdmin, role, passwordChanged, createdAt) VALUES (?, ?, ?, 1, ?, 0, ?)')
      .run(adminId, 'admin', hash, 'admin', new Date().toISOString());
    try {
      db.prepare('INSERT INTO players (id, name, userId, createdAt) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), 'admin', adminId, new Date().toISOString());
    } catch (_e) {}
    console.log('Admin account created — login with admin / admin and change the password immediately.');
  } else {
    db.prepare('UPDATE users SET isAdmin = 1, role = ? WHERE username = ? COLLATE NOCASE').run('admin', 'admin');
    // For existing deployments: if passwordChanged is still 0, check whether the stored hash
    // matches the default 'admin' password.  If it does NOT match, the admin already rotated
    // their password before this migration — mark as changed so they aren't locked out.
    if (!existing.passwordChanged) {
      const isStillDefault = bcrypt.compareSync('admin', existing.password_hash);
      if (!isStillDefault) {
        db.prepare('UPDATE users SET passwordChanged = 1 WHERE id = ?').run(existing.id);
      }
    }
  }
}
seedAdmin();

// --- Auth middleware ---
function auth(req, res, next) {
  // Prefer httpOnly cookie; fall back to Bearer header for backward compat
  const cookieToken = req.cookies?.auth_token;
  const headerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = cookieToken || headerToken;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    // Backward compat: tokens issued before roles had isAdmin instead
    if (!req.user.role) req.user.role = req.user.isAdmin ? 'admin' : 'user';
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function ownerAuth(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin' && req.user.role !== 'owner')
      return res.status(403).json({ error: 'Owner or Admin access required.' });
    next();
  });
}

function adminAuth(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin')
      return res.status(403).json({ error: 'Admin access required.' });
    next();
  });
}

// --- Register ---
app.post('/api/register', registerLimiter, async (req, res) => {
  const username = sanitizeStr(req.body.username, 30);
  const { password } = req.body;
  if (!username) return res.status(400).json({ error: 'Username is required.' });
  if (username.length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters.' });
  if (!/^[a-zA-Z0-9_.-]+$/.test(username))
    return res.status(400).json({ error: 'Username may only contain letters, numbers, underscores, hyphens, and dots.' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  try {
    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const id = uuidv4();
    db.prepare('INSERT INTO users (id, username, password_hash, isAdmin, role, createdAt) VALUES (?, ?, ?, 0, ?, ?)')
      .run(id, username, password_hash, 'user', new Date().toISOString());
    try {
      db.prepare('INSERT INTO players (id, name, userId, createdAt) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), username, id, new Date().toISOString());
    } catch (_e) {}
    try { awardXP(id, getXpConfig('create_profile'), 'Created a profile'); } catch (_e) {}
    const token = jwt.sign({ userId: id, username, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('auth_token', token, COOKIE_OPTS);
    res.json({ username, role: 'user' });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Username already taken.' });
    console.error(e);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// --- Login ---
app.post('/api/login', loginLimiter, async (req, res) => {
  const username = sanitizeStr(req.body.username, 30);
  const { password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid username or password.' });
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid username or password.' });
  const role = user.role ?? (user.isAdmin ? 'admin' : 'user');
  // Admin accounts with default password must rotate before receiving a session cookie
  if (role === 'admin' && !user.passwordChanged) {
    return res.json({ requiresPasswordChange: true });
  }
  const token = jwt.sign({ userId: user.id, username: user.username, role }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('auth_token', token, COOKIE_OPTS);
  res.json({ username: user.username, role, avatarPath: user.avatarPath ?? null });
});

// --- Logout ---
app.post('/api/logout', (_req, res) => {
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
  res.json({ ok: true });
});

// --- Change password (used for forced admin rotation; verifies credentials without requiring cookie) ---
app.post('/api/change-password', async (req, res) => {
  const username = sanitizeStr(req.body.username, 30);
  const { currentPassword, newPassword } = req.body;
  if (!username || !currentPassword || !newPassword)
    return res.status(400).json({ error: 'username, currentPassword, and newPassword are required.' });
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
  const match = await bcrypt.compare(currentPassword, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });
  if (newPassword.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  if (currentPassword === newPassword)
    return res.status(400).json({ error: 'New password must differ from current password.' });
  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  db.prepare('UPDATE users SET password_hash = ?, passwordChanged = 1 WHERE id = ?').run(hash, user.id);
  const role = user.role ?? (user.isAdmin ? 'admin' : 'user');
  const token = jwt.sign({ userId: user.id, username: user.username, role }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('auth_token', token, COOKIE_OPTS);
  res.json({ username: user.username, role, avatarPath: user.avatarPath ?? null });
});

// --- Profile ---
app.get('/api/profile', auth, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, firstName, lastName, email, role, avatarPath, xp, createdAt FROM users WHERE id = ?'
  ).get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json(user);
});

app.patch('/api/profile', auth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const sets = [];
  const vals = [];

  if (req.body.firstName !== undefined) {
    sets.push('firstName = ?');
    vals.push(sanitizeStr(req.body.firstName, 50) || null);
  }
  if (req.body.lastName !== undefined) {
    sets.push('lastName = ?');
    vals.push(sanitizeStr(req.body.lastName, 50) || null);
  }
  if (req.body.email !== undefined) {
    if (req.body.email === '') {
      sets.push('email = ?'); vals.push(null);
    } else {
      const cleaned = sanitizeEmail(req.body.email);
      if (!cleaned) return res.status(400).json({ error: 'Invalid email address.' });
      sets.push('email = ?'); vals.push(cleaned);
    }
  }
  if (req.body.password !== undefined) {
    if (req.body.password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    sets.push('password_hash = ?');
    vals.push(await bcrypt.hash(req.body.password, BCRYPT_ROUNDS));
  }

  if (sets.length === 0) return res.json({ message: 'No changes.' });
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.user.userId);
  const updated = db.prepare(
    'SELECT id, username, firstName, lastName, email, role, avatarPath, createdAt FROM users WHERE id = ?'
  ).get(req.user.userId);
  res.json(updated);
});

app.post('/api/profile/avatar', auth, (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const avatarPath = `/avatars/${req.file.filename}`;
    db.prepare('UPDATE users SET avatarPath = ? WHERE id = ?').run(avatarPath, req.user.userId);
    res.json({ avatarPath });
  });
});

app.get('/api/profile/stats', auth, (req, res) => {
  const player = db.prepare('SELECT id FROM players WHERE userId = ?').get(req.user.userId);
  if (!player) return res.json({ summary: null, history: [] });

  const rows = db.prepare(`
    SELECT gp.buyIn, gp.rebuys, gp.cashOut,
           g.id as gameId, g.date, g.location, g.startTime, g.endTime
    FROM game_players gp
    JOIN games g ON gp.gameID = g.id
    WHERE gp.playerID = ? AND g.isComplete = 1
    ORDER BY g.date DESC, g.createdAt DESC
  `).all(player.id);

  const gamesPlayed = rows.length;
  const totalBuyIn = rows.reduce((s, r) => s + (r.buyIn || 0) + (r.rebuys || 0), 0);
  const totalCashOut = rows.reduce((s, r) => s + (r.cashOut || 0), 0);

  res.json({
    summary: {
      gamesPlayed,
      avgBuyIn: gamesPlayed ? totalBuyIn / gamesPlayed : 0,
      totalBuyIn,
      totalCashOut,
      avgCashOut: gamesPlayed ? totalCashOut / gamesPlayed : 0,
    },
    history: rows.map((r) => ({
      gameId: r.gameId,
      date: r.date,
      location: r.location,
      buyIn: r.buyIn,
      rebuys: r.rebuys,
      cashOut: r.cashOut,
      startTime: r.startTime,
      endTime: r.endTime,
    })),
  });
});

// --- User Management (admin only) ---
app.get('/api/users', adminAuth, (req, res) => {
  const users = db.prepare(
    'SELECT id, username, firstName, lastName, email, isAdmin, role, avatarPath, createdAt FROM users ORDER BY createdAt ASC'
  ).all();
  res.json({ users: users.map((u) => ({ ...u, isAdmin: !!u.isAdmin })) });
});

app.delete('/api/users/:id', adminAuth, (req, res) => {
  if (req.params.id === req.user.userId)
    return res.status(400).json({ error: "You can't delete your own account." });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ id: req.params.id });
});

app.patch('/api/users/:id', adminAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const sets = [];
  const vals = [];

  if (req.body.role !== undefined) {
    if (!['admin', 'owner', 'user'].includes(req.body.role))
      return res.status(400).json({ error: 'Invalid role. Must be admin, owner, or user.' });
    if (req.params.id === req.user.userId && req.body.role !== 'admin')
      return res.status(400).json({ error: "You can't revoke your own admin role." });
    sets.push('role = ?'); vals.push(req.body.role);
    sets.push('isAdmin = ?'); vals.push(req.body.role === 'admin' ? 1 : 0);
  }
  if (req.body.password !== undefined) {
    if (req.body.password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    sets.push('password_hash = ?');
    vals.push(await bcrypt.hash(req.body.password, BCRYPT_ROUNDS));
  }
  if (req.body.firstName !== undefined) {
    sets.push('firstName = ?'); vals.push(sanitizeStr(req.body.firstName, 50) || null);
  }
  if (req.body.lastName !== undefined) {
    sets.push('lastName = ?'); vals.push(sanitizeStr(req.body.lastName, 50) || null);
  }
  if (req.body.email !== undefined) {
    if (req.body.email === '') {
      sets.push('email = ?'); vals.push(null);
    } else {
      const cleaned = sanitizeEmail(req.body.email);
      if (!cleaned) return res.status(400).json({ error: 'Invalid email address.' });
      sets.push('email = ?'); vals.push(cleaned);
    }
  }

  if (sets.length === 0) return res.json({ ...user, isAdmin: !!user.isAdmin });
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.params.id);
  const updated = db.prepare(
    'SELECT id, username, firstName, lastName, email, isAdmin, role, avatarPath, createdAt FROM users WHERE id = ?'
  ).get(req.params.id);
  res.json({ ...updated, isAdmin: !!updated.isAdmin });
});

// --- Players ---
app.get('/api/players', auth, (req, res) => {
  const players = db.prepare(`
    SELECT p.id, p.name, p.userId, p.createdAt, u.avatarPath, COALESCE(u.xp, 0) as xp
    FROM players p
    LEFT JOIN users u ON p.userId = u.id
    ORDER BY p.name
  `).all();
  const result = players.map((p) => {
    const gamePlayers = db.prepare(`
      SELECT gp.id, gp.buyIn, gp.rebuys, gp.cashOut,
             g.id as gameID, g.date, g.isComplete
      FROM game_players gp
      JOIN games g ON gp.gameID = g.id
      WHERE gp.playerID = ?
    `).all(p.id);
    return {
      id: p.id, name: p.name, userId: p.userId ?? null,
      avatarPath: p.avatarPath ?? null, xp: p.xp ?? 0,
      games: {
        items: gamePlayers.map((gp) => ({
          id: gp.id, buyIn: gp.buyIn, rebuys: gp.rebuys, cashOut: gp.cashOut,
          game: { id: gp.gameID, date: gp.date, isComplete: !!gp.isComplete },
        })),
      },
    };
  });
  res.json({ items: result });
});

app.post('/api/players', ownerAuth, (req, res) => {
  const name = sanitizeStr(req.body.name, 50);
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = uuidv4();
  try {
    db.prepare('INSERT INTO players (id, name, createdAt) VALUES (?, ?, ?)').run(id, name, new Date().toISOString());
    res.json({ id, name });
  } catch { res.status(400).json({ error: 'Player already exists' }); }
});

app.delete('/api/players/:id', ownerAuth, (req, res) => {
  const player = db.prepare('SELECT id, userId FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found.' });

  const { count: gameCount } = db.prepare(
    'SELECT COUNT(*) as count FROM game_players WHERE playerID = ?'
  ).get(req.params.id);

  if (gameCount > 0) {
    // Admin can delete guest (unlinked) players even with game history
    if (req.user.role === 'admin' && !player.userId) {
      // allowed — fall through to delete
    } else {
      return res.status(400).json({
        error: player.userId
          ? 'Cannot delete a player who is linked to a user account and has game history.'
          : 'Only an Admin can delete a guest player who has game history.',
      });
    }
  }

  db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM game_players WHERE playerID = ?').run(req.params.id);
  res.json({ id: req.params.id });
});

// --- Games ---
// Return owner info alongside games
app.get('/api/games', auth, (req, res) => {
  const games = db.prepare('SELECT * FROM games ORDER BY date DESC').all();
  const result = games.map((g) => {
    const players = db.prepare(`
      SELECT gp.id, gp.buyIn, gp.rebuys, gp.cashOut,
             p.id as playerID, p.name as playerName,
             u.avatarPath
      FROM game_players gp
      JOIN players p ON gp.playerID = p.id
      LEFT JOIN users u ON p.userId = u.id
      WHERE gp.gameID = ?
    `).all(g.id);
    const owner = g.ownerId
      ? db.prepare('SELECT id, username, firstName, lastName FROM users WHERE id = ?').get(g.ownerId)
      : null;
    return {
      id: g.id, date: g.date, isComplete: !!g.isComplete, notes: g.notes,
      ownerId: g.ownerId, location: g.location, startTime: g.startTime, endTime: g.endTime,
      owner,
      players: {
        items: players.map((gp) => ({
          id: gp.id, buyIn: gp.buyIn, rebuys: gp.rebuys, cashOut: gp.cashOut,
          player: { id: gp.playerID, name: gp.playerName, avatarPath: gp.avatarPath ?? null },
        })),
      },
    };
  });
  res.json({ items: result });
});

// GET eligible owners (admin + owner roles) for new game owner picker
app.get('/api/owners', ownerAuth, (req, res) => {
  const owners = db.prepare(
    `SELECT id, username, firstName, lastName FROM users WHERE role IN ('admin','owner') ORDER BY username`
  ).all();
  res.json({ owners });
});

app.post('/api/games', ownerAuth, (req, res) => {
  const date = sanitizeStr(req.body.date, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: 'Invalid date.' });
  const isComplete = !!req.body.isComplete;
  const ownerId = req.body.ownerId || req.user.userId;
  const location = sanitizeStr(req.body.location || '', 100) || null;
  const startTime = sanitizeStr(req.body.startTime || '', 5) || new Date().toTimeString().slice(0, 5);
  const id = uuidv4();
  db.prepare('INSERT INTO games (id, date, isComplete, ownerId, location, startTime, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, date, isComplete ? 1 : 0, ownerId, location, startTime, new Date().toISOString());
  const locationNote = location ? `\n📍 ${location}` : '';
  telegramNotify(`🃏 <b>New game started!</b>\n📅 ${date} at ${startTime}${locationNote}`);
  res.json({ id, date, isComplete, ownerId, location, startTime, endTime: null });
});

app.put('/api/games/:id', ownerAuth, (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const isComplete = req.body.isComplete !== undefined ? !!req.body.isComplete : !!game.isComplete;
  const notes = req.body.notes !== undefined ? sanitizeStr(req.body.notes, 1000) : game.notes;
  const location = req.body.location !== undefined ? (sanitizeStr(req.body.location, 100) || null) : game.location;
  const ownerId = req.body.ownerId !== undefined ? req.body.ownerId : game.ownerId;
  const endTime = isComplete && !game.isComplete
    ? (sanitizeStr(req.body.endTime || '', 5) || new Date().toTimeString().slice(0, 5))
    : game.endTime;
  db.prepare('UPDATE games SET isComplete = ?, notes = ?, location = ?, ownerId = ?, endTime = ? WHERE id = ?')
    .run(isComplete ? 1 : 0, notes, location, ownerId, endTime, req.params.id);

  if (isComplete && !game.isComplete) {
    const gps = db.prepare(`
      SELECT gp.buyIn, gp.rebuys, gp.cashOut, p.name, p.userId
      FROM game_players gp JOIN players p ON gp.playerID = p.id
      WHERE gp.gameID = ?
    `).all(req.params.id);
    const pot = gps.reduce((s, gp) => s + gp.buyIn + (gp.rebuys || 0), 0);
    const lines = [...gps]
      .sort((a, b) => ((b.cashOut || 0) - b.buyIn - (b.rebuys || 0)) - ((a.cashOut || 0) - a.buyIn - (a.rebuys || 0)))
      .map((gp) => {
        const net = (gp.cashOut || 0) - gp.buyIn - (gp.rebuys || 0);
        return `  ${gp.name}: ${net >= 0 ? '+' : ''}$${net.toFixed(0)}`;
      });
    telegramNotify(`🏁 <b>Game Over! — ${game.date}</b>\n${lines.join('\n')}\n\n💰 Pot: $${pot.toFixed(0)}`);

    // Award XP for game completion
    try {
      const playXP = getXpConfig('play_game');
      const topXP = getXpConfig('top_winner');
      const profitPer5XP = getXpConfig('profit_per_5');
      const gpsWithNet = gps.map(gp => ({
        ...gp,
        net: (gp.cashOut || 0) - gp.buyIn - (gp.rebuys || 0),
      }));
      let topWinnerUserId = null;
      let topNet = -Infinity;
      for (const gp of gpsWithNet) {
        if (!gp.userId) continue;
        if (playXP !== 0) awardXP(gp.userId, playXP, 'Played a game', req.params.id);
        if (gp.cashOut != null && gp.net > topNet) { topNet = gp.net; topWinnerUserId = gp.userId; }
        if (profitPer5XP !== 0 && gp.cashOut != null && gp.net > 0) {
          const profitXp = Math.floor(gp.net / 5) * profitPer5XP;
          if (profitXp !== 0) awardXP(gp.userId, profitXp, `Profit bonus ($${gp.net.toFixed(0)})`, req.params.id);
        }
      }
      if (topWinnerUserId && topXP !== 0) awardXP(topWinnerUserId, topXP, 'Top winner', req.params.id);
    } catch (e) { console.error('XP game-completion error:', e.message); }

    // Award achievements
    try { awardAchievements(req.params.id); } catch (_e) {}
  }

  res.json({ id: req.params.id });
});

app.delete('/api/games/:id', adminAuth, (req, res) => {
  const game = db.prepare('SELECT id FROM games WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found.' });
  db.prepare('DELETE FROM games WHERE id = ?').run(req.params.id);
  res.json({ id: req.params.id });
});

// --- Game Players ---
app.post('/api/game-players', auth, (req, res) => {
  const { gameID, playerID, rebuys = 0 } = req.body;
  const buyIn = parseFloat(req.body.buyIn);
  if (!gameID || !playerID) return res.status(400).json({ error: 'gameID and playerID required.' });
  if (isNaN(buyIn) || buyIn <= 0) return res.status(400).json({ error: 'Buy-in must be greater than $0.' });
  const id = uuidv4();
  db.prepare('INSERT INTO game_players (id, gameID, playerID, buyIn, rebuys) VALUES (?, ?, ?, ?, ?)')
    .run(id, gameID, playerID, buyIn, rebuys);
  try {
    const player = db.prepare('SELECT name FROM players WHERE id = ?').get(playerID);
    const game = db.prepare('SELECT date FROM games WHERE id = ?').get(gameID);
    if (player && game)
      telegramNotify(`💵 <b>${player.name}</b> bought in for $${buyIn.toFixed(0)} — ${game.date}`);
  } catch (_e) {}
  res.json({ id, gameID, playerID, buyIn, rebuys });
});

app.put('/api/game-players/:id', auth, (req, res) => {
  // Join to players so we can check the linked userId for ownership
  const gp = db.prepare(`
    SELECT gp.*, p.userId as linkedUserId, g.ownerId as gameOwnerId
    FROM game_players gp
    JOIN players p ON gp.playerID = p.id
    JOIN games g ON gp.gameID = g.id
    WHERE gp.id = ?
  `).get(req.params.id);
  if (!gp) return res.status(404).json({ error: 'Not found' });

  const isAdmin = req.user.role === 'admin';
  const isOwner = req.user.role === 'owner' || req.user.role === 'admin';
  const isLinkedPlayer = gp.linkedUserId && gp.linkedUserId === req.user.userId;
  const isGameOwner = gp.gameOwnerId && gp.gameOwnerId === req.user.userId;

  if (!isLinkedPlayer && !isOwner && !isGameOwner) {
    return res.status(403).json({ error: 'You are not authorised to update this record.' });
  }

  const buyIn = req.body.buyIn !== undefined ? parseFloat(req.body.buyIn) : gp.buyIn;
  const rebuys = req.body.rebuys !== undefined ? parseFloat(req.body.rebuys) : gp.rebuys;
  const cashOut = req.body.cashOut !== undefined ? parseFloat(req.body.cashOut) : gp.cashOut;
  try {
    const row = db.prepare(
      'SELECT p.name FROM game_players gp JOIN players p ON gp.playerID = p.id WHERE gp.id = ?'
    ).get(req.params.id);
    if (row) {
      if (req.body.rebuys !== undefined && parseFloat(req.body.rebuys) > (gp.rebuys || 0)) {
        const amt = parseFloat(req.body.rebuys) - (gp.rebuys || 0);
        telegramNotify(`🔄 <b>${row.name}</b> rebuyed $${amt.toFixed(0)}`);
        if (gp.linkedUserId) {
          const penalty = getXpConfig('additional_buyin_penalty');
          if (penalty !== 0) awardXP(gp.linkedUserId, penalty, 'Additional buy-in', gp.gameID);
        }
      }
      if (req.body.cashOut !== undefined && gp.cashOut == null) {
        telegramNotify(`💰 <b>${row.name}</b> cashed out $${parseFloat(req.body.cashOut).toFixed(0)}`);
      }
    }
  } catch (_e) {}
  db.prepare('UPDATE game_players SET buyIn = ?, rebuys = ?, cashOut = ? WHERE id = ?')
    .run(buyIn, rebuys, cashOut, req.params.id);
  res.json({ id: req.params.id, buyIn, rebuys, cashOut });
});

// ── Rules ──────────────────────────────────────────────────────────────────

app.get('/api/rules', auth, (_req, res) => {
  const rules = db.prepare('SELECT * FROM rules ORDER BY gameName ASC').all();
  res.json(rules);
});

app.get('/api/rules/:id', auth, (req, res) => {
  const rule = db.prepare('SELECT * FROM rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found.' });
  const versions = db.prepare('SELECT * FROM rule_versions WHERE ruleId = ? ORDER BY version DESC').all(req.params.id);
  const comments = db.prepare('SELECT * FROM rule_comments WHERE ruleId = ? ORDER BY createdAt ASC').all(req.params.id);
  res.json({ ...rule, versions, comments });
});

app.post('/api/rules', auth, (req, res) => {
  const gameName = sanitizeStr(req.body.gameName, 100);
  if (!gameName) return res.status(400).json({ error: 'Game name is required.' });
  const id = uuidv4();
  const now = new Date().toISOString();
  const overview = sanitizeStr(req.body.overview, 500) || null;
  const keyConsiderations = typeof req.body.keyConsiderations === 'string' ? req.body.keyConsiderations.slice(0, 10000) : null;
  const minPlayers = req.body.minPlayers ? parseInt(req.body.minPlayers, 10) : null;
  const cardsDealt = req.body.cardsDealt ? parseInt(req.body.cardsDealt, 10) : null;
  const bettingType = sanitizeStr(req.body.bettingType, 100) || null;
  const setupInstructions = sanitizeStr(req.body.setupInstructions, 5000) || null;
  const winningHierarchy = typeof req.body.winningHierarchy === 'string' ? req.body.winningHierarchy.slice(0, 10000) : null;
  const howToPlay = typeof req.body.howToPlay === 'string' ? req.body.howToPlay.slice(0, 20000) : null;
  const howItEnds = sanitizeStr(req.body.howItEnds, 2000) || null;

  db.prepare(`
    INSERT INTO rules (id, gameName, overview, keyConsiderations, minPlayers, cardsDealt, bettingType, setupInstructions, winningHierarchy, howToPlay, howItEnds, createdAt, createdBy, lastUpdated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, gameName, overview, keyConsiderations, minPlayers, cardsDealt, bettingType, setupInstructions, winningHierarchy, howToPlay, howItEnds, now, req.user.userId, now);

  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.userId);
  db.prepare(`
    INSERT INTO rule_versions (id, ruleId, version, gameName, overview, keyConsiderations, minPlayers, cardsDealt, bettingType, setupInstructions, winningHierarchy, howToPlay, howItEnds, editedAt, editedBy, editedByUsername)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), id, gameName, overview, keyConsiderations, minPlayers, cardsDealt, bettingType, setupInstructions, winningHierarchy, howToPlay, howItEnds, now, req.user.userId, user?.username || 'unknown');

  res.json({ id });
});

app.put('/api/rules/:id', auth, (req, res) => {
  const rule = db.prepare('SELECT * FROM rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found.' });

  const gameName = sanitizeStr(req.body.gameName, 100) || rule.gameName;
  const overview = req.body.overview !== undefined ? (sanitizeStr(req.body.overview, 500) || null) : rule.overview;
  const keyConsiderations = req.body.keyConsiderations !== undefined
    ? (typeof req.body.keyConsiderations === 'string' ? req.body.keyConsiderations.slice(0, 10000) : null)
    : rule.keyConsiderations;
  const minPlayers = req.body.minPlayers !== undefined
    ? (req.body.minPlayers ? parseInt(req.body.minPlayers, 10) : null)
    : rule.minPlayers;
  const cardsDealt = req.body.cardsDealt !== undefined
    ? (req.body.cardsDealt ? parseInt(req.body.cardsDealt, 10) : null)
    : rule.cardsDealt;
  const bettingType = req.body.bettingType !== undefined ? (sanitizeStr(req.body.bettingType, 100) || null) : rule.bettingType;
  const setupInstructions = req.body.setupInstructions !== undefined ? (sanitizeStr(req.body.setupInstructions, 5000) || null) : rule.setupInstructions;
  const winningHierarchy = req.body.winningHierarchy !== undefined
    ? (typeof req.body.winningHierarchy === 'string' ? req.body.winningHierarchy.slice(0, 10000) : null)
    : rule.winningHierarchy;
  const howToPlay = req.body.howToPlay !== undefined
    ? (typeof req.body.howToPlay === 'string' ? req.body.howToPlay.slice(0, 20000) : null)
    : rule.howToPlay;
  const howItEnds = req.body.howItEnds !== undefined ? (sanitizeStr(req.body.howItEnds, 2000) || null) : rule.howItEnds;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE rules SET gameName = ?, overview = ?, keyConsiderations = ?, minPlayers = ?, cardsDealt = ?, bettingType = ?, setupInstructions = ?, winningHierarchy = ?, howToPlay = ?, howItEnds = ?, lastUpdated = ?
    WHERE id = ?
  `).run(gameName, overview, keyConsiderations, minPlayers, cardsDealt, bettingType, setupInstructions, winningHierarchy, howToPlay, howItEnds, now, req.params.id);

  const { maxVer } = db.prepare('SELECT MAX(version) as maxVer FROM rule_versions WHERE ruleId = ?').get(req.params.id);
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.userId);
  db.prepare(`
    INSERT INTO rule_versions (id, ruleId, version, gameName, overview, keyConsiderations, minPlayers, cardsDealt, bettingType, setupInstructions, winningHierarchy, howToPlay, howItEnds, editedAt, editedBy, editedByUsername)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), req.params.id, (maxVer || 0) + 1, gameName, overview, keyConsiderations, minPlayers, cardsDealt, bettingType, setupInstructions, winningHierarchy, howToPlay, howItEnds, now, req.user.userId, user?.username || 'unknown');

  res.json({ id: req.params.id });
});

app.post('/api/rules/:id/duplicate', auth, (req, res) => {
  const source = db.prepare('SELECT * FROM rules WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).json({ error: 'Rule not found.' });

  const gameName = sanitizeStr(req.body.gameName, 100);
  if (!gameName) return res.status(400).json({ error: 'Game name is required.' });

  const collision = db.prepare('SELECT id FROM rules WHERE LOWER(gameName) = LOWER(?)').get(gameName);
  if (collision) return res.status(400).json({ error: `A rule named "${gameName}" already exists. Choose a different name.` });

  const id = uuidv4();
  const now = new Date().toISOString();
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.userId);

  db.prepare(`
    INSERT INTO rules (id, gameName, overview, keyConsiderations, minPlayers, cardsDealt, bettingType, setupInstructions, winningHierarchy, howToPlay, howItEnds, createdAt, createdBy, lastUpdated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, gameName, source.overview, source.keyConsiderations, source.minPlayers, source.cardsDealt, source.bettingType, source.setupInstructions, source.winningHierarchy, source.howToPlay, source.howItEnds, now, req.user.userId, now);

  db.prepare(`
    INSERT INTO rule_versions (id, ruleId, version, gameName, overview, keyConsiderations, minPlayers, cardsDealt, bettingType, setupInstructions, winningHierarchy, howToPlay, howItEnds, editedAt, editedBy, editedByUsername)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), id, gameName, source.overview, source.keyConsiderations, source.minPlayers, source.cardsDealt, source.bettingType, source.setupInstructions, source.winningHierarchy, source.howToPlay, source.howItEnds, now, req.user.userId, user?.username || 'unknown');

  res.json({ id });
});

app.delete('/api/rules/:id', adminAuth, (req, res) => {
  if (!db.prepare('SELECT id FROM rules WHERE id = ?').get(req.params.id))
    return res.status(404).json({ error: 'Rule not found.' });
  db.prepare('DELETE FROM rule_comments WHERE ruleId = ?').run(req.params.id);
  db.prepare('DELETE FROM rule_versions WHERE ruleId = ?').run(req.params.id);
  db.prepare('DELETE FROM rules WHERE id = ?').run(req.params.id);
  res.json({ id: req.params.id });
});

app.post('/api/rules/:id/comments', auth, (req, res) => {
  if (!db.prepare('SELECT id FROM rules WHERE id = ?').get(req.params.id))
    return res.status(404).json({ error: 'Rule not found.' });
  const body = sanitizeStr(req.body.body, 1000);
  if (!body) return res.status(400).json({ error: 'Comment cannot be empty.' });
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.userId);
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO rule_comments (id, ruleId, userId, username, body, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.params.id, req.user.userId, user?.username || 'unknown', body, now);
  res.json({ id, body, username: user?.username, createdAt: now });
});

app.delete('/api/rules/:id/comments/:commentId', adminAuth, (req, res) => {
  db.prepare('DELETE FROM rule_comments WHERE id = ? AND ruleId = ?').run(req.params.commentId, req.params.id);
  res.json({ id: req.params.commentId });
});

// ── Ask Claude ────────────────────────────────────────────────────────────
app.post('/api/ask-claude', adminAuth, async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'Claude API key not configured.' });

  const { gameName, gameRules, playerCount, holeCards, boardCards, street } = req.body;

  if (!gameName) return res.status(400).json({ error: 'Game name is required.' });
  if (!playerCount || parseInt(playerCount) < 2 || parseInt(playerCount) > 10)
    return res.status(400).json({ error: 'Player count must be between 2 and 10.' });
  if (!Array.isArray(holeCards) || holeCards.length < 1 || holeCards.length > 20 ||
      holeCards.some((c) => !c?.rank || !c?.suit))
    return res.status(400).json({ error: 'At least one complete hole card is required.' });

  const formatCard = (c) => `${c.rank}${c.suit}`;
  const hole = holeCards.map(formatCard).join(' ');
  const validBoard = Array.isArray(boardCards) ? boardCards.filter(c => c?.rank && c?.suit) : [];
  const boardStr = validBoard.length > 0 ? validBoard.map(formatCard).join(' ') : null;
  const streetLabel = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River' }[street] || street;

  const rulesSection = gameRules ? `\nGame Rules:\n${gameRules.slice(0, 3000)}\n` : '';
  const boardSection = boardStr
    ? `Community Cards (${streetLabel}): ${boardStr}`
    : 'No community cards yet (Pre-flop)';

  const allCards = [...holeCards.map(formatCard), ...validBoard.map(formatCard)];
  const poolNote = validBoard.length > 0
    ? `Full card pool (${allCards.length} cards): ${allCards.join(' ')}`
    : `Hole cards only so far (${holeCards.length} cards): ${hole}`;

  const prompt = `You are an expert poker advisor. Analyze this hand scenario.

Game: ${sanitizeStr(gameName, 100)}${rulesSection}
Players at table: ${parseInt(playerCount)}
Street: ${streetLabel}
Hole cards per player: ${holeCards.length}

My hole cards: ${hole}
${boardSection}

${poolNote}

CRITICAL — Hand Evaluation Rule: The player's best hand is the single best 5-card combination chosen from ANY of the ${allCards.length} cards listed in the full card pool above. Do NOT assume Hold'em rules (must use exactly 2 hole cards). In this game variant, any 5 of the ${allCards.length} available cards may form the hand. Work through all meaningful combinations and identify the actual best 5-card hand before writing your analysis.

Respond in EXACTLY this format — do not deviate:

PROBABILITY: [e.g. 62%]
OUTS: [list specific cards like A♠ K♦ Q♥, or "None" if not drawing]
RECOMMENDATION: [exactly one of: Fold / Check / Call / Bet / Raise]
BOTTOM LINE: [one sentence — the single most important thing to know]
---
[Full analysis: start by stating the best 5-card hand from the full pool, then cover hand strength, probability reasoning, key outs, recommended action, and any game-specific notes. Use poker notation. Be direct and concise.]`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }
  } catch (err) {
    console.error('Claude API error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message || 'Claude API error' })}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

// ── Achievements ──────────────────────────────────────────────────────────────

// Evaluate a single condition against resolved left/right numeric values
function evalOp(left, op, right) {
  switch (op) {
    case '>=': return left >= right;
    case '>':  return left >  right;
    case '<=': return left <= right;
    case '<':  return left <  right;
    case '=':  return left === right;
    case '!=': return left !== right;
    default:   return false;
  }
}

// Resolve a named player metric to a number
function resolveMetric(metric, player, ctx) {
  switch (metric) {
    case 'total_invested':  return player.total_invested;
    case 'cash_out':        return player.cash_out;
    case 'net_profit':      return player.net_profit;
    case 'buy_in':          return player.buy_in;
    case 'rebuy_amount':    return player.rebuy_amount;
    case 'net_profit_rank': return player.net_profit_rank;
    case 'game_min_buy_in': return ctx.game_min_buy_in;
    case 'game_max_buy_in': return ctx.game_max_buy_in;
    case 'game_avg_buy_in': return ctx.game_avg_buy_in;
    case 'game_pot':        return ctx.game_pot;
    case 'own_buy_in':          return player.buy_in;
    case 'own_total_invested':  return player.total_invested;
    default: return 0;
  }
}

// Evaluate structured criteriaJson against one player+game context
// Returns true/false, or null if criteriaJson is invalid/unrecognised
function evaluateCriteriaJson(criteriaJson, player, ctx, userId) {
  let rules;
  try { rules = typeof criteriaJson === 'string' ? JSON.parse(criteriaJson) : criteriaJson; }
  catch { return null; }

  if (rules.scope === 'game') {
    if (!Array.isArray(rules.conditions) || rules.conditions.length === 0) return null;
    for (const cond of rules.conditions) {
      const leftVal = resolveMetric(cond.left, player, ctx);
      let rightVal;
      if (cond.rightType === 'number') {
        rightVal = Number(cond.rightValue);
      } else if (cond.rightType === 'metric') {
        rightVal = resolveMetric(cond.rightMetric, player, ctx);
      } else if (cond.rightType === 'multiplier') {
        rightVal = Number(cond.rightMultiplier) * resolveMetric(cond.rightBase, player, ctx);
      } else {
        return null;
      }
      if (!evalOp(leftVal, cond.op, rightVal)) return false;
    }
    return true;
  }

  if (rules.scope === 'streak') {
    const len = Number(rules.streakLength) || 3;
    const cond = rules.streakCondition || 'profit';
    const playerRow = db.prepare('SELECT id FROM players WHERE userId = ?').get(userId);
    if (!playerRow) return false;
    const recent = db.prepare(`
      SELECT gp.buyIn, gp.rebuys, gp.cashOut FROM game_players gp
      JOIN games g ON gp.gameID = g.id
      WHERE gp.playerID = ? AND g.isComplete = 1
      ORDER BY g.date DESC, g.createdAt DESC LIMIT ?
    `).all(playerRow.id, len);
    if (recent.length < len) return false;
    return recent.every(r => {
      const net = (r.cashOut || 0) - r.buyIn - (r.rebuys || 0);
      if (cond === 'profit') return net > 0;
      if (cond === 'loss') return net < 0;
      return false;
    });
  }

  return null; // unknown scope
}

// Helper: check and award achievements after a game completes
function awardAchievements(gameId) {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  if (!game || !game.isComplete) return;

  const gps = db.prepare(`
    SELECT gp.*, p.userId FROM game_players gp
    JOIN players p ON gp.playerID = p.id
    WHERE gp.gameID = ?
  `).all(gameId);

  const achievements = db.prepare('SELECT * FROM achievements WHERE isActive = 1').all();

  // Build game-level context
  const validGps = gps.filter(gp => gp.cashOut != null);
  const buyIns = gps.map(gp => gp.buyIn).filter(b => b > 0);
  const gameCtx = {
    game_min_buy_in: buyIns.length ? Math.min(...buyIns) : 0,
    game_max_buy_in: buyIns.length ? Math.max(...buyIns) : 0,
    game_avg_buy_in: buyIns.length ? buyIns.reduce((a, b) => a + b, 0) / buyIns.length : 0,
    game_pot: gps.reduce((s, gp) => s + gp.buyIn + (gp.rebuys || 0), 0),
  };

  // Compute per-player metrics and ranks
  const playerMetrics = gps.map(gp => {
    const total_invested = gp.buyIn + (gp.rebuys || 0);
    const cash_out = gp.cashOut || 0;
    return {
      playerID: gp.playerID,
      userId: gp.userId,
      buy_in: gp.buyIn,
      rebuy_amount: gp.rebuys || 0,
      total_invested,
      cash_out,
      net_profit: cash_out - total_invested,
      net_profit_rank: 0, // filled below
    };
  });

  // Rank by net_profit descending (1 = highest)
  const sorted = [...playerMetrics].sort((a, b) => b.net_profit - a.net_profit);
  sorted.forEach((p, i) => { p.net_profit_rank = i + 1; });

  for (const pm of playerMetrics) {
    if (!pm.userId) continue;
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(pm.userId);
    if (!user) continue;

    for (const ach of achievements) {
      let earned = false;

      // Try JSON rules first
      if (ach.criteriaJson) {
        const result = evaluateCriteriaJson(ach.criteriaJson, pm, gameCtx, pm.userId);
        if (result !== null) {
          earned = result;
        } else {
          // JSON present but unrecognised — fall through to legacy
          earned = evalLegacyCriteria(ach.criteria, pm, gameCtx, sorted);
        }
      } else {
        earned = evalLegacyCriteria(ach.criteria, pm, gameCtx, sorted);
      }

      if (earned) {
        try {
          const now = new Date().toISOString();
          db.prepare(`
            INSERT INTO user_achievements (id, userId, achievementId, earnedAt, gameId, count)
            VALUES (?, ?, ?, ?, ?, 1)
            ON CONFLICT(userId, achievementId) DO UPDATE SET count = count + 1
          `).run(uuidv4(), pm.userId, ach.id, now, gameId);
          const awardedUser = db.prepare(
            'SELECT username, firstName, lastName FROM users WHERE id = ?'
          ).get(pm.userId);
          if (awardedUser) {
            const displayName = [awardedUser.firstName, awardedUser.lastName].filter(Boolean).join(' ') || awardedUser.username;
            telegramNotify(`🏆 <b>${displayName}</b> just earned the "<b>${ach.name}</b>" achievement!`);
          }
          if (ach.xpValue > 0) awardXP(pm.userId, ach.xpValue, `Achievement: ${ach.name}`, ach.id);
        } catch (_e) {}
      }
    }
  }
}

// Legacy string-based criteria (fallback for achievements without criteriaJson)
function evalLegacyCriteria(criteria, pm, ctx, sortedByProfit) {
  const { total_invested, cash_out, net_profit, rebuy_amount } = pm;
  if (criteria === 'double_up') {
    return cash_out != null && total_invested > 0 && cash_out >= total_invested * 2;
  } else if (criteria === 'rebuy_profit') {
    return rebuy_amount >= pm.buy_in * 2 && net_profit > 0;
  } else if (criteria === 'high_roller') {
    return net_profit >= 200;
  } else if (criteria === 'comeback_kid') {
    return rebuy_amount > 0 && pm.net_profit_rank === 1 && net_profit > 0;
  }
  return false;
}

// Achievement image storage
const achievementDir = path.join(__dirname, '../data/achievements');
fs.mkdirSync(achievementDir, { recursive: true });

const achievementUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, achievementDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? ext : '.jpg';
      cb(null, `rec-${uuidv4()}${safeExt}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files allowed.'));
  },
});

app.use('/achievement-images', express.static(achievementDir));

// GET all achievements + which ones current user has earned
app.get('/api/achievements', auth, (req, res) => {
  const achievements = db.prepare('SELECT * FROM achievements WHERE isActive = 1 ORDER BY name').all();
  const earned = db.prepare('SELECT achievementId, earnedAt, gameId, count FROM user_achievements WHERE userId = ?')
    .all(req.user.userId);
  const earnedMap = {};
  for (const e of earned) earnedMap[e.achievementId] = { earnedAt: e.earnedAt, gameId: e.gameId, count: e.count ?? 1 };

  // Count total earners per achievement
  const counts = db.prepare('SELECT achievementId, COUNT(*) as cnt FROM user_achievements GROUP BY achievementId').all();
  const countMap = {};
  for (const c of counts) countMap[c.achievementId] = c.cnt;

  res.json(achievements.map(a => ({
    ...a,
    earned: !!earnedMap[a.id],
    earnedAt: earnedMap[a.id]?.earnedAt ?? null,
    timesEarned: earnedMap[a.id]?.count ?? 0,
    earnerCount: countMap[a.id] ?? 0,
  })));
});

// GET all achievements for a specific user (for profile/leaderboard display)
app.get('/api/achievements/user/:userId', auth, (req, res) => {
  const earned = db.prepare(`
    SELECT a.*, ua.earnedAt, ua.gameId FROM user_achievements ua
    JOIN achievements a ON ua.achievementId = a.id
    WHERE ua.userId = ?
    ORDER BY ua.earnedAt DESC
  `).all(req.params.userId);
  res.json(earned);
});

// GET all users' earned achievements (for leaderboard)
app.get('/api/achievements/all-users', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT ua.userId, ua.achievementId, ua.earnedAt, a.name, a.imageSvg
    FROM user_achievements ua
    JOIN achievements a ON ua.achievementId = a.id
  `).all();
  res.json(rows);
});

// POST recommendation (with optional image)
app.post('/api/achievements/recommendations', auth, (req, res) => {
  achievementUpload.single('referenceImage')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const name = sanitizeStr(req.body.name || '', 100);
    const description = sanitizeStr(req.body.description || '', 500);
    if (!name) return res.status(400).json({ error: 'Achievement name is required.' });
    if (!description) return res.status(400).json({ error: 'Description is required.' });

    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.userId);
    const id = uuidv4();
    const referenceImagePath = req.file ? `/achievement-images/${req.file.filename}` : null;
    db.prepare(`
      INSERT INTO achievement_recommendations (id, userId, username, name, description, referenceImagePath, status, submittedAt)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, req.user.userId, user?.username || 'unknown', name, description, referenceImagePath, new Date().toISOString());
    try { awardXP(req.user.userId, getXpConfig('suggest_achievement'), 'Suggested an achievement', id); } catch (_e) {}
    res.json({ id, name, description });
  });
});

// GET pending recommendations (admin only)
app.get('/api/achievements/recommendations', adminAuth, (req, res) => {
  const recs = db.prepare(
    `SELECT * FROM achievement_recommendations ORDER BY submittedAt DESC`
  ).all();
  res.json(recs);
});

// Shared image generation helper — calls Gemini, saves PNG to disk, returns URL path
async function generateAchievementImage(name, description, feedback, inspirationImagePath) {
  if (!gemini) {
    console.warn('GEMINI_API_KEY not set — skipping image generation');
    return null;
  }

  const model = gemini.getGenerativeModel({
    model: 'gemini-2.0-flash-preview-image-generation',
  });

  const parts = [];

  if (inspirationImagePath) {
    try {
      const imgBuffer = fs.readFileSync(inspirationImagePath);
      const base64 = imgBuffer.toString('base64');
      const ext = path.extname(inspirationImagePath).toLowerCase();
      const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
      parts.push({ inlineData: { data: base64, mimeType: mimeMap[ext] || 'image/jpeg' } });
    } catch (e) {
      console.warn('Could not read inspiration image:', e.message);
    }
  }

  const feedbackLine = feedback ? ` ${feedback}.` : '';
  const prompt = inspirationImagePath
    ? `Recreate this image in 65-bit style.${feedbackLine}`
    : `Generate 65-bit style artwork for a poker achievement card called "${name}". ${description}.${feedbackLine} Vibrant colors, bold shapes, Balatro card game aesthetic.`;

  parts.push({ text: prompt });

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    });

    const candidate = result.response.candidates?.[0];
    if (!candidate) return null;

    for (const part of candidate.content.parts) {
      if (part.inlineData?.data) {
        const ext = part.inlineData.mimeType === 'image/png' ? '.png' : '.jpg';
        const filename = `gen-${uuidv4()}${ext}`;
        const outPath = path.join(achievementDir, filename);
        fs.writeFileSync(outPath, Buffer.from(part.inlineData.data, 'base64'));
        return `/achievement-images/${filename}`;
      }
    }
    return null;
  } catch (e) {
    console.error('Gemini image generation failed:', e.message);
    return null;
  }
}

// Keep old name as alias so callers don't need renaming
const generateAchievementSvg = generateAchievementImage;

// POST approve recommendation — accepts optional overrides, art feedback, and admin inspiration image
app.post('/api/achievements/recommendations/:id/approve', adminAuth, (req, res) => {
  achievementUpload.single('inspirationImage')(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });

    const rec = db.prepare('SELECT * FROM achievement_recommendations WHERE id = ?').get(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Recommendation not found.' });
    if (rec.status !== 'pending') return res.status(400).json({ error: 'Already reviewed.' });

    const name = sanitizeStr(req.body.name || '', 100) || rec.name;
    const description = sanitizeStr(req.body.description || '', 500) || rec.description;
    const imageFeedback = sanitizeStr(req.body.imageFeedback || '', 300) || null;

    let inspirationLocalPath = null;
    if (req.file) {
      inspirationLocalPath = req.file.path;
    } else if (rec.referenceImagePath) {
      const filename = path.basename(rec.referenceImagePath);
      const candidate = path.join(achievementDir, filename);
      if (fs.existsSync(candidate)) inspirationLocalPath = candidate;
    }

    const generateArt = req.body.generateArt !== 'false' && req.body.generateArt !== false;
    const imageSvg = generateArt
      ? await generateAchievementSvg(name, description, imageFeedback, inspirationLocalPath)
      : null;

    const achId = uuidv4();
    db.prepare(`
      INSERT INTO achievements (id, name, description, criteria, imageSvg, isActive, createdAt)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(achId, name, description, `custom_${achId}`, imageSvg, new Date().toISOString());

    db.prepare(`
      UPDATE achievement_recommendations SET status = 'approved', reviewedBy = ?, reviewedAt = ? WHERE id = ?
    `).run(req.user.userId, new Date().toISOString(), req.params.id);

    res.json({ achievementId: achId, name, description, imageSvg, imageFrame: null });
  });
});

// POST reject recommendation
app.post('/api/achievements/recommendations/:id/reject', adminAuth, (req, res) => {
  const rec = db.prepare('SELECT * FROM achievement_recommendations WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Recommendation not found.' });
  db.prepare(`
    UPDATE achievement_recommendations SET status = 'rejected', reviewedBy = ?, reviewedAt = ? WHERE id = ?
  `).run(req.user.userId, new Date().toISOString(), req.params.id);
  res.json({ id: req.params.id });
});

// PATCH existing achievement (admin) — update name, description, imageSvg, imageFrame, criteriaJson, xpValue
app.patch('/api/achievements/:id', adminAuth, (req, res) => {
  const ach = db.prepare('SELECT * FROM achievements WHERE id = ?').get(req.params.id);
  if (!ach) return res.status(404).json({ error: 'Achievement not found.' });

  const sets = [];
  const vals = [];

  if (req.body.name !== undefined) {
    const n = sanitizeStr(req.body.name, 100);
    if (!n) return res.status(400).json({ error: 'Name cannot be empty.' });
    sets.push('name = ?'); vals.push(n);
  }
  if (req.body.description !== undefined) {
    sets.push('description = ?'); vals.push(sanitizeStr(req.body.description, 500));
  }
  if (req.body.imageSvg !== undefined) {
    sets.push('imageSvg = ?'); vals.push(req.body.imageSvg || null);
  }
  if (req.body.imageFrame !== undefined) {
    sets.push('imageFrame = ?'); vals.push(req.body.imageFrame || null);
  }
  if (req.body.criteriaJson !== undefined) {
    if (req.body.criteriaJson) {
      try { JSON.parse(req.body.criteriaJson); } catch {
        return res.status(400).json({ error: 'criteriaJson must be valid JSON.' });
      }
      sets.push('criteriaJson = ?'); vals.push(req.body.criteriaJson);
    } else {
      sets.push('criteriaJson = ?'); vals.push(null);
    }
  }
  if (req.body.xpValue !== undefined) {
    const xv = parseInt(req.body.xpValue, 10);
    sets.push('xpValue = ?'); vals.push(isNaN(xv) ? 0 : xv);
  }

  if (sets.length === 0) return res.json(ach);
  db.prepare(`UPDATE achievements SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.params.id);
  const updated = db.prepare('SELECT * FROM achievements WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// --- XP routes ---

app.get('/api/xp/history', auth, (req, res) => {
  const events = db.prepare(
    'SELECT id, amount, reason, referenceId, createdAt FROM xp_events WHERE userId = ? ORDER BY id DESC LIMIT 20'
  ).all(req.user.userId);
  res.json(events);
});

app.get('/api/admin/xp-config', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT key, value, label FROM xp_config ORDER BY key').all();
  res.json(rows);
});

app.patch('/api/admin/xp-config', adminAuth, (req, res) => {
  for (const [key, value] of Object.entries(req.body)) {
    const num = parseInt(value, 10);
    if (!isNaN(num)) db.prepare('UPDATE xp_config SET value = ? WHERE key = ?').run(num, key);
  }
  const rows = db.prepare('SELECT key, value, label FROM xp_config ORDER BY key').all();
  res.json(rows);
});

// --- Achievement user assignment ---

app.get('/api/achievements/:id/users', adminAuth, (req, res) => {
  const ach = db.prepare('SELECT id FROM achievements WHERE id = ?').get(req.params.id);
  if (!ach) return res.status(404).json({ error: 'Achievement not found.' });

  const users = db.prepare(
    'SELECT id, username, firstName, lastName, avatarPath FROM users ORDER BY username ASC'
  ).all();

  const earned = db.prepare(
    'SELECT userId, earnedAt, gameId, count FROM user_achievements WHERE achievementId = ?'
  ).all(req.params.id);

  const earnedMap = {};
  for (const e of earned) earnedMap[e.userId] = { earnedAt: e.earnedAt, gameId: e.gameId, count: e.count ?? 1 };

  res.json(users.map(u => ({
    id: u.id,
    username: u.username,
    displayName: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username,
    avatarPath: u.avatarPath ?? null,
    earned: !!earnedMap[u.id],
    earnedAt: earnedMap[u.id]?.earnedAt ?? null,
    gameId: earnedMap[u.id]?.gameId ?? null,
    count: earnedMap[u.id]?.count ?? null,
  })));
});

app.post('/api/achievements/:id/users/:userId', adminAuth, (req, res) => {
  const ach = db.prepare('SELECT id, name, xpValue FROM achievements WHERE id = ?').get(req.params.id);
  if (!ach) return res.status(404).json({ error: 'Achievement not found.' });
  const user = db.prepare('SELECT id, username, firstName, lastName FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const now = new Date().toISOString();
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username;
  try {
    db.prepare(`
      INSERT INTO user_achievements (id, userId, achievementId, earnedAt, gameId, count)
      VALUES (?, ?, ?, ?, NULL, 1)
      ON CONFLICT(userId, achievementId) DO UPDATE SET count = count + 1
    `).run(uuidv4(), req.params.userId, req.params.id, now);

    // Award XP every time the achievement is granted (first grant or re-grant)
    if (ach.xpValue > 0) {
      awardXP(req.params.userId, ach.xpValue, `Achievement: ${ach.name}`, ach.id);
    }

    telegramNotify(`🏆 <b>${displayName}</b> was awarded the "<b>${ach.name}</b>" achievement by an admin!`);
  } catch (_e) { console.error('Manual grant error:', _e.message); }

  const row = db.prepare(
    'SELECT earnedAt, count FROM user_achievements WHERE userId = ? AND achievementId = ?'
  ).get(req.params.userId, req.params.id);

  res.json({ userId: req.params.userId, achievementId: req.params.id, earned: true, earnedAt: row?.earnedAt ?? now, timesEarned: row?.count ?? 1 });
});

app.delete('/api/achievements/:id/users/:userId', adminAuth, (req, res) => {
  db.prepare('DELETE FROM user_achievements WHERE userId = ? AND achievementId = ?')
    .run(req.params.userId, req.params.id);
  res.json({ userId: req.params.userId, achievementId: req.params.id, earned: false });
});

// PATCH count — admin manually adjusts how many times a user has earned an achievement
app.patch('/api/achievements/:id/users/:userId/count', adminAuth, (req, res) => {
  const newCount = parseInt(req.body.count, 10);
  if (isNaN(newCount) || newCount < 1) return res.status(400).json({ error: 'count must be >= 1' });

  const row = db.prepare(
    'SELECT earnedAt, count FROM user_achievements WHERE userId = ? AND achievementId = ?'
  ).get(req.params.userId, req.params.id);
  if (!row) return res.status(404).json({ error: 'User has not earned this achievement.' });

  db.prepare(
    'UPDATE user_achievements SET count = ? WHERE userId = ? AND achievementId = ?'
  ).run(newCount, req.params.userId, req.params.id);

  res.json({ userId: req.params.userId, achievementId: req.params.id, count: newCount, earnedAt: row.earnedAt });
});

// POST upload custom image for achievement
app.post('/api/achievements/:id/upload-image', adminAuth, (req, res) => {
  achievementUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });

    const ach = db.prepare('SELECT id FROM achievements WHERE id = ?').get(req.params.id);
    if (!ach) return res.status(404).json({ error: 'Achievement not found.' });

    const imageSvg = `/achievement-images/${req.file.filename}`;
    let imageFrame = null;
    if (req.body.imageFrame) {
      try { JSON.parse(req.body.imageFrame); imageFrame = req.body.imageFrame; } catch (_e) {}
    }

    db.prepare('UPDATE achievements SET imageSvg = ?, imageFrame = ? WHERE id = ?')
      .run(imageSvg, imageFrame, req.params.id);

    res.json({ imageSvg, imageFrame });
  });
});

// POST regenerate achievement image with Gemini
app.post('/api/achievements/:id/regenerate', adminAuth, (req, res) => {
  achievementUpload.single('inspirationImage')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const ach = db.prepare('SELECT * FROM achievements WHERE id = ?').get(req.params.id);
    if (!ach) return res.status(404).json({ error: 'Achievement not found.' });

    const feedback = sanitizeStr(req.body.feedback || '', 300) || null;
    const inspirationPath = req.file ? req.file.path : null;

    const imageSvg = await generateAchievementSvg(ach.name, ach.description, feedback, inspirationPath);
    if (!imageSvg) return res.status(503).json({ error: 'Image generation unavailable (GEMINI_API_KEY not set).' });

    db.prepare('UPDATE achievements SET imageSvg = ? WHERE id = ?').run(imageSvg, req.params.id);
    res.json({ imageSvg });
  });
});

// --- User management (admin) ---

app.get('/api/users', adminAuth, (req, res) => {
  const users = db.prepare(
    'SELECT id, username, firstName, lastName, email, role, avatarPath, xp, createdAt FROM users ORDER BY username ASC'
  ).all();
  res.json({ users });
});

// Returns list of owners/admins for game ownership dropdown
app.get('/api/owners', auth, (req, res) => {
  const owners = db.prepare(
    "SELECT id, username, firstName, lastName, avatarPath FROM users WHERE role IN ('owner','admin') ORDER BY username"
  ).all();
  res.json(owners.map(u => ({
    id: u.id,
    username: u.username,
    displayName: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username,
    avatarPath: u.avatarPath ?? null,
  })));
});

app.patch('/api/users/:id', adminAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const sets = [];
  const vals = [];

  if (req.body.role !== undefined) {
    const validRoles = ['admin', 'owner', 'user'];
    if (!validRoles.includes(req.body.role)) return res.status(400).json({ error: 'Invalid role.' });
    sets.push('role = ?'); vals.push(req.body.role);
    sets.push('isAdmin = ?'); vals.push(req.body.role === 'admin' ? 1 : 0);
  }
  if (req.body.password !== undefined) {
    if (req.body.password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    sets.push('password_hash = ?'); vals.push(await bcrypt.hash(req.body.password, BCRYPT_ROUNDS));
    sets.push('passwordChanged = ?'); vals.push(1);
  }

  if (sets.length === 0) return res.json({ message: 'No changes.' });
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.params.id);
  const updated = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.params.id);
  res.json(updated);
});

app.delete('/api/users/:id', adminAuth, (req, res) => {
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (req.user.userId === req.params.id) return res.status(400).json({ error: 'Cannot delete your own account.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ id: req.params.id });
});

// --- Ask Claude (SSE streaming with adaptive thinking) ---

app.post('/api/ask-claude', adminAuth, async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'AI analysis not available (ANTHROPIC_API_KEY not set).' });

  const { gameName, gameRules, playerCount, holeCards, boardCards, street } = req.body;
  if (!gameName || !holeCards || holeCards.length < 2)
    return res.status(400).json({ error: 'gameName and holeCards are required.' });

  const formatCard = (c) => c?.rank && c?.suit ? `${c.rank}${c.suit}` : null;
  const holeStr = holeCards.map(formatCard).filter(Boolean).join(' ');
  const boardStr = (boardCards || []).map(formatCard).filter(Boolean).join(' ');

  const prompt = `You are an expert poker analyst. The game being played is "${gameName}".

${gameRules ? `Game rules:\n${gameRules}\n\n` : ''}Player count: ${playerCount || '?'}
Street: ${street || 'unknown'}
Hole cards: ${holeStr}${boardStr ? `\nBoard: ${boardStr}` : ''}

Respond in this exact format:
PROBABILITY: <win probability estimate as a percentage or range>
OUTS: <number of outs if applicable, or N/A>
RECOMMENDATION: <Fold, Check, Call, Bet, or Raise>
BOTTOM LINE: <one sentence summary>
---
<Full detailed analysis here>`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = await anthropic.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      thinking: { type: 'enabled', budget_tokens: 10000 },
      messages: [{ role: 'user', content: prompt }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'text_delta' && delta.text) {
          res.write(`data: ${JSON.stringify({ text: delta.text })}\n\n`);
        }
      }
    }

    res.write('data: [DONE]\n\n');
  } catch (e) {
    console.error('Claude error:', e.message);
    res.write(`data: ${JSON.stringify({ error: e.message || 'Analysis failed.' })}\n\n`);
  }
  res.end();
});

// --- Serve React build (catch-all) ---
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../build/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  telegramPoll();
});
