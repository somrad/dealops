import { useState, useRef, useEffect } from "react";
import { FaTimes } from "react-icons/fa";

function Modal({ title, onClose, children, wide }) {
  // Offset from the default centered position — dragged via the header,
  // reset naturally every time since a new Modal instance mounts each open.
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragInfo = useRef(null);

  useEffect(() => {
    function handleMouseMove(e) {
      if (!dragInfo.current) return;
      const { startX, startY, origin } = dragInfo.current;
      setPosition({ x: origin.x + (e.clientX - startX), y: origin.y + (e.clientY - startY) });
    }
    function handleMouseUp() {
      dragInfo.current = null;
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  function startDrag(e) {
    if (e.target.closest("button")) return;
    dragInfo.current = { startX: e.clientX, startY: e.clientY, origin: position };
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal ${wide ? "modal-wide" : ""}`}
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header" onMouseDown={startDrag} title="Drag to move">
          <h2>{title}</h2>
          <button className="btn-ghost" onClick={onClose}>
            <FaTimes />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export default Modal;
