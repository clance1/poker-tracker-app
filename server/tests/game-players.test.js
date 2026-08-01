'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');

const h = require('./helpers');
h.isolateDataDir('game-players');

const agent = h.makeAgent();
const db = h.getDb();

describe('game-players: create (POST /api/game-players)', () => {
  test('no cookie -> 401', async () => {
    const res = await agent.post('/api/game-players').send({ gameID: 'x', playerID: 'y', buyIn: 10 });
    assert.strictEqual(res.status, 401);
  });

  test('missing gameID/playerID -> 400', async () => {
    const u = h.createUser({ role: 'user' });
    const res = await agent.post('/api/game-players').set('Cookie', u.cookie).send({ buyIn: 20 });
    assert.strictEqual(res.status, 400);
  });

  test('buyIn <= 0 -> 400', async () => {
    const u = h.createUser({ role: 'user' });
    const player = h.createPlayer({});
    const game = h.createGame({});
    const res = await agent
      .post('/api/game-players')
      .set('Cookie', u.cookie)
      .send({ gameID: game.id, playerID: player.id, buyIn: 0 });
    assert.strictEqual(res.status, 400);
  });

  // BUG FIX (R1): POST /api/game-players only required `auth` (i.e. any
  // logged-in user) -- there was NO check that the caller owns the game, owns
  // the player record, or is the linked user for that player. A completely
  // unrelated plain `user` account could add a buy-in to ANY game for ANY
  // player. This mirrors the ownership check PUT /api/game-players/:id
  // already had (app.js ~825-843): allow only if the caller is the linked
  // player, the game owner, or has role owner/admin.
  test('plain user with zero relationship to the game/player -> 403 (ownership check enforced)', async () => {
    const bystander = h.createUser({ role: 'user' });
    const game = h.createGame({}); // no owner the bystander is related to
    const player = h.createPlayer({}); // unlinked guest player
    const res = await agent
      .post('/api/game-players')
      .set('Cookie', bystander.cookie)
      .send({ gameID: game.id, playerID: player.id, buyIn: 15 });
    assert.strictEqual(res.status, 403, 'bystander must not be able to post a buy-in for an unrelated game/player');
  });

  test('the linked player themself can create their own buy-in -> 200', async () => {
    const linkedUser = h.createUser({ role: 'user' });
    const player = h.createPlayer({ userId: linkedUser.id });
    const game = h.createGame({}); // no relation via ownerId, only via linked player
    const res = await agent
      .post('/api/game-players')
      .set('Cookie', linkedUser.cookie)
      .send({ gameID: game.id, playerID: player.id, buyIn: 20 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.playerID, player.id);
  });

  test('the game owner (not the linked player, not admin) can post a buy-in for any player in their game -> 200', async () => {
    const owner = h.createUser({ role: 'owner' });
    const player = h.createPlayer({}); // unlinked guest player
    const game = h.createGame({ ownerId: owner.id });
    const res = await agent
      .post('/api/game-players')
      .set('Cookie', owner.cookie)
      .send({ gameID: game.id, playerID: player.id, buyIn: 20 });
    assert.strictEqual(res.status, 200);
  });

  test('an admin (unrelated to the game) can post a buy-in for any player -> 200', async () => {
    const admin = h.createUser({ role: 'admin' });
    const player = h.createPlayer({});
    const game = h.createGame({});
    const res = await agent
      .post('/api/game-players')
      .set('Cookie', admin.cookie)
      .send({ gameID: game.id, playerID: player.id, buyIn: 20 });
    assert.strictEqual(res.status, 200);
  });

  test('valid create -> 200 {id, gameID, playerID, buyIn, rebuys}', async () => {
    const u = h.createUser({ role: 'owner' });
    const player = h.createPlayer({});
    const game = h.createGame({ ownerId: u.id });
    const res = await agent
      .post('/api/game-players')
      .set('Cookie', u.cookie)
      .send({ gameID: game.id, playerID: player.id, buyIn: 30 });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(Object.keys(res.body).sort(), ['buyIn', 'gameID', 'id', 'playerID', 'rebuys']);
    assert.strictEqual(res.body.rebuys, 0);
  });
});

describe('game-players: update (PUT /api/game-players/:id)', () => {
  test('no cookie -> 401', async () => {
    const res = await agent.put('/api/game-players/whatever').send({ buyIn: 5 });
    assert.strictEqual(res.status, 401);
  });

  test('not found -> 404', async () => {
    const u = h.createUser({ role: 'admin' });
    const res = await agent.put('/api/game-players/does-not-exist').set('Cookie', u.cookie).send({ buyIn: 1 });
    assert.strictEqual(res.status, 404);
  });

  test('unrelated user (not linked, not owner/admin, not game owner) -> 403', async () => {
    const owner = h.createUser({ role: 'owner' });
    const linkedUser = h.createUser({ role: 'user' });
    const player = h.createPlayer({ userId: linkedUser.id });
    const game = h.createGame({ ownerId: owner.id });
    const gp = h.createGamePlayer({ gameID: game.id, playerID: player.id, buyIn: 20 });

    const bystander = h.createUser({ role: 'user' });
    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', bystander.cookie).send({ buyIn: 25 });
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /not authorised/);
  });

  test('the linked player themself can rebuy; rebuy triggers an XP penalty', async () => {
    const linkedUser = h.createUser({ role: 'user' });
    const player = h.createPlayer({ userId: linkedUser.id });
    const game = h.createGame({});
    const gp = h.createGamePlayer({ gameID: game.id, playerID: player.id, buyIn: 20, rebuys: 0 });

    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', linkedUser.cookie).send({ rebuys: 20 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.rebuys, 20);

    const penaltyRows = db
      .prepare('SELECT * FROM xp_events WHERE userId = ? AND reason = ?')
      .all(linkedUser.id, 'Additional buy-in');
    assert.strictEqual(penaltyRows.length, 1);
    assert.strictEqual(penaltyRows[0].amount, -10); // xp_config default: additional_buyin_penalty
  });

  test('the game owner (not linked, not admin) can cash out a player', async () => {
    const owner = h.createUser({ role: 'owner' });
    const player = h.createPlayer({});
    const game = h.createGame({ ownerId: owner.id });
    const gp = h.createGamePlayer({ gameID: game.id, playerID: player.id, buyIn: 20 });

    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ cashOut: 45 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.cashOut, 45);
  });

  test('an admin (unrelated to the game) can update any record', async () => {
    const admin = h.createUser({ role: 'admin' });
    const player = h.createPlayer({});
    const game = h.createGame({});
    const gp = h.createGamePlayer({ gameID: game.id, playerID: player.id, buyIn: 20 });

    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', admin.cookie).send({ buyIn: 99 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.buyIn, 99);
  });
});
