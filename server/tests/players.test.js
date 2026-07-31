'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');

const h = require('./helpers');
h.isolateDataDir('players');

const agent = h.makeAgent();
const db = h.getDb();

describe('players: list shape', () => {
  test('GET /api/players requires auth -> 401 without cookie', async () => {
    const res = await agent.get('/api/players');
    assert.strictEqual(res.status, 401);
  });

  test('GET /api/players -> {items:[{..., avatarPath, xp, games:{items:[...]}}]} (LEFT JOIN users)', async () => {
    const owner = h.createUser({ role: 'user' });
    db.prepare('UPDATE users SET xp = ?, avatarPath = ? WHERE id = ?').run(150, '/avatars/x.png', owner.id);
    const player = h.createPlayer({ userId: owner.id, name: h.uniqueName('linked') });
    const game = h.createGame({ ownerId: owner.id, isComplete: true });
    h.createGamePlayer({ gameID: game.id, playerID: player.id, buyIn: 20, cashOut: 40 });

    const res = await agent.get('/api/players').set('Cookie', owner.cookie);
    assert.strictEqual(res.status, 200);
    const found = res.body.items.find((p) => p.id === player.id);
    assert.ok(found, 'linked player should be present');
    assert.strictEqual(found.userId, owner.id);
    assert.strictEqual(found.avatarPath, '/avatars/x.png');
    assert.strictEqual(found.xp, 150);
    assert.strictEqual(found.games.items.length, 1);
    assert.strictEqual(found.games.items[0].game.id, game.id);
    assert.strictEqual(found.games.items[0].cashOut, 40);
  });

  test('GET /api/players -> unlinked guest player has userId:null, avatarPath:null, xp:0', async () => {
    const owner = h.createUser({ role: 'user' });
    const guest = h.createPlayer({ name: h.uniqueName('guest') });
    const res = await agent.get('/api/players').set('Cookie', owner.cookie);
    const found = res.body.items.find((p) => p.id === guest.id);
    assert.ok(found);
    assert.strictEqual(found.userId, null);
    assert.strictEqual(found.avatarPath, null);
    assert.strictEqual(found.xp, 0);
    assert.deepStrictEqual(found.games.items, []);
  });
});

describe('players: create (ownerAuth)', () => {
  test('user role -> 403', async () => {
    const u = h.createUser({ role: 'user' });
    const res = await agent.post('/api/players').set('Cookie', u.cookie).send({ name: h.uniqueName('p') });
    assert.strictEqual(res.status, 403);
  });

  test('missing name -> 400', async () => {
    const owner = h.createUser({ role: 'owner' });
    const res = await agent.post('/api/players').set('Cookie', owner.cookie).send({});
    assert.strictEqual(res.status, 400);
  });

  test('owner role -> 200 {id, name}', async () => {
    const owner = h.createUser({ role: 'owner' });
    const name = h.uniqueName('newplayer');
    const res = await agent.post('/api/players').set('Cookie', owner.cookie).send({ name });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.name, name);
    assert.ok(res.body.id);
  });

  test('duplicate name -> 400', async () => {
    const owner = h.createUser({ role: 'owner' });
    const name = h.uniqueName('dupplayer');
    await agent.post('/api/players').set('Cookie', owner.cookie).send({ name });
    const res = await agent.post('/api/players').set('Cookie', owner.cookie).send({ name });
    assert.strictEqual(res.status, 400);
  });
});

describe('players: delete rules', () => {
  test('404 when player does not exist', async () => {
    const owner = h.createUser({ role: 'owner' });
    const res = await agent.delete('/api/players/does-not-exist').set('Cookie', owner.cookie);
    assert.strictEqual(res.status, 404);
  });

  test('no game history -> owner can delete freely', async () => {
    const owner = h.createUser({ role: 'owner' });
    const player = h.createPlayer({ name: h.uniqueName('nohistory') });
    const res = await agent.delete(`/api/players/${player.id}`).set('Cookie', owner.cookie);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, player.id);
  });

  test('linked player with game history -> 400 for owner AND for admin', async () => {
    const linkedUser = h.createUser({ role: 'user' });
    const player = h.createPlayer({ userId: linkedUser.id, name: h.uniqueName('linkedhist') });
    const game = h.createGame({ isComplete: true });
    h.createGamePlayer({ gameID: game.id, playerID: player.id, buyIn: 10 });

    const owner = h.createUser({ role: 'owner' });
    const res1 = await agent.delete(`/api/players/${player.id}`).set('Cookie', owner.cookie);
    assert.strictEqual(res1.status, 400);
    assert.match(res1.body.error, /linked to a user account/);

    const admin = h.createUser({ role: 'admin' });
    const res2 = await agent.delete(`/api/players/${player.id}`).set('Cookie', admin.cookie);
    assert.strictEqual(res2.status, 400, 'admin cannot bypass this check -- only the guest-player case is admin-bypassable');
  });

  test('guest (unlinked) player with game history -> 400 for owner, 200 for admin', async () => {
    const player = h.createPlayer({ name: h.uniqueName('guesthist') });
    const game = h.createGame({ isComplete: true });
    h.createGamePlayer({ gameID: game.id, playerID: player.id, buyIn: 10 });

    const owner = h.createUser({ role: 'owner' });
    const res1 = await agent.delete(`/api/players/${player.id}`).set('Cookie', owner.cookie);
    assert.strictEqual(res1.status, 400);
    assert.match(res1.body.error, /Only an Admin/);

    const admin = h.createUser({ role: 'admin' });
    const res2 = await agent.delete(`/api/players/${player.id}`).set('Cookie', admin.cookie);
    assert.strictEqual(res2.status, 200);
  });
});
