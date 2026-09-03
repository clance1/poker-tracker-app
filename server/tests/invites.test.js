/*
 * Unit tests for invite-code rules. No database, so these run anywhere.
 * Endpoint-level coverage lives in invite-codes.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  CODE_ALPHABET,
  generateInviteCode,
  normaliseCode,
  codeIsUsable,
  findUsableCodeIn,
} = require('../invites');

test('generateInviteCode: shape', () => {
  const code = generateInviteCode();
  assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.strictEqual(code.replace(/-/g, '').length, 16);
});

test('generateInviteCode: only uses the unambiguous alphabet', () => {
  for (let i = 0; i < 200; i++) {
    for (const ch of generateInviteCode().replace(/-/g, '')) {
      assert.ok(CODE_ALPHABET.includes(ch), `unexpected character ${ch}`);
    }
  }
});

test('generateInviteCode: excludes look-alike characters', () => {
  const joined = Array.from({ length: 200 }, () => generateInviteCode()).join('');
  for (const ch of ['0', 'O', '1', 'I', 'L']) {
    assert.ok(!joined.includes(ch), `${ch} should never appear in a code`);
  }
});

test('generateInviteCode: does not repeat', () => {
  const seen = new Set(Array.from({ length: 500 }, () => generateInviteCode()));
  assert.strictEqual(seen.size, 500);
});

test('generateInviteCode: rejection sampling keeps the distribution flat', () => {
  // A byte >= 248 must be discarded rather than folded back onto the first
  // symbols. Feeding only out-of-range bytes first proves they are skipped.
  let call = 0;
  const bytes = (n) => {
    call++;
    return Buffer.alloc(n, call === 1 ? 0xff : 0x00);
  };
  const code = generateInviteCode(bytes);
  assert.strictEqual(code, 'AAAA-AAAA-AAAA-AAAA');
  assert.ok(call > 1, 'the all-0xff buffer should have been rejected');
});

test('normaliseCode: tolerates real-world paste damage', () => {
  const canonical = 'ABCD-EFGH-JKMN-PQRS';
  const stripped = 'ABCDEFGHJKMNPQRS';
  for (const variant of [
    canonical,
    '  ' + canonical + '  ',
    canonical.toLowerCase(),
    stripped,
    'abcd efgh jkmn pqrs',
    'ABCD_EFGH.JKMN/PQRS',
  ]) {
    assert.strictEqual(normaliseCode(variant), stripped, `failed on ${JSON.stringify(variant)}`);
  }
});

test('normaliseCode: non-strings and empties become empty', () => {
  for (const v of [null, undefined, 42, {}, [], '', '   ', '---']) {
    assert.strictEqual(normaliseCode(v), '');
  }
});

test('codeIsUsable: unrevoked with no cap is usable', () => {
  assert.strictEqual(codeIsUsable({ revokedAt: null, maxUses: null, useCount: 999 }), true);
});

test('codeIsUsable: revoked is never usable', () => {
  assert.strictEqual(
    codeIsUsable({ revokedAt: '2026-01-01T00:00:00Z', maxUses: null, useCount: 0 }),
    false
  );
});

test('codeIsUsable: respects the usage cap', () => {
  assert.strictEqual(codeIsUsable({ revokedAt: null, maxUses: 3, useCount: 2 }), true);
  assert.strictEqual(codeIsUsable({ revokedAt: null, maxUses: 3, useCount: 3 }), false);
  assert.strictEqual(codeIsUsable({ revokedAt: null, maxUses: 3, useCount: 4 }), false);
});

test('codeIsUsable: missing row is not usable', () => {
  assert.strictEqual(codeIsUsable(null), false);
  assert.strictEqual(codeIsUsable(undefined), false);
});

test('findUsableCodeIn: matches regardless of formatting', () => {
  const rows = [{ id: 'a', code: 'ABCD-EFGH-JKMN-PQRS', revokedAt: null, maxUses: null, useCount: 0 }];
  assert.strictEqual(findUsableCodeIn(rows, 'abcdefghjkmnpqrs').id, 'a');
  assert.strictEqual(findUsableCodeIn(rows, ' ABCD-efgh-JKMN-pqrs ').id, 'a');
});

test('findUsableCodeIn: skips revoked and exhausted codes', () => {
  const rows = [
    { id: 'revoked', code: 'AAAA-AAAA-AAAA-AAAA', revokedAt: '2026-01-01', maxUses: null, useCount: 0 },
    { id: 'spent', code: 'BBBB-BBBB-BBBB-BBBB', revokedAt: null, maxUses: 1, useCount: 1 },
    { id: 'good', code: 'CCCC-CCCC-CCCC-CCCC', revokedAt: null, maxUses: 2, useCount: 1 },
  ];
  assert.strictEqual(findUsableCodeIn(rows, 'AAAAAAAAAAAAAAAA'), null);
  assert.strictEqual(findUsableCodeIn(rows, 'BBBBBBBBBBBBBBBB'), null);
  assert.strictEqual(findUsableCodeIn(rows, 'CCCCCCCCCCCCCCCC').id, 'good');
});

test('findUsableCodeIn: empty input never matches', () => {
  const rows = [{ id: 'a', code: 'ABCD-EFGH-JKMN-PQRS', revokedAt: null, maxUses: null, useCount: 0 }];
  for (const v of ['', '   ', null, undefined, '-- --']) {
    assert.strictEqual(findUsableCodeIn(rows, v), null, `blank input ${JSON.stringify(v)} matched`);
  }
  assert.strictEqual(findUsableCodeIn([], 'ABCDEFGHJKMNPQRS'), null);
  assert.strictEqual(findUsableCodeIn(null, 'ABCDEFGHJKMNPQRS'), null);
});
