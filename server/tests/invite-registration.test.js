'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { v4: uuidv4 } = require('uuid');

const h = require('./helpers');
h.isolateDataDir('invite-registration');

const agent = h.makeAgent();
const db = h.getDb();

// registerLimiter is 5/hour per IP and every supertest request shares one IP,
// so this file makes EXACTLY 5 POST /api/register calls. Guest-claim coverage
// lives in guest-claim.test.js, which gets its own process and its own budget.
function seedCode({ code, revokedAt = null, maxUses = null, useCount = 0 }) {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO invite_codes (id, code, label, createdAt, revokedAt, maxUses, useCount)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, code, 'seed', new Date().toISOString(), revokedAt, maxUses, useCount);
  return id;
}

const GOOD = 'GOOD-GOOD-GOOD-GOOD';
const REVOKED = 'REVK-REVK-REVK-REVK';
const SPENT = 'SPNT-SPNT-SPNT-SPNT';

seedCode({ code: GOOD });
seedCode({ code: REVOKED, revokedAt: new Date().toISOString() });
seedCode({ code: SPENT, maxUses: 1, useCount: 1 });

describe('registration is invite-gated', () => {
  test('no invite code -> 403', async () => {
    const res = await agent.post('/api/register')
      .send({ username: h.uniqueName('nc'), password: 'password123', email: 'nc@example.com' });
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /invite code/i);
  });

  test('revoked code -> 403', async () => {
    const res = await agent.post('/api/register').send({
      username: h.uniqueName('rv'), password: 'password123',
      email: 'rv@example.com', inviteCode: REVOKED,
    });
    assert.strictEqual(res.status, 403);
  });

  test('code that has hit its usage cap -> 403', async () => {
    const res = await agent.post('/api/register').send({
      username: h.uniqueName('sp'), password: 'password123',
      email: 'sp@example.com', inviteCode: SPENT,
    });
    assert.strictEqual(res.status, 403);
  });

  test('valid code but no email -> 400', async () => {
    const res = await agent.post('/api/register').send({
      username: h.uniqueName('ne'), password: 'password123', inviteCode: GOOD,
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /email/i);
  });

  test('valid code plus email -> 200, and the code records the redemption', async () => {
    const username = h.uniqueName('ok');
    // Lowercase and dash-free: normalisation should still match.
    const res = await agent.post('/api/register').send({
      username, password: 'password123',
      email: `${username}@example.com`,
      inviteCode: GOOD.toLowerCase().replace(/-/g, ''),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.username, username);
    assert.strictEqual(res.body.claimedGuest, null);
    assert.ok(res.headers['set-cookie']?.some((c) => c.startsWith('auth_token=')));

    const row = db.prepare('SELECT useCount FROM invite_codes WHERE code = ?').get(GOOD);
    assert.strictEqual(row.useCount, 1, 'use count should increment');

    const redemption = db.prepare(
      'SELECT username FROM invite_redemptions WHERE username = ?'
    ).get(username);
    assert.ok(redemption, 'a redemption row should be written');

    // Email is stored, and a player row was created for the new account.
    const user = db.prepare('SELECT email FROM users WHERE username = ?').get(username);
    assert.strictEqual(user.email, `${username}@example.com`.toLowerCase());
    const player = db.prepare('SELECT name FROM players WHERE userId = (SELECT id FROM users WHERE username = ?)').get(username);
    assert.ok(player, 'a player row should be linked to the new account');
  });
});
