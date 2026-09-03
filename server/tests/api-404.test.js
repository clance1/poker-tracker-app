'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');

const h = require('./helpers');
h.isolateDataDir('api-404');

const agent = h.makeAgent();

// BUG FIX (R6): the SPA catch-all (`app.get('*', ...)`, registered last) used
// to be the only thing left standing for an unmatched `GET /api/*` route, so
// e.g. `GET /api/does-not-exist` returned index.html with a 200 status. That
// masks client bugs (typo'd endpoint URLs silently "succeed" with HTML instead
// of erroring) and makes apiFetch's JSON parsing fail in a confusing way. A
// dedicated `app.all('/api/*', ...)` 404 handler is registered after every
// real API route and before the SPA catch-all so unmatched API paths get a
// clean JSON 404 while the SPA catch-all keeps serving the app shell for
// everything else (client-side routes).
describe('unmatched /api/* routes', () => {
  test('GET /api/nope -> 404 with a JSON body, not the SPA HTML shell', async () => {
    const res = await agent.get('/api/nope');
    assert.strictEqual(res.status, 404);
    assert.ok(res.headers['content-type']?.includes('application/json'), `expected JSON, got content-type: ${res.headers['content-type']}`);
    assert.deepStrictEqual(res.body, { error: 'Not found' });
  });

  test('POST /api/does-not-exist -> 404 JSON too (app.all covers all methods)', async () => {
    const res = await agent.post('/api/does-not-exist').send({});
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(res.body, { error: 'Not found' });
  });

  // The real /api/ask-claude route is registered well before the new
  // app.all('/api/*') 404 handler, so it must still be reached (and its own
  // adminAuth gate, not the 404 catch-all, must be what rejects an
  // unauthenticated caller).
  test('POST /api/ask-claude (a real, earlier-registered route) is still reached -> 401 from adminAuth, not 404 from the new catch-all', async () => {
    const res = await agent.post('/api/ask-claude').send({});
    assert.strictEqual(res.status, 401);
  });
});

describe('SPA catch-all is unaffected for non-API paths', () => {
  test('GET /some/client-route -> 200 HTML (index.html), not JSON 404', async () => {
    const res = await agent.get('/some/client-route');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type']?.includes('text/html'), `expected HTML, got content-type: ${res.headers['content-type']}`);
  });

  test('GET / -> 200 HTML (index.html)', async () => {
    const res = await agent.get('/');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type']?.includes('text/html'));
  });
});
