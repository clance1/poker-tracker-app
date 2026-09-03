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

  test('valid create -> 200 {id, gameID, playerID, buyIn, rebuys, timeIn}', async () => {
    const u = h.createUser({ role: 'owner' });
    const player = h.createPlayer({});
    const game = h.createGame({ ownerId: u.id });
    const res = await agent
      .post('/api/game-players')
      .set('Cookie', u.cookie)
      .send({ gameID: game.id, playerID: player.id, buyIn: 30 });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(Object.keys(res.body).sort(), ['buyIn', 'gameID', 'id', 'playerID', 'rebuys', 'timeIn']);
    assert.strictEqual(res.body.rebuys, 0);
    // The game's timer hasn't been started yet, so this buy-in doesn't get a
    // Time In until the owner presses "Start Timer".
    assert.strictEqual(res.body.timeIn, null);
  });

  test('buy-in after the timer has started gets an immediate timeIn', async () => {
    const u = h.createUser({ role: 'owner' });
    const player = h.createPlayer({});
    const game = h.createGame({ ownerId: u.id });
    await agent.post(`/api/games/${game.id}/start-timer`).set('Cookie', u.cookie);
    const res = await agent
      .post('/api/game-players')
      .set('Cookie', u.cookie)
      .send({ gameID: game.id, playerID: player.id, buyIn: 30 });
    assert.strictEqual(res.status, 200);
    assert.match(res.body.timeIn, /^\d{2}:\d{2}$/);
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

  // Two distinct rules guard this route. Money fields (buyIn/cashOut) are
  // restricted to admin / owner-role / game owner -- the linked player may not
  // set their own cash-out. Everything else (rebuys) additionally allows the
  // linked player. A bystander is refused either way.
  test('unrelated user changing a money field -> 403', async () => {
    const owner = h.createUser({ role: 'owner' });
    const linkedUser = h.createUser({ role: 'user' });
    const player = h.createPlayer({ userId: linkedUser.id });
    const game = h.createGame({ ownerId: owner.id });
    const gp = h.createGamePlayer({ gameID: game.id, playerID: player.id, buyIn: 20 });

    const bystander = h.createUser({ role: 'user' });
    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', bystander.cookie).send({ buyIn: 25 });
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /can adjust buy-ins and cash-outs/);
  });

  test('unrelated user changing rebuys -> 403', async () => {
    const linkedUser = h.createUser({ role: 'user' });
    const player = h.createPlayer({ userId: linkedUser.id });
    const game = h.createGame({});
    const gp = h.createGamePlayer({ gameID: game.id, playerID: player.id, buyIn: 20, rebuys: 0 });

    const bystander = h.createUser({ role: 'user' });
    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', bystander.cookie).send({ rebuys: 20 });
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /not authorised/);
  });

  test('the linked player may NOT set their own cash-out -> 403', async () => {
    const linkedUser = h.createUser({ role: 'user' });
    const player = h.createPlayer({ userId: linkedUser.id });
    const game = h.createGame({});
    const gp = h.createGamePlayer({ gameID: game.id, playerID: player.id, buyIn: 20 });

    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', linkedUser.cookie).send({ cashOut: 500 });
    assert.strictEqual(res.status, 403);
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

// Mid-game cash-out: an owner/admin can record a cash-out while the game is
// still running, so a player who leaves early is logged as cashed out straight
// away rather than at End Game.
describe('game-players: mid-game cash-out', () => {
  const setup = ({ ownerRole = 'owner' } = {}) => {
    const owner = h.createUser({ role: ownerRole });
    const player = h.createPlayer({});
    const game = h.createGame({ ownerId: owner.id, isComplete: false });
    const gp = h.createGamePlayer({ gameID: game.id, playerID: player.id, buyIn: 20, rebuys: 10 });
    return { owner, player, game, gp };
  };
  const rowFor = (id) => db.prepare('SELECT cashOut FROM game_players WHERE id = ?').get(id);
  const gameRow = (id) => db.prepare('SELECT isComplete FROM games WHERE id = ?').get(id);

  test('owner records a cash-out mid-game; it persists and the game stays open', async () => {
    const { owner, game, gp } = setup();
    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ cashOut: 75 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.cashOut, 75);
    assert.strictEqual(rowFor(gp.id).cashOut, 75);
    // Recording a cash-out must not end the game
    assert.strictEqual(gameRow(game.id).isComplete, 0);
  });

  test('admin can record a cash-out for any game', async () => {
    const admin = h.createUser({ role: 'admin' });
    const { gp } = setup();
    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', admin.cookie).send({ cashOut: 40 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(rowFor(gp.id).cashOut, 40);
  });

  test('a $0 bust-out is stored as 0, not null -- it is still a cash-out', async () => {
    const { owner, gp } = setup();
    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ cashOut: 0 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(rowFor(gp.id).cashOut, 0);
    assert.notStrictEqual(rowFor(gp.id).cashOut, null);
  });

  test('a cash-out can be corrected without clearing it', async () => {
    const { owner, gp } = setup();
    await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ cashOut: 75 });
    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ cashOut: 105 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(rowFor(gp.id).cashOut, 105);
  });

  test('null clears a mis-entered cash-out back to not-cashed-out', async () => {
    const { owner, gp } = setup();
    await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ cashOut: 75 });
    assert.strictEqual(rowFor(gp.id).cashOut, 75);

    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ cashOut: null });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(rowFor(gp.id).cashOut, null);
  });

  test('empty string also clears it', async () => {
    const { owner, gp } = setup();
    await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ cashOut: 50 });
    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ cashOut: '' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(rowFor(gp.id).cashOut, null);
  });

  test('a non-numeric cash-out is rejected rather than stored as NaN', async () => {
    const { owner, gp } = setup();
    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ cashOut: 'abc' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(rowFor(gp.id).cashOut, null);
  });

  test('a negative cash-out is rejected', async () => {
    const { owner, gp } = setup();
    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ cashOut: -10 });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(rowFor(gp.id).cashOut, null);
  });

  test('a bystander cannot record a cash-out', async () => {
    const { gp } = setup();
    const bystander = h.createUser({ role: 'user' });
    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', bystander.cookie).send({ cashOut: 75 });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(rowFor(gp.id).cashOut, null);
  });

  test('other fields are untouched when only cashOut is sent', async () => {
    const { owner, gp } = setup();
    await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ cashOut: 75 });
    const row = db.prepare('SELECT buyIn, rebuys FROM game_players WHERE id = ?').get(gp.id);
    assert.strictEqual(row.buyIn, 20);
    assert.strictEqual(row.rebuys, 10);
  });
});

