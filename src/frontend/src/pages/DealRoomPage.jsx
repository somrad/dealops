import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import { FaPaperPlane, FaBuilding, FaIndustry, FaHome, FaBars, FaTimes, FaFileAlt, FaFolder, FaUpload, FaCloudUploadAlt, FaDownload, FaComments, FaFlag, FaRobot, FaUserTie, FaUniversity, FaUsers, FaEye, FaArrowLeft, FaCheckCircle, FaHighlighter, FaExchangeAlt, FaEllipsisV, FaTrashAlt, FaShare, FaSitemap, FaHandHoldingUsd, FaFileInvoiceDollar, FaClipboardCheck } from "react-icons/fa";
import { GiPoliceOfficerHead } from "react-icons/gi";
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
  moveDocument,
  listAgentCommands,
  listStandingInstructions,
  validateStandingInstruction,
  listDealActivity,
  getFundingDocument,
  generateFundingDocument,
  uploadFundingDocument,
} from "../api";
import Avatar from "../components/Avatar";
import AccordionItem from "../components/AccordionItem";
import Modal from "../components/Modal";
import Brand from "../components/Brand";
import ProfileMenu from "../components/ProfileMenu";

const ACTIVITY_ICONS = {
  deal_created: FaFlag,
  llm_call: FaRobot,
  message: FaComments,
};

const SSI_STATUS_LABELS = {
  pending_checker_review: "Pending review",
  checker_validated: "Validated",
  rejected: "Rejected",
  superseded: "Superseded",
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
// A document only ever reaches "Deleted" via an explicit move, never
// classification — kept out of this list so it never shows as a normal
// working folder, and rendered as its own separate, muted section instead.
const FOLDER_CATEGORIES = ["Borrower", "Lenders", "Credit Verification", "Funding Docs", "3rd Party Providers", "Unfiled"];

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
// A short "Label: value" line (describe's output shape) — rendered as a
// real two-column row instead of running the colon together with prose, so
// /describe reads as a proper table in the chat window instead of a wall
// of text. Label capped short so an ordinary sentence with a colon further
// in (rare, but possible) doesn't get misread as a table row.
const TABLE_ROW_PATTERN = /^([A-Za-z][A-Za-z0-9 /'-]{1,28}):\s+(.+)$/;

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
    const tableMatch = trimmed.match(TABLE_ROW_PATTERN);
    if (tableMatch) {
      return (
        <div key={i} className="bot-table-row">
          <span className="bot-table-label">{tableMatch[1]}</span>
          <span className="bot-table-value">{tableMatch[2]}</span>
        </div>
      );
    }
    return <div key={i}>{line}</div>;
  });
}

