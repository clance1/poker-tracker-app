// Size is the only per-instance value, so it rides in as a custom property and
// the rest lives in App.css. The fallback disc previously used var(--accent),
// which was never defined — it rendered with no background behind the initial.
function Avatar({ src, name, size = 32 }) {
  const style = { "--avatar-size": `${size}px` };
  if (src) {
    // Decorative: the player's name is always rendered as text beside it.
    return <img className="avatar avatar-img" src={src} alt="" style={style} />;
  }
  return (
    <span className="avatar avatar-fallback" style={style} aria-hidden="true">
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

export default Avatar;
