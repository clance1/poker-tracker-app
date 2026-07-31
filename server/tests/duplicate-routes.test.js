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

  // Guard against duplicate route registrations. Express matches routes in
  // registration order and stops at the first match (none of these handlers
  // call next()), so duplicate registrations result in unreachable dead code.
  // This assertion verifies there are zero duplicate registrations -- a regression
  // test to ensure duplicates are not accidentally reintroduced in future commits.
  const expected = [];

  assert.deepStrictEqual(dupes, expected, `Full route list was:\n${routes.join('\n')}`);
});
