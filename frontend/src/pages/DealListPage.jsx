import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaPlus, FaBuilding, FaHome, FaInbox, FaFileAlt, FaCommentDots, FaThLarge, FaListUl } from "react-icons/fa";
import { listDeals, createDeal } from "../api";
import Modal from "../components/Modal";
import Avatar from "../components/Avatar";

const PRODUCT_META = {
  commercial_loan: { label: "Commercial Loan", icon: FaBuilding },
  real_estate_loan: { label: "Real Estate Loan", icon: FaHome },
};

function timeAgo(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// The members / documents / last-message sections are identical in both the
// card and list layouts — only how they're arranged around them differs.
function DealSections({ deal }) {
  return (
    <>
      <div className="deal-section">
        <h4>Members</h4>
        <div className="avatar-wrap">
          {deal.members.map((m) => (
            <Avatar key={m.id} name={m.name} size={26} role={m.role} />
          ))}
        </div>
      </div>

      <div className="deal-section">
        <h4>
          <FaFileAlt /> Documents
        </h4>
        {deal.document_count > 0 ? (
          <p className="small">{deal.document_count} document{deal.document_count === 1 ? "" : "s"}</p>
        ) : (
          <p className="muted small">No documents yet</p>
        )}
      </div>

      <div className="deal-section deal-section-chat">
        <h4>
          <FaCommentDots /> Last message
        </h4>
        {deal.last_message_text ? (
          <p className="small">
            <strong>{deal.last_message_user}: </strong>
            {deal.last_message_text.length > 60
              ? deal.last_message_text.slice(0, 60) + "…"
              : deal.last_message_text}
            <span className="muted"> · {timeAgo(deal.last_message_at)}</span>
          </p>
        ) : (
          <p className="muted small">No messages yet</p>
        )}
      </div>
    </>
  );
}

function DealListPage({ user }) {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
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
            const meta = PRODUCT_META[deal.product_type] || { label: deal.product_type, icon: FaBuilding };
            const Icon = meta.icon;
            return (
              <div key={deal.id} className="deal-card-v" onClick={() => navigate(`/deals/${deal.id}`)}>
                <div className="deal-card-v-header">
                  <div className="deal-card-icon">
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
                <DealSections deal={deal} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="deal-bar-list">
          {deals.map((deal) => {
            const meta = PRODUCT_META[deal.product_type] || { label: deal.product_type, icon: FaBuilding };
            const Icon = meta.icon;
            return (
              <div key={deal.id} className="deal-bar" onClick={() => navigate(`/deals/${deal.id}`)}>
                <div className="deal-bar-summary">
                  <div className="deal-card-icon">
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
                <DealSections deal={deal} />
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
