import { parseFrame } from "../../lib/format";

// --- Achievement image renderer (handles SVG markup and URL images with frame) ---
function AchievementImage({ src, imageFrame, className = "" }) {
  if (!src) return null;
  const isSvg = src.trimStart().startsWith('<svg') || src.trimStart().startsWith('<SVG');
  if (isSvg) {
    return <div className={"joker-svg-art " + className} dangerouslySetInnerHTML={{ __html: src }} />;
  }
  const f = parseFrame(imageFrame);
  return (
    <div className={"joker-img-wrap " + className}>
      <img
        src={src}
        alt="achievement art"
        draggable={false}
        style={{
          position: "absolute",
          top: `calc(50% + ${f.y * 100}%)`,
          left: `calc(50% + ${f.x * 100}%)`,
          transform: `translate(-50%, -50%) scale(${f.scale})`,
          width: "auto",
          height: "auto",
          minWidth: "100%",
          minHeight: "100%",
          maxWidth: "none",
          objectFit: "none",
          userSelect: "none",
        }}
      />
    </div>
  );
}

export default AchievementImage;
