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

  // CHARACTERIZATION: documents a known authz gap, tightened in a later commit.
  // POST /api/game-players only requires `auth` (i.e. any logged-in user) -- there
  // is NO check that the caller owns the game, owns the player record, or is the
  // linked user for that player. A completely unrelated plain `user` account can
  // add a buy-in to ANY game for ANY player right now. This test asserts today's
  // (over-permissive) behavior on purpose; do not "fix" the route to make this
  // fail. A later commit tightens this check, and this test will need updating
  // (or removing) at that point.
  test('plain user with zero relationship to the game/player -> currently 200 (no ownership check)', async () => {
    const bystander = h.createUser({ role: 'user' });
    const game = h.createGame({}); // no owner the bystander is related to
    const player = h.createPlayer({}); // unlinked guest player
    const res = await agent
      .post('/api/game-players')
      .set('Cookie', bystander.cookie)
      .send({ gameID: game.id, playerID: player.id, buyIn: 15 });
    assert.strictEqual(res.status, 200, 'CHARACTERIZATION: no ownership check exists on this route today');
    assert.strictEqual(res.body.gameID, game.id);
    assert.strictEqual(res.body.playerID, player.id);
    assert.strictEqual(res.body.buyIn, 15);
  });

  test('valid create -> 200 {id, gameID, playerID, buyIn, rebuys}', async () => {
    const u = h.createUser({ role: 'user' });
    const player = h.createPlayer({});
    const game = h.createGame({});
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
