import { useState } from "react";
import { FaChevronDown, FaChevronRight } from "react-icons/fa";

function AccordionItem({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="accordion-item">
      <button type="button" className="accordion-header" onClick={() => setOpen(!open)}>
        <span>{title}</span>
        {open ? <FaChevronDown /> : <FaChevronRight />}
      </button>
      {open && <div className="accordion-body">{children}</div>}
    </div>
  );
}

export default AccordionItem;
