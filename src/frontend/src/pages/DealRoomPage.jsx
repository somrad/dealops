import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import { FaPaperPlane, FaBuilding, FaIndustry, FaHome, FaBars, FaTimes, FaFileAlt, FaFolder, FaUpload, FaCloudUploadAlt, FaDownload, FaComments, FaFlag, FaRobot, FaUserTie, FaUniversity, FaEye, FaArrowLeft, FaCheckCircle, FaHighlighter } from "react-icons/fa";
import {
  getDeal,
  listMessages,
  postMessage,
  listUsers,
  listDealMembers,
  listDocuments,
  uploadDocuments,
  downloadDocument,
  fetchDocumentBlob,
  fetchHighlightedDocumentBlob,
  listAgentCommands,
  listStandingInstructions,
  validateStandingInstruction,
  listDealActivity,
} from "../api";
import Avatar from "../components/Avatar";
import AccordionItem from "../components/AccordionItem";
import Modal from "../components/Modal";

const ACTIVITY_ICONS = {
  deal_created: FaFlag,
  llm_call: FaRobot,
  message: FaComments,
};

const SSI_STATUS_LABELS = {
  pending_checker_review: "Pending review",
  checker_validated: "Validated",
  rejected: "Rejected",
};

// Each product type gets its own icon + color, not one shared blue — a
// factory reads oddly in the same blue used for a house.
const PRODUCT_META = {
  commercial_loan: { label: "Commercial Loan", icon: FaIndustry, iconBg: "#fef3c7", iconColor: "#d97706" },
  real_estate_loan: { label: "Real Estate Loan", icon: FaHome, iconBg: "#eff6ff", iconColor: "#2563eb" },
};
const DEFAULT_PRODUCT_META = { icon: FaBuilding, iconBg: "#eff6ff", iconColor: "#2563eb" };

const ROLE_LABELS = {
  deal_team: "Deal Team",
  ops_manager: "Ops Manager",
  ops_team_member: "Ops Team",
  checker: "Checker",
  agent: "Agent",
};

