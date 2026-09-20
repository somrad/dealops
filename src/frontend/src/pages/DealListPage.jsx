import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaPlus, FaBuilding, FaIndustry, FaHome, FaInbox, FaThLarge, FaListUl, FaTasks, FaAt, FaUserShield } from "react-icons/fa";
import { listDeals, createDeal, listPendingApprovals } from "../api";
import Modal from "../components/Modal";
import Avatar from "../components/Avatar";

// Each product type gets its own icon + color, not one shared blue — a
// factory reads oddly in the same blue used for a house.
const PRODUCT_META = {
  commercial_loan: { label: "Commercial Loan", icon: FaIndustry, iconBg: "#fef3c7", iconColor: "#d97706" },
  real_estate_loan: { label: "Real Estate Loan", icon: FaHome, iconBg: "#eff6ff", iconColor: "#2563eb" },
};
const DEFAULT_PRODUCT_META = { icon: FaBuilding, iconBg: "#eff6ff", iconColor: "#2563eb" };

// Borrower/Lenders render as a stacked, right-aligned list, one name per
// line — past 9 names it stops being a useful list to read on a dashboard
// tile, so it collapses to a single "…" instead.
function PartyList({ names }) {
  if (!names || names.length === 0) return <span className="party-list-empty">—</span>;
  if (names.length > 9) return <span className="party-list-empty">…</span>;
  return (
    <div className="party-list">
      {names.map((name, i) => (
        <div key={i} className="party-list-item">{name}</div>
      ))}
    </div>
  );
}

// A big, unmissable signal that the current user specifically has something
// to do in this deal — a pending Checker task, or a mention aimed at them.
// Absent for everyone else looking at the same tile.
function DealBadges({ deal }) {
  if (!deal.has_pending_task && !deal.has_mention) return null;
  return (
    <div className="deal-badges">
      {deal.has_pending_task && (
        <span
          className="deal-badge deal-badge-task"
          title={`${deal.pending_task_count} Standing Instruction${deal.pending_task_count === 1 ? "" : "s"} awaiting your review`}
        >
          <FaTasks />
          <span className="deal-badge-count">{deal.pending_task_count}</span>
        </span>
      )}
      {deal.has_mention && (
        <span className="deal-badge deal-badge-mention" title="You were mentioned in this deal">
          <FaAt />
        </span>
      )}
    </div>
  );
}

