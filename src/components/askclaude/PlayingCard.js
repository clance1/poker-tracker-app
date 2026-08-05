import { RED_SUITS } from "../../lib/constants";

function PlayingCard({ rank, suit, size = "md", faceDown = false, selected = false }) {
  const isRed = RED_SUITS.has(suit);
  const sizeClass = size === "sm" ? " playing-card-sm" : size === "lg" ? " playing-card-lg" : "";
  const suitSymbol = { "♠": "♠", "♥": "♥", "♦": "♦", "♣": "♣" }[suit] || "";
  if (faceDown) {
    return <div className={"playing-card playing-card-back" + sizeClass} />;
  }
  if (!rank || !suit) {
    return <div className={"playing-card playing-card-empty" + sizeClass} />;
  }
  return (
    <div className={"playing-card" + (isRed ? " card-red" : " card-black") + sizeClass + (selected ? " card-selected" : "")}>
      <div className="card-corner card-corner-tl">
        <span className="card-rank">{rank}</span>
        <span className="card-suit-corner">{suitSymbol}</span>
      </div>
      <div className="card-center-suit">{suitSymbol}</div>
      <div className="card-corner card-corner-br">
        <span className="card-rank">{rank}</span>
        <span className="card-suit-corner">{suitSymbol}</span>
      </div>
    </div>
  );
}

export default PlayingCard;
