import { useEffect, useCallback, useRef } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Minus, Plus } from "../icons";

// Interactive framing tool: drag to pan, scroll or pinch to zoom.
//
// It edits the same { px, py, scale } model the card renders, and its preview
// box carries the card's 4:5 aspect ratio, so what the admin frames here is
// exactly what ships. Panning maps one full drag across the box to the full
// 0-100 object-position range, divided by scale so a zoomed-in image pans at a
// proportionate rate rather than flying across.
const PAN_STEP = 6;     // percentage points per arrow press
const ZOOM_STEP = 1.15;
const MIN_SCALE = 1;    // below 1 the image would no longer cover the frame
const MAX_SCALE = 4;

const clampPct = (n) => Math.min(100, Math.max(0, n));
const clampScale = (n) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));

function ImageFramer({ src, frame, onChange }) {
  const ref = useRef(null);
  // Keep latest frame + onChange in refs so event listeners don't go stale
  const frameRef = useRef(frame);
  const onChangeRef = useRef(onChange);
  useEffect(() => { frameRef.current = frame; }, [frame]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const gestureRef = useRef(null);

  const pinchDist = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const pinchMid = (touches) => ({
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  });
  const containerSize = () => ref.current
    ? { w: ref.current.offsetWidth, h: ref.current.offsetHeight }
    : { w: 320, h: 400 };

  // Dragging right reveals more of the image's left side, so the crop anchor
  // moves toward 0. Hence the subtraction.
  const panBy = (start, dxPx, dyPx) => {
    const { w, h } = containerSize();
    const s = frameRef.current.scale || 1;
    return {
      ...frameRef.current,
      px: clampPct(start.px - (dxPx / w) * 100 / s),
      py: clampPct(start.py - (dyPx / h) * 100 / s),
    };
  };

  // ── Mouse drag ───────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    const f = frameRef.current;
    gestureRef.current = { type: "drag", sx: e.clientX, sy: e.clientY, px: f.px, py: f.py };

    const onMove = (me) => {
      const g = gestureRef.current;
      if (!g) return;
      onChangeRef.current(panBy(g, me.clientX - g.sx, me.clientY - g.sy));
    };
    const onUp = () => {
      gestureRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- reads only stable refs

  // ── Scroll-wheel zoom ────────────────────────────────────────────────────
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const f = frameRef.current;
      const factor = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
      onChangeRef.current({ ...f, scale: clampScale(f.scale * factor) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Touch: pan (1 finger) + pinch zoom (2 fingers) ─────────────────────
  // Must use addEventListener with { passive: false } so preventDefault()
  // actually blocks page scroll — React JSX touch handlers are passive.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onTouchStart = (e) => {
      e.preventDefault();
      const t = e.touches;
      const f = frameRef.current;
      if (t.length === 1) {
        gestureRef.current = { type: "drag", sx: t[0].clientX, sy: t[0].clientY, px: f.px, py: f.py };
      } else if (t.length === 2) {
        gestureRef.current = {
          type: "pinch",
          startDist: pinchDist(t),
          startScale: f.scale,
          startMid: pinchMid(t),
          px: f.px, py: f.py,
        };
      }
    };

    const onTouchMove = (e) => {
      e.preventDefault();
      const g = gestureRef.current;
      if (!g) return;
      const t = e.touches;
      if (g.type === "drag" && t.length === 1) {
        onChangeRef.current(panBy(g, t[0].clientX - g.sx, t[0].clientY - g.sy));
      } else if (g.type === "pinch" && t.length === 2) {
        const m = pinchMid(t);
        const scale = clampScale(g.startScale * (pinchDist(t) / g.startDist));
        onChangeRef.current({
          ...panBy(g, m.x - g.startMid.x, m.y - g.startMid.y),
          scale,
        });
      }
    };

    const onTouchEnd = () => { gestureRef.current = null; };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove",  onTouchMove,  { passive: false });
    el.addEventListener("touchend",   onTouchEnd,   { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
      el.removeEventListener("touchend",   onTouchEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- handlers only use stable refs

  const stepPan = useCallback((dx, dy) => {
    const f = frameRef.current;
    onChangeRef.current({ ...f, px: clampPct(f.px + dx), py: clampPct(f.py + dy) });
  }, []);

  const stepZoom = useCallback((factor) => {
    const f = frameRef.current;
    onChangeRef.current({ ...f, scale: clampScale(f.scale * factor) });
  }, []);

  const f = frame || { px: 50, py: 50, scale: 1 };
  return (
    <div className="image-framer-outer">
      <div ref={ref} className="image-framer" onMouseDown={onMouseDown}>
        <img
          className="joker-img"
          src={src}
          alt=""
          draggable={false}
          style={{
            objectPosition: `${f.px}% ${f.py}%`,
            transform: `scale(${f.scale})`,
          }}
        />
        {/* Marks the exact card boundary. Sits above the image in stacking order. */}
        <div className="image-framer-guide" aria-hidden="true" />
        <div className="image-framer-hint">Drag to pan, scroll or pinch to zoom</div>
      </div>
      {/* Tap-friendly controls for mobile and precision desktop use */}
      <div className="framer-controls">
        <button className="framer-ctrl-btn" onClick={() => stepPan(0, -PAN_STEP)} title="Pan up" aria-label="Pan up"><ArrowUp /></button>
        <button className="framer-ctrl-btn" onClick={() => stepPan(0, PAN_STEP)} title="Pan down" aria-label="Pan down"><ArrowDown /></button>
        <button className="framer-ctrl-btn" onClick={() => stepPan(-PAN_STEP, 0)} title="Pan left" aria-label="Pan left"><ArrowLeft /></button>
        <button className="framer-ctrl-btn" onClick={() => stepPan(PAN_STEP, 0)} title="Pan right" aria-label="Pan right"><ArrowRight /></button>
        <div className="framer-ctrl-divider" />
        <button className="framer-ctrl-btn" onClick={() => stepZoom(ZOOM_STEP)} title="Zoom in" aria-label="Zoom in"><Plus /></button>
        <button className="framer-ctrl-btn" onClick={() => stepZoom(1 / ZOOM_STEP)} title="Zoom out" aria-label="Zoom out"><Minus /></button>
      </div>
    </div>
  );
}

export default ImageFramer;
