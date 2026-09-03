'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { v4: uuidv4 } = require('uuid');

const h = require('./helpers');
h.isolateDataDir('achievements');

const agent = h.makeAgent();
const db = h.getDb();

// ---------------------------------------------------------------------------
// PRE-EXISTING BUG, NOT introduced by this suite: server/db.js seeds its 8
// "builtin" achievements with `INSERT OR IGNORE INTO achievements (..., criteriaJson,
// ...)` BEFORE the later `addCol('achievements', 'criteriaJson', 'TEXT')` migration
// that actually creates that column. On a genuinely fresh database (first-ever
// boot against an empty DATA_DIR) every one of those INSERTs throws "no such
// column: criteriaJson", which is silently swallowed by a bare `catch (_e) {}` in
// db.js. Net effect: the `achievements` table has ZERO rows after the very first
// boot. It "self-heals" on the *second* boot against the same DB file (once the
// column already exists from the first boot's migration), which is why this was
// never noticed against the long-lived production database -- but any brand-new
// deployment starts with no achievements at all until the process restarts once.
// This was verified directly against a throwaway container run (not just this
// test): `SELECT COUNT(*) FROM achievements` = 0 on boot 1, non-zero on boot 2
// of the same underlying DB file.
//
// Do NOT fix db.js here. This test documents and freezes that fact. The rest of
// this file's tests use h.createAchievement() (a direct DB insert) so they can
// still characterize the list/unseen/counts/grant/revoke routes without
// depending on the broken seed.
// ---------------------------------------------------------------------------
test('BUG: fresh DB has zero seeded achievements (seed runs before its own column migration)', () => {
  const count = db.prepare('SELECT COUNT(*) as c FROM achievements').get().c;
  assert.strictEqual(count, 0, 'BUG: see comment above -- builtin achievement seeding silently no-ops on first boot');
});

describe('achievements: list', () => {
  test('GET /api/achievements requires auth -> 401', async () => {
    const res = await agent.get('/api/achievements');
    assert.strictEqual(res.status, 401);
  });

  test('GET /api/achievements -> array with earned/earnedAt/timesEarned/earnerCount fields', async () => {
    h.createAchievement({ name: h.uniqueName('ach') });
    const u = h.createUser({ role: 'user' });
    const res = await agent.get('/api/achievements').set('Cookie', u.cookie);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0);
    const a = res.body[0];
    assert.ok('earned' in a && 'earnedAt' in a && 'timesEarned' in a && 'earnerCount' in a);
    assert.strictEqual(a.earned, false);
  });
});

describe('achievements: unseen marks seen', () => {
  test('fetching unseen achievements returns them once, then marks seen=1', async () => {
    const u = h.createUser({ role: 'user' });
    const ach = h.createAchievement({ name: h.uniqueName('ach') });
    const uaId = uuidv4();
    db.prepare(
      'INSERT INTO user_achievements (id, userId, achievementId, earnedAt, gameId, count, seen) VALUES (?, ?, ?, ?, NULL, 1, 0)'
    ).run(uaId, u.id, ach.id, new Date().toISOString());

    const res1 = await agent.get('/api/achievements/unseen').set('Cookie', u.cookie);
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.body.length, 1);
    assert.strictEqual(res1.body[0].achievementId, ach.id);

    const row = db.prepare('SELECT seen FROM user_achievements WHERE id = ?').get(uaId);
    assert.strictEqual(row.seen, 1, 'GET /api/achievements/unseen must mark rows seen as a side-effect');

    const res2 = await agent.get('/api/achievements/unseen').set('Cookie', u.cookie);
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.length, 0, 'already-seen achievements should not be returned again');
  });
});

describe('achievements: counts', () => {
  test('GET /api/achievements/counts -> per-user achievement counts', async () => {
    const u = h.createUser({ role: 'user' });
    const ach = h.createAchievement({ name: h.uniqueName('ach') });
    db.prepare(
      'INSERT INTO user_achievements (id, userId, achievementId, earnedAt, gameId, count, seen) VALUES (?, ?, ?, ?, NULL, 1, 1)'
    ).run(uuidv4(), u.id, ach.id, new Date().toISOString());

    const res = await agent.get('/api/achievements/counts').set('Cookie', u.cookie);
    assert.strictEqual(res.status, 200);
    const row = res.body.find((r) => r.userId === u.id);
    assert.ok(row);
    assert.strictEqual(row.achievementCount, 1);
  });
});

describe('achievements: admin grant/revoke', () => {
  test('grant requires adminAuth -> 403 for owner', async () => {
    const owner = h.createUser({ role: 'owner' });
    const u = h.createUser({ role: 'user' });
    const ach = h.createAchievement({ name: h.uniqueName('ach') });
    const res = await agent.post(`/api/achievements/${ach.id}/users/${u.id}`).set('Cookie', owner.cookie);
    assert.strictEqual(res.status, 403);
  });

  test('admin grant -> 200 {earned:true}, then revoke -> 200 {earned:false}', async () => {
    const admin = h.createUser({ role: 'admin' });
    const u = h.createUser({ role: 'user' });
    const ach = h.createAchievement({ name: h.uniqueName('ach') });

    const grantRes = await agent.post(`/api/achievements/${ach.id}/users/${u.id}`).set('Cookie', admin.cookie);
    assert.strictEqual(grantRes.status, 200);
    assert.strictEqual(grantRes.body.userId, u.id);
    assert.strictEqual(grantRes.body.achievementId, ach.id);
    assert.strictEqual(grantRes.body.earned, true);
    assert.ok(grantRes.body.earnedAt);

    const revokeRes = await agent.delete(`/api/achievements/${ach.id}/users/${u.id}`).set('Cookie', admin.cookie);
    assert.strictEqual(revokeRes.status, 200);
    assert.strictEqual(revokeRes.body.earned, false);

    const row = db.prepare('SELECT * FROM user_achievements WHERE userId = ? AND achievementId = ?').get(u.id, ach.id);
    assert.strictEqual(row, undefined, 'revoke deletes the row entirely');
  });
});
