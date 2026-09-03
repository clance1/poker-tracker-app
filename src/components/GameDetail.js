import React, { useState, useEffect } from "react";
import { apiFetch, getStoredUsername } from "../lib/api";
import { REBUY_DEFAULT, REBUY_PRESETS } from "../lib/constants";
import { buildVenmoLink, fmt, fmtDate, nowTime, sanitizeInput, totalPot } from "../lib/format";
import Avatar from "./Avatar";
import PlayerHoverCard from "./PlayerHoverCard";
import { ArrowLeft, Check, Clock, CurrencyDollar, FlagCheckered, MapPin, Play, Plus, User, X } from "./icons";

// Pay/Request-via-Venmo affordance for a player who has cashed out, plus a
// manual "Mark Settled" toggle (Venmo isn't required to record a settlement --
// cash and other apps count too). Shared between the joker card and the
// players table so the two views never drift.
function VenmoAction({ gp, net, gameDate, onToggleSettled }) {
  if (net === null || Math.abs(net) < 0.01) return null; // nothing owed either direction

  if (gp.venmoSettledAt) {
    return (
      <button type="button" className="venmo-btn venmo-settled"
        onClick={() => onToggleSettled(gp, false)} title="Marked settled — click to undo">
        <Check /> Settled
      </button>
    );
  }

  const link = buildVenmoLink(gp.player?.venmoHandle, net, `Poker ${fmtDate(gameDate)}`);
  return (
    <span className="venmo-action">
      {link ? (
        <a className={"venmo-btn " + (net > 0 ? "venmo-btn-pay" : "venmo-btn-request")}
          href={link} target="_blank" rel="noopener noreferrer"
          title={(net > 0 ? "Pay " : "Request ") + fmt(Math.abs(net)) + " via Venmo"}>
          <CurrencyDollar /> {net > 0 ? "Pay" : "Request"} {fmt(Math.abs(net))}
        </a>
      ) : (
        <span className="venmo-btn venmo-btn-disabled" title={`${gp.player?.name ?? "Player"} hasn't added a Venmo handle`}>
          <CurrencyDollar /> No Venmo
        </span>
      )}
      <button type="button" className="venmo-settle-toggle" onClick={() => onToggleSettled(gp, true)}>
        Mark Settled
      </button>
    </span>
  );
}

