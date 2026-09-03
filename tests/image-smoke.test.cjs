const { test } = require('node:test');
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:3001';

test('API health reports ready', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

for (const route of ['/', '/some/client-route']) {
  test(`compiled React shell is served at ${route}`, async () => {
    const res = await fetch(`${base}${route}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /<div id="root"><\/div>/);
  });
}

test('game records require authentication', async () => {
  const res = await fetch(`${base}/api/games`);
  assert.equal(res.status, 401);
});
