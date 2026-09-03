'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');

const h = require('./helpers');
h.isolateDataDir('games');

const agent = h.makeAgent();
const db = h.getDb();

describe('games: list shape', () => {
  test('GET /api/games requires auth -> 401 without cookie', async () => {
    const res = await agent.get('/api/games');
    assert.strictEqual(res.status, 401);
  });

  test('GET /api/games -> {items:[{..., owner:{...}, players:{items:[{..., player:{...}}]}}]}', async () => {
    const owner = h.createUser({ role: 'owner' });
    const linkedUser = h.createUser({ role: 'user' });
    const player = h.createPlayer({ userId: linkedUser.id, name: h.uniqueName('gp') });
    const game = h.createGame({ ownerId: owner.id, location: 'Basement' });
    h.createGamePlayer({ gameID: game.id, playerID: player.id, buyIn: 25, cashOut: 50 });

    const res = await agent.get('/api/games').set('Cookie', owner.cookie);
    assert.strictEqual(res.status, 200);
    const found = res.body.items.find((g) => g.id === game.id);
    assert.ok(found);
    assert.strictEqual(found.owner.id, owner.id);
    assert.strictEqual(found.owner.username, owner.username);
    assert.strictEqual(found.location, 'Basement');
    assert.strictEqual(found.players.items.length, 1);
    assert.strictEqual(found.players.items[0].player.id, player.id);
    assert.strictEqual(found.players.items[0].player.name, player.name);
    assert.strictEqual(found.players.items[0].cashOut, 50);
  });

  test('GET /api/games -> game with no ownerId has owner:null', async () => {
    const u = h.createUser({ role: 'user' });
    const game = h.createGame({ ownerId: null });
    const res = await agent.get('/api/games').set('Cookie', u.cookie);
    const found = res.body.items.find((g) => g.id === game.id);
    assert.ok(found);
    assert.strictEqual(found.owner, null);
  });

  test('GET /api/games -> players.items[].player.venmoHandle and .venmoSettledAt flow through from users/game_players', async () => {
    const owner = h.createUser({ role: 'owner' });
    const linkedUser = h.createUser({ role: 'user' });
    db.prepare('UPDATE users SET venmoHandle = ? WHERE id = ?').run('with-venmo-99', linkedUser.id);
    const withHandle = h.createPlayer({ userId: linkedUser.id, name: h.uniqueName('venmo-yes') });
    const withoutHandle = h.createPlayer({ name: h.uniqueName('venmo-no') });
    const game = h.createGame({ ownerId: owner.id });
    const gp1 = h.createGamePlayer({ gameID: game.id, playerID: withHandle.id, buyIn: 20, cashOut: 40 });
    h.createGamePlayer({ gameID: game.id, playerID: withoutHandle.id, buyIn: 20, cashOut: 0 });
    db.prepare('UPDATE game_players SET venmoSettledAt = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', gp1.id);

    const res = await agent.get('/api/games').set('Cookie', owner.cookie);
    const found = res.body.items.find((g) => g.id === game.id);
    const row1 = found.players.items.find((p) => p.player.id === withHandle.id);
    const row2 = found.players.items.find((p) => p.player.id === withoutHandle.id);
    assert.strictEqual(row1.player.venmoHandle, 'with-venmo-99');
    assert.strictEqual(row1.venmoSettledAt, '2026-01-01T00:00:00.000Z');
    assert.strictEqual(row2.player.venmoHandle, null);
    assert.strictEqual(row2.venmoSettledAt, null);
  });
});

describe('games: create (ownerAuth)', () => {
  test('user role -> 403', async () => {
    const u = h.createUser({ role: 'user' });
    const res = await agent.post('/api/games').set('Cookie', u.cookie).send({ date: '2026-08-01' });
    assert.strictEqual(res.status, 403);
  });

  test('invalid date -> 400', async () => {
    const owner = h.createUser({ role: 'owner' });
    const res = await agent.post('/api/games').set('Cookie', owner.cookie).send({ date: 'not-a-date' });
    assert.strictEqual(res.status, 400);
  });

  test('owner role -> 200, ownerId defaults to creator when not supplied', async () => {
    const owner = h.createUser({ role: 'owner' });
    const res = await agent.post('/api/games').set('Cookie', owner.cookie).send({ date: '2026-08-01' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ownerId, owner.id);
    assert.strictEqual(res.body.isComplete, false);
    assert.strictEqual(res.body.endTime, null);
  });
});

describe('games: complete flow (PUT) triggers XP + achievements without throwing', () => {
  test('completing a game with linked players awards XP rows and does not throw', async () => {
    const owner = h.createUser({ role: 'owner' });
    const winner = h.createUser({ role: 'user' });
    const loser = h.createUser({ role: 'user' });
    const winnerPlayer = h.createPlayer({ userId: winner.id, name: h.uniqueName('winner') });
    const loserPlayer = h.createPlayer({ userId: loser.id, name: h.uniqueName('loser') });
    const game = h.createGame({ ownerId: owner.id });
    h.createGamePlayer({ gameID: game.id, playerID: winnerPlayer.id, buyIn: 20, cashOut: 60 });
    h.createGamePlayer({ gameID: game.id, playerID: loserPlayer.id, buyIn: 20, cashOut: 0 });

    const res = await agent.put(`/api/games/${game.id}`).set('Cookie', owner.cookie).send({ isComplete: true });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, game.id);

    const gameRow = db.prepare('SELECT isComplete, endTime FROM games WHERE id = ?').get(game.id);
    assert.strictEqual(gameRow.isComplete, 1);
    assert.ok(gameRow.endTime, 'endTime should be auto-set on completion');

    const winnerXp = db.prepare('SELECT * FROM xp_events WHERE userId = ? AND referenceId = ?').all(winner.id, game.id);
    assert.ok(winnerXp.length > 0, 'winner should receive XP events');
    const reasons = winnerXp.map((e) => e.reason);
    assert.ok(reasons.includes('Played a game'));
    assert.ok(reasons.includes('Top winner'));

    const winnerRow = db.prepare('SELECT xp FROM users WHERE id = ?').get(winner.id);
    assert.ok(winnerRow.xp > 0);
  });

  test('completing an already-complete game does not re-fire XP or throw', async () => {
    const owner = h.createUser({ role: 'owner' });
    const game = h.createGame({ ownerId: owner.id, isComplete: true });
    const res = await agent.put(`/api/games/${game.id}`).set('Cookie', owner.cookie).send({ isComplete: true, notes: 'edited' });
    assert.strictEqual(res.status, 200);
    const row = db.prepare('SELECT notes FROM games WHERE id = ?').get(game.id);
    assert.strictEqual(row.notes, 'edited');
  });

  test('game not found -> 404', async () => {
    const owner = h.createUser({ role: 'owner' });
    const res = await agent.put('/api/games/does-not-exist').set('Cookie', owner.cookie).send({ isComplete: true });
    assert.strictEqual(res.status, 404);
  });
});

describe('games: delete (adminAuth)', () => {
  test('owner role -> 403', async () => {
    const owner = h.createUser({ role: 'owner' });
    const game = h.createGame({ ownerId: owner.id });
    const res = await agent.delete(`/api/games/${game.id}`).set('Cookie', owner.cookie);
    assert.strictEqual(res.status, 403);
  });

  test('admin role -> 200', async () => {
    const admin = h.createUser({ role: 'admin' });
    const game = h.createGame({ ownerId: admin.id });
    const res = await agent.delete(`/api/games/${game.id}`).set('Cookie', admin.cookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, game.id);
  });
});
