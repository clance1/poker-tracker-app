'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { v4: uuidv4 } = require('uuid');

const h = require('./helpers');
h.isolateDataDir('scheduled-games');

const agent = h.makeAgent();
const db = h.getDb();

function futureDate(daysAhead) {
  return new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10);
}

describe('scheduled-games', () => {
  test('GET requires auth -> 401 without cookie', async () => {
    const res = await agent.get('/api/scheduled-games');
    assert.strictEqual(res.status, 401);
  });

  test('POST requires ownerAuth -> 403 for plain user', async () => {
    const u = h.createUser({ role: 'user' });
    const res = await agent
      .post('/api/scheduled-games')
      .set('Cookie', u.cookie)
      .send({ date: futureDate(3), time: '19:00' });
    assert.strictEqual(res.status, 403);
  });

  test('invalid date -> 400, invalid time -> 400', async () => {
    const owner = h.createUser({ role: 'owner' });
    const res1 = await agent.post('/api/scheduled-games').set('Cookie', owner.cookie).send({ date: 'bad', time: '19:00' });
    assert.strictEqual(res1.status, 400);
    const res2 = await agent
      .post('/api/scheduled-games')
      .set('Cookie', owner.cookie)
      .send({ date: futureDate(3), time: 'bad' });
    assert.strictEqual(res2.status, 400);
  });

  test('owner can create -> 200 {id, scheduledDate, scheduledTime, location}, then it appears in the list', async () => {
    const owner = h.createUser({ role: 'owner' });
    const date = futureDate(3);
    const createRes = await agent
      .post('/api/scheduled-games')
      .set('Cookie', owner.cookie)
      .send({ date, time: '19:30', location: 'Garage' });
    assert.strictEqual(createRes.status, 200);
    assert.strictEqual(createRes.body.scheduledDate, date);
    assert.strictEqual(createRes.body.scheduledTime, '19:30');
    assert.strictEqual(createRes.body.location, 'Garage');

    const listRes = await agent.get('/api/scheduled-games').set('Cookie', owner.cookie);
    assert.strictEqual(listRes.status, 200);
    assert.ok(Array.isArray(listRes.body.games));
    const found = listRes.body.games.find((g) => g.id === createRes.body.id);
    assert.ok(found, 'newly scheduled game should be listed');
  });

  test('DELETE requires ownerAuth -> 403 for plain user, 200 for owner', async () => {
    const owner = h.createUser({ role: 'owner' });
    const date = futureDate(5);
    const createRes = await agent.post('/api/scheduled-games').set('Cookie', owner.cookie).send({ date, time: '20:00' });

    const plainUser = h.createUser({ role: 'user' });
    const res403 = await agent.delete(`/api/scheduled-games/${createRes.body.id}`).set('Cookie', plainUser.cookie);
    assert.strictEqual(res403.status, 403);

    const res200 = await agent.delete(`/api/scheduled-games/${createRes.body.id}`).set('Cookie', owner.cookie);
    assert.strictEqual(res200.status, 200);
  });

  test('DELETE not found -> 404', async () => {
    const owner = h.createUser({ role: 'owner' });
    const res = await agent.delete('/api/scheduled-games/does-not-exist').set('Cookie', owner.cookie);
    assert.strictEqual(res.status, 404);
  });

  // CHARACTERIZATION: GET only returns rows where scheduledDate >= today (app.js
  // ~741-744) -- a scheduled game silently disappears from the list once its date
  // is in the past, even though the row is never deleted.
  test('a past-dated scheduled game is excluded from the list even though the row still exists', async () => {
    const owner = h.createUser({ role: 'owner' });
    const id = uuidv4();
    db.prepare(
      'INSERT INTO scheduled_games (id, scheduledDate, scheduledTime, location, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, '2000-01-01', '19:00', null, owner.id, new Date().toISOString());

    const res = await agent.get('/api/scheduled-games').set('Cookie', owner.cookie);
    assert.strictEqual(res.status, 200);
    assert.ok(!res.body.games.some((g) => g.id === id));

    const stillInDb = db.prepare('SELECT id FROM scheduled_games WHERE id = ?').get(id);
    assert.ok(stillInDb, 'row is still in the table, just filtered out of the API response');
  });
});
