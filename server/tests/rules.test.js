'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');

const h = require('./helpers');
h.isolateDataDir('rules');

const agent = h.makeAgent();
const db = h.getDb();

describe('rules: PRE-EXISTING BUG -- fresh DB schema is missing columns app.js requires', () => {
  // REAL BUG, NOT introduced by this suite: server/db.js's `CREATE TABLE rules`
  // (and `rule_versions`) never define `overview`, `keyConsiderations`,
  // `cardsDealt`, or `howToPlay` columns, but server/app.js's POST /api/rules,
  // PUT /api/rules/:id, and POST /api/rules/:id/duplicate handlers
  // unconditionally INSERT/UPDATE those columns (app.js ~868-963). On a fresh
  // DATA_DIR -- i.e. ANY brand-new deployment, not just this isolated test DB --
  // that throws a synchronous better-sqlite3 "no such column" error. The route
  // handlers have no try/catch around it, so Express's default error handler
  // turns it into an uncaught 500. This means rule *creation* (and update, and
  // duplicate) is completely broken on a fresh install today.
  //
  // Do NOT patch server/db.js to "fix" this. This block exists to document and
  // freeze the current broken behavior so a later migration-fixing commit has a
  // red/green signal: once db.js gains the missing columns, these three
  // assertions should flip from 500 to 200/201 and must be updated then.
  test('POST /api/rules currently 500s on a fresh DB (missing columns)', async () => {
    const u = h.createUser({ role: 'user' });
    const res = await agent
      .post('/api/rules')
      .set('Cookie', u.cookie)
      .send({ gameName: "Texas Hold'em", overview: 'A card game' });
    assert.strictEqual(res.status, 500, 'BUG: fresh installs cannot create a rule at all -- see comment above');
  });

  test('PUT /api/rules/:id also 500s (same missing-column bug) once a rule row exists', async () => {
    const u = h.createUser({ role: 'user' });
    const rule = h.createRuleRow({ gameName: h.uniqueName('game') }); // inserted directly, bypassing the broken POST
    const res = await agent.put(`/api/rules/${rule.id}`).set('Cookie', u.cookie).send({ gameName: 'Renamed' });
    assert.strictEqual(res.status, 500, 'BUG: same missing-column issue affects updates too');
  });

  test('POST /api/rules/:id/duplicate also 500s (same missing-column bug)', async () => {
    const u = h.createUser({ role: 'user' });
    const rule = h.createRuleRow({ gameName: h.uniqueName('game') });
    const res = await agent
      .post(`/api/rules/${rule.id}/duplicate`)
      .set('Cookie', u.cookie)
      .send({ gameName: h.uniqueName('copy') });
    assert.strictEqual(res.status, 500, 'BUG: duplicate also INSERTs the missing columns');
  });
});

describe('rules: read + comments + delete (paths that do not touch the missing columns)', () => {
  test('GET /api/rules -> array (works even though the schema is incomplete)', async () => {
    const u = h.createUser({ role: 'user' });
    h.createRuleRow({ gameName: h.uniqueName('listed') });
    const res = await agent.get('/api/rules').set('Cookie', u.cookie);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  test('GET /api/rules/:id -> {..., versions:[], comments:[]}', async () => {
    const u = h.createUser({ role: 'user' });
    const rule = h.createRuleRow({ gameName: h.uniqueName('detail') });
    const res = await agent.get(`/api/rules/${rule.id}`).set('Cookie', u.cookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, rule.id);
    assert.deepStrictEqual(res.body.versions, []);
    assert.deepStrictEqual(res.body.comments, []);
  });

  test('GET /api/rules/:id -> 404 when missing', async () => {
    const u = h.createUser({ role: 'user' });
    const res = await agent.get('/api/rules/does-not-exist').set('Cookie', u.cookie);
    assert.strictEqual(res.status, 404);
  });

  test('POST /api/rules/:id/comments -> 200, then GET reflects it', async () => {
    const u = h.createUser({ role: 'user' });
    const rule = h.createRuleRow({ gameName: h.uniqueName('withcomments') });
    const res = await agent.post(`/api/rules/${rule.id}/comments`).set('Cookie', u.cookie).send({ body: 'Great game!' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.body, 'Great game!');
    assert.strictEqual(res.body.username, u.username);

    const detail = await agent.get(`/api/rules/${rule.id}`).set('Cookie', u.cookie);
    assert.strictEqual(detail.body.comments.length, 1);
  });

  test('empty comment body -> 400', async () => {
    const u = h.createUser({ role: 'user' });
    const rule = h.createRuleRow({ gameName: h.uniqueName('emptycomment') });
    const res = await agent.post(`/api/rules/${rule.id}/comments`).set('Cookie', u.cookie).send({ body: '' });
    assert.strictEqual(res.status, 400);
  });

  test('DELETE /api/rules/:id requires adminAuth -> 403 for plain user, 200 for admin', async () => {
    const rule = h.createRuleRow({ gameName: h.uniqueName('todelete') });
    const u = h.createUser({ role: 'user' });
    const res403 = await agent.delete(`/api/rules/${rule.id}`).set('Cookie', u.cookie);
    assert.strictEqual(res403.status, 403);

    const admin = h.createUser({ role: 'admin' });
    const res200 = await agent.delete(`/api/rules/${rule.id}`).set('Cookie', admin.cookie);
    assert.strictEqual(res200.status, 200);

    const stillThere = db.prepare('SELECT id FROM rules WHERE id = ?').get(rule.id);
    assert.strictEqual(stillThere, undefined);
  });
});
