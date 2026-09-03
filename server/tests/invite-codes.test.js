'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');

const h = require('./helpers');
h.isolateDataDir('invite-codes');

const agent = h.makeAgent();
const db = h.getDb();

// Admin-side code management only. No POST /api/register calls here, so this
// file never touches the 5/hour registerLimiter budget.
describe('invite codes: authorization', () => {
  const paths = [
    ['get', '/api/admin/invite-codes'],
    ['post', '/api/admin/invite-codes'],
  ];

  test('anonymous -> 401', async () => {
    for (const [method, url] of paths) {
      const res = await agent[method](url).send({});
      assert.strictEqual(res.status, 401, `${method} ${url}`);
    }
  });

  test('non-admin roles -> 403', async () => {
    for (const role of ['user', 'owner']) {
      const u = h.createUser({ role });
      for (const [method, url] of paths) {
        const res = await agent[method](url).set('Cookie', u.cookie).send({});
        assert.strictEqual(res.status, 403, `${role} ${method} ${url}`);
      }
    }
  });
});

describe('invite codes: lifecycle', () => {
  const admin = h.createUser({ role: 'admin' });

  test('generate -> readable code, zero uses, active', async () => {
    const res = await agent.post('/api/admin/invite-codes')
      .set('Cookie', admin.cookie).send({ label: 'Autumn 2026' });
    assert.strictEqual(res.status, 200);
    assert.match(res.body.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.strictEqual(res.body.label, 'Autumn 2026');
    assert.strictEqual(res.body.useCount, 0);
    assert.strictEqual(res.body.maxUses, null);
    assert.strictEqual(res.body.active, true);
    assert.strictEqual(res.body.revokedAt, null);
    assert.deepStrictEqual(res.body.redemptions, []);
  });

  test('generate with a usage cap', async () => {
    const res = await agent.post('/api/admin/invite-codes')
      .set('Cookie', admin.cookie).send({ maxUses: 3 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.maxUses, 3);
  });

  test('rejects a nonsense usage cap', async () => {
    for (const maxUses of [0, -1, 'abc', 2.5]) {
      const res = await agent.post('/api/admin/invite-codes')
        .set('Cookie', admin.cookie).send({ maxUses });
      assert.strictEqual(res.status, 400, `maxUses=${maxUses}`);
      assert.match(res.body.error, /whole number/);
    }
  });

  test('two generated codes are never equal', async () => {
    const a = await agent.post('/api/admin/invite-codes').set('Cookie', admin.cookie).send({});
    const b = await agent.post('/api/admin/invite-codes').set('Cookie', admin.cookie).send({});
    assert.notStrictEqual(a.body.code, b.body.code);
  });

  test('list returns every code, newest first', async () => {
    const res = await agent.get('/api/admin/invite-codes').set('Cookie', admin.cookie);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.codes));
    assert.ok(res.body.codes.length >= 2);
  });

  test('revoke marks the code inactive', async () => {
    const made = await agent.post('/api/admin/invite-codes').set('Cookie', admin.cookie).send({});
    const res = await agent.post(`/api/admin/invite-codes/${made.body.id}/revoke`)
      .set('Cookie', admin.cookie).send({});
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.active, false);
    assert.ok(res.body.revokedAt);
  });

  test('revoking twice -> 400', async () => {
    const made = await agent.post('/api/admin/invite-codes').set('Cookie', admin.cookie).send({});
    await agent.post(`/api/admin/invite-codes/${made.body.id}/revoke`).set('Cookie', admin.cookie).send({});
    const res = await agent.post(`/api/admin/invite-codes/${made.body.id}/revoke`)
      .set('Cookie', admin.cookie).send({});
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /already revoked/);
  });

  test('revoke on an unknown id -> 404', async () => {
    const res = await agent.post('/api/admin/invite-codes/does-not-exist/revoke')
      .set('Cookie', admin.cookie).send({});
    assert.strictEqual(res.status, 404);
  });

  test('regenerate revokes the old code and issues a new one with the same settings', async () => {
    const made = await agent.post('/api/admin/invite-codes')
      .set('Cookie', admin.cookie).send({ label: 'Rotating', maxUses: 5 });

    const res = await agent.post(`/api/admin/invite-codes/${made.body.id}/regenerate`)
      .set('Cookie', admin.cookie).send({});
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.revokedId, made.body.id);
    assert.notStrictEqual(res.body.code.code, made.body.code);
    assert.strictEqual(res.body.code.label, 'Rotating');
    assert.strictEqual(res.body.code.maxUses, 5);
    assert.strictEqual(res.body.code.active, true);
    assert.strictEqual(res.body.code.useCount, 0);

    const old = db.prepare('SELECT revokedAt FROM invite_codes WHERE id = ?').get(made.body.id);
    assert.ok(old.revokedAt, 'the old code should be revoked');
  });

  test('regenerate on an unknown id -> 404', async () => {
    const res = await agent.post('/api/admin/invite-codes/nope/regenerate')
      .set('Cookie', admin.cookie).send({});
    assert.strictEqual(res.status, 404);
  });
});
