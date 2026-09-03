/*
 * Invite-code logic, kept free of any database dependency so it can be unit
 * tested on its own. app.js owns persistence; this owns the rules.
 */
const crypto = require('crypto');

// Excludes 0/O/1/I/L so a code can be read aloud or copied off a phone screen
// without ambiguity. 16 characters from 31 symbols is ~79 bits of entropy.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_GROUPS = 4;
const CODE_GROUP_LEN = 4;

function generateInviteCode(randomBytes = crypto.randomBytes) {
  const n = CODE_GROUPS * CODE_GROUP_LEN;
  // Rejection sampling: 256 is not a multiple of 31, so naive modulo would make
  // the first few symbols slightly likelier than the rest.
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  const chars = [];
  while (chars.length < n) {
    for (const b of randomBytes(n)) {
      if (b >= limit) continue;
      chars.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
      if (chars.length === n) break;
    }
  }
  const groups = [];
  for (let i = 0; i < CODE_GROUPS; i++) {
    groups.push(chars.slice(i * CODE_GROUP_LEN, (i + 1) * CODE_GROUP_LEN).join(''));
  }
  return groups.join('-');
}

// People paste codes with stray spaces, lowercase, or no dashes. Compare on the
// stripped form so none of that matters.
const normaliseCode = (val) =>
  typeof val === 'string' ? val.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '';

// A code can be used when it exists, has not been revoked, and has uses left.
// maxUses of null means unlimited.
const codeIsUsable = (row) =>
  !!row && !row.revokedAt && (row.maxUses == null || (row.useCount ?? 0) < row.maxUses);

// Finds the usable code matching `raw` among `rows`, or null.
function findUsableCodeIn(rows, raw) {
  const wanted = normaliseCode(raw);
  if (!wanted) return null;
  return (rows || []).find((r) => normaliseCode(r.code) === wanted && codeIsUsable(r)) ?? null;
}

module.exports = {
  CODE_ALPHABET,
  generateInviteCode,
  normaliseCode,
  codeIsUsable,
  findUsableCodeIn,
};
