import { CARD_RANKS, CARD_SUITS } from "../../lib/constants";
import PlayingCard from "./PlayingCard";

function CardPicker({ card, label, onChange, duplicate }) {
  return (
    <div className={"card-picker" + (duplicate ? " card-picker-dup" : "")}>
      <div className="card-picker-label">{label}</div>
      <PlayingCard rank={card.rank} suit={card.suit} size="md" />
      <div className="card-picker-selects">
        <select
          className="card-select"
          value={card.rank}
          onChange={(e) => onChange("rank", e.target.value)}
        >
          <option value="">Rank</option>
          {CARD_RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select
          className="card-select"
          value={card.suit}
          onChange={(e) => onChange("suit", e.target.value)}
        >
          <option value="">Suit</option>
          {CARD_SUITS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      {duplicate && <div className="card-dup-warn">Duplicate!</div>}
    </div>
  );
}

export default CardPicker;