function DealRoomPage({ user, onLogout }) {
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
  const [moveMenuDocId, setMoveMenuDocId] = useState(null);
  const [moving, setMoving] = useState(false);
  const [fundingDoc, setFundingDoc] = useState(null);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [generateForm, setGenerateForm] = useState({ loan_amount: "", interest_rate: "", upfront_fee: "", legal_fee: "", interest_amount: "", lead_agent_fee: "", currency: "USD" });
  const [generatingFunding, setGeneratingFunding] = useState(false);
  const [uploadingFunding, setUploadingFunding] = useState(false);
  const chatBoxRef = useRef(null);
  const inputRef = useRef(null);
  const fundingFileInputRef = useRef(null);

  useEffect(() => {
    getDeal(dealId).then(setDeal);
    listUsers().then(setAllUsers);
    listAgentCommands().then(setAgentCommands);
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [dealId]);

  function refresh() {
    listMessages(dealId).then(setMessages);
    listDealMembers(dealId).then(setMembers);
    listDocuments(dealId).then(setDocuments);
    listStandingInstructions(dealId).then(setStandingInstructions);
    listDealActivity(dealId).then(setActivity);
    getFundingDocument(dealId).then(setFundingDoc);
  }

  useEffect(() => {
    if (moveMenuDocId === null) return;
    function closeMenu() {
      setMoveMenuDocId(null);
    }
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, [moveMenuDocId]);

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

  // A wrongly-classified document can be corrected by hand; moving it to a
  // real folder re-triggers extraction if it hasn't already produced an SSI
  // (backend-side, so no duplicate SSIs on a repeated/no-op move). Deleting
  // is the same call with folder="Deleted" — no separate mechanism.
  async function handleMove(doc, folder) {
    setMoveMenuDocId(null);
    if (folder === doc.folder) return;
    setMoving(true);
    try {
      await moveDocument(dealId, doc.id, folder);
      if (previewDoc?.id === doc.id) closePreview();
      refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setMoving(false);
    }
  }

  // FR-13: Deal-Team-only. Backend also enforces this — the button is
  // hidden for other roles below, but the real gate is server-side.
  async function handleGenerateFunding(event) {
    event.preventDefault();
    setGeneratingFunding(true);
    try {
      const payload = {
        loan_amount: parseFloat(generateForm.loan_amount) || 0,
        interest_rate: parseFloat(generateForm.interest_rate) || 0,
        upfront_fee: parseFloat(generateForm.upfront_fee) || 0,
        legal_fee: parseFloat(generateForm.legal_fee) || 0,
        interest_amount: parseFloat(generateForm.interest_amount) || 0,
        lead_agent_fee: parseFloat(generateForm.lead_agent_fee) || 0,
        currency: generateForm.currency || "USD",
      };
      const result = await generateFundingDocument(dealId, payload);
      setFundingDoc(result);
      setShowGenerateForm(false);
      refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setGeneratingFunding(false);
    }
  }

  async function handleUploadFunding(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadingFunding(true);
    try {
      const result = await uploadFundingDocument(dealId, file);
      setFundingDoc(result);
      refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setUploadingFunding(false);
    }
  }

  // FR-14's actual gating rule, made visible: "Ready" needs both — the
  // party is confirmed present in the fund flow document AND its own
  // Standing Instruction is Checker-validated. "no_ssi_on_file" is its own
  // distinct label (not "awaiting validation") since nothing is actually
  // pending there — this deal just never extracted one for that party
  // (e.g. a co-lender whose SSI was set up on a previous deal and reused).
  function remitReadiness(entry) {
    const ready = entry.confirmed && entry.status === "checker_validated";
    let label;
    if (ready) label = "Ready";
    else if (entry.status === "no_ssi_on_file") label = "No SSI on file in this deal";
    else if (!entry.confirmed) label = "Not in document";
    else label = "Awaiting validation";
    return { ready, label };
  }

  function renderReconciliationGroups(reconciliation, filterFn) {
    return [
      ["borrower", "Borrower"],
      ["lenders", "Lenders"],
      ["third_party", "3rd Party Providers"],
    ].map(([key, label]) => {
      const entries = filterFn ? reconciliation[key].filter(filterFn) : reconciliation[key];
      return (
        <div key={key} className="remit-group">
          <h3>{label}</h3>
          {entries.length === 0 ? (
            <p className="muted small">{filterFn ? "Nothing here needs your review." : "No participants on file."}</p>
          ) : (
            entries.map((e, i) => {
              const { ready, label: statusLabel } = remitReadiness(e);
              return (
                <div key={i} className="remit-row">
                  <span className="remit-row-name">{e.name}</span>
                  <span className={`remit-badge ${ready ? "remit-ready" : "remit-blocked"}`}>
                    {ready ? <FaCheckCircle /> : <FaTimes />} {statusLabel}
                  </span>
                </div>
              );
            })
          )}
        </div>
      );
    });
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
        <div className="doc-move-wrap">
          <button
            type="button"
            className="btn-ghost doc-move-trigger"
            onClick={(e) => {
              e.stopPropagation();
              setMoveMenuDocId(moveMenuDocId === doc.id ? null : doc.id);
            }}
            title="Move or delete"
            disabled={moving}
          >
            <FaEllipsisV />
          </button>
          {moveMenuDocId === doc.id && (
            <div className="doc-move-menu">
              <div className="doc-move-menu-label">Move to</div>
              {FOLDER_CATEGORIES.filter((f) => f !== doc.folder).map((f) => (
                <div key={f} className="doc-move-item" onMouseDown={() => handleMove(doc, f)}>
                  <FaShare /> {f}
                </div>
              ))}
              <div className="doc-move-menu-divider" />
              <div className="doc-move-item doc-move-delete" onMouseDown={() => handleMove(doc, "Deleted")}>
                <FaTrashAlt /> Delete
              </div>
            </div>
          )}
        </div>
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

  const deletedDocs = useMemo(() => documents.filter((d) => d.folder === "Deleted"), [documents]);

  // Deal Map — a quick census of the deal, assembled from data already in
  // state (no new endpoint needed; the shape mirrors what build_deal_context()
  // hands the agent for "describe"/"docs"/"ssi").
  const memberCountsByRole = useMemo(() => {
    const counts = {};
    members.forEach((m) => {
      if (m.role === "agent") return;
      counts[m.role] = (counts[m.role] || 0) + 1;
    });
    return counts;
  }, [members]);

  const docCountsByFolder = useMemo(() => {
    const counts = {};
    documents.forEach((d) => {
      counts[d.folder] = (counts[d.folder] || 0) + 1;
    });
    return counts;
  }, [documents]);

  const ssiCountsByStatus = useMemo(() => {
    const counts = {};
    standingInstructions.forEach((s) => {
      counts[s.status] = (counts[s.status] || 0) + 1;
    });
    return counts;
  }, [standingInstructions]);

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
  // Everything that isn't Borrower or Lenders — 3rd Party Providers, Unfiled,
  // and anything else FR-3's classifier might ever produce — one catch-all
  // tab rather than a growing list of per-folder ones.
  const otherSsis = useMemo(
    () => standingInstructions.filter((s) => s.document_folder !== "Borrower" && s.document_folder !== "Lenders"),
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
  const otherPendingCount = useMemo(
    () => otherSsis.filter((s) => s.status === "pending_checker_review").length,
    [otherSsis]
  );
  const activeSsiList =
    rightPanelView === "ssi-borrower" ? borrowerSsis :
    rightPanelView === "ssi-lender" ? lenderSsis :
    rightPanelView === "ssi-other" ? otherSsis : [];
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
          <Brand />
          <span className="topbar-divider" />
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
          <ProfileMenu user={user} onLogout={onLogout} />
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
          <button
            type="button"
            className={`icon-rail-btn other-rail-btn ${showChatPanel && rightPanelView === "ssi-other" ? "active" : ""}`}
            onClick={() => toggleRightPanel("ssi-other")}
            title="SSI — 3rd Party & Other"
          >
            <FaUsers />
            {otherPendingCount > 0 && <span className="rail-badge">{otherPendingCount}</span>}
          </button>
          <button
            type="button"
            className={`icon-rail-btn map-rail-btn ${showChatPanel && rightPanelView === "deal-map" ? "active" : ""}`}
            onClick={() => toggleRightPanel("deal-map")}
            title="Deal Map"
          >
            <FaSitemap />
          </button>
          {user.role === "deal_team" && (
            <button
              type="button"
              className={`icon-rail-btn remit-rail-btn ${showChatPanel && rightPanelView === "generate-funding" ? "active" : ""}`}
              onClick={() => toggleRightPanel("generate-funding")}
              title="Generate Fund Flow Document"
            >
              <FaFileInvoiceDollar />
            </button>
          )}
          {(user.role === "ops_team_member" || user.role === "ops_manager") && (
            <button
              type="button"
              className={`icon-rail-btn remit-rail-btn ${showChatPanel && rightPanelView === "remittances" ? "active" : ""}`}
              onClick={() => toggleRightPanel("remittances")}
              title="Remittances"
            >
              <FaHandHoldingUsd />
            </button>
          )}
          {user.role === "checker" && (
            <button
              type="button"
              className={`icon-rail-btn remit-rail-btn ${showChatPanel && rightPanelView === "remittance-checker" ? "active" : ""}`}
              onClick={() => toggleRightPanel("remittance-checker")}
              title="Remittances — Checker Approval"
            >
              <FaClipboardCheck />
            </button>
          )}
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
          <AccordionItem
            title={
              <span className="doc-folder-title doc-folder-title-deleted">
                <FaTrashAlt />
                <span className="doc-folder-title-text">Deleted ({deletedDocs.length})</span>
              </span>
            }
          >
            {deletedDocs.length === 0 ? (
              <p className="muted small">Nothing deleted</p>
            ) : (
              <div className="doc-file-list">
                {deletedDocs.map((doc) => renderDocRow(doc))}
              </div>
            )}
          </AccordionItem>
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
                // describe's reply always opens with "{title} ({reference})"
                // — a deterministic way to spot it without any new message
                // metadata, since chat messages are plain text end to end.
                const isDescribeReply = isBot && deal && m.text.startsWith(`${deal.title} (${deal.reference})`);
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
                      {isDescribeReply && (
                        <div className="bot-message-members">
                          {members.map((mem) => (
                            <Avatar key={mem.id} name={mem.name} size={26} role={mem.role} />
                          ))}
                        </div>
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

        {(rightPanelView === "ssi-borrower" || rightPanelView === "ssi-lender" || rightPanelView === "ssi-other") && (
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
                  {rightPanelView === "ssi-borrower" ? "Borrower" : rightPanelView === "ssi-lender" ? "Lender" : "3rd Party & Other"} Standing Instructions ({activeSsiList.length})
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
                  {detailSsi.assigned_checker && (
                    <div className="sidebar-row">
                      <span>Assigned to</span>
                      <strong title="No Checker was on this deal when this was extracted — routed here for oversight until one is added. Only a Checker can actually approve it.">
                        {detailSsi.assigned_checker.name}
                      </strong>
                    </div>
                  )}
                  <div className="sidebar-row">
                    <span>Loan IQ reference</span>
                    <strong>{detailSsi.loan_iq_reference || "—"}</strong>
                  </div>
                  <div className="sidebar-row">
                    <span>Evidence</span>
                    {detailSsi.document_filename ? (
                      <button
                        type="button"
                        className="evidence-link"
                        onClick={() => handleViewEvidence(detailSsi)}
                        title="Open the source document with the detected bank details highlighted"
                      >
                        <FaHighlighter /> {detailSsi.document_filename}
                      </button>
                    ) : (
                      <strong className="muted">Source document no longer available</strong>
                    )}
                  </div>
                  <div className="sidebar-row">
                    <span>Added by</span>
                    <strong>{detailSsi.added_by?.name || "—"}</strong>
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

        {rightPanelView === "deal-map" && (
          <div className="ssi-panel">
            <div className="ssi-panel-header">
              <span className="ssi-panel-title"><FaSitemap /> Deal Map</span>
              <button type="button" className="btn-ghost ssi-panel-close" onClick={() => setShowChatPanel(false)} title="Close panel">
                <FaTimes />
              </button>
            </div>
            <div className="ssi-panel-body">
              <h3>Deal</h3>
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
              {Object.entries(memberCountsByRole).map(([role, count]) => (
                <div className="sidebar-row" key={role}>
                  <span>{ROLE_LABELS[role] || role}</span>
                  <strong>{count}</strong>
                </div>
              ))}

              <h3 style={{ marginTop: "1.25rem" }}>Documents ({documents.length})</h3>
              {[...FOLDER_CATEGORIES, "Deleted"].map((folder) => (
                <div className="sidebar-row" key={folder}>
                  <span>{folder}</span>
                  <strong>{docCountsByFolder[folder] || 0}</strong>
                </div>
              ))}

              <h3 style={{ marginTop: "1.25rem" }}>Standing Instructions ({standingInstructions.length})</h3>
              {Object.keys(SSI_STATUS_LABELS).map((status) => (
                <div className="sidebar-row" key={status}>
                  <span>{SSI_STATUS_LABELS[status]}</span>
                  <strong>{ssiCountsByStatus[status] || 0}</strong>
                </div>
              ))}

              <h3 style={{ marginTop: "1.25rem" }}>Fund Flow Document</h3>
              <div className="sidebar-row">
                <span>Status</span>
                <strong>{fundingDoc?.document ? fundingDoc.document.original_filename : "Not created yet"}</strong>
              </div>
            </div>
          </div>
        )}

        {rightPanelView === "generate-funding" && (
          <div className="ssi-panel">
            <div className="ssi-panel-header">
              <span className="ssi-panel-title"><FaFileInvoiceDollar /> Generate Fund Flow Document</span>
              <button type="button" className="btn-ghost ssi-panel-close" onClick={() => setShowChatPanel(false)} title="Close panel">
                <FaTimes />
              </button>
            </div>
            <div className="ssi-panel-body">
              {!fundingDoc ? (
                <p className="muted small">Loading...</p>
              ) : !fundingDoc.document ? (
                <div className="funding-empty">
                  <p className="muted small">
                    No Fund Flow / Settlement and Closing Document yet. Remittances stay
                    blocked for every party until one exists.
                  </p>
                  <button type="button" onClick={() => setShowGenerateForm(true)}>
                    <FaFileAlt /> Generate from documents on file
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => fundingFileInputRef.current?.click()}
                    disabled={uploadingFunding}
                  >
                    <FaUpload /> {uploadingFunding ? "Uploading..." : "Upload settlement/closing PDF"}
                  </button>
                  <input
                    ref={fundingFileInputRef}
                    type="file"
                    accept="application/pdf"
                    style={{ display: "none" }}
                    onChange={handleUploadFunding}
                  />
                </div>
              ) : (
                <>
                  <div className="sidebar-row">
                    <span>Fund Flow Document</span>
                    <button type="button" className="evidence-link" onClick={() => handlePreviewClick(fundingDoc.document)}>
                      <FaFileAlt /> {fundingDoc.document.original_filename}
                    </button>
                  </div>

                  {renderReconciliationGroups(fundingDoc.reconciliation)}

                  <button type="button" className="btn-secondary" style={{ marginTop: "1rem" }} onClick={() => setShowGenerateForm(true)}>
                    <FaExchangeAlt /> Regenerate
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ marginTop: "0.5rem" }}
                    onClick={() => fundingFileInputRef.current?.click()}
                    disabled={uploadingFunding}
                  >
                    <FaUpload /> {uploadingFunding ? "Uploading..." : "Replace with upload"}
                  </button>
                  <input
                    ref={fundingFileInputRef}
                    type="file"
                    accept="application/pdf"
                    style={{ display: "none" }}
                    onChange={handleUploadFunding}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {rightPanelView === "remittances" && (
          <div className="ssi-panel">
            <div className="ssi-panel-header">
              <span className="ssi-panel-title"><FaHandHoldingUsd /> Remittances</span>
              <button type="button" className="btn-ghost ssi-panel-close" onClick={() => setShowChatPanel(false)} title="Close panel">
                <FaTimes />
              </button>
            </div>
            <div className="ssi-panel-body">
              {!fundingDoc ? (
                <p className="muted small">Loading...</p>
              ) : !fundingDoc.document ? (
                <p className="muted small">
                  No Fund Flow / Settlement and Closing Document yet — ask a Deal Team member
                  to generate or upload one before any remittance can move.
                </p>
              ) : (
                <>
                  <div className="sidebar-row">
                    <span>Fund Flow Document</span>
                    <button type="button" className="evidence-link" onClick={() => handlePreviewClick(fundingDoc.document)}>
                      <FaFileAlt /> {fundingDoc.document.original_filename}
                    </button>
                  </div>
                  {renderReconciliationGroups(fundingDoc.reconciliation)}
                </>
              )}
            </div>
          </div>
        )}

        {rightPanelView === "remittance-checker" && (
          <div className="ssi-panel">
            <div className="ssi-panel-header">
              <span className="ssi-panel-title"><FaClipboardCheck /> Remittances — Checker Approval</span>
              <button type="button" className="btn-ghost ssi-panel-close" onClick={() => setShowChatPanel(false)} title="Close panel">
                <FaTimes />
              </button>
            </div>
            <div className="ssi-panel-body">
              {!fundingDoc ? (
                <p className="muted small">Loading...</p>
              ) : !fundingDoc.document ? (
                <p className="muted small">No Fund Flow / Settlement and Closing Document yet.</p>
              ) : (
                <>
                  <p className="muted small">
                    Parties still blocking remittance — validate via the Borrower/Lender SSI
                    panels (left rail). Blind re-entry happens there, not here.
                  </p>
                  {renderReconciliationGroups(
                    fundingDoc.reconciliation,
                    (e) => !(e.confirmed && e.status === "checker_validated")
                  )}
                </>
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

      {showGenerateForm && (
        <Modal title="Generate Fund Flow Document" onClose={() => setShowGenerateForm(false)}>
          <form className="modal-form" onSubmit={handleGenerateFunding}>
            <p className="muted small">
              Borrower, Lender, and 3rd Party Provider names are pulled automatically from
              standing instructions already on file — just the loan economics below.
            </p>
            <label>Loan amount</label>
            <input
              type="number" step="0.01" required autoFocus
              value={generateForm.loan_amount}
              onChange={(e) => setGenerateForm({ ...generateForm, loan_amount: e.target.value })}
            />
            <label>Interest rate (% per annum)</label>
            <input
              type="number" step="0.001" required
              value={generateForm.interest_rate}
              onChange={(e) => setGenerateForm({ ...generateForm, interest_rate: e.target.value })}
            />
            <label>Upfront / origination fee</label>
            <input
              type="number" step="0.01"
              value={generateForm.upfront_fee}
              onChange={(e) => setGenerateForm({ ...generateForm, upfront_fee: e.target.value })}
            />
            <label>Legal fee</label>
            <input
              type="number" step="0.01"
              value={generateForm.legal_fee}
              onChange={(e) => setGenerateForm({ ...generateForm, legal_fee: e.target.value })}
            />
            <label>Prepaid interest</label>
            <input
              type="number" step="0.01"
              value={generateForm.interest_amount}
              onChange={(e) => setGenerateForm({ ...generateForm, interest_amount: e.target.value })}
            />
            <label>Lead agent fee</label>
            <input
              type="number" step="0.01"
              value={generateForm.lead_agent_fee}
              onChange={(e) => setGenerateForm({ ...generateForm, lead_agent_fee: e.target.value })}
            />
            <label>Currency</label>
            <input
              value={generateForm.currency}
              onChange={(e) => setGenerateForm({ ...generateForm, currency: e.target.value })}
            />
            <button type="submit" disabled={generatingFunding}>
              {generatingFunding ? "Generating..." : "Generate"}
            </button>
          </form>
        </Modal>
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
            <div className="shisa-kanko-icon">
              <GiPoliceOfficerHead />
            </div>
            <p className="shisa-kanko-label">Shisa Kanko — Point and Call</p>
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
