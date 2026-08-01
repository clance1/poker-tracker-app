'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');

const h = require('./helpers');
h.isolateDataDir('change-password-rate-limit');

const agent = h.makeAgent();

// BUG FIX (R4): unlike POST /api/login, POST /api/change-password had no rate
// limiter at all, making it a brute-force oracle for `currentPassword` -- an
// attacker who knows (or guesses) a username could hammer this endpoint
// indefinitely to brute-force the current password. This file is isolated
// from auth.test.js's own change-password tests specifically so this
// dedicated limiter (15-minute window, max 10, its own message) can be
// exercised without accounting for calls made elsewhere -- each test FILE gets
// its own in-process app instance and therefore its own in-memory limiter
// state, so this is a clean slate.
describe('change-password rate limiting', () => {
  test('11th POST /api/change-password from the same IP within the window -> 429', async () => {
    const u = h.createUser({ role: 'user', password: 'correcthorse123' });

    let lastRes;
    for (let i = 0; i < 10; i++) {
      lastRes = await agent
        .post('/api/change-password')
        .send({ username: u.username, currentPassword: 'wrong-guess', newPassword: 'wontmatter123' });
      // All of these are wrong-password attempts and should 401, not 429 --
      // the limiter's max is 10, so none of the first 10 should be throttled.
      assert.strictEqual(lastRes.status, 401, `attempt ${i + 1} should be 401 (not yet rate limited)`);
    }

    const res11 = await agent
      .post('/api/change-password')
      .send({ username: u.username, currentPassword: 'wrong-guess', newPassword: 'wontmatter123' });
    assert.strictEqual(res11.status, 429);
    assert.match(res11.body.error, /too many/i);
  });
});
