'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { v4: uuidv4 } = require('uuid');

const h = require('./helpers');
h.isolateDataDir('guest-claim');

const agent = h.makeAgent();
const db = h.getDb();

// Exactly 3 POST /api/register calls here, well under the 5/hour limiter.
const CODE = 'CLAM-CLAM-CLAM-CLAM';
db.prepare(
  `INSERT INTO invite_codes (id, code, label, createdAt, maxUses, useCount)
   VALUES (?, ?, ?, ?, NULL, 0)`
).run(uuidv4(), CODE, 'guest-claim', new Date().toISOString());

const admin = h.createUser({ role: 'admin' });
const owner = h.createUser({ role: 'owner' });

describe('attaching a claim email to a guest', () => {
  test('non-admins cannot attach one', async () => {
    const guest = h.createPlayer({ name: h.uniqueName('guest') });
    for (const actor of [owner, h.createUser({ role: 'user' })]) {
      const res = await agent.patch(`/api/players/${guest.id}`)
        .set('Cookie', actor.cookie).send({ claimEmail: 'x@example.com' });
      assert.strictEqual(res.status, 403);
    }
    const anon = await agent.patch(`/api/players/${guest.id}`).send({ claimEmail: 'x@example.com' });
    assert.strictEqual(anon.status, 401);
  });

  test('admin attaches, then clears', async () => {
    const guest = h.createPlayer({ name: h.uniqueName('guest') });
    const set = await agent.patch(`/api/players/${guest.id}`)
      .set('Cookie', admin.cookie).send({ claimEmail: 'Dave@Example.COM' });
    assert.strictEqual(set.status, 200);
    assert.strictEqual(set.body.claimEmail, 'dave@example.com', 'should normalise to lowercase');

    const cleared = await agent.patch(`/api/players/${guest.id}`)
      .set('Cookie', admin.cookie).send({ claimEmail: '' });
    assert.strictEqual(cleared.status, 200);
    assert.strictEqual(cleared.body.claimEmail, null);
  });

  test('rejects a malformed email', async () => {
    const guest = h.createPlayer({ name: h.uniqueName('guest') });
    const res = await agent.patch(`/api/players/${guest.id}`)
      .set('Cookie', admin.cookie).send({ claimEmail: 'not-an-email' });
    assert.strictEqual(res.status, 400);
  });

  test('refuses a player already linked to an account', async () => {
    const u = h.createUser({ role: 'user' });
    const linked = h.createPlayer({ name: h.uniqueName('linked'), userId: u.id });
    const res = await agent.patch(`/api/players/${linked.id}`)
      .set('Cookie', admin.cookie).send({ claimEmail: 'a@example.com' });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /already linked/);
  });

  test('refuses an email two guests would both claim', async () => {
    const a = h.createPlayer({ name: h.uniqueName('g1') });
    const b = h.createPlayer({ name: h.uniqueName('g2') });
    await agent.patch(`/api/players/${a.id}`).set('Cookie', admin.cookie)
      .send({ claimEmail: 'shared@example.com' });
    const res = await agent.patch(`/api/players/${b.id}`).set('Cookie', admin.cookie)
      .send({ claimEmail: 'shared@example.com' });
    assert.strictEqual(res.status, 409);
    assert.match(res.body.error, /already reserved/);
  });

  test('unknown player -> 404', async () => {
    const res = await agent.patch('/api/players/nope')
      .set('Cookie', admin.cookie).send({ claimEmail: 'a@example.com' });
    assert.strictEqual(res.status, 404);
  });
});

describe('registering with a tagged email claims the guest', () => {
  test('history transfers and the guest stops being a guest', async () => {
    // A guest with two games of history.
    const guest = h.createPlayer({ name: h.uniqueName('Dave') });
    const g1 = h.createGame({ isComplete: true });
    const g2 = h.createGame({ isComplete: true });
    h.createGamePlayer({ gameID: g1.id, playerID: guest.id, buyIn: 20, cashOut: 55 });
    h.createGamePlayer({ gameID: g2.id, playerID: guest.id, buyIn: 40, rebuys: 20, cashOut: 0 });

    const email = `${h.uniqueName('dave')}@example.com`;
    await agent.patch(`/api/players/${guest.id}`).set('Cookie', admin.cookie).send({ claimEmail: email });

    const username = h.uniqueName('daveacct');
    const res = await agent.post('/api/register')
      .send({ username, password: 'password123', email, inviteCode: CODE });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.claimedGuest, guest.name, 'response should name the claimed guest');

    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);

    // The original player row is now owned by the new account.
    const claimed = db.prepare('SELECT userId, claimEmail FROM players WHERE id = ?').get(guest.id);
    assert.strictEqual(claimed.userId, user.id);
    assert.strictEqual(claimed.claimEmail, null, 'claim email should be consumed');

    // Every game row still points at the same player, so history came along.
    const games = db.prepare('SELECT COUNT(*) c FROM game_players WHERE playerID = ?').get(guest.id);
    assert.strictEqual(games.c, 2);

    // No duplicate player row was created for the new account.
    const rows = db.prepare('SELECT COUNT(*) c FROM players WHERE userId = ?').get(user.id);
    assert.strictEqual(rows.c, 1, 'claiming must not also create a second player');
  });

  test('an untagged email creates a fresh player and claims nothing', async () => {
    const username = h.uniqueName('solo');
    const res = await agent.post('/api/register').send({
      username, password: 'password123',
      email: `${username}@example.com`, inviteCode: CODE,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.claimedGuest, null);

    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    const player = db.prepare('SELECT name FROM players WHERE userId = ?').get(user.id);
    assert.strictEqual(player.name, username);
  });

  test('an email already held by an account -> 409, and nothing is consumed', async () => {
    const taken = db.prepare('SELECT email FROM users WHERE email IS NOT NULL LIMIT 1').get();
    assert.ok(taken, 'a previous test should have registered an email');

    const before = db.prepare('SELECT useCount FROM invite_codes WHERE code = ?').get(CODE).useCount;
    const res = await agent.post('/api/register').send({
      username: h.uniqueName('dupe'), password: 'password123',
      email: taken.email, inviteCode: CODE,
    });
    assert.strictEqual(res.status, 409);
    assert.match(res.body.error, /already uses that email/);

    const after = db.prepare('SELECT useCount FROM invite_codes WHERE code = ?').get(CODE).useCount;
    assert.strictEqual(after, before, 'a rejected registration must not burn an invite use');
  });
});