// Dashboard-level "what do I need to do right now" summary — surfaces every
// deal's pending_task_count (today, only ever a Checker's pending Standing
// Instruction reviews) as a real to-do list on login, not just a per-tile
// badge someone has to notice on their own. Naturally scoped to nothing for
// any role without a task type yet, since pending_task_count is already 0
// for them server-side.
function TodoBanner({ deals, onOpenDeal }) {
  const items = deals.filter((d) => d.pending_task_count > 0);
  const total = items.reduce((sum, d) => sum + d.pending_task_count, 0);
  if (total === 0) return null;

  return (
    <div className="todo-banner">
      <div className="todo-banner-header">
        <span className="todo-banner-icon">
          <FaTasks />
        </span>
        <div>
          <strong>
            {total} Standing Instruction{total === 1 ? "" : "s"} awaiting your review
          </strong>
          <p className="muted small">Blind re-entry confirmation is waiting on you before {items.length === 1 ? "this deal" : "these deals"} can move forward.</p>
        </div>
      </div>
      <div className="todo-banner-list">
        {items.map((d) => (
          <button key={d.id} type="button" className="todo-banner-item" onClick={() => onOpenDeal(d.id)}>
            <span>{d.title}</span>
            <span className="todo-banner-item-count">{d.pending_task_count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Pared down to just Product/Borrower/Lenders (Status is already the pill
// in the card header; Members/Messages/Standing-instructions counts were
// dropped as not needed on the dashboard tile itself) — member avatars
// pinned to the bottom of the tile regardless of how tall the lists above
// are.
function DealSections({ deal, productLabel }) {
  return (
    <div className="deal-map-mini">
      <div className="sidebar-row">
        <span>Product</span>
        <strong>{productLabel}</strong>
      </div>
      <div className="sidebar-row">
        <span>Borrower</span>
        <PartyList names={deal.borrower_names} />
      </div>
      <div className="sidebar-row">
        <span>Lenders</span>
        <PartyList names={deal.lender_names} />
      </div>
      <div className="avatar-wrap deal-map-mini-avatars">
        {deal.members.map((m) => (
          <Avatar key={m.id} name={m.name} size={26} role={m.role} />
        ))}
      </div>
    </div>
  );
}

// This feeds the FR-15 approvals table's "Pending since" column — real
// financial-approval timestamps, so the year is never dropped even though
// it's the common case (nothing here should read as ambiguous months from
// now, out of the context of "today").
function formatDateTime(isoString) {
  return new Date(isoString).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAge(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

// Ops Manager oversight (FR-15) — every pending Standing Instruction across
// EVERY deal, not just deals Omar happens to be looking at, so he can spot
// something stalling and add another Checker to that deal (via the same
// @mention-in-chat flow that already grants membership — clicking a row
// opens the deal so he can do exactly that). Row background age-codes each
// item so the oldest, most overdue items are visually unmissable.
function PendingApprovalsPanel({ approvals, onOpenDeal }) {
  if (approvals.length === 0) return null;
  const sorted = [...approvals].sort((a, b) => b.hours_pending - a.hours_pending);

  return (
    <div className="approvals-panel">
      <div className="todo-banner-header">
        <span className="todo-banner-icon approvals-panel-icon">
          <FaUserShield />
        </span>
        <div>
          <strong>
            {approvals.length} open approval{approvals.length === 1 ? "" : "s"} across all deals
          </strong>
          <p className="muted small">Every Standing Instruction still awaiting a Checker's review — oldest first. Open a deal to add another Checker if one's stalling.</p>
        </div>
      </div>
      <div className="approvals-table-wrap">
        <table className="approvals-table">
          <thead>
            <tr>
              <th>Deal</th>
              <th>Party</th>
              <th>Folder</th>
              <th>Checker(s)</th>
              <th>Pending since</th>
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const urgency = a.hours_pending > 8 ? "urgent" : a.hours_pending > 4 ? "warning" : "normal";
              return (
                <tr key={a.ssi_id} className={`approvals-row approvals-row-${urgency}`} onClick={() => onOpenDeal(a.deal_id)}>
                  <td>
                    <strong>{a.deal_title}</strong>
                    <span className="muted"> {a.deal_reference}</span>
                  </td>
                  <td>{a.party_name || "Unnamed party"}</td>
                  <td>{a.folder || "—"}</td>
                  <td>
                    {a.checkers.length > 0 ? a.checkers.map((c) => c.name).join(", ") : <span className="muted">Unassigned</span>}
                  </td>
                  <td>{formatDateTime(a.submitted_at)}</td>
                  <td className="approvals-age">{formatAge(a.hours_pending)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DealListPage({ user }) {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [approvals, setApprovals] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [reference, setReference] = useState("");
  const [title, setTitle] = useState("");
  const [productType, setProductType] = useState("commercial_loan");
  const [viewMode, setViewMode] = useState("grid"); // "grid" (vertical cards) or "bars" (horizontal list)
  const navigate = useNavigate();

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  function refresh() {
    listDeals().then((data) => {
      setDeals(data);
      setLoading(false);
    });
    // Ops-Manager-only endpoint — skip the call entirely for every other
    // role rather than firing a request that's always going to 403.
    if (user.role === "ops_manager") {
      listPendingApprovals().then(setApprovals);
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    await createDeal(reference, title, productType);
    setShowModal(false);
    setReference("");
    setTitle("");
    refresh();
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Deals</h1>
          <p className="page-subtitle">
            {deals.length} active deal{deals.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="page-header-actions">
          <button onClick={() => setShowModal(true)}>
            <FaPlus /> New Deal
          </button>
          <div className="view-toggle">
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => setViewMode("grid")}
              title="Card view"
            >
              <FaThLarge />
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === "bars" ? "active" : ""}`}
              onClick={() => setViewMode("bars")}
              title="List view"
            >
              <FaListUl />
            </button>
          </div>
        </div>
      </div>

      {!loading && <TodoBanner deals={deals} onOpenDeal={(id) => navigate(`/deals/${id}`)} />}
      {!loading && user.role === "ops_manager" && (
        <PendingApprovalsPanel approvals={approvals} onOpenDeal={(id) => navigate(`/deals/${id}`)} />
      )}

      {loading ? (
        <p className="muted">Loading deals...</p>
      ) : deals.length === 0 ? (
        <div className="empty-state">
          <FaInbox size={40} />
          <h3>No deals yet</h3>
          <p>Create your first Deal Room to get started.</p>
          <button onClick={() => setShowModal(true)}>
            <FaPlus /> New Deal
          </button>
        </div>
      ) : viewMode === "grid" ? (
        <div className="deal-card-grid">
          {deals.map((deal) => {
            const meta = { label: deal.product_type, ...DEFAULT_PRODUCT_META, ...PRODUCT_META[deal.product_type] };
            const Icon = meta.icon;
            return (
              <div key={deal.id} className="deal-card-v" onClick={() => navigate(`/deals/${deal.id}`)}>
                <DealBadges deal={deal} />
                <div className="deal-card-v-header">
                  <div className="deal-card-icon" style={{ background: meta.iconBg, color: meta.iconColor }}>
                    <Icon />
                  </div>
                  <div>
                    <strong>{deal.title}</strong>
                    <p className="muted">{deal.reference}</p>
                  </div>
                </div>
                <div className="deal-card-meta">
                  <span className="tag">{meta.label}</span>
                  <span className={`status-pill status-${deal.status}`}>{deal.status}</span>
                </div>
                <DealSections deal={deal} productLabel={meta.label} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="deal-bar-list">
          {deals.map((deal) => {
            const meta = { label: deal.product_type, ...DEFAULT_PRODUCT_META, ...PRODUCT_META[deal.product_type] };
            const Icon = meta.icon;
            return (
              <div key={deal.id} className="deal-bar" onClick={() => navigate(`/deals/${deal.id}`)}>
                <div className="deal-bar-summary">
                  <div className="deal-card-icon" style={{ background: meta.iconBg, color: meta.iconColor }}>
                    <Icon />
                  </div>
                  <div>
                    <strong>{deal.title}</strong>
                    <p className="muted">{deal.reference}</p>
                    <div className="deal-card-meta">
                      <span className="tag">{meta.label}</span>
                      <span className={`status-pill status-${deal.status}`}>{deal.status}</span>
                    </div>
                  </div>
                </div>
                <DealSections deal={deal} productLabel={meta.label} />
                <DealBadges deal={deal} />
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <Modal title="Create a new Deal Room" onClose={() => setShowModal(false)}>
          <form className="modal-form" onSubmit={handleCreate}>
            <label>Deal reference</label>
            <input placeholder="e.g. CL-2026-0099" value={reference} onChange={(e) => setReference(e.target.value)} required />
            <label>Deal title</label>
            <input placeholder="e.g. Acme Manufacturing Expansion" value={title} onChange={(e) => setTitle(e.target.value)} required />
            <label>Loan product type</label>
            <select value={productType} onChange={(e) => setProductType(e.target.value)}>
              <option value="commercial_loan">Commercial Loan</option>
              <option value="real_estate_loan">Real Estate Loan</option>
            </select>
            <button type="submit">
              <FaPlus /> Create Deal Room
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default DealListPage;
