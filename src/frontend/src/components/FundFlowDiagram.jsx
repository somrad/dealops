// Visual fund-flow diagram for the Deal Map — a different VIEW of the same
// Sources & Uses breakdown the generated Fund Flow Document (FR-13) already
// computes server-side (see build_diagram_data() in funding_document.py),
// not a second calculation. Layout is computed from however many lenders/
// fee lines/3rd parties a given deal actually has — nothing here is
// hardcoded to a specific deal's shape, and every box sizes itself to its
// own wrapped text rather than assuming a fixed width fits everything.

const COLORS = {
  source: "#2563eb",
  hub: "#0f172a",
  borrower: "#16a34a",
  fees: "#d97706",
  legal: "#7c3aed",
};

const MIN_NODE_W = 190;
const MAX_NODE_W = 440;
const NODE_PAD_X = 32; // left+right internal padding a box reserves around its text
const HUB_W = 280;
const HUB_H = 130;
const GAP = 24;
const PAD_Y = 40;
const SOURCE_X = 40;
const LEFT_CORRIDOR = 90;
const RIGHT_CORRIDOR = 130;
const RIGHT_MARGIN = 40;
// Generously estimated character widths (overestimate on purpose — a box
// slightly wider than strictly necessary is fine; a box that clips real
// text on both edges, because a mid-weight sans-serif's actual rendered
// width was higher than assumed, is the bug this is specifically guarding
// against).
const NAME_CHAR_W = 8.6; // bold 13px
const SUB_CHAR_W = 7.1; // regular 11px
const BOX_H_PAD = 22;
const NAME_LINE_H = 18;
const SUB_LINE_H = 15;

function formatMoney(amount, currency) {
  const n = Math.round(Number(amount) || 0);
  return `${currency} ${n.toLocaleString()}`;
}

function estWidth(text, charW) {
  return text.length * charW;
}

// Fits text into up to `maxLines` lines that each stay within `maxTextW` —
// tries a single line FIRST (most party names/categories fit on one line
// once the box is allowed to be wide), only wrapping when a line would
// genuinely exceed the width ceiling, and only ellipsis-truncating the
// very last line if it still doesn't fit after wrapping.
function fitLines(text, charW, maxTextW, maxLines) {
  const str = String(text || "");
  if (estWidth(str, charW) <= maxTextW) return [str];

  const words = str.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estWidth(candidate, charW) <= maxTextW || !current) {
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
  if (lines.length === 0) return [str];

  const lastIdx = lines.length - 1;
  if (estWidth(lines[lastIdx], charW) > maxTextW) {
    let t = lines[lastIdx];
    while (t.length > 1 && estWidth(t + "…", charW) > maxTextW) t = t.slice(0, -1);
    lines[lastIdx] = t + "…";
  }
  return lines;
}

// Sizes a box to whatever its own name + category actually need at their
// natural (unwrapped) width, up to MAX_NODE_W — "as wide as required,"
// wrapping only as a last resort for a name/category that's genuinely
// longer than the width ceiling allows on one line.
function layoutNode(name, category) {
  const maxTextW = MAX_NODE_W - NODE_PAD_X;
  const nameLines = fitLines(name, NAME_CHAR_W, maxTextW, 2);
  const categoryLines = fitLines(category, SUB_CHAR_W, maxTextW, 2);
  const widest = Math.max(
    ...nameLines.map((l) => estWidth(l, NAME_CHAR_W)),
    ...categoryLines.map((l) => estWidth(l, SUB_CHAR_W)),
  );
  const width = Math.min(MAX_NODE_W, Math.max(MIN_NODE_W, Math.ceil(widest) + NODE_PAD_X));
  const height = BOX_H_PAD + nameLines.length * NAME_LINE_H + 8 + categoryLines.length * SUB_LINE_H + 10;
  return { nameLines, categoryLines, width, height };
}

function stackNodes(nodes, x, canvasHeight) {
  const totalH = nodes.reduce((sum, n) => sum + n.height, 0) + GAP * Math.max(0, nodes.length - 1);
  let y = (canvasHeight - totalH) / 2;
  return nodes.map((n) => {
    const positioned = { ...n, x, y };
    y += n.height + GAP;
    return positioned;
  });
}

// Right-angle (elbow) connector: out horizontally from the source, up/down
// through a shared vertical corridor, then horizontally into the target.
// Reads like a flowchart instead of a tangle of crossing curves once there
// are more than a handful of boxes on one side.
function elbowPath(x1, y1, x2, y2, corridorX) {
  return `M ${x1},${y1} H ${corridorX} V ${y2} H ${x2}`;
}

