// Recharts renders its colours as SVG presentation attributes, and those do not
// resolve var(--token). So instead of hardcoding hex in the chart JSX, read the
// custom properties off :root once. The tokens stay the single source of truth.

const read = (name, fallback) => {
  if (typeof window === "undefined" || !document?.documentElement) return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback; // jsdom and very old browsers return "" here
};

export function chartTheme() {
  return {
    grid: read("--border", "#30363d"),
    axis: read("--text-muted", "#8b949e"),
    zeroLine: read("--surface-4", "#2f3743"),
    text: read("--text", "#e6edf3"),
    surface: read("--surface-2", "#1c2128"),
  };
}

export function chartTooltipStyle(t) {
  return {
    background: t.surface,
    border: `1px solid ${t.grid}`,
    borderRadius: 8,
    fontSize: 13,
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
  };
}
