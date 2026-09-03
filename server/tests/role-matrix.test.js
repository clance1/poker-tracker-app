'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');

const h = require('./helpers');
h.isolateDataDir('role-matrix');

const agent = h.makeAgent();

// Representative route per protection level:
//   auth       -> GET  /api/players
//   ownerAuth  -> POST /api/players
//   adminAuth  -> GET  /api/users
describe('role matrix', () => {
  test('auth-only route: no cookie -> 401', async () => {
    const res = await agent.get('/api/players');
    assert.strictEqual(res.status, 401);
  });

  test('auth-only route: garbage/invalid token -> 401', async () => {
    const res = await agent.get('/api/players').set('Cookie', 'auth_token=not-a-real-jwt');
    assert.strictEqual(res.status, 401);
  });

  test('ownerAuth route: user role -> 403', async () => {
    const u = h.createUser({ role: 'user' });
    const res = await agent.post('/api/players').set('Cookie', u.cookie).send({ name: h.uniqueName('rm') });
    assert.strictEqual(res.status, 403);
  });

  test('ownerAuth route: owner role -> 2xx', async () => {
    const owner = h.createUser({ role: 'owner' });
    const res = await agent.post('/api/players').set('Cookie', owner.cookie).send({ name: h.uniqueName('rm') });
    assert.ok(res.status >= 200 && res.status < 300, `expected 2xx, got ${res.status}`);
  });

  test('ownerAuth route: admin role -> 2xx (admin satisfies ownerAuth too)', async () => {
    const admin = h.createUser({ role: 'admin' });
    const res = await agent.post('/api/players').set('Cookie', admin.cookie).send({ name: h.uniqueName('rm') });
    assert.ok(res.status >= 200 && res.status < 300, `expected 2xx, got ${res.status}`);
  });

  test('adminAuth route: user role -> 403', async () => {
    const u = h.createUser({ role: 'user' });
    const res = await agent.get('/api/users').set('Cookie', u.cookie);
    assert.strictEqual(res.status, 403);
  });

  test('adminAuth route: owner role -> 403 (owner does NOT satisfy adminAuth)', async () => {
    const owner = h.createUser({ role: 'owner' });
    const res = await agent.get('/api/users').set('Cookie', owner.cookie);
    assert.strictEqual(res.status, 403);
  });

  test('adminAuth route: admin role -> 2xx', async () => {
    const admin = h.createUser({ role: 'admin' });
    const res = await agent.get('/api/users').set('Cookie', admin.cookie);
    assert.ok(res.status >= 200 && res.status < 300, `expected 2xx, got ${res.status}`);
  });
});