// venmoSettled: owner/admin can mark a player's net as manually settled
// (Venmo or otherwise), following the same authorization rules as cashOut.
describe('game-players: venmoSettled toggle', () => {
  const setup = ({ ownerRole = 'owner' } = {}) => {
    const owner = h.createUser({ role: ownerRole });
    const player = h.createPlayer({});
    const game = h.createGame({ ownerId: owner.id, isComplete: false });
    const gp = h.createGamePlayer({ gameID: game.id, playerID: player.id, buyIn: 20, cashOut: 40 });
    return { owner, player, game, gp };
  };
  const rowFor = (id) => db.prepare('SELECT venmoSettledAt FROM game_players WHERE id = ?').get(id);

  test('owner marks settled -> venmoSettledAt is stamped and returned', async () => {
    const { owner, gp } = setup();
    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ venmoSettled: true });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.venmoSettledAt);
    assert.strictEqual(rowFor(gp.id).venmoSettledAt, res.body.venmoSettledAt);
  });

  test('unmarking clears venmoSettledAt', async () => {
    const { owner, gp } = setup();
    await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ venmoSettled: true });
    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ venmoSettled: false });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.venmoSettledAt, null);
    assert.strictEqual(rowFor(gp.id).venmoSettledAt, null);
  });

  test('a bystander cannot toggle it -> 403', async () => {
    const { gp } = setup();
    const bystander = h.createUser({ role: 'user' });
    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', bystander.cookie).send({ venmoSettled: true });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(rowFor(gp.id).venmoSettledAt, null);
  });

  test('an admin (unrelated to the game) can toggle it', async () => {
    const admin = h.createUser({ role: 'admin' });
    const { gp } = setup();
    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', admin.cookie).send({ venmoSettled: true });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.venmoSettledAt);
  });

  test('clearing the cash-out also clears any settlement recorded against it', async () => {
    const { owner, gp } = setup();
    await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ venmoSettled: true });
    assert.ok(rowFor(gp.id).venmoSettledAt);

    const res = await agent.put(`/api/game-players/${gp.id}`).set('Cookie', owner.cookie).send({ cashOut: null });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.venmoSettledAt, null);
    assert.strictEqual(rowFor(gp.id).venmoSettledAt, null);
  });
});
