import { useEffect, useRef } from "react";

export function ResultsHandle({ onResize }: { onResize: (h: number) => void }) {
  const handleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = handleRef.current;
    if (!el) return;
    let dragging = false;
    let startY = 0;
    let startH = 0;

    const onDown = (e: MouseEvent) => {
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      startH = el.parentElement?.offsetHeight || 300;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      onResize(Math.max(120, startH - (e.clientY - startY)));
    };
    const onUp = () => {
      dragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    el.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      el.removeEventListener("mousedown", onDown);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={handleRef} className="h-1.5 cursor-row-resize hover:bg-blue-300" />;
}
