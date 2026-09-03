// Shape-matched loading placeholders. These stand in for the real layout while
// a chunk or a fetch is in flight, so the page does not jump when content lands.

export function SkeletonLine({ width = "100%", height = 14 }) {
  return <span className="skeleton skeleton-line" style={{ width, height }} />;
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <span className="skeleton skeleton-avatar" />
      <div className="skeleton-card-body">
        <SkeletonLine width="45%" />
        <SkeletonLine width="80%" height={10} />
      </div>
      <SkeletonLine width="64px" />
    </div>
  );
}

// Default fallback for a lazily loaded tab.
export default function SkeletonTab({ rows = 4 }) {
  return (
    <div className="skeleton-tab" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}
