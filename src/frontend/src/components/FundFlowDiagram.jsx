// Visual fund-flow diagram for the Deal Map — a different VIEW of the same
// Sources & Uses breakdown the generated Fund Flow Document (FR-13) already
// computes server-side (see build_diagram_data() in funding_document.py),
// not a second calculation. Layout is computed from however many lenders/
// fee lines/3rd parties a given deal actually has — nothing here is
// hardcoded to a specific deal's shape.

const COLORS = {
  source: "#2563eb",
  hub: "#0f172a",
  borrower: "#16a34a",
  fees: "#d97706",
  legal: "#7c3aed",
};

const NODE_W = 230;
const HUB_W = 300;
const HUB_H = 130;
const GAP = 22;
const PAD_Y = 40;
const SOURCE_X = 40;
const HUB_X = 460;
const USE_X = 900;
const CANVAS_W = 1170;

function formatMoney(amount, currency) {
  const n = Math.round(Number(amount) || 0);
  return `${currency} ${n.toLocaleString()}`;
}

// Long lender/borrower/3rd-party names and fee-line details don't fit a
// 230px-wide box on one line — wrap/truncate rather than let SVG text
// silently overflow past the shape's edges.
function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}

function wrapLabel(text, maxCharsPerLine = 24, maxLines = 2) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) {
        current = "";
        break;
      }
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  const consumedWords = lines.join(" ").split(" ").length;
  if (lines.length && (consumedWords < words.length || lines[lines.length - 1].length > maxCharsPerLine)) {
    const lastIdx = lines.length - 1;
    lines[lastIdx] = truncate(lines[lastIdx], maxCharsPerLine);
  }
  return lines.length ? lines : [""];
}

function stackNodes(nodes, x, canvasHeight) {
  const totalH = nodes.reduce((sum, n) => sum + n.height, 0) + GAP * Math.max(0, nodes.length - 1);
  let y = (canvasHeight - totalH) / 2;
  return nodes.map((n) => {
    const positioned = { ...n, x, y, w: NODE_W };
    y += n.height + GAP;
    return positioned;
  });
}

function curvePath(x1, y1, x2, y2) {
  const midX = (x1 + x2) / 2;
  return `M ${x1},${y1} C ${midX},${y1} ${midX},${y2} ${x2},${y2}`;
}

function buildLayout(data) {
  const sourceRaw = data.sources.map((s) => {
    const nameLines = wrapLabel(s.name, 22, 2);
    return { type: "source", name: s.name, nameLines, amount: s.amount, height: 52 + nameLines.length * 16 };
  });

  // Every USE line gets its OWN box — each one is a separate remittance (a
  // separate wire), so merging several into one box (the old "fees
  // cluster" and "sum by party" behavior) hid that there was more than one
  // payment happening. A party billing four fee categories on one invoice
  // shows as four boxes here, not one summed total.
  const useRaw = [];
  (data.borrower_lines || []).forEach((b) => {
    const nameLines = wrapLabel(b.name, 22, 2);
    useRaw.push({
      type: "borrower", name: b.name, nameLines, amount: b.amount,
      height: 54 + nameLines.length * 16, label: b.category || "Borrower",
    });
  });
  (data.fee_lines || []).forEach((f) => {
    const nameLines = wrapLabel(f.party, 22, 2);
    useRaw.push({
      type: "fee", name: f.party, nameLines, amount: f.amount,
      height: 54 + nameLines.length * 16, label: f.section,
    });
  });
  (data.legal_lines || []).forEach((l) => {
    const nameLines = wrapLabel(l.party, 22, 2);
    useRaw.push({
      type: "legal", name: l.party, nameLines, amount: l.amount,
      height: 54 + nameLines.length * 16, label: l.category || "3rd Party Provider",
    });
  });

  const sourceTotalH = sourceRaw.reduce((s, n) => s + n.height, 0) + GAP * Math.max(0, sourceRaw.length - 1);
  const useTotalH = useRaw.reduce((s, n) => s + n.height, 0) + GAP * Math.max(0, useRaw.length - 1);
  const canvasHeight = Math.max(sourceTotalH, useTotalH, HUB_H + 40) + PAD_Y * 2;

  const sources = stackNodes(sourceRaw, SOURCE_X, canvasHeight);
  const uses = stackNodes(useRaw, USE_X, canvasHeight);
  const hub = { x: HUB_X, y: (canvasHeight - HUB_H) / 2, w: HUB_W, h: HUB_H };

  return { width: CANVAS_W, height: canvasHeight, sources, uses, hub };
}

