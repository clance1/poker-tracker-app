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

// BUG FIX: admin-forced password resets (PATCH /api/users/:id) must set a
// dedicated `mustChangePassword` flag (distinct from the overloaded
// `passwordChanged` column) so the target user is forced to rotate on their
// next login, and /api/change-password clears it again once they do.
describe('auth: mustChangePassword (admin-forced rotation)', () => {
  test('admin resets another user\'s password -> forces rotation on next login; change-password clears the flag', async () => {
    const admin = h.createUser({ role: 'admin' });
    const b = h.createUser({ role: 'user', password: 'originalpw1' });

    const patchRes = await agent
      .patch(`/api/users/${b.id}`)
      .set('Cookie', admin.cookie)
      .send({ password: 'adminchosen1' });
    assert.strictEqual(patchRes.status, 200);

    const afterPatch = db.prepare('SELECT mustChangePassword FROM users WHERE id = ?').get(b.id);
    assert.strictEqual(afterPatch.mustChangePassword, 1);

    // B logs in with the admin-chosen password -> must be forced to rotate, no cookie.
    const loginRes = await agent.post('/api/login').send({ username: b.username, password: 'adminchosen1' });
    assert.strictEqual(loginRes.status, 200);
    assert.deepStrictEqual(loginRes.body, { requiresPasswordChange: true });
    assert.strictEqual(loginRes.headers['set-cookie'], undefined);

    // B rotates via /api/change-password.
    const changeRes = await agent
      .post('/api/change-password')
      .send({ username: b.username, currentPassword: 'adminchosen1', newPassword: 'brandnewpw1' });
    assert.strictEqual(changeRes.status, 200);
    assert.ok(changeRes.headers['set-cookie']?.some((c) => c.startsWith('auth_token=')));

    const afterChange = db.prepare('SELECT mustChangePassword, passwordChanged FROM users WHERE id = ?').get(b.id);
    assert.strictEqual(afterChange.mustChangePassword, 0);
    assert.strictEqual(afterChange.passwordChanged, 1);

    // B can now log in normally and gets a cookie.
    const loginRes2 = await agent.post('/api/login').send({ username: b.username, password: 'brandnewpw1' });
    assert.strictEqual(loginRes2.status, 200);
    assert.ok(loginRes2.headers['set-cookie']?.some((c) => c.startsWith('auth_token=')));
    assert.strictEqual(loginRes2.body.requiresPasswordChange, undefined);
  });

  test('admin resetting their OWN password via PATCH /api/users/:id does NOT set mustChangePassword', async () => {
    const admin = h.createUser({ role: 'admin' });
    const res = await agent
      .patch(`/api/users/${admin.id}`)
      .set('Cookie', admin.cookie)
      .send({ password: 'selfchosen123' });
    assert.strictEqual(res.status, 200);
    const row = db.prepare('SELECT mustChangePassword FROM users WHERE id = ?').get(admin.id);
    assert.strictEqual(row.mustChangePassword, 0);
  });

  test('normal user with mustChangePassword unset logs in normally (no regression)', async () => {
    const u = h.createUser({ role: 'user', password: 'regularpw1' });
    const res = await agent.post('/api/login').send({ username: u.username, password: 'regularpw1' });
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['set-cookie']?.some((c) => c.startsWith('auth_token=')));
    assert.strictEqual(res.body.requiresPasswordChange, undefined);
  });

  test('self-service password change via /api/profile also clears mustChangePassword (defensive)', async () => {
    const u = h.createUser({ role: 'user' });
    db.prepare('UPDATE users SET mustChangePassword = 1 WHERE id = ?').run(u.id);
    const res = await agent
      .patch('/api/profile')
      .set('Cookie', u.cookie)
      .send({ password: 'freshchoice123' });
    assert.strictEqual(res.status, 200);
    const row = db.prepare('SELECT mustChangePassword, passwordChanged FROM users WHERE id = ?').get(u.id);
    assert.strictEqual(row.mustChangePassword, 0);
    assert.strictEqual(row.passwordChanged, 1);
  });
});
