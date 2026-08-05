import { useEffect, useCallback, useRef } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Minus, Plus } from "../icons";

// --- Interactive image framer (drag to pan, pinch/scroll to zoom) ---
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
    : { w: 240, h: 240 };

  // ── Mouse drag ───────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    const f = frameRef.current;
    gestureRef.current = { type: "drag", sx: e.clientX, sy: e.clientY, fx: f.x, fy: f.y };

    const onMove = (me) => {
      const g = gestureRef.current;
      if (!g) return;
      const { w, h } = containerSize();
      onChangeRef.current({
        ...frameRef.current,
        x: g.fx + (me.clientX - g.sx) / w,
        y: g.fy + (me.clientY - g.sy) / h,
      });
    };
    const onUp = () => {
      gestureRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // ── Scroll-wheel zoom ────────────────────────────────────────────────────
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const f = frameRef.current;
      const factor = e.deltaY > 0 ? 0.93 : 1.08;
      onChangeRef.current({ ...f, scale: Math.max(0.25, Math.min(6, f.scale * factor)) });
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
        gestureRef.current = { type: "drag", sx: t[0].clientX, sy: t[0].clientY, fx: f.x, fy: f.y };
      } else if (t.length === 2) {
        gestureRef.current = {
          type: "pinch",
          startDist: pinchDist(t),
          startScale: f.scale,
          startMid: pinchMid(t),
          fx: f.x, fy: f.y,
        };
      }
    };

    const onTouchMove = (e) => {
      e.preventDefault();
      const g = gestureRef.current;
      if (!g) return;
      const t = e.touches;
      const { w, h } = containerSize();
      const f = frameRef.current;
      if (g.type === "drag" && t.length === 1) {
        onChangeRef.current({
          ...f,
          x: g.fx + (t[0].clientX - g.sx) / w,
          y: g.fy + (t[0].clientY - g.sy) / h,
        });
      } else if (g.type === "pinch" && t.length === 2) {
        const newScale = Math.max(0.25, Math.min(6, g.startScale * (pinchDist(t) / g.startDist)));
        const m = pinchMid(t);
        onChangeRef.current({
          ...f,
          scale: newScale,
          x: g.fx + (m.x - g.startMid.x) / w,
          y: g.fy + (m.y - g.startMid.y) / h,
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

  const PAN_STEP = 0.05;

  const stepPan = useCallback((dx, dy) => {
    onChangeRef.current({ ...frameRef.current, x: frameRef.current.x + dx, y: frameRef.current.y + dy });
  }, []);

  const stepZoom = useCallback((factor) => {
    const f = frameRef.current;
    onChangeRef.current({ ...f, scale: Math.max(0.25, Math.min(6, f.scale * factor)) });
  }, []);

  const f = frame || { x: 0, y: 0, scale: 1 };
  return (
    <div className="image-framer-outer">
      <div
        ref={ref}
        className="image-framer"
        onMouseDown={onMouseDown}
      >
        <img
          src={src}
          alt=""
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
            pointerEvents: "none",
          }}
        />
        {/* Frame guide — sits above image in stacking order, marks the exact card boundary */}
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
        <button className="framer-ctrl-btn" onClick={() => stepZoom(1.15)} title="Zoom in" aria-label="Zoom in"><Plus /></button>
        <button className="framer-ctrl-btn" onClick={() => stepZoom(0.87)} title="Zoom out" aria-label="Zoom out"><Minus /></button>
      </div>
    </div>
  );
}

export default ImageFramer;