function FundFlowDiagram({ data, dealTitle, productLabel }) {
  if (!data.has_data) {
    return (
      <div className="fund-flow-diagram-empty">
        {data.missing_count > 0 ? (
          <>
            <p className="muted">{data.missing_count} financial line{data.missing_count === 1 ? "" : "s"} still need an amount.</p>
            <p className="muted small">Open "Generate Fund Flow Document" to fill in what's missing — the diagram draws once every amount is known.</p>
          </>
        ) : (
          <>
            <p className="muted">No financial line items on file for this deal yet.</p>
            <p className="muted small">Upload Borrower/Lenders/3rd Party documents, or open "Generate Fund Flow Document" to enter them by hand.</p>
          </>
        )}
      </div>
    );
  }

  const layout = buildLayout(data);
  const currency = data.currency || "USD";

  return (
    <div className="fund-flow-diagram">
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="fund-flow-diagram-svg">
        <defs>
          <marker id="ffd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" />
          </marker>
        </defs>

        {/* source -> hub connectors */}
        {layout.sources.map((s, i) => {
          const y1 = s.y + s.height / 2;
          const y2 = layout.hub.y + layout.hub.h / 2;
          const x1 = s.x + s.w;
          const x2 = layout.hub.x;
          return (
            <g key={`src-edge-${i}`}>
              <path d={curvePath(x1, y1, x2, y2)} fill="none" stroke="#94a3b8" strokeWidth="2" markerEnd="url(#ffd-arrow)" />
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} textAnchor="middle" className="ffd-edge-label">
                {formatMoney(s.amount, currency)}
              </text>
            </g>
          );
        })}

        {/* hub -> use connectors */}
        {layout.uses.map((u, i) => {
          const y1 = layout.hub.y + layout.hub.h / 2;
          const y2 = u.y + u.height / 2;
          const x1 = layout.hub.x + layout.hub.w;
          const x2 = u.x;
          const amount = u.amount;
          return (
            <g key={`use-edge-${i}`}>
              <path d={curvePath(x1, y1, x2, y2)} fill="none" stroke="#94a3b8" strokeWidth="2" markerEnd="url(#ffd-arrow)" />
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} textAnchor="middle" className="ffd-edge-label">
                {formatMoney(amount, currency)}
              </text>
            </g>
          );
        })}

        {/* source nodes */}
        {layout.sources.map((s, i) => (
          <g key={`src-${i}`}>
            <rect x={s.x} y={s.y} width={s.w} height={s.height} rx="10" fill={COLORS.source} />
            {s.nameLines.map((line, li) => (
              <text key={li} x={s.x + s.w / 2} y={s.y + 24 + li * 16} textAnchor="middle" className="ffd-node-label">{line}</text>
            ))}
            <text x={s.x + s.w / 2} y={s.y + 24 + s.nameLines.length * 16 + 8} textAnchor="middle" className="ffd-node-sub">Lender</text>
          </g>
        ))}

        {/* hub */}
        <rect x={layout.hub.x} y={layout.hub.y} width={layout.hub.w} height={layout.hub.h} rx="14" fill={COLORS.hub} />
        <text x={layout.hub.x + layout.hub.w / 2} y={layout.hub.y + 40} textAnchor="middle" className="ffd-hub-title">{dealTitle}</text>
        <text x={layout.hub.x + layout.hub.w / 2} y={layout.hub.y + 60} textAnchor="middle" className="ffd-hub-sub">
          {productLabel}
        </text>
        <text x={layout.hub.x + layout.hub.w / 2} y={layout.hub.y + 100} textAnchor="middle" className="ffd-hub-amount">
          {formatMoney(data.total_sources, currency)}
        </text>
        <text x={layout.hub.x + layout.hub.w / 2} y={layout.hub.y + 118} textAnchor="middle" className="ffd-hub-sub">Sources = Uses</text>

        {/* use nodes — one box per line item, each a distinct remittance */}
        {layout.uses.map((u, i) => {
          const fill = u.type === "borrower" ? COLORS.borrower : u.type === "fee" ? COLORS.fees : COLORS.legal;
          return (
            <g key={`use-${i}`}>
              <rect x={u.x} y={u.y} width={u.w} height={u.height} rx="10" fill={fill} />
              {u.nameLines.map((line, li) => (
                <text key={li} x={u.x + u.w / 2} y={u.y + 24 + li * 16} textAnchor="middle" className="ffd-node-label">{line}</text>
              ))}
              <text x={u.x + u.w / 2} y={u.y + 24 + u.nameLines.length * 16 + 8} textAnchor="middle" className="ffd-node-sub">{u.label}</text>
            </g>
          );
        })}
      </svg>

      <div className="fund-flow-diagram-legend">
        <span><i style={{ background: COLORS.source }} />Lender (source)</span>
        <span><i style={{ background: COLORS.hub }} />Loan facility (hub)</span>
        <span><i style={{ background: COLORS.borrower }} />Borrower (use)</span>
        <span><i style={{ background: COLORS.fees }} />Fees to lenders (use)</span>
        <span><i style={{ background: COLORS.legal }} />3rd party provider (use)</span>
      </div>
    </div>
  );
}

export default FundFlowDiagram;