// Folder categories from the FR-3 spec, plus Unfiled for anything the
// classifier couldn't confidently place.
const FOLDER_CATEGORIES = ["Borrower", "Lenders", "Credit Verification", "Funding Docs", "Unfiled"];

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Splits message text on @username tokens and turns recognized ones into
// highlighted spans, same idea as how Slack renders a mention.
function renderMessageText(text, usersByUsername) {
  const regex = /@(\w+)/g;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const [fullMatch, username] = match;
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const mentionedUser = usersByUsername[username];
    parts.push(
      mentionedUser ? (
        <span key={match.index} className="mention">@{mentionedUser.name}</span>
      ) : (
        fullMatch
      )
    );
    lastIndex = match.index + fullMatch.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function DealRoomPage({ user }) {
  const { dealId } = useParams();
  const [deal, setDeal] = useState(null);
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [standingInstructions, setStandingInstructions] = useState([]);
  const [activity, setActivity] = useState([]);
  const [validatingSsi, setValidatingSsi] = useState(null);
  const [validateInput, setValidateInput] = useState("");
  const [validating, setValidating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [agentCommands, setAgentCommands] = useState([]);
  const [text, setText] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [mentionQuery, setMentionQuery] = useState(null);
  const [commandQuery, setCommandQuery] = useState(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showDocPanel, setShowDocPanel] = useState(true);
  const [showChatPanel, setShowChatPanel] = useState(true);
  const [rightPanelView, setRightPanelView] = useState("chat"); // "chat" | "ssi-borrower" | "ssi-lender"
  const [ssiDetailId, setSsiDetailId] = useState(null);
  const chatBoxRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    getDeal(dealId).then(setDeal);
    listUsers().then(setAllUsers);
    listAgentCommands().then(setAgentCommands);
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [dealId]);

  // Show the deal's own name as the browser tab title while in its Deal Room.
  useEffect(() => {
    if (deal) document.title = deal.title;
    return () => {
      document.title = "dealops";
    };
  }, [deal]);

  function refresh() {
    listMessages(dealId).then(setMessages);
    listDealMembers(dealId).then(setMembers);
    listDocuments(dealId).then(setDocuments);
    listStandingInstructions(dealId).then(setStandingInstructions);
    listDealActivity(dealId).then(setActivity);
  }

  async function handleValidateSubmit(event) {
    event.preventDefault();
    setValidating(true);
    try {
      await validateStandingInstruction(dealId, validatingSsi.id, validateInput);
      setValidatingSsi(null);
      setValidateInput("");
      refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setValidating(false);
    }
  }

  const onDrop = useCallback(
    async (acceptedFiles) => {
      if (acceptedFiles.length === 0) return;
      setUploading(true);
      try {
        await uploadDocuments(dealId, acceptedFiles);
        refresh();
      } catch (err) {
        alert(err.message);
      } finally {
        setUploading(false);
      }
    },
    [dealId]
  );

  // noClick/noKeyboard: dragging a file anywhere over the deal room uploads
  // it, but a plain click doesn't hijack the file dialog — that would break
  // clicking chat, buttons, and links everywhere inside this area.
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  });

  // Revoke the previous blob URL whenever a new one replaces it, or on
  // unmount — otherwise each preview leaks memory the browser never frees.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function handlePreviewClick(doc) {
    setPreviewLoading(true);
    try {
      const blob = await fetchDocumentBlob(dealId, doc.id);
      setPreviewDoc(doc);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      alert(err.message);
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    setPreviewDoc(null);
    setPreviewUrl(null);
  }

  // The evidence view for an SSI: same source document, but with the exact
  // spots the extraction read from marked in light green — never the value
  // itself, just where to look. Point-and-call, not copy-and-paste.
  async function handleViewEvidence(ssi) {
    setPreviewLoading(true);
    setShowDocPanel(true);
    try {
      const blob = await fetchHighlightedDocumentBlob(dealId, ssi.id);
      setPreviewDoc({ id: ssi.document_id, original_filename: ssi.document_filename });
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      alert(err.message);
    } finally {
      setPreviewLoading(false);
    }
  }

  // Only auto-scroll to the newest message if the user is already near the
  // bottom — otherwise a background poll would keep yanking them back down
  // while they're reading older messages.
  useEffect(() => {
    const container = chatBoxRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 150) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const mentionPool = useMemo(() => {
    const byId = new Map();
    allUsers.forEach((u) => byId.set(u.id, u));
    members.forEach((u) => byId.set(u.id, u));
    return Array.from(byId.values());
  }, [allUsers, members]);

  const usersByUsername = useMemo(
    () => Object.fromEntries(mentionPool.map((u) => [u.username, u])),
    [mentionPool]
  );
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  // FR-3's folder classification is the natural Borrower/Lender split — no
  // separate party-type field needed, the source document already carries it.
  const borrowerSsis = useMemo(
    () => standingInstructions.filter((s) => s.document_folder === "Borrower"),
    [standingInstructions]
  );
  const lenderSsis = useMemo(
    () => standingInstructions.filter((s) => s.document_folder === "Lenders"),
    [standingInstructions]
  );
  const borrowerPendingCount = useMemo(
    () => borrowerSsis.filter((s) => s.status === "pending_checker_review").length,
    [borrowerSsis]
  );
  const lenderPendingCount = useMemo(
    () => lenderSsis.filter((s) => s.status === "pending_checker_review").length,
    [lenderSsis]
  );
  const activeSsiList = rightPanelView === "ssi-borrower" ? borrowerSsis : rightPanelView === "ssi-lender" ? lenderSsis : [];
  const detailSsi = activeSsiList.find((s) => s.id === ssiDetailId) || null;

  // One toggle for the whole right column, shared by the rail icons and the
  // top-bar Chat button: clicking the view that's already open closes the
  // panel; clicking a different view switches content without closing.
  function toggleRightPanel(view) {
    if (showChatPanel && rightPanelView === view) {
      setShowChatPanel(false);
    } else {
      setRightPanelView(view);
      setSsiDetailId(null);
      setShowChatPanel(true);
    }
  }

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const matches = mentionPool.filter(
      (u) => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
    );
    // This deal's own agent always leads the list — it's who you'd reach
    // for most often (a quick "describe", a menu of what it can do).
    matches.sort((a, b) => (a.role === "agent" ? -1 : 0) - (b.role === "agent" ? -1 : 0));
    return matches.slice(0, 6);
  }, [mentionQuery, mentionPool]);

  const agentUser = useMemo(() => members.find((m) => m.role === "agent"), [members]);

  const commandSuggestions = useMemo(() => {
    if (commandQuery === null) return [];
    const q = commandQuery.toLowerCase();
    return agentCommands.filter((c) => c.name.toLowerCase().includes(q));
  }, [commandQuery, agentCommands]);

  function handleTextChange(event) {
    const value = event.target.value;
    const pos = event.target.selectionStart;
    setText(value);
    setCursorPos(pos);
    const before = value.slice(0, pos);

    // Right after mentioning this deal's own agent — "@AgentName " plus
    // whatever partial word comes next — show command suggestions instead
    // of the person-mention dropdown.
    if (agentUser) {
      const commandMatch = before.match(new RegExp(`@${escapeRegExp(agentUser.username)}\\s+(\\w*)$`));
      if (commandMatch) {
        setCommandQuery(commandMatch[1]);
        setMentionQuery(null);
        return;
      }
    }
    setCommandQuery(null);

    const mentionMatch = before.match(/@(\w*)$/);
    setMentionQuery(mentionMatch ? mentionMatch[1] : null);
  }

  function selectCommand(commandName) {
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const newBefore = before.replace(/(\w*)$/, commandName);
    const newText = newBefore + after;
    setText(newText);
    setCommandQuery(null);
    inputRef.current?.focus();
  }

  function selectMention(mentionedUser) {
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const newBefore = before.replace(/@(\w*)$/, `@${mentionedUser.username} `);
    const newText = newBefore + after;
    setText(newText);
    setMentionQuery(null);
    inputRef.current?.focus();
  }

  async function handleSend(event) {
    event.preventDefault();
    if (!text.trim()) return;
    await postMessage(dealId, text);
    setText("");
    setMentionQuery(null);
    setCommandQuery(null);
    refresh();
  }

  if (!deal) {
    return <p className="muted" style={{ padding: "2rem" }}>Loading deal room...</p>;
  }

  const meta = { label: deal.product_type, ...DEFAULT_PRODUCT_META, ...PRODUCT_META[deal.product_type] };
  const Icon = meta.icon;

  return (
    <div className="deal-room-page-v2">
      <div className="deal-top-bar">
        <div className="deal-top-bar-main">
          <div className="deal-room-icon" style={{ background: meta.iconBg, color: meta.iconColor }}>
            <Icon />
          </div>
          <h1>{deal.title}</h1>
          <span className="muted">{deal.reference} · {meta.label}</span>
          <span className={`status-pill status-${deal.status}`}>{deal.status}</span>
        </div>
        <div className="deal-top-bar-actions">
          <button
            type="button"
            className={`chat-toggle-btn ${showChatPanel && rightPanelView === "chat" ? "active" : ""}`}
            onClick={() => toggleRightPanel("chat")}
            title="Toggle chat"
          >
            <FaComments /> Chat
          </button>
          <button className="btn-ghost drawer-trigger" onClick={() => setShowDrawer(true)} title="Deal details">
            <FaBars />
          </button>
        </div>
      </div>

      <div className="deal-room-layout">
        <div className="icon-rail">
          <button
            type="button"
            className={`icon-rail-btn ${showDocPanel ? "active" : ""}`}
            onClick={() => setShowDocPanel((v) => !v)}
            title="Documents"
          >
            <FaFolder />
          </button>
          <button
            type="button"
            className={`icon-rail-btn chat-rail-btn ${showChatPanel && rightPanelView === "chat" ? "active" : ""}`}
            onClick={() => toggleRightPanel("chat")}
            title="Chat"
          >
            <FaComments />
          </button>
          <button
            type="button"
            className={`icon-rail-btn ${showChatPanel && rightPanelView === "ssi-borrower" ? "active" : ""}`}
            onClick={() => toggleRightPanel("ssi-borrower")}
            title="SSI — Borrower"
          >
            <FaUserTie />
            {borrowerPendingCount > 0 && <span className="rail-badge">{borrowerPendingCount}</span>}
          </button>
          <button
            type="button"
            className={`icon-rail-btn ${showChatPanel && rightPanelView === "ssi-lender" ? "active" : ""}`}
            onClick={() => toggleRightPanel("ssi-lender")}
            title="SSI — Lender"
          >
            <FaUniversity />
            {lenderPendingCount > 0 && <span className="rail-badge">{lenderPendingCount}</span>}
          </button>
        </div>

      <div
        className="deal-room-body-v2"
        style={{
          "--doc-col": showDocPanel ? "250px" : "0px",
          "--chat-col": showChatPanel ? "380px" : "0px",
        }}
        {...getRootProps()}
      >
        <input {...getInputProps({ style: { display: "none" } })} />
        {isDragActive && (
          <div className="drop-overlay">
            <FaCloudUploadAlt size={40} />
            <p>Drop files to upload</p>
          </div>
        )}

        <aside className={`doc-explorer ${!showDocPanel ? "panel-collapsed" : ""}`}>
          <div className="doc-explorer-header">
            <h3>Documents</h3>
            <button type="button" className="btn-ghost" onClick={open} title="Upload documents" disabled={uploading}>
              <FaUpload />
            </button>
          </div>
          {uploading && <p className="muted small">Uploading...</p>}
          {FOLDER_CATEGORIES.map((category) => {
            const docsInFolder = documents.filter((d) => d.folder === category);
            return (
              <AccordionItem
                key={category}
                title={
                  <span className="doc-folder-title">
                    <FaFolder />
                    <span className="doc-folder-title-text">{category} ({docsInFolder.length})</span>
                  </span>
                }
              >
                {docsInFolder.length === 0 ? (
                  <p className="muted small">No documents yet</p>
                ) : (
                  <div className="doc-file-list">
                    {docsInFolder.map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        className={`doc-file-link ${previewDoc?.id === doc.id ? "active" : ""}`}
                        onClick={() => handlePreviewClick(doc)}
                        title={doc.original_filename}
                      >
                        <FaFileAlt /> <span>{doc.original_filename}</span>
                      </button>
                    ))}
                  </div>
                )}
              </AccordionItem>
            );
          })}
        </aside>

        <div className="doc-preview-panel">
          {previewLoading ? (
            <div className="doc-preview-empty">
              <p className="muted">Loading preview...</p>
            </div>
          ) : previewDoc ? (
            <>
              <div className="doc-preview-header">
                <span className="doc-preview-title" title={previewDoc.original_filename}>
                  <FaFileAlt /> {previewDoc.original_filename}
                </span>
                <div className="doc-preview-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => downloadDocument(dealId, previewDoc.id, previewDoc.original_filename)}
                    title="Download"
                  >
                    <FaDownload />
                  </button>
                  <button type="button" className="btn-ghost" onClick={closePreview} title="Close preview">
                    <FaTimes />
                  </button>
                </div>
              </div>
              <iframe
                src={`${previewUrl}#zoom=page-width`}
                title={previewDoc.original_filename}
                className="doc-preview-frame"
              />
            </>
          ) : (
            <div className="doc-preview-empty">
              <FaFileAlt size={36} />
              <p className="muted">Select a document on the left to preview it here.</p>
            </div>
          )}
        </div>

        <div className={`chat-panel-v2 ${!showChatPanel ? "panel-collapsed" : ""}`}>
        {rightPanelView === "chat" && (
          <>
          <div className="chat-box" ref={chatBoxRef}>
            {messages.length === 0 && (
              <p className="muted" style={{ textAlign: "center", marginTop: "2rem" }}>
                No messages yet — say hello to get the deal moving. Type @ to mention someone.
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} className="message-row">
                <Avatar name={m.user.name} size={36} role={m.user.role} />
                <div className="message-content">
                  <div className="message-meta">
                    <strong>{m.user.name}</strong>
                    <span className="message-time">{formatTime(m.created_at)}</span>
                  </div>
                  <p className="message-text">{renderMessageText(m.text, usersByUsername)}</p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <form className="chat-input-wrapper" onSubmit={handleSend}>
            {commandQuery !== null && commandSuggestions.length > 0 ? (
              <div className="mention-dropdown">
                {commandSuggestions.map((c) => (
                  <div key={c.name} className="mention-item" onMouseDown={() => selectCommand(c.name)}>
                    <div className="mention-item-info">
                      <strong>{c.name}</strong>
                      <span className="muted">{c.help}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              mentionQuery !== null && mentionSuggestions.length > 0 && (
                <div className="mention-dropdown">
                  {mentionSuggestions.map((u) => (
                    <div key={u.id} className="mention-item" onMouseDown={() => selectMention(u)}>
                      <Avatar name={u.name} size={24} role={u.role} />
                      <div className="mention-item-info">
                        <strong>{u.name}</strong>
                        <span className="muted">@{u.username} · {ROLE_LABELS[u.role] || u.role}</span>
                      </div>
                      {!memberIds.has(u.id) && <span className="tag">not in deal</span>}
                    </div>
                  ))}
                </div>
              )
            )}
            <div className="chat-input">
              <input
                ref={inputRef}
                placeholder="Type a message... use @ to mention someone"
                value={text}
                onChange={handleTextChange}
                onBlur={() => setTimeout(() => { setMentionQuery(null); setCommandQuery(null); }, 150)}
              />
              <button type="submit">
                <FaPaperPlane />
              </button>
            </div>
          </form>
          </>
        )}

        {(rightPanelView === "ssi-borrower" || rightPanelView === "ssi-lender") && (
          <div className="ssi-panel">
            <div className="ssi-panel-header">
              {detailSsi ? (
                <>
                  <button type="button" className="btn-ghost" onClick={() => setSsiDetailId(null)} title="Back">
                    <FaArrowLeft />
                  </button>
                  <span className="ssi-panel-title">{detailSsi.account_holder_name || "Unnamed party"}</span>
                </>
              ) : (
                <span className="ssi-panel-title">
                  {rightPanelView === "ssi-borrower" ? "Borrower" : "Lender"} Standing Instructions ({activeSsiList.length})
                </span>
              )}
            </div>

            <div className="ssi-panel-body">
              {detailSsi ? (
                <div className="ssi-detail">
                  <div className="sidebar-row">
                    <span>Account holder</span>
                    <strong>{detailSsi.account_holder_name || "—"}</strong>
                  </div>
                  <div className="sidebar-row">
                    <span>Bank</span>
                    <strong>{detailSsi.bank_name || "—"}</strong>
                  </div>
                  <div className="sidebar-row">
                    <span>Account number</span>
                    <strong>{detailSsi.masked_account_number}</strong>
                  </div>
                  <div className="sidebar-row">
                    <span>Status</span>
                    <span className={`status-pill ssi-status-${detailSsi.status}`}>
                      {SSI_STATUS_LABELS[detailSsi.status] || detailSsi.status}
                    </span>
                  </div>
                  <div className="sidebar-row">
                    <span>Loan IQ reference</span>
                    <strong>{detailSsi.loan_iq_reference || "—"}</strong>
                  </div>
                  <div className="sidebar-row">
                    <span>Evidence</span>
                    <button
                      type="button"
                      className="evidence-link"
                      onClick={() => handleViewEvidence(detailSsi)}
                      title="Open the source document with the detected bank details highlighted"
                    >
                      <FaHighlighter /> {detailSsi.document_filename}
                    </button>
                  </div>
                  <div className="sidebar-row">
                    <span>Added by</span>
                    <strong>{detailSsi.added_by.name}</strong>
                  </div>
                  <div className="sidebar-row">
                    <span>Submitted</span>
                    <strong>{formatTime(detailSsi.submitted_at)}</strong>
                  </div>
                  {detailSsi.validated_by && (
                    <div className="sidebar-row">
                      <span>Validated by</span>
                      <strong>{detailSsi.validated_by.name}</strong>
                    </div>
                  )}
                  {detailSsi.validated_at && (
                    <div className="sidebar-row">
                      <span>Validated at</span>
                      <strong>{formatTime(detailSsi.validated_at)}</strong>
                    </div>
                  )}

                  {detailSsi.status === "pending_checker_review" && user.role === "checker" && (
                    <button
                      type="button"
                      className="btn-approve"
                      onClick={() => setValidatingSsi(detailSsi)}
                    >
                      <FaCheckCircle /> Approve
                    </button>
                  )}
                </div>
              ) : activeSsiList.length === 0 ? (
                <p className="muted small" style={{ padding: "1rem" }}>No standing instructions yet.</p>
              ) : (
                <div className="ssi-list">
                  {activeSsiList.map((ssi) => (
                    <div key={ssi.id} className="ssi-row">
                      <div className="ssi-row-main">
                        <strong>{ssi.account_holder_name || "Unnamed party"}</strong>
                        <span className="muted small">{ssi.masked_account_number}</span>
                      </div>
                      <div className="ssi-row-meta">
                        <span className={`status-pill ssi-status-${ssi.status}`}>
                          {SSI_STATUS_LABELS[ssi.status] || ssi.status}
                        </span>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => handleViewEvidence(ssi)}
                          title="View evidence document"
                        >
                          <FaHighlighter />
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => setSsiDetailId(ssi.id)}
                          title="View details"
                        >
                          <FaEye />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      </div>
      </div>

      {showDrawer && (
        <div className="drawer-overlay" onClick={() => setShowDrawer(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>Deal Details</h2>
              <button className="btn-ghost" onClick={() => setShowDrawer(false)}>
                <FaTimes />
              </button>
            </div>
            <div className="accordion">
              <AccordionItem title="Deal Detail" defaultOpen>
                <div className="sidebar-row">
                  <span>Reference</span>
                  <strong>{deal.reference}</strong>
                </div>
                <div className="sidebar-row">
                  <span>Product</span>
                  <strong>{meta.label}</strong>
                </div>
                <div className="sidebar-row">
                  <span>Status</span>
                  <strong className="capitalize">{deal.status}</strong>
                </div>

                <h3 style={{ marginTop: "1.25rem" }}>Members ({members.length})</h3>
                <div className="member-list">
                  {members.map((m) => (
                    <div key={m.id} className="member-row">
                      <Avatar name={m.name} size={26} role={m.role} />
                      <div className="member-row-info">
                        <strong>{m.name}</strong>
                        <span className="muted">{ROLE_LABELS[m.role] || m.role}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionItem>

              <AccordionItem title="Signal Board">
                <p className="muted small">Checkpoints and Checker verification are coming in a future update.</p>
              </AccordionItem>

              <AccordionItem title={`Activity Log (${activity.length})`}>
                {activity.length === 0 ? (
                  <p className="muted small">No activity yet.</p>
                ) : (
                  <div className="activity-list">
                    {activity
                      .slice()
                      .reverse()
                      .map((item, i) => {
                        const Icon = ACTIVITY_ICONS[item.event_type] || FaFlag;
                        const text =
                          item.description.length > 120
                            ? item.description.slice(0, 120) + "…"
                            : item.description;
                        return (
                          <div key={i} className="activity-row">
                            <Icon className="activity-icon" />
                            <div className="activity-row-body">
                              <div className="activity-row-meta">
                                <strong>{item.actor_name}</strong>
                                <span className="muted small">{formatTime(item.timestamp)}</span>
                              </div>
                              <p className="small">{text}</p>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </AccordionItem>
            </div>
          </div>
        </div>
      )}

      {validatingSsi && (
        <Modal
          title={`Validate — ${validatingSsi.account_holder_name || "Unnamed party"}`}
          onClose={() => {
            setValidatingSsi(null);
            setValidateInput("");
          }}
        >
          <form className="modal-form" onSubmit={handleValidateSubmit}>
            <p className="muted small">
              Open the source document (left panel) and re-type the account number exactly as it
              appears there. This is a blind check — the extracted number is never shown to you.
            </p>
            <label>Account number</label>
            <input
              value={validateInput}
              onChange={(e) => setValidateInput(e.target.value)}
              placeholder="Re-type the account number"
              autoFocus
              required
            />
            <button type="submit" disabled={validating}>
              {validating ? "Checking..." : "Confirm"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default DealRoomPage;
