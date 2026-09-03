// API base + fetch wrapper + auth display state.
// The JWT lives in an httpOnly cookie; only non-sensitive display state
// (username, role, avatar) is mirrored into localStorage.
const API = "";

// --- Auth helpers ---
// JWT is stored in an httpOnly cookie (not accessible to JS); only non-sensitive
// display state (username, role, avatar) is kept in localStorage.
export const getStoredUsername = () => localStorage.getItem("poker_username");
export const storeUsername = (u) => localStorage.setItem("poker_username", u);
export const clearUsername = () => localStorage.removeItem("poker_username");
export const getRole = () => localStorage.getItem("poker_role") || "user";
export const storeRole = (r) => localStorage.setItem("poker_role", r);
export const clearRole = () => localStorage.removeItem("poker_role");
export const getStoredAvatar = () => localStorage.getItem("poker_avatar") || null;
export const storeAvatar = (v) => v ? localStorage.setItem("poker_avatar", v) : localStorage.removeItem("poker_avatar");

// Role helpers
export const roleIsAdmin = (r) => r === "admin";
export const roleIsOwner = (r) => r === "admin" || r === "owner";

export async function apiFetch(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    credentials: "include",  // send the httpOnly auth_token cookie automatically
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) {
    // Session expired — clear display state and reload to login screen
    clearUsername();
    clearRole();
    storeAvatar(null);
    window.location.reload();
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
