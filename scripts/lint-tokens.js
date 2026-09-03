#!/usr/bin/env node
/*
 * Fails if any var(--token) reference has no definition in src/App.css :root.
 *
 * This is the guard for the bug class that motivated it: --accent, --surface,
 * --surface2, --primary, --danger and four others were referenced 41 times and
 * defined zero times. CSS drops those declarations silently, so achievement
 * cards, avatars and leaderboard rows shipped with no background at all.
 *
 * Run: npm run lint:tokens
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const CSS = path.join(SRC, "App.css");

// Tokens set at runtime on an element's style attribute rather than in :root.
// Each must be genuinely written by a component; keep this list short.
const RUNTIME_TOKENS = new Set([
  "--pc",             // Leaderboard: per-player toggle colour
  "--avatar-size",    // Avatar: per-instance diameter
  "--joker-accent",   // JokerCard: per-achievement accent
  "--stagger-index",  // JokerCard: grid position, drives reveal delay
]);

// Normalize CRLF -> LF up front. On a Windows checkout with core.autocrlf=true,
// every file on disk has \r\n even though the committed blobs are LF-only; the
// per-line comment stripping below is anchored with `$`, which (unlike a bare
// end-of-string check) does not consider `\r` matched by `.` -- so a trailing
// \r silently defeated the strip and produced false-positive "undefined
// token" errors for anything resembling var(--x) inside a // comment.
const readNormalized = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const css = readNormalized(CSS);

// Definitions from the :root block only. A token defined ad hoc deeper in the
// stylesheet does not count: it would not be in scope for every consumer.
const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/);
if (!rootBlock) {
  console.error("lint:tokens: could not find the :root block in src/App.css");
  process.exit(1);
}
const defined = new Set(
  [...rootBlock[1].matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)].map((m) => m[1])
);

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );

// Blank out comments so prose like "var(--x)" in a doc block is not scanned.
// Newlines are preserved so reported line numbers stay accurate.
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

const files = walk(SRC).filter((f) => /\.(css|js|jsx)$/.test(f));
const problems = [];

for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  stripComments(readNormalized(file)).split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*([,)])/g)) {
      const [, token, next] = m;
      if (defined.has(token) || RUNTIME_TOKENS.has(token)) continue;
      // A fallback (the comma form) means the page still renders, but it also
      // means the token is drifting out of the system. Report it as a warning.
      const kind = next === "," ? "warn" : "error";
      problems.push({ kind, rel, line: i + 1, token });
    }
  });
}

const errors = problems.filter((p) => p.kind === "error");
const warns = problems.filter((p) => p.kind === "warn");

for (const p of warns) {
  console.warn(`warn  ${p.rel}:${p.line}  ${p.token} is undefined but has a fallback`);
}
for (const p of errors) {
  console.error(`ERROR ${p.rel}:${p.line}  ${p.token} is not defined in :root`);
}

// ── Undefined class names ──────────────────────────────────────────────────
// Same failure mode as the tokens: a className with no matching rule renders
// unstyled and silently. `.btn-secondary` sat on two visible buttons this way.
const definedClasses = new Set();
stripComments(css)
  .replace(/\{[^{}]*\}/g, "{}")
  .split(/[{}]/)
  .forEach((sel) => {
    for (const m of sel.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) definedClasses.add(m[1]);
  });

const classProblems = [];
for (const file of files.filter((f) => /\.(js|jsx)$/.test(f))) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  stripComments(readNormalized(file)).split("\n").forEach((line, i) => {
    for (const attr of line.matchAll(/className=(?:"([^"]*)"|\{([^}]*)\})/g)) {
      // Only literal strings. Inside an expression, read the quoted segments,
      // after dropping comparison operands (`view === "game"`) and lookup keys
      // (`ROLE_CLASS[u.role ?? "user"]`) — those are data, not class names.
      const expr = (attr[2] || "")
        .replace(/[=!]==?\s*["'`][^"'`]*["'`]/g, "")
        .replace(/\[[^\]]*\]/g, "");
      const literals = attr[1] !== undefined
        ? [attr[1]]
        : [...expr.matchAll(/["'`]([^"'`]*)["'`]/g)].map((m) => m[1]);
      for (const chunk of literals) {
        for (const name of chunk.split(/\s+/).filter(Boolean)) {
          // A trailing hyphen means a template prefix like "joker-tier-" + key.
          if (name.endsWith("-") || definedClasses.has(name)) continue;
          classProblems.push({ rel, line: i + 1, name });
        }
      }
    }
  });
}
for (const p of classProblems) {
  console.error(`ERROR ${p.rel}:${p.line}  .${p.name} has no CSS rule`);
}

const total = errors.length + classProblems.length;
if (total) {
  console.error(`\nlint:tokens failed: ${errors.length} undefined token(s), ` +
                `${classProblems.length} undefined class(es).`);
  console.error("Define them in src/App.css, or add genuinely runtime-set tokens");
  console.error("to RUNTIME_TOKENS in scripts/lint-tokens.js.");
  process.exit(1);
}

console.log(
  `lint:tokens ok — ${defined.size} tokens and ${definedClasses.size} classes defined, ` +
  `${files.length} files checked, ${warns.length} warning(s).`
);