function buildLayout(data) {
  const sourceRaw = data.sources.map((s) => {
    const node = layoutNode(s.name, s.category || "Lender");
    return { type: "source", name: s.name, amount: s.amount, ...node };
  });

  // Every USE line gets its OWN box — each one is a separate remittance (a
  // separate wire), so merging several into one box (the old "fees
  // cluster" and "sum by party" behavior) hid that there was more than one
  // payment happening. A party billing four fee categories on one invoice
  // shows as four boxes here, not one summed total.
  const useRaw = [];
  (data.borrower_lines || []).forEach((b) => {
    const node = layoutNode(b.name, b.category || "Borrower");
    useRaw.push({ type: "borrower", name: b.name, amount: b.amount, ...node });
  });
  (data.fee_lines || []).forEach((f) => {
    const node = layoutNode(f.party, f.section);
    useRaw.push({ type: "fee", name: f.party, amount: f.amount, ...node });
  });
  (data.legal_lines || []).forEach((l) => {
    const node = layoutNode(l.party, l.category || "3rd Party Provider");
    useRaw.push({ type: "legal", name: l.party, amount: l.amount, ...node });
  });

  const sourceTotalH = sourceRaw.reduce((s, n) => s + n.height, 0) + GAP * Math.max(0, sourceRaw.length - 1);
  const useTotalH = useRaw.reduce((s, n) => s + n.height, 0) + GAP * Math.max(0, useRaw.length - 1);
  const canvasHeight = Math.max(sourceTotalH, useTotalH, HUB_H + 40) + PAD_Y * 2;

  const maxSourceW = sourceRaw.reduce((m, n) => Math.max(m, n.width), MIN_NODE_W);
  const maxUseW = useRaw.reduce((m, n) => Math.max(m, n.width), MIN_NODE_W);
  const hubX = SOURCE_X + maxSourceW + LEFT_CORRIDOR;
  const useX = hubX + HUB_W + RIGHT_CORRIDOR;
  const canvasWidth = useX + maxUseW + RIGHT_MARGIN;

  const sources = stackNodes(sourceRaw, SOURCE_X, canvasHeight);
  const uses = stackNodes(useRaw, useX, canvasHeight);
  const hub = { x: hubX, y: (canvasHeight - HUB_H) / 2, w: HUB_W, h: HUB_H };
  const leftCorridorX = SOURCE_X + maxSourceW + LEFT_CORRIDOR / 2;
  const rightCorridorX = hubX + HUB_W + RIGHT_CORRIDOR / 2;

  return { width: canvasWidth, height: canvasHeight, sources, uses, hub, leftCorridorX, rightCorridorX };
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
          const x1 = s.x + s.width;
          const x2 = layout.hub.x;
          return (
            <g key={`src-edge-${i}`}>
              <path d={elbowPath(x1, y1, x2, y2, layout.leftCorridorX)} fill="none" stroke="#94a3b8" strokeWidth="2" markerEnd="url(#ffd-arrow)" />
              <text x={(layout.leftCorridorX + x1) / 2} y={y1 - 8} textAnchor="middle" className="ffd-edge-label">
                {formatMoney(s.amount, currency)}
              </text>
            </g>
          );
        })}

        {/* hub -> use connectors — label sits on the final leg, right next
            to its own destination box, so it never clusters with other
            edges' labels near the hub regardless of how many boxes there are */}
        {layout.uses.map((u, i) => {
          const y1 = layout.hub.y + layout.hub.h / 2;
          const y2 = u.y + u.height / 2;
          const x1 = layout.hub.x + layout.hub.w;
          const x2 = u.x;
          return (
            <g key={`use-edge-${i}`}>
              <path d={elbowPath(x1, y1, x2, y2, layout.rightCorridorX)} fill="none" stroke="#94a3b8" strokeWidth="2" markerEnd="url(#ffd-arrow)" />
              <text x={(layout.rightCorridorX + x2) / 2} y={y2 - 8} textAnchor="middle" className="ffd-edge-label">
                {formatMoney(u.amount, currency)}
              </text>
            </g>
          );
        })}

        {/* source nodes */}
        {layout.sources.map((s, i) => (
          <g key={`src-${i}`}>
            <rect x={s.x} y={s.y} width={s.width} height={s.height} rx="10" fill={COLORS.source} />
            {s.nameLines.map((line, li) => (
              <text key={li} x={s.x + s.width / 2} y={s.y + 18 + li * NAME_LINE_H} textAnchor="middle" className="ffd-node-label">{line}</text>
            ))}
            {s.categoryLines.map((line, li) => (
              <text key={li} x={s.x + s.width / 2} y={s.y + 18 + s.nameLines.length * NAME_LINE_H + 10 + li * SUB_LINE_H} textAnchor="middle" className="ffd-node-sub">{line}</text>
            ))}
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
              <rect x={u.x} y={u.y} width={u.width} height={u.height} rx="10" fill={fill} />
              {u.nameLines.map((line, li) => (
                <text key={li} x={u.x + u.width / 2} y={u.y + 18 + li * NAME_LINE_H} textAnchor="middle" className="ffd-node-label">{line}</text>
              ))}
              {u.categoryLines.map((line, li) => (
                <text key={li} x={u.x + u.width / 2} y={u.y + 18 + u.nameLines.length * NAME_LINE_H + 10 + li * SUB_LINE_H} textAnchor="middle" className="ffd-node-sub">{line}</text>
              ))}
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
