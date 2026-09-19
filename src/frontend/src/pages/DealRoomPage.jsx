import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import { FaPaperPlane, FaBuilding, FaHome, FaBars, FaTimes, FaFileAlt, FaFolder, FaUpload, FaCloudUploadAlt, FaDownload } from "react-icons/fa";
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
  listAgentCommands,
} from "../api";
import Avatar from "../components/Avatar";
import AccordionItem from "../components/AccordionItem";

const PRODUCT_META = {
  commercial_loan: { label: "Commercial Loan", icon: FaBuilding },
  real_estate_loan: { label: "Real Estate Loan", icon: FaHome },
};

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

  const meta = PRODUCT_META[deal.product_type] || { label: deal.product_type, icon: FaBuilding };
  const Icon = meta.icon;

  return (
    <div className="deal-room-page-v2">
      <div className="deal-top-bar">
        <div className="deal-top-bar-main">
          <div className="deal-room-icon">
            <Icon />
          </div>
          <h1>{deal.title}</h1>
          <span className="muted">{deal.reference} · {meta.label}</span>
          <span className={`status-pill status-${deal.status}`}>{deal.status}</span>
        </div>
        <button className="btn-ghost drawer-trigger" onClick={() => setShowDrawer(true)} title="Deal details">
          <FaBars />
        </button>
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
        </div>

      <div className={`deal-room-body-v2 ${showDocPanel ? "with-doc-panel" : ""}`} {...getRootProps()}>
        <input {...getInputProps({ style: { display: "none" } })} />
        {isDragActive && (
          <div className="drop-overlay">
            <FaCloudUploadAlt size={40} />
            <p>Drop files to upload</p>
          </div>
        )}

        <aside className="doc-explorer">
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
              <iframe src={previewUrl} title={previewDoc.original_filename} className="doc-preview-frame" />
            </>
          ) : (
            <div className="doc-preview-empty">
              <FaFileAlt size={36} />
              <p className="muted">Select a document on the left to preview it here.</p>
            </div>
          )}
        </div>

        <div className="chat-panel-v2">
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

              <AccordionItem title="Standing Instructions">
                <p className="muted small">Coming soon.</p>
              </AccordionItem>

              <AccordionItem title="Activity Log">
                <p className="muted small">Coming soon.</p>
              </AccordionItem>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DealRoomPage;
