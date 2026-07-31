'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');

const h = require('./helpers');
h.isolateDataDir('auth');

const agent = h.makeAgent();
const db = h.getDb();

// NOTE: registerLimiter is 5/hour per IP (app.js:72) and all supertest requests
// share one IP, so this describe block deliberately makes exactly 5 POST
// /api/register calls total -- one for each validation branch, one success, one
// duplicate -- to stay under the limit.
describe('auth: register', () => {
  test('username shorter than 2 chars -> 400', async () => {
    const res = await agent.post('/api/register').send({ username: 'a', password: 'password123' });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /at least 2 characters/);
  });

  test('username with disallowed characters -> 400', async () => {
    const res = await agent.post('/api/register').send({ username: 'bad name!', password: 'password123' });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /may only contain/);
  });

  test('password shorter than 6 chars -> 400', async () => {
    const res = await agent.post('/api/register').send({ username: h.uniqueName('reguser'), password: '123' });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /at least 6 characters/);
  });

  let regUsername;
  test('valid registration -> 200 {username, role}, sets auth_token cookie', async () => {
    regUsername = h.uniqueName('reguser');
    const res = await agent.post('/api/register').send({ username: regUsername, password: 'password123' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { username: regUsername, role: 'user' });
    assert.ok(res.headers['set-cookie']?.some((c) => c.startsWith('auth_token=')));
  });

  test('duplicate username (case-insensitive) -> 409', async () => {
    const res = await agent.post('/api/register').send({ username: regUsername.toUpperCase(), password: 'password123' });
    assert.strictEqual(res.status, 409);
    assert.match(res.body.error, /already taken/);
  });
});

describe('auth: login', () => {
  test('bad credentials -> 401', async () => {
    const res = await agent.post('/api/login').send({ username: 'nobody-such-user', password: 'whatever123' });
    assert.strictEqual(res.status, 401);
  });

  test('correct credentials -> 200, sets cookie, shape is {username, role, avatarPath}', async () => {
    const password = 'correcthorse1';
    const u = h.createUser({ role: 'user', password });
    const res = await agent.post('/api/login').send({ username: u.username, password });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(Object.keys(res.body).sort(), ['avatarPath', 'role', 'username']);
    assert.strictEqual(res.body.username, u.username);
    assert.strictEqual(res.body.role, 'user');
    assert.strictEqual(res.body.avatarPath, null);
    assert.ok(res.headers['set-cookie']?.some((c) => c.startsWith('auth_token=')));
  });

  // CHARACTERIZATION: seedAdmin() (app.js ~215) runs on import and always creates
  // a literal 'admin' / 'admin' account with passwordChanged = 0. Logging into
  // that account must NOT set a session cookie -- it must return
  // {requiresPasswordChange:true} instead, forcing rotation first (app.js:319-321).
  test('admin login with passwordChanged=0 -> 200 {requiresPasswordChange:true}, NO cookie', async () => {
    const res = await agent.post('/api/login').send({ username: 'admin', password: 'admin' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { requiresPasswordChange: true });
    assert.strictEqual(res.headers['set-cookie'], undefined);
  });
});

describe('auth: logout', () => {
  test('logout works with no auth required, clears cookie -> 200 {ok:true}', async () => {
    const res = await agent.post('/api/logout');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { ok: true });
    assert.ok(res.headers['set-cookie']?.some((c) => c.startsWith('auth_token=;')));
  });
});

describe('auth: change-password', () => {
  test('wrong current password -> 401', async () => {
    const u = h.createUser({ role: 'user', password: 'original123' });
    const res = await agent
      .post('/api/change-password')
      .send({ username: u.username, currentPassword: 'totally-wrong', newPassword: 'newpass123' });
    assert.strictEqual(res.status, 401);
  });

  test('new password same as current -> 400', async () => {
    const u = h.createUser({ role: 'user', password: 'samepass123' });
    const res = await agent
      .post('/api/change-password')
      .send({ username: u.username, currentPassword: 'samepass123', newPassword: 'samepass123' });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /must differ/);
  });

  test('successful change -> 200, sets cookie, passwordChanged=1 persisted in DB', async () => {
    const u = h.createUser({ role: 'user', password: 'oldpass123', passwordChanged: 0 });
    const res = await agent
      .post('/api/change-password')
      .send({ username: u.username, currentPassword: 'oldpass123', newPassword: 'brandnew123' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.username, u.username);
    assert.ok(res.headers['set-cookie']?.some((c) => c.startsWith('auth_token=')));

    const row = db.prepare('SELECT passwordChanged FROM users WHERE id = ?').get(u.id);
    assert.strictEqual(row.passwordChanged, 1);
  });
});
