import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ROLE_CLASS, ROLE_LABEL } from "../lib/constants";
import { computePlayerStats, fmt } from "../lib/format";
import Avatar from "./Avatar";
import { EnvelopeSimple, Lightning } from "./icons";

const OPEN_DELAY_MS = 350; // debounce so a fast mouse-pass doesn't flash the card
const CLOSE_DELAY_MS = 100; // lets the cursor cross the gap onto the card itself

// Wraps a trigger (an avatar, a name, or both) and shows a floating summary
// card on hover/focus (tap on touch devices). Portaled to document.body and
// positioned via getBoundingClientRect() rather than CSS position:absolute,
// because several tables in this app (e.g. the mobile players-table) use
// overflow-x:auto with a position:sticky player cell -- an absolutely
// positioned child there would get clipped or fight the sticky cell's own
// stacking context. A portal sidesteps that entirely.
//
// `player` is nullable on purpose: callers resolve a full player record from
// already-loaded data (the `players`/`allPlayers` arrays already threaded
// through this app), and when that lookup fails this renders `children`
// inertly rather than crashing or showing a broken card.
//
// The trigger renders as a real (inline-flex) box rather than `display:
// contents`, since mouseenter/mouseleave hit-testing on a `contents` element
// is inconsistent across browsers. That means it takes a spot in whatever
// flex layout it's dropped into -- `className` lets each call site match its
// surrounding container (e.g. "hover-card-trigger--column" for a stacked
// avatar-over-name layout, "hover-card-trigger--grow" where the original
// element it's replacing had `flex: 1`).
function PlayerHoverCard({ player, children, className = "" }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);
  const cardRef = useRef(null);
  const openTimer = useRef(null);
  const closeTimer = useRef(null);

  const isTouch = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches,
    []
  );

  const clearTimers = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  };

  const scheduleOpen = () => {
    clearTimeout(closeTimer.current);
    openTimer.current = setTimeout(() => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      setCoords({ top: r.bottom + 6, left: r.left });
      setOpen(true);
    }, OPEN_DELAY_MS);
  };

  const scheduleClose = () => {
    clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  const close = () => { clearTimers(); setOpen(false); };

  useEffect(() => clearTimers, []);

  // Dismiss on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") { clearTimers(); setOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Nudge back on-screen if the card would overflow the viewport.
  useLayoutEffect(() => {
    if (!open || !cardRef.current || !coords) return;
    const r = cardRef.current.getBoundingClientRect();
    let { top, left } = coords;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - r.width - 8);
    if (top + r.height > window.innerHeight - 8) {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      top = triggerRect ? triggerRect.top - r.height - 6 : top;
    }
    if (left !== coords.left || top !== coords.top) setCoords({ top, left });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!player) return children;

  const stats = player.games ? computePlayerStats(player) : null;

  return (
    <>
      <span
        ref={triggerRef}
        className={"hover-card-trigger " + className}
        tabIndex={0}
        onMouseEnter={!isTouch ? scheduleOpen : undefined}
        onMouseLeave={!isTouch ? scheduleClose : undefined}
        onFocus={scheduleOpen}
        onBlur={scheduleClose}
        onClick={isTouch ? () => (open ? close() : scheduleOpen()) : undefined}
      >
        {children}
      </span>
      {open && coords && createPortal(
        <>
          {isTouch && <div className="hover-card-backdrop" onClick={close} />}
          <div
            ref={cardRef}
            className="player-hover-card"
            style={{ top: coords.top, left: coords.left }}
            onMouseEnter={() => clearTimeout(closeTimer.current)}
            onMouseLeave={!isTouch ? scheduleClose : undefined}
          >
            <div className="hover-card-header">
              <Avatar src={player.avatarPath} name={player.name} size={48} />
              <div className="hover-card-id">
                <div className="hover-card-name">{player.name}</div>
                {player.role && (
                  <span className={"role-badge " + ROLE_CLASS[player.role]}>{ROLE_LABEL[player.role]}</span>
                )}
              </div>
            </div>
            {stats && (
              <div className="hover-card-stats">
                <span>{stats.gamesPlayed} game{stats.gamesPlayed === 1 ? "" : "s"}</span>
                <span>{stats.wins}-{stats.losses} ({Math.round(stats.winRate * 100)}%)</span>
                <span className={stats.net >= 0 ? "profit" : "loss"}>
                  {stats.net >= 0 ? "+" : ""}{fmt(stats.net)}
                </span>
                <span><Lightning weight="fill" /> {stats.xp.toLocaleString()} XP</span>
              </div>
            )}
            {player.email && (
              <div className="hover-card-email"><EnvelopeSimple /> {player.email}</div>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

export default PlayerHoverCard;
