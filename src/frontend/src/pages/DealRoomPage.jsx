import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import { FaPaperPlane, FaBuilding, FaIndustry, FaHome, FaBars, FaTimes, FaFileAlt, FaFolder, FaUpload, FaCloudUploadAlt, FaDownload, FaComments, FaFlag, FaRobot, FaUserTie, FaUniversity, FaEye, FaArrowLeft, FaCheckCircle, FaHighlighter, FaExchangeAlt } from "react-icons/fa";
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
  compareDocuments,
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

function formatDateTime(isoString) {
  return new Date(isoString).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

// Agent replies are plain text built from f-strings/joins in agent_skills.py
// ("  - name" bullets, "Header:" lines) — this gives that structure real
// visual shape (bullets, bold headers) instead of a flat wall of text.
function formatBotMessage(text) {
  return text.split("\n").map((line, i) => {
    const trimmed = line.trim();
    if (trimmed === "") return <div key={i} className="bot-message-spacer" />;
    if (trimmed.startsWith("- ")) {
      return (
        <div key={i} className="bot-message-bullet">
          {trimmed.slice(2)}
        </div>
      );
    }
    if (trimmed.endsWith(":") && trimmed.length < 60) {
      return (
        <div key={i} className="bot-message-heading">
          {trimmed}
        </div>
      );
    }
    return <div key={i}>{line}</div>;
  });
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
  const [slashQuery, setSlashQuery] = useState(null);
  const [docQuery, setDocQuery] = useState(null);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showDocPanel, setShowDocPanel] = useState(true);
  const [showChatPanel, setShowChatPanel] = useState(true);
  const [rightPanelView, setRightPanelView] = useState("chat"); // "chat" | "ssi-borrower" | "ssi-lender"
  const [ssiDetailId, setSsiDetailId] = useState(null);
  const [resizeTick, setResizeTick] = useState(0);
  const [compareSelection, setCompareSelection] = useState([]);
  const [compareResult, setCompareResult] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [panelsBeforeCompare, setPanelsBeforeCompare] = useState(null);
  const chatBoxRef = useRef(null);
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

  // "#zoom=page-width" only fits the PDF to the iframe's width at the
  // moment it loads — the browser's built-in viewer doesn't keep re-fitting
  // on its own afterward. Bumping resizeTick changes the iframe's src
  // string (see below), which forces it to reload and refit against
  // whatever width is available right now. Debounced on window resize;
  // immediate when a side panel opens/closes, since that also changes the
  // preview's available width without the window itself resizing.
  useEffect(() => {
    let timeout;
    function handleResize() {
      clearTimeout(timeout);
      timeout = setTimeout(() => setResizeTick((t) => t + 1), 250);
    }
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    setResizeTick((t) => t + 1);
  }, [showDocPanel, showChatPanel]);

  async function handlePreviewClick(doc) {
    setCompareResult(null);
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

  // FR-6: at most 2 documents selected at a time for comparison — picking a
  // 3rd drops the oldest selection rather than blocking the click.
  function toggleCompareSelect(docId) {
    setCompareSelection((prev) => {
      if (prev.includes(docId)) return prev.filter((id) => id !== docId);
      if (prev.length >= 2) return [prev[1], docId];
      return [...prev, docId];
    });
  }

  async function runCompare() {
    if (compareSelection.length !== 2) return;
    setComparing(true);
    try {
      // Older document (by upload time) always goes on the left, newer on
      // the right — regardless of which order the two were checked in.
      const [first, second] = compareSelection
        .map((id) => documents.find((d) => d.id === id))
        .sort((a, b) => new Date(a.uploaded_at) - new Date(b.uploaded_at));
      const result = await compareDocuments(dealId, first.id, second.id);
      setCompareResult(result);
      setPreviewDoc(null);
      setPreviewUrl(null);
      // Compare mode gets the whole window — collapse the side panels,
      // remembering their state so closing the diff can restore it.
      setPanelsBeforeCompare({ doc: showDocPanel, chat: showChatPanel });
      setShowDocPanel(false);
      setShowChatPanel(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setComparing(false);
    }
  }

  function closeCompare() {
    setCompareResult(null);
    setCompareSelection([]);
    if (panelsBeforeCompare) {
      setShowDocPanel(panelsBeforeCompare.doc);
      setShowChatPanel(panelsBeforeCompare.chat);
      setPanelsBeforeCompare(null);
    }
  }

  // Shared by both a version family's head row and its greyed-out older
  // versions — same file button + a checkbox for FR-6 compare-selection,
  // just an extra "indented, under the tree line" class for old versions.
  function renderDocRow(doc, indented = false) {
    return (
      <div key={doc.id} className={`doc-file-row ${indented ? "doc-version-child" : ""}`}>
        <input
          type="checkbox"
          className="doc-compare-checkbox"
          checked={compareSelection.includes(doc.id)}
          onChange={() => toggleCompareSelect(doc.id)}
          title="Select to compare"
        />
        <button
          type="button"
          className={`doc-file-link ${previewDoc?.id === doc.id ? "active" : ""}`}
          onClick={() => handlePreviewClick(doc)}
          title={doc.original_filename}
        >
          <FaFileAlt /> <span>{doc.original_filename}</span>
        </button>
      </div>
    );
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
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
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

  // FR-6: groups each folder's flat document list into version families —
  // a "head" (the current, un-superseded version) plus its chain of older
  // versions, walked backward via supersedes_id. A document with no version
  // history is just a head with an empty chain.
  const documentTreeByFolder = useMemo(() => {
    const tree = {};
    FOLDER_CATEGORIES.forEach((category) => {
      const docsInFolder = documents.filter((d) => d.folder === category);
      const byId = new Map(docsInFolder.map((d) => [d.id, d]));
      const supersededIds = new Set(docsInFolder.map((d) => d.supersedes_id).filter((id) => id != null));
      const heads = docsInFolder.filter((d) => !supersededIds.has(d.id));
      tree[category] = heads.map((head) => {
        const chain = [];
        let current = head;
        while (current.supersedes_id != null && byId.has(current.supersedes_id)) {
          current = byId.get(current.supersedes_id);
          chain.push(current);
        }
        return { head, chain };
      });
    });
    return tree;
  }, [documents]);

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

  // "/" is a shortcut straight to an agent skill — same commands as
  // "@AgentName <command>", just faster to reach for without typing the
  // agent's full name first.
  const slashSuggestions = useMemo(() => {
    if (slashQuery === null) return [];
    const q = slashQuery.toLowerCase();
    return agentCommands.filter((c) => c.name.toLowerCase().includes(q));
  }, [slashQuery, agentCommands]);

  // "#" references a specific document already in this deal — inserted as
  // plain "#filename" text (not parsed by the backend), a fast way to point
  // at a file while talking to a person or the agent.
  const docSuggestions = useMemo(() => {
    if (docQuery === null) return [];
    const q = docQuery.toLowerCase();
    return documents.filter((d) => d.original_filename.toLowerCase().includes(q)).slice(0, 8);
  }, [docQuery, documents]);

  function clearTriggers() {
    setMentionQuery(null);
    setCommandQuery(null);
    setSlashQuery(null);
    setDocQuery(null);
  }

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
        clearTriggers();
        setCommandQuery(commandMatch[1]);
        return;
      }
    }

    const mentionMatch = before.match(/@(\w*)$/);
    if (mentionMatch) {
      clearTriggers();
      setMentionQuery(mentionMatch[1]);
      return;
    }

    const slashMatch = before.match(/\/(\w*)$/);
    if (slashMatch) {
      clearTriggers();
      setSlashQuery(slashMatch[1]);
      return;
    }

    const docMatch = before.match(/#([\w.\-]*)$/);
    if (docMatch) {
      clearTriggers();
      setDocQuery(docMatch[1]);
      return;
    }

    clearTriggers();
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

  function selectSlashCommand(commandName) {
    if (!agentUser) return;
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const newBefore = before.replace(/\/(\w*)$/, `@${agentUser.username} ${commandName} `);
    const newText = newBefore + after;
    setText(newText);
    setSlashQuery(null);
    inputRef.current?.focus();
  }

  function selectDocument(doc) {
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const newBefore = before.replace(/#([\w.\-]*)$/, `#${doc.original_filename} `);
    const newText = newBefore + after;
    setText(newText);
    setDocQuery(null);
    inputRef.current?.focus();
  }

  async function handleSend(event) {
    event.preventDefault();
    if (!text.trim()) return;
    await postMessage(dealId, text);
    setText("");
    clearTriggers();
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
            className={`icon-rail-btn borrower-rail-btn ${showChatPanel && rightPanelView === "ssi-borrower" ? "active" : ""}`}
            onClick={() => toggleRightPanel("ssi-borrower")}
            title="SSI — Borrower"
          >
            <FaUserTie />
            {borrowerPendingCount > 0 && <span className="rail-badge">{borrowerPendingCount}</span>}
          </button>
          <button
            type="button"
            className={`icon-rail-btn lender-rail-btn ${showChatPanel && rightPanelView === "ssi-lender" ? "active" : ""}`}
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
            <div className="doc-explorer-header-actions">
              <button
                type="button"
                className="btn-ghost doc-compare-trigger"
                onClick={compareSelection.length === 2 ? runCompare : undefined}
                disabled={compareSelection.length !== 2 || comparing}
                title={compareSelection.length === 2 ? (comparing ? "Comparing..." : "Compare selected files") : "Select 2 files to compare"}
              >
                <FaExchangeAlt />
                {compareSelection.length > 0 && <span className="rail-badge">{compareSelection.length}</span>}
              </button>
              <button type="button" className="btn-ghost" onClick={open} title="Upload documents" disabled={uploading}>
                <FaUpload />
              </button>
            </div>
          </div>
          {uploading && <p className="muted small">Uploading...</p>}
          {compareSelection.length > 0 && (
            <div className="compare-bar">
              <span className="muted small">{compareSelection.length} of 2 selected</span>
              <button type="button" className="btn-ghost" onClick={() => setCompareSelection([])} title="Clear selection">
                <FaTimes /> Clear
              </button>
            </div>
          )}
          {FOLDER_CATEGORIES.map((category) => {
            const docFamilies = documentTreeByFolder[category] || [];
            return (
              <AccordionItem
                key={category}
                title={
                  <span className="doc-folder-title">
                    <FaFolder />
                    <span className="doc-folder-title-text">{category} ({documents.filter((d) => d.folder === category).length})</span>
                  </span>
                }
              >
                {docFamilies.length === 0 ? (
                  <p className="muted small">No documents yet</p>
                ) : (
                  <div className="doc-file-list">
                    {docFamilies.map(({ head, chain }) => (
                      <div key={head.id} className="doc-version-group">
                        {renderDocRow(head)}
                        {chain.length > 0 && (
                          <div className="doc-version-children">
                            {chain.map((doc) => renderDocRow(doc, true))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </AccordionItem>
            );
          })}
        </aside>

        <div className="doc-preview-panel">
          {compareResult ? (
            <>
              <div className="doc-preview-header">
                <span className="doc-preview-title" title={`${compareResult.document_a.original_filename} vs ${compareResult.document_b.original_filename}`}>
                  <FaExchangeAlt /> {compareResult.document_a.original_filename} <span className="muted">vs</span> {compareResult.document_b.original_filename}
                </span>
                <div className="doc-preview-actions">
                  <button type="button" className="btn-ghost" onClick={closeCompare} title="Close diff">
                    <FaTimes />
                  </button>
                </div>
              </div>
              <div className="diff-view">
                <div className="diff-col-headers">
                  <span>{compareResult.document_a.original_filename}</span>
                  <span>{compareResult.document_b.original_filename}</span>
                </div>
                {compareResult.rows.map((row, i) => (
                  <div key={i} className={`diff-row diff-row-${row.type}`}>
                    <div className="diff-col diff-col-left">
                      {row.left_segments &&
                        row.left_segments.map((seg, j) => (
                          <span key={j} className={seg.changed ? "diff-seg-removed" : ""}>
                            {seg.text}
                          </span>
                        ))}
                    </div>
                    <div className="diff-col diff-col-right">
                      {row.right_segments &&
                        row.right_segments.map((seg, j) => (
                          <span key={j} className={seg.changed ? "diff-seg-added" : ""}>
                            {seg.text}
                          </span>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : previewLoading ? (
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
                src={`${previewUrl}#zoom=page-width&t=${resizeTick}`}
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
          <div className="chat-panel-header">
            <span className="ssi-panel-title">Chat</span>
            <button type="button" className="btn-ghost" onClick={() => setShowChatPanel(false)} title="Close chat">
              <FaTimes />
            </button>
          </div>
          <div className="chat-box" ref={chatBoxRef}>
            {messages.length === 0 && (
              <p className="muted" style={{ textAlign: "center", marginTop: "2rem" }}>
                No messages yet — say hello to get the deal moving. Type @ to mention someone.
              </p>
            )}
            {messages
              .map((m) => {
                const isBot = m.user.role === "agent";
                return (
                  <div key={m.id} className={`message-row ${isBot ? `bot-message-box level-${m.level}` : ""}`}>
                    <Avatar name={m.user.name} size={36} role={m.user.role} />
                    <div className="message-content">
                      <div className="message-meta">
                        <strong>{m.user.name}</strong>
                      </div>
                      {isBot ? (
                        <div className="message-text">{formatBotMessage(m.text)}</div>
                      ) : (
                        <p className="message-text">{renderMessageText(m.text, usersByUsername)}</p>
                      )}
                      <div className="message-timestamp">{formatDateTime(m.created_at)}</div>
                    </div>
                  </div>
                );
              })}
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
            ) : mentionQuery !== null && mentionSuggestions.length > 0 ? (
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
            ) : slashQuery !== null && slashSuggestions.length > 0 ? (
              <div className="mention-dropdown">
                {slashSuggestions.map((c) => (
                  <div key={c.name} className="mention-item" onMouseDown={() => selectSlashCommand(c.name)}>
                    <div className="mention-item-info">
                      <strong>/{c.name}</strong>
                      <span className="muted">{c.help}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              docQuery !== null && docSuggestions.length > 0 && (
                <div className="mention-dropdown">
                  {docSuggestions.map((d) => (
                    <div key={d.id} className="mention-item" onMouseDown={() => selectDocument(d)}>
                      <FaFileAlt />
                      <div className="mention-item-info">
                        <strong>{d.original_filename}</strong>
                        <span className="muted">{d.folder}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
            <div className="chat-input">
              <input
                ref={inputRef}
                placeholder="Type a message... @ to mention, / for a skill, # for a document"
                value={text}
                onChange={handleTextChange}
                onBlur={() => setTimeout(clearTriggers, 150)}
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
              <button
                type="button"
                className="btn-ghost ssi-panel-close"
                onClick={() => setShowChatPanel(false)}
                title="Close panel"
              >
                <FaTimes />
              </button>
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

                  <h3 style={{ marginTop: "1.25rem" }}>Activity</h3>
                  {detailSsi.activity.length === 0 ? (
                    <p className="muted small">No recorded activity yet.</p>
                  ) : (
                    <div className="ssi-activity-list">
                      {detailSsi.activity.map((a, i) => (
                        <div key={i} className={`ssi-activity-item bot-message-box level-${a.level}`}>
                          <div className="message-meta">
                            <strong>{a.actor_name}</strong>
                          </div>
                          <div className="message-text">{a.text}</div>
                          <div className="message-timestamp">{formatDateTime(a.created_at)}</div>
                        </div>
                      ))}
                    </div>
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
                        const isBot = item.actor_role === "agent";
                        const text =
                          item.description.length > 120
                            ? item.description.slice(0, 120) + "…"
                            : item.description;
                        return (
                          <div key={i} className={`activity-row ${isBot ? `bot-message-box level-${item.level}` : ""}`}>
                            <Icon className="activity-icon" />
                            <div className="activity-row-body">
                              <div className="activity-row-meta">
                                <strong>{item.actor_name}</strong>
                              </div>
                              <p className="small">{text}</p>
                              <div className="message-timestamp">{formatDateTime(item.timestamp)}</div>
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
