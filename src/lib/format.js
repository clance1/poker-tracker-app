import {
  CRITERIA_METRICS, CRITERIA_OPS, CRITERIA_BASES, TIER_CONFIG,
} from "./constants";

// --- Client-side sanitization ---
export const sanitizeInput = (val, maxLen = 100) =>
  typeof val === "string" ? val.trim().slice(0, maxLen) : "";

export const isValidEmail = (val) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val.trim());

// --- Formatting & derived values ---
export const fmt = (amount) => {
  if (amount === null || amount === undefined) return "$0";
  const abs = Math.abs(amount);
  const str = Number.isInteger(abs) ? abs.toFixed(0) : abs.toFixed(2);
  return (amount < 0 ? "-$" : "$") + str;
};
export const fmtDate = (dateStr) => {
  if (!dateStr) return "";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
};
export const todayISO = () => new Date().toISOString().split("T")[0];
export const calcNet = (gp) => (gp.cashOut ?? 0) - gp.buyIn - (gp.rebuys ?? 0);
export const totalPot = (gps) => gps.reduce((s, gp) => s + gp.buyIn + (gp.rebuys ?? 0), 0);

export const fmtDateShort = (dateStr) => {
  if (!dateStr) return "";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export const calcStreak = (completedGames) => {
  if (!completedGames.length) return { count: 0, type: null };
  const sorted = [...completedGames].sort((a, b) => b.game.date.localeCompare(a.game.date));
  const firstType = calcNet(sorted[0]) > 0 ? "W" : calcNet(sorted[0]) < 0 ? "L" : "E";
  let count = 0;
  for (const g of sorted) {
    const t = calcNet(g) > 0 ? "W" : calcNet(g) < 0 ? "L" : "E";
    if (t === firstType) count++;
    else break;
  }
  return { count, type: firstType };
};

export const nowTime = () => new Date().toTimeString().slice(0, 5);

export const parseSteps = (raw) => {
  if (!raw) return [];
  try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch {}
  return [];
};

export const parseHands = (raw) => {
  if (!raw) return [];
  try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch {}
  return raw.split(/->|›|\n/).map((s) => s.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
};

// Parse imageFrame JSON safely. New format: { x, y, scale } where x/y are
// fractional offsets from center (-1..1). Legacy posX/posY (0-100%) converted.
export function parseFrame(raw) {
  const def = { x: 0, y: 0, scale: 1 };
  if (!raw) return def;
  try {
    const p = JSON.parse(raw);
    if ('posX' in p || 'posY' in p) {
      // Migrate old slider format
      return { x: ((p.posX ?? 50) - 50) / 100, y: ((p.posY ?? 50) - 50) / 100, scale: p.scale ?? 1 };
    }
    return { ...def, ...p };
  } catch { return def; }
}

export function getTier(timesEarned) {
  if (!timesEarned || timesEarned < 2) return null;
  return TIER_CONFIG.find(t => timesEarned >= t.min) ?? null;
}

// Human-readable summary of one condition
export function conditionLabel(cond) {
  const left = CRITERIA_METRICS.find(m => m.value === cond.left)?.label ?? cond.left;
  const op = CRITERIA_OPS.find(o => o.value === cond.op)?.label ?? cond.op;
  let right = '';
  if (cond.rightType === 'number') right = String(cond.rightValue ?? 0);
  else if (cond.rightType === 'metric') right = CRITERIA_METRICS.find(m => m.value === cond.rightMetric)?.label ?? cond.rightMetric;
  else if (cond.rightType === 'multiplier') {
    const base = CRITERIA_BASES.find(b => b.value === cond.rightBase)?.label ?? cond.rightBase;
    right = `${cond.rightMultiplier ?? 1}× ${base}`;
  }
  return `${left} ${op} ${right}`;
}
