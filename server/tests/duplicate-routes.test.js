'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const h = require('./helpers');
h.isolateDataDir('duplicate-routes');

const app = h.getApp();

function collectRoutes(expressApp) {
  const routes = [];
  for (const layer of expressApp._router.stack) {
    if (layer.route) {
      const routePath = layer.route.path;
      for (const method of Object.keys(layer.route.methods)) {
        if (layer.route.methods[method]) routes.push(`${method.toUpperCase()} ${routePath}`);
      }
    }
  }
  return routes;
}

test('mechanically detect duplicate route registrations in app._router.stack', () => {
  const routes = collectRoutes(app);
  const counts = new Map();
  for (const r of routes) counts.set(r, (counts.get(r) || 0) + 1);
  const dupes = [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([r]) => r)
    .sort();

  // KNOWN, CURRENT duplicates as of this characterization suite. Express matches
  // routes in registration order and stops at the first match (none of these
  // handlers call next()), so for each pair the FIRST-registered definition
  // always wins and the second is unreachable dead code.
  //
  // When a later commit deletes the dead duplicates, update this array to []
  // (empty). If this assertion starts failing after such a cleanup, that is the
  // *intended* signal to update the expectation -- it does not mean the cleanup
  // broke anything.
  const expected = [
    'DELETE /api/users/:id',
    'GET /api/owners',
    'GET /api/users',
    'PATCH /api/users/:id',
    'POST /api/ask-claude',
  ];

  assert.deepStrictEqual(dupes, expected, `Full route list was:\n${routes.join('\n')}`);
});