// --- Game Detail ---
function GameDetail({ game, onBack, onRefresh, isOwner, isAdmin, allPlayers }) {
  const [gamePlayers, setGamePlayers] = useState(game.players?.items ?? []);
  const [cashOuts, setCashOuts] = useState({});
  const [saving, setSaving] = useState(false);
  const [endError, setEndError] = useState("");
  const [notes, setNotes] = useState(game.notes ?? "");
  const [rebuyOpen, setRebuyOpen] = useState(null);
  const [rebuyCustom, setRebuyCustom] = useState("");
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [addPlayerID, setAddPlayerID] = useState("");
  const [addBuyIn, setAddBuyIn] = useState("20");
  const [addError, setAddError] = useState("");
  const [cashOutSaving, setCashOutSaving] = useState({});
  const [timerStarted, setTimerStarted] = useState(!!game.timerStarted);
  const [timerSaving, setTimerSaving] = useState(false);
  const [timerError, setTimerError] = useState("");

  useEffect(() => {
    const initial = {};
    (game.players?.items ?? []).forEach((gp) => {
      if (gp.cashOut !== null && gp.cashOut !== undefined) initial[gp.id] = gp.cashOut.toString();
    });
    setCashOuts(initial);
    setGamePlayers(game.players?.items ?? []);
    setNotes(game.notes ?? "");
    setTimerStarted(!!game.timerStarted);
  }, [game]);

  const pot = totalPot(gamePlayers);
  // For an active game, money paid out on cash-out is no longer "in the pot" --
  // it's been taken off the table. Completed games keep the full pot since
  // every cash-out has already been reconciled against it.
  const cashedOutSoFar = gamePlayers.reduce((s, gp) => s + (gp.cashOut ?? 0), 0);
  const displayPot = game.isComplete ? pot : pot - cashedOutSoFar;

  const openRebuy = (gpId) => { setRebuyOpen(gpId); setRebuyCustom(""); };
  const closeRebuy = () => setRebuyOpen(null);

  const confirmRebuy = async (gp, amount) => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return;
    closeRebuy();
    setSaving(true);
    try {
      const newRebuys = (gp.rebuys ?? 0) + amt;
      await apiFetch("/api/game-players/" + gp.id, { method: "PUT", body: { rebuys: newRebuys } });
      setGamePlayers((prev) => prev.map((p) => p.id === gp.id ? { ...p, rebuys: newRebuys } : p));
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const cashOutTotal = gamePlayers.reduce((s, gp) => {
    const co = parseFloat(cashOuts[gp.id] ?? 0);
    return s + (isNaN(co) ? 0 : co);
  }, 0);
  const potDiff = cashOutTotal - pot;

  const handleEndGame = async () => {
    setEndError("");
    if (Math.abs(potDiff) > 0.01) return setEndError("Cash-outs (" + fmt(cashOutTotal) + ") must equal the pot (" + fmt(pot) + ").");
    setSaving(true);
    try {
      await Promise.all(gamePlayers.map((gp) =>
        apiFetch("/api/game-players/" + gp.id, { method: "PUT", body: { cashOut: parseFloat(cashOuts[gp.id] ?? 0) } })
      ));
      await apiFetch("/api/games/" + game.id, { method: "PUT", body: { isComplete: true, notes: sanitizeInput(notes, 1000), endTime: nowTime() } });
      await onRefresh();
    } catch (e) { setEndError("Save failed."); console.error(e); setSaving(false); }
  };

  const handleAddPlayer = async () => {
    setAddError("");
    if (!addPlayerID) return setAddError("Select a player.");
    const buyIn = parseFloat(addBuyIn);
    if (isNaN(buyIn) || buyIn <= 0) return setAddError("Buy-in must be > $0.");
    setSaving(true);
    try {
      const gp = await apiFetch("/api/game-players", {
        method: "POST",
        body: { gameID: game.id, playerID: addPlayerID, buyIn, rebuys: 0 },
      });
      const player = allPlayers.find((p) => p.id === addPlayerID);
      setGamePlayers((prev) => [...prev, { ...gp, timeIn: gp.timeIn ?? null, timeOut: null, venmoSettledAt: null, player: { id: addPlayerID, name: player?.name ?? "", avatarPath: player?.avatarPath ?? null, venmoHandle: player?.venmoHandle ?? null } }]);
      setAddPlayerID(""); setAddBuyIn("20"); setAddPlayerOpen(false);
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setAddError(msg);
    }
    setSaving(false);
  };

  // Owner/admin-only: stamps timeIn (now) on every player who was pre-selected
  // at game creation and is still waiting on one -- i.e. everyone who hasn't
  // bought in mid-game since. Anyone added after this point gets their own
  // timeIn immediately (see handleAddPlayer / the server side of buy-ins).
  const handleStartTimer = async () => {
    setTimerError("");
    setTimerSaving(true);
    try {
      const { timeIn } = await apiFetch("/api/games/" + game.id + "/start-timer", { method: "POST" });
      setTimerStarted(true);
      setGamePlayers((prev) => prev.map((p) => (p.timeIn ? p : { ...p, timeIn })));
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      setTimerError(msg);
    }
    setTimerSaving(false);
  };

  // Save a cash-out as soon as it's entered, so a player who leaves mid-game is
  // logged as Cashed Out straight away instead of waiting for End Game. Blank
  // clears it again, which undoes a mis-entry. Owner/admin only, enforced
  // server-side as well.
  const persistCashOut = async (gp, raw) => {
    const trimmed = (raw ?? "").trim();
    const value = trimmed === "" ? null : parseFloat(trimmed);
    if (value !== null && (isNaN(value) || value < 0)) return;

    const saved = gp.cashOut ?? null;
    if (value === saved) return; // nothing changed, skip the round-trip

    setCashOutSaving((prev) => ({ ...prev, [gp.id]: true }));
    try {
      const res = await apiFetch("/api/game-players/" + gp.id, { method: "PUT", body: { cashOut: value } });
      setGamePlayers((prev) => prev.map((p) => (p.id === gp.id ? { ...p, cashOut: value, timeOut: res.timeOut ?? null } : p)));
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      alert(msg);
      // Put the field back to the last value the server accepted
      setCashOuts((prev) => ({ ...prev, [gp.id]: saved === null ? "" : String(saved) }));
    }
    setCashOutSaving((prev) => ({ ...prev, [gp.id]: false }));
  };

  const toggleVenmoSettled = async (gp, next) => {
    try {
      const res = await apiFetch("/api/game-players/" + gp.id, { method: "PUT", body: { venmoSettled: next } });
      setGamePlayers((prev) => prev.map((p) => (p.id === gp.id ? { ...p, venmoSettledAt: res.venmoSettledAt } : p)));
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      alert(msg);
    }
  };

  const handleRemovePlayer = async (gp) => {
    const name = gp.player?.name ?? "this player";
    if (!window.confirm(`Remove ${name} from this game?`)) return;
    try {
      await apiFetch(`/api/game-players/${gp.id}`, { method: "DELETE" });
      setGamePlayers((prev) => prev.filter((p) => p.id !== gp.id));
    } catch (e) {
      let msg = e.message;
      try { msg = JSON.parse(e.message).error || msg; } catch {}
      alert(msg);
    }
  };

  const availablePlayers = (allPlayers ?? []).filter(
    (p) => !gamePlayers.some((gp) => gp.player?.id === p.id)
  );

  const currentUsername = getStoredUsername();
  // The specific person assigned as this game's owner can cash players out
  // even without the global "owner" role -- the server already allows this
  // (isGameOwner in PUT /api/game-players/:id); the UI just needs to match.
  const isThisGameOwner = !!(game.owner?.username && currentUsername
    && game.owner.username.toLowerCase() === currentUsername.toLowerCase());
  const canManageCashOuts = isOwner || isAdmin || isThisGameOwner;

  return (
    <div className="game-detail">
      <button className="back-btn" onClick={onBack}><ArrowLeft /> Back</button>
      <div className="detail-header">
        <h2>{fmtDate(game.date)}</h2>
        <span className={"game-status " + (game.isComplete ? "" : "badge-active")}>{game.isComplete ? "Completed" : "In Progress"}</span>
      </div>

      {/* Game metadata strip */}
      {(game.owner || game.location || game.startTime || game.endTime) && (
        <div className="game-meta">
          {game.owner && (
            <span className="game-meta-item">
              <User className="game-meta-icon" />
              {game.owner.firstName ? `${game.owner.firstName} ${game.owner.lastName ?? ""}`.trim() : game.owner.username}
            </span>
          )}
          {game.location && (
            <span className="game-meta-item">
              <MapPin className="game-meta-icon" />{game.location}
            </span>
          )}
          {game.startTime && (
            <span className="game-meta-item">
              <Clock className="game-meta-icon" />Start: {game.startTime}
            </span>
          )}
          {game.endTime && (
            <span className="game-meta-item">
              <FlagCheckered className="game-meta-icon" />End: {game.endTime}
            </span>
          )}
        </div>
      )}

      {/* Start Timer -- owner/admin only, begins the buy-in clock for anyone
          pre-selected at game creation who hasn't bought in mid-game since */}
      {(isOwner || isAdmin) && !game.isComplete && !timerStarted && (
        <div className="start-timer-banner">
          <span className="start-timer-text">Timer hasn't started — Time In won't be recorded for pre-selected players until you start it.</span>
          <button className="btn btn-primary btn-sm" onClick={handleStartTimer} disabled={timerSaving}>
            <Play weight="fill" /> {timerSaving ? "Starting..." : "Start Timer"}
          </button>
        </div>
      )}
      {timerError && <p className="error-msg">{timerError}</p>}

      {/* Balatro-style player cards */}
      <div className="player-cards-strip">
        {gamePlayers.map((gp) => {
          const totalIn = gp.buyIn + (gp.rebuys ?? 0);
          // Server truth, same as the table row -- gates the Venmo action on an
          // actually-recorded cash-out rather than an unsaved typed draft.
          const savedCashOut = gp.cashOut ?? null;
          const hasCashedOut = savedCashOut !== null;
          const savedNet = hasCashedOut ? savedCashOut - totalIn : null;
          const co = game.isComplete
            ? (gp.cashOut ?? 0)
            : (parseFloat(cashOuts[gp.id] ?? "") || null);
          const net = co !== null ? co - totalIn : null;
          const isMe = gp.player?.name?.toLowerCase() === currentUsername?.toLowerCase();
          return (
            <div key={gp.id} className={"player-joker-card" + (isMe ? " player-joker-card-me" : "") + (net !== null && net > 0 ? " joker-winner" : net !== null && net < 0 ? " joker-loser" : "")}>
              <div className="joker-card-inner">
                <PlayerHoverCard player={allPlayers.find((p) => p.id === gp.player?.id)} className="hover-card-trigger--column">
                  <div className="joker-avatar-wrap">
                    <Avatar src={gp.player?.avatarPath} name={gp.player?.name} size={38} />
                  </div>
                  <div className="joker-player-name">{gp.player?.name ?? "?"}</div>
                </PlayerHoverCard>
                <div className="joker-buy-in">
                  <span className="joker-stat-label">In</span>
                  <span className="joker-stat-val">{fmt(totalIn)}</span>
                </div>
                {(game.isComplete || hasCashedOut) && net !== null ? (
                  <div className={"joker-result " + (net >= 0 ? "joker-profit" : "joker-loss")}>
                    <div className="joker-cashout">{fmt(co)}</div>
                    <div className="joker-net">{net >= 0 ? "+" : ""}{fmt(net)}</div>
                    {canManageCashOuts && !isMe && (
                      <VenmoAction gp={gp} net={savedNet} gameDate={game.date} onToggleSettled={toggleVenmoSettled} />
                    )}
                  </div>
                ) : !game.isComplete && (
                  gp.timeIn
                    ? <div className="joker-live-badge"><Play weight="fill" size={9} /> Live</div>
                    : <div className="joker-live-badge joker-timer-pending">Timer not started</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Total Pot + User Contribution */}
      <div className="pot-contribution-row">
        <div className="pot-summary">
          <div className="pot-label">Total Pot</div>
          <div className="pot-amount">{fmt(displayPot)}</div>
        </div>
        {(() => {
          const myGp = gamePlayers.find(gp => gp.player?.name?.toLowerCase() === currentUsername?.toLowerCase());
          if (!myGp) return null;
          const myIn = myGp.buyIn + (myGp.rebuys ?? 0);
          const pct = pot > 0 ? Math.round((myIn / pot) * 100) : 0;
          return (
            <div className="my-contribution">
              <div className="pot-label">Your Contribution</div>
              <div className="pot-amount">{fmt(myIn)} <span className="contribution-pct">({pct}%)</span></div>
            </div>
          );
        })()}
      </div>
      <div className={"players-table mt-md" + ((isOwner || isAdmin) && !game.isComplete ? " players-table--with-actions" : "")}>
        <div className="table-head"><span>Player</span><span>Time In</span><span>Buy-In</span><span>Rebuys</span><span>Total In</span><span>Cash Out</span><span>Time Out</span><span>Net</span>{(isOwner || isAdmin) && !game.isComplete && <span></span>}</div>
        {gamePlayers.map((gp) => {
          const totalIn = gp.buyIn + (gp.rebuys ?? 0);
          // Server truth -- drives the Cashed Out badge. Busting out for $0 is
          // still a cash-out, so test against null rather than falsiness.
          const savedCashOut = gp.cashOut ?? null;
          const hasCashedOut = savedCashOut !== null;
          const savedNet = hasCashedOut ? savedCashOut - totalIn : null;
          // Live input value -- drives the Net column while it's being typed.
          const typed = String(cashOuts[gp.id] ?? "").trim();
          const co = game.isComplete ? gp.cashOut ?? 0 : (typed === "" ? null : parseFloat(typed));
          const net = co !== null && !isNaN(co) ? co - totalIn : null;
          const isRebuyOpen = rebuyOpen === gp.id;
          const isMe = gp.player?.name?.toLowerCase() === currentUsername?.toLowerCase();
          return (
            <React.Fragment key={gp.id}>
              <div className="table-row">
                <span className="player-cell">
                  <PlayerHoverCard player={allPlayers.find((p) => p.id === gp.player?.id)}>
                    <Avatar src={gp.player?.avatarPath} name={gp.player?.name} size={24} />
                    {gp.player?.name ?? "?"}
                  </PlayerHoverCard>
                  {hasCashedOut && (
                    <>
                      <span className="cashed-out-badge">Cashed Out</span>
                      <span className={savedNet > 0 ? "net-positive" : savedNet < 0 ? "net-negative" : "net-zero"}>
                        {savedNet >= 0 ? "+" : ""}{fmt(savedNet)}
                      </span>
                      {canManageCashOuts && !isMe && (
                        <VenmoAction gp={gp} net={savedNet} gameDate={game.date} onToggleSettled={toggleVenmoSettled} />
                      )}
                    </>
                  )}
                </span>
                <span className="muted">{gp.timeIn ?? "--"}</span>
                <span>{fmt(gp.buyIn)}</span>
                <span className="rebuy-cell">
                  <span className="rebuy-amount">{fmt(gp.rebuys ?? 0)}</span>
                  {!game.isComplete && (
                    <button
                      className={"rebuy-btn" + (isRebuyOpen ? " active" : "")}
                      onClick={() => isRebuyOpen ? closeRebuy() : openRebuy(gp.id)}
                      disabled={saving}
                      title={isRebuyOpen ? "Cancel rebuy" : "Add rebuy"}
                      aria-label={isRebuyOpen ? "Cancel rebuy" : `Add rebuy for ${gp.player?.name ?? "player"}`}
                    >
                      {isRebuyOpen ? <X /> : <Plus />}
                    </button>
                  )}
                </span>
                <span>{fmt(totalIn)}</span>
                <span>
                  {game.isComplete ? fmt(gp.cashOut ?? 0) : (
                    canManageCashOuts
                      ? <input type="number" className="input cashout-input" placeholder="$0"
                          value={cashOuts[gp.id] ?? ""} min="0"
                          disabled={!!cashOutSaving[gp.id]}
                          title="Saved as soon as you leave this field"
                          onChange={(e) => setCashOuts((prev) => ({ ...prev, [gp.id]: e.target.value }))}
                          onBlur={(e) => persistCashOut(gp, e.target.value)} />
                      : <span className="muted">--</span>
                  )}
                </span>
                <span className="muted">{gp.timeOut ?? "--"}</span>
                <span className={net !== null ? (net >= 0 ? "profit" : "loss") : "muted"}>
                  {net !== null ? (net >= 0 ? "+" : "") + fmt(net) : "--"}
                </span>
                {(isOwner || isAdmin) && !game.isComplete && (
                  <button
                    className="btn-icon delete-btn remove-player-btn"
                    title={`Remove ${gp.player?.name ?? "player"} from game`}
                    onClick={() => handleRemovePlayer(gp)}
                    disabled={saving}
                    aria-label={`Remove ${gp.player?.name ?? "player"} from game`}
                  ><X /></button>
                )}
              </div>
              {isRebuyOpen && (
                <div className="rebuy-drawer">
                  <span className="rebuy-drawer-label">Rebuy for <strong>{gp.player?.name}</strong></span>
                  <div className="rebuy-presets">
                    {REBUY_PRESETS.map((amt) => (
                      <button key={amt} className={"rebuy-preset-btn" + (amt === REBUY_DEFAULT ? " rebuy-preset-default" : "")} onClick={() => confirmRebuy(gp, amt)}>+${amt}</button>
                    ))}
                  </div>
                  <div className="rebuy-custom-row">
                    <span className="rebuy-custom-label">Custom</span>
                    <div className="rebuy-custom-input-group">
                      <span className="input-prefix">$</span>
                      <input type="number" className="input rebuy-custom-input" placeholder="0" min="1"
                        value={rebuyCustom} onChange={(e) => setRebuyCustom(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") confirmRebuy(gp, rebuyCustom); if (e.key === "Escape") closeRebuy(); }}
                        autoFocus />
                      <button className="btn btn-primary btn-sm" onClick={() => confirmRebuy(gp, rebuyCustom)} disabled={!rebuyCustom}>Add</button>
                    </div>
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Add player to active game */}
      {!game.isComplete && availablePlayers.length > 0 && (
        <div className="add-to-game-section">
          {!addPlayerOpen ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setAddPlayerOpen(true)}>+ Add Player to Game</button>
          ) : (
            <div className="add-to-game-form">
              <span className="field-label">Add Player</span>
              <select className="input" value={addPlayerID} onChange={(e) => setAddPlayerID(e.target.value)}>
                <option value="">Select player...</option>
                {availablePlayers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="row-sm-center">
                <span className="input-prefix">$</span>
                <input type="number" className="input input-w-sm" placeholder="Buy-in" value={addBuyIn} min="1"
                  onChange={(e) => setAddBuyIn(e.target.value)} />
                <button className="btn btn-primary btn-sm" onClick={handleAddPlayer} disabled={saving}>Add</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setAddPlayerOpen(false); setAddError(""); }}>Cancel</button>
              </div>
              {addError && <p className="error-msg">{addError}</p>}
            </div>
          )}
        </div>
      )}

      {!game.isComplete && (
        <div className="end-game-section">
          <div className={"pot-diff " + (Math.abs(potDiff) < 0.01 ? "balanced" : "unbalanced")}>
            {Math.abs(potDiff) < 0.01
              ? <><Check weight="bold" /> Pot balanced</>
              : (potDiff > 0 ? "Over" : "Under") + " by " + fmt(Math.abs(potDiff))}
          </div>
          {isOwner && (
            <>
              <label className="field-label">Notes (optional)</label>
              <textarea className="input notes-input" placeholder="Any notes about this game..."
                value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
              {endError && <p className="error-msg">{endError}</p>}
              <button className="btn btn-danger end-game-btn" onClick={handleEndGame}
                disabled={saving || Math.abs(potDiff) > 0.01}>
                {saving ? "Saving..." : "End Game"}
              </button>
            </>
          )}
        </div>
      )}

      {game.isComplete && game.notes && <div className="game-notes"><strong>Notes:</strong> {game.notes}</div>}
    </div>
  );
}

export default GameDetail;
