// Local dev talks to the backend directly; a deployed build sets
// VITE_API_BASE=/api at build time so requests go same-origin through the
// reverse proxy instead (see the VM's Caddyfile) — no CORS involved either way.
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

function getToken() {
  return localStorage.getItem("token");
}

function setToken(token) {
  localStorage.setItem("token", token);
}

async function apiRequest(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Something went wrong" }));
    throw new Error(error.detail);
  }
  return response.json();
}

export async function login(username, password) {
  const data = await apiRequest("/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setToken(data.token);
  return data.user;
}

export function logout() {
  localStorage.removeItem("token");
}

export function listDeals() {
  return apiRequest("/deals");
}

export function createDeal(reference, title, productType) {
  return apiRequest("/deals", {
    method: "POST",
    body: JSON.stringify({ reference, title, product_type: productType }),
  });
}

export function getDeal(dealId) {
  return apiRequest(`/deals/${dealId}`);
}

export function listMessages(dealId) {
  return apiRequest(`/deals/${dealId}/messages`);
}

export function postMessage(dealId, text) {
  return apiRequest(`/deals/${dealId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function listUsers() {
  return apiRequest("/users");
}

export function listDealMembers(dealId) {
  return apiRequest(`/deals/${dealId}/members`);
}

export function listAgentCommands() {
  return apiRequest("/agent-commands");
}

export function listDocuments(dealId) {
  return apiRequest(`/deals/${dealId}/documents`);
}

// Also how a document is "deleted" — moving it to the special "Deleted"
// folder, same endpoint, no separate delete call.
export function moveDocument(dealId, documentId, folder) {
  return apiRequest(`/deals/${dealId}/documents/${documentId}/move`, {
    method: "POST",
    body: JSON.stringify({ folder }),
  });
}

// The GCS import picker — for when there's no local file to pick from at
// all (e.g. a locked-down office laptop). Files are staged in a bucket
// elsewhere and copied server-side into the deal, no browser file APIs used.
export function listGcsImportFiles(dealId, prefix = "") {
  return apiRequest(`/deals/${dealId}/gcs-import/list?prefix=${encodeURIComponent(prefix)}`);
}

export function importGcsFile(dealId, objectName) {
  return apiRequest(`/deals/${dealId}/gcs-import`, {
    method: "POST",
    body: JSON.stringify({ object_name: objectName }),
  });
}

// Preview a bucket file before importing it — same auth-header-then-blob
// pattern as fetchDocumentBlob, just against the bucket instead of an
// already-imported Document.
export async function fetchGcsPreviewBlob(dealId, objectName) {
  const token = getToken();
  const response = await fetch(`${API_BASE}/deals/${dealId}/gcs-import/preview?object_name=${encodeURIComponent(objectName)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error("Could not load preview");
  return response.blob();
}

export function compareDocuments(dealId, docAId, docBId) {
  return apiRequest(`/deals/${dealId}/documents/compare?doc_a=${docAId}&doc_b=${docBId}`);
}

export function getFundingDocument(dealId) {
  return apiRequest(`/deals/${dealId}/funding-document`);
}

export function generateFundingDocument(dealId, payload) {
  return apiRequest(`/deals/${dealId}/funding-document/generate`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Multipart, same reasoning as uploadDocuments — can't go through apiRequest.
export async function uploadFundingDocument(dealId, file) {
  const formData = new FormData();
  formData.append("file", file);
  const token = getToken();
  const response = await fetch(`${API_BASE}/deals/${dealId}/funding-document/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(error.detail);
  }
  return response.json();
}

export function listStandingInstructions(dealId) {
  return apiRequest(`/deals/${dealId}/standing-instructions`);
}

export function validateStandingInstruction(dealId, ssiId, enteredAccountNumber) {
  return apiRequest(`/deals/${dealId}/standing-instructions/${ssiId}/validate`, {
    method: "POST",
    body: JSON.stringify({ entered_account_number: enteredAccountNumber }),
  });
}

export function listDealActivity(dealId) {
  return apiRequest(`/deals/${dealId}/activity`);
}

// FR-15: Ops Manager's cross-deal oversight of every pending Standing
// Instruction, not just ones in a deal they happen to be looking at.
export function listPendingApprovals() {
  return apiRequest("/admin/pending-approvals");
}

// The evidence view for an SSI: the source document with the exact spots
// the extraction read from highlighted — same auth-header-then-blob pattern
// as fetchDocumentBlob.
export async function fetchHighlightedDocumentBlob(dealId, ssiId) {
  const token = getToken();
  const response = await fetch(`${API_BASE}/deals/${dealId}/standing-instructions/${ssiId}/highlighted-document`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error("Could not load evidence document");
  return response.blob();
}

// Multipart upload can't go through apiRequest — it always sets a JSON
// Content-Type, which breaks the multipart boundary the browser needs to set.
export async function uploadDocuments(dealId, files) {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  const token = getToken();
  const response = await fetch(`${API_BASE}/deals/${dealId}/documents`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(error.detail);
  }
  return response.json();
}

// A plain <a href> download wouldn't send our Authorization header, so this
// fetches the file with auth and hands the browser a blob to save instead.
export async function downloadDocument(dealId, documentId, filename) {
  const token = getToken();
  const response = await fetch(`${API_BASE}/deals/${dealId}/documents/${documentId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error("Could not download file");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// For previewing a document in-page (an <iframe src>) rather than saving it —
// same auth problem as download, same fix: fetch with the header, hand back
// a blob the caller turns into an object URL.
export async function fetchDocumentBlob(dealId, documentId) {
  const token = getToken();
  const response = await fetch(`${API_BASE}/deals/${dealId}/documents/${documentId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error("Could not load file");
  return response.blob();
}
