'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');

const h = require('./helpers');
h.isolateDataDir('game-timer');

const agent = h.makeAgent();
const db = h.getDb();

describe('start-timer (POST /api/games/:id/start-timer)', () => {
  test('user role -> 403', async () => {
    const u = h.createUser({ role: 'user' });
    const game = h.createGame({});
    const res = await agent.post(`/api/games/${game.id}/start-timer`).set('Cookie', u.cookie);
    assert.strictEqual(res.status, 403);
  });

  test('game not found -> 404', async () => {
    const owner = h.createUser({ role: 'owner' });
    const res = await agent.post('/api/games/does-not-exist/start-timer').set('Cookie', owner.cookie);
    assert.strictEqual(res.status, 404);
  });

  test('completed game -> 400', async () => {
    const owner = h.createUser({ role: 'owner' });
    const game = h.createGame({ isComplete: true });
    const res = await agent.post(`/api/games/${game.id}/start-timer`).set('Cookie', owner.cookie);
    assert.strictEqual(res.status, 400);
  });

  test('stamps timeIn on pre-selected players, leaves already-set ones alone, and is not repeatable', async () => {
    const owner = h.createUser({ role: 'owner' });
    const p1 = h.createPlayer({});
    const p2 = h.createPlayer({});
    const game = h.createGame({ ownerId: owner.id });
    const gp1 = h.createGamePlayer({ gameID: game.id, playerID: p1.id, buyIn: 20 });
    // Simulate a player added mid-setup who already has some other timeIn value --
    // start-timer must not clobber it.
    db.prepare('UPDATE game_players SET timeIn = ? WHERE id = ?').run('05:00', gp1.id);
    const gp2 = h.createGamePlayer({ gameID: game.id, playerID: p2.id, buyIn: 20 });

    const res = await agent.post(`/api/games/${game.id}/start-timer`).set('Cookie', owner.cookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.timerStarted, true);
    assert.match(res.body.timeIn, /^\d{2}:\d{2}$/);

    const row1 = db.prepare('SELECT timeIn FROM game_players WHERE id = ?').get(gp1.id);
    const row2 = db.prepare('SELECT timeIn FROM game_players WHERE id = ?').get(gp2.id);
    assert.strictEqual(row1.timeIn, '05:00');
    assert.strictEqual(row2.timeIn, res.body.timeIn);

    const gameRow = db.prepare('SELECT timerStarted FROM games WHERE id = ?').get(game.id);
    assert.strictEqual(gameRow.timerStarted, 1);

    const again = await agent.post(`/api/games/${game.id}/start-timer`).set('Cookie', owner.cookie);
    assert.strictEqual(again.status, 400);
  });

  test('GET /api/games reflects timerStarted and per-player timeIn/timeOut', async () => {
    const owner = h.createUser({ role: 'owner' });
    const p1 = h.createPlayer({});
    const game = h.createGame({ ownerId: owner.id });
    h.createGamePlayer({ gameID: game.id, playerID: p1.id, buyIn: 20 });

    const before = await agent.get('/api/games').set('Cookie', owner.cookie);
    const gBefore = before.body.items.find((g) => g.id === game.id);
    assert.strictEqual(gBefore.timerStarted, false);
    assert.strictEqual(gBefore.players.items[0].timeIn, null);

    await agent.post(`/api/games/${game.id}/start-timer`).set('Cookie', owner.cookie);

    const after = await agent.get('/api/games').set('Cookie', owner.cookie);
    const gAfter = after.body.items.find((g) => g.id === game.id);
    assert.strictEqual(gAfter.timerStarted, true);
    assert.match(gAfter.players.items[0].timeIn, /^\d{2}:\d{2}$/);
    assert.strictEqual(gAfter.players.items[0].timeOut, null);
  });
});

describe('cash-out stamps/clears timeOut (PUT /api/game-players/:id)', () => {
  test('first cash-out stamps timeOut; a later correction keeps it; clearing removes it', async () => {
    const owner = h.createUser({ role: 'owner' });
    const player = h.createPlayer({});
    const game = h.createGame({ ownerId: owner.id });
    const gp = h.createGamePlayer({ gameID: game.id, playerID: player.id, buyIn: 20 });

    const first = await agent
      .put(`/api/game-players/${gp.id}`)
      .set('Cookie', owner.cookie)
      .send({ cashOut: 40 });
    assert.strictEqual(first.status, 200);
    assert.match(first.body.timeOut, /^\d{2}:\d{2}$/);
    const stampedAt = first.body.timeOut;

    const corrected = await agent
      .put(`/api/game-players/${gp.id}`)
      .set('Cookie', owner.cookie)
      .send({ cashOut: 45 });
    assert.strictEqual(corrected.status, 200);
    assert.strictEqual(corrected.body.timeOut, stampedAt);

    const cleared = await agent
      .put(`/api/game-players/${gp.id}`)
      .set('Cookie', owner.cookie)
      .send({ cashOut: null });
    assert.strictEqual(cleared.status, 200);
    assert.strictEqual(cleared.body.timeOut, null);
  });

  test('a rebuy-only update does not touch timeOut', async () => {
    const owner = h.createUser({ role: 'owner' });
    const player = h.createPlayer({});
    const game = h.createGame({ ownerId: owner.id });
    const gp = h.createGamePlayer({ gameID: game.id, playerID: player.id, buyIn: 20, cashOut: 30 });
    db.prepare('UPDATE game_players SET timeOut = ? WHERE id = ?').run('21:00', gp.id);

    const res = await agent
      .put(`/api/game-players/${gp.id}`)
      .set('Cookie', owner.cookie)
      .send({ rebuys: 20 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.timeOut, '21:00');
  });
});
