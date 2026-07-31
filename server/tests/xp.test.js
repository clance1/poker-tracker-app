'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');

const h = require('./helpers');
h.isolateDataDir('xp');

const agent = h.makeAgent();
const db = h.getDb();

describe('xp: history', () => {
  test('GET /api/xp/history requires auth -> 401', async () => {
    const res = await agent.get('/api/xp/history');
    assert.strictEqual(res.status, 401);
  });

  test('returns only the caller\'s own events, most-recent-first', async () => {
    const u = h.createUser({ role: 'user' });
    const other = h.createUser({ role: 'user' });
    db.prepare('INSERT INTO xp_events (userId, amount, reason) VALUES (?, ?, ?)').run(other.id, 999, 'not mine');
    for (let i = 0; i < 3; i++) {
      db.prepare('INSERT INTO xp_events (userId, amount, reason) VALUES (?, ?, ?)').run(u.id, i, `event-${i}`);
    }
    const res = await agent.get('/api/xp/history').set('Cookie', u.cookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 3);
    assert.ok(res.body.every((e) => e.reason.startsWith('event-')));
    assert.strictEqual(res.body[0].reason, 'event-2', 'most recently inserted event should be first (ORDER BY id DESC)');
    assert.deepStrictEqual(Object.keys(res.body[0]).sort(), ['amount', 'createdAt', 'id', 'reason', 'referenceId']);
  });
});

describe('xp: admin config', () => {
  test('GET /api/admin/xp-config requires adminAuth -> 403 for owner', async () => {
    const owner = h.createUser({ role: 'owner' });
    const res = await agent.get('/api/admin/xp-config').set('Cookie', owner.cookie);
    assert.strictEqual(res.status, 403);
  });

  test('GET as admin -> array of {key, value, label} including seeded defaults', async () => {
    const admin = h.createUser({ role: 'admin' });
    const res = await agent.get('/api/admin/xp-config').set('Cookie', admin.cookie);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
    const row = res.body.find((r) => r.key === 'play_game');
    assert.ok(row);
    assert.strictEqual(row.value, 50);
    assert.strictEqual(row.label, 'Play a Game');
  });

  test('PATCH updates numeric values and returns the full updated list', async () => {
    const admin = h.createUser({ role: 'admin' });
    const res = await agent.patch('/api/admin/xp-config').set('Cookie', admin.cookie).send({ play_game: 75 });
    assert.strictEqual(res.status, 200);
    const row = res.body.find((r) => r.key === 'play_game');
    assert.strictEqual(row.value, 75);

    const dbRow = db.prepare('SELECT value FROM xp_config WHERE key = ?').get('play_game');
    assert.strictEqual(dbRow.value, 75);
  });

  test('PATCH ignores non-numeric values silently', async () => {
    const admin = h.createUser({ role: 'admin' });
    const before = db.prepare('SELECT value FROM xp_config WHERE key = ?').get('top_winner');
    const res = await agent.patch('/api/admin/xp-config').set('Cookie', admin.cookie).send({ top_winner: 'not-a-number' });
    assert.strictEqual(res.status, 200);
    const after = db.prepare('SELECT value FROM xp_config WHERE key = ?').get('top_winner');
    assert.strictEqual(after.value, before.value);
  });
});
