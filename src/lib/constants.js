// Shared literal tables. No behaviour, no imports.

export const ROLE_LABEL = { admin: "Admin", owner: "Owner", user: "User" };
export const ROLE_CLASS = { admin: "badge-admin", owner: "badge-owner", user: "badge-user" };

export const PLAYER_COLORS = ["#d4af37","#3fb950","#58a6ff","#f85149","#a855f7","#f97316","#06b6d4","#ec4899"];

export const REBUY_PRESETS = [20, 50, 100];
export const REBUY_DEFAULT = 50;

export const CARD_RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
export const CARD_SUITS = [
  { value: '♠', label: '♠ Spades' },
  { value: '♥', label: '♥ Hearts' },
  { value: '♦', label: '♦ Diamonds' },
  { value: '♣', label: '♣ Clubs' },
];
export const RED_SUITS = new Set(['♥', '♦']);

// Repeat-earn tiers. `key` drives both the icon choice and the card's glow
// class (.joker-tier-<key>) — the badge glyph used to live here as an emoji.
export const TIER_CONFIG = [
  { min: 5, key: "diamond" },
  { min: 4, key: "gold" },
  { min: 3, key: "silver" },
  { min: 2, key: "bronze" },
];

export const CRITERIA_METRICS = [
  { value: 'total_invested',  label: 'Buy-In + Rebuys' },
  { value: 'cash_out',        label: 'Cash Out' },
  { value: 'net_profit',      label: 'Net Profit ($)' },
  { value: 'buy_in',          label: 'Initial Buy-In' },
  { value: 'rebuy_amount',    label: 'Rebuys Total ($)' },
  { value: 'net_profit_rank', label: 'Profit Rank (1 = winner)' },
];

export const CRITERIA_OPS = [
  { value: '>=', label: '≥' },
  { value: '>',  label: '>' },
  { value: '<=', label: '≤' },
  { value: '<',  label: '<' },
  { value: '=',  label: '=' },
  { value: '!=', label: '≠' },
];

export const CRITERIA_BASES = [
  { value: 'own_total_invested', label: "player's Total Invested" },
  { value: 'own_buy_in',         label: "player's Initial Buy-In" },
  { value: 'game_min_buy_in',    label: 'Min Buy-In in game' },
  { value: 'game_max_buy_in',    label: 'Max Buy-In in game' },
  { value: 'game_avg_buy_in',    label: 'Avg Buy-In in game' },
  { value: 'game_pot',           label: 'Total Pot' },
];

export const DEFAULT_CONDITION = {
  left: 'cash_out', op: '>=', rightType: 'number', rightValue: 0,
  rightMetric: 'total_invested', rightMultiplier: 2, rightBase: 'own_total_invested',
};

// Accent palette for generated achievement art (was duplicated inline twice).
export const SUIT_COLORS = ["#d4af37", "#a855f7", "#3fb950", "#58a6ff", "#f97316"];

export const TABS = [
  { id: "leaderboard",  label: "Leaderboard" },
  { id: "games",        label: "Games" },
  { id: "players",      label: "Players" },
  { id: "rules",        label: "Rules" },
  { id: "achievements", label: "Achievements" },
  { id: "stats",        label: "Stats" },
];
