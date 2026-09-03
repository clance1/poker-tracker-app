import { parseFrame } from "../../lib/format";

// Achievement art. Handles inline SVG markup and uploaded raster images.
//
// Raster art is sized to the container (object-fit: cover) and framed with
// object-position plus a scale transform. Both are relative units, so the crop
// is identical at every size this renders at: the 320px framing tool, the 148px
// preview beside it, the ~170px grid card, and the ~288px single-column card on
// a narrow phone.
//
// The previous version sized the image in intrinsic pixels (width:auto plus
// min-width:100%) while offsetting it by percentages of the container, so the
// two never scaled together and each surface showed a different crop.
function AchievementImage({ src, imageFrame, className = "" }) {
  if (!src) return null;

  const isSvg = src.trimStart().toLowerCase().startsWith("<svg");
  if (isSvg) {
    return <div className={"joker-svg-art " + className} dangerouslySetInnerHTML={{ __html: src }} />;
  }

  const f = parseFrame(imageFrame);
  return (
    <div className={"joker-img-wrap " + className}>
      <img
        className="joker-img"
        src={src}
        alt=""
        draggable={false}
        loading="lazy"
        style={{
          objectPosition: `${f.px}% ${f.py}%`,
          transform: `scale(${f.scale})`,
        }}
      />
    </div>
  );
}

export default AchievementImage;
