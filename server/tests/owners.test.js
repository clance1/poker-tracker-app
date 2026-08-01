'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');

const h = require('./helpers');
h.isolateDataDir('owners');

const agent = h.makeAgent();
const db = h.getDb();

// BUG FIX: GET /api/owners was gated behind ownerAuth (admin/owner only), 403ing
// plain `user` role accounts trying to populate the new-game owner picker.
// It should be readable by any authenticated user, and the payload should be
// enriched with displayName/avatarPath WITHOUT changing the response envelope
// (the frontend reads `d.owners ?? []` at src/App.js:973 -- a bare array would
// silently break the dropdown).
describe('GET /api/owners', () => {
  test('no cookie -> 401', async () => {
    const res = await agent.get('/api/owners');
    assert.strictEqual(res.status, 401);
  });

  test('plain user role -> 200 (any authenticated user, not just owner/admin)', async () => {
    const u = h.createUser({ role: 'user' });
    const res = await agent.get('/api/owners').set('Cookie', u.cookie);
    assert.strictEqual(res.status, 200);
  });

  test('response envelope is {owners:[...]} array; entries include id/username/displayName, falls back to username, excludes plain users', async () => {
    const u = h.createUser({ role: 'user' });
    const owner = h.createUser({ role: 'owner' });
    const admin = h.createUser({ role: 'admin' });
    db.prepare('UPDATE users SET firstName = ?, lastName = ? WHERE id = ?').run('Jane', 'Doe', owner.id);

    const res = await agent.get('/api/owners').set('Cookie', u.cookie);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.owners), 'response must have an `owners` array key -- frontend reads d.owners ?? []');

    const foundOwner = res.body.owners.find((o) => o.id === owner.id);
    assert.ok(foundOwner, 'owner-role user should be listed');
    assert.strictEqual(foundOwner.username, owner.username);
    assert.strictEqual(foundOwner.displayName, 'Jane Doe');

    const foundAdmin = res.body.owners.find((o) => o.id === admin.id);
    assert.ok(foundAdmin, 'admin-role user should be listed');
    assert.strictEqual(foundAdmin.displayName, admin.username, 'falls back to username when no first/last name set');

    assert.ok(!res.body.owners.some((o) => o.id === u.id), 'plain user-role accounts must not appear in the eligible-owners list');
  });
});
