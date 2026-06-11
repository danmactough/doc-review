// doc-review-app.js — Browser-side logic for document review.

const reviewData = JSON.parse(document.getElementById("doc-review-data").textContent || "{}");

const state = {
  originalContent: reviewData.originalContent || "",
  editedContent: null,
  docPath: reviewData.docPath || "",
  filename: reviewData.filename || "",

  overallComments: [],
  selectionComments: [],

  editing: false,
  showingDiff: false,
};

const docTitleEl = document.getElementById("doc-title");
const docPathEl = document.getElementById("doc-path");
const renderedContentEl = document.getElementById("rendered-content");
const docContentEl = document.getElementById("doc-content");
const editRawButton = document.getElementById("edit-raw-button");
const showDiffButton = document.getElementById("show-diff-button");
const submitButton = document.getElementById("submit-button");
const cancelButton = document.getElementById("cancel-button");
const overallCommentsBar = document.getElementById("overall-comments-bar");
const overallCommentsList = document.getElementById("overall-comments-list");
const addOverallButton = document.getElementById("add-overall-button");
const selectionPopup = document.getElementById("selection-popup");
const selectionCommentInput = document.getElementById("selection-comment-input");
const addSelectionCommentButton = document.getElementById("add-selection-comment-button");
const cancelSelectionButton = document.getElementById("cancel-selection-button");
const overallCommentButton = document.getElementById("overall-comment-button");
const monacoEditorContainer = document.getElementById("monaco-editor-container");
const commentsSidebar = document.getElementById("comments-sidebar");
const commentsList = document.getElementById("comments-list");
const commentCountEl = document.getElementById("comment-count");
const diffModal = document.getElementById("diff-modal");
const diffContent = document.getElementById("diff-content");
const closeDiffModal = document.getElementById("close-diff-modal");

let monacoApi = null;
let monacoEditor = null;
let pendingSelectionContext = null;
let pendingHighlightText = null;

// --------------------------------------------------------------------------
// Markdown rendering
// --------------------------------------------------------------------------

function renderMarkdown(md) {
  if (!window.markdownit) return `<pre class="text-review-text">${escapeHtml(md)}</pre>`;
  const mdInstance = window.markdownit({ html: true, linkify: true, breaks: false });
  let html = mdInstance.render(md);
  if (window.DOMPurify) {
    html = window.DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["h1","h2","h3","h4","h5","h6","p","ul","ol","li","pre","code","blockquote","table","thead","tbody","tr","th","td","a","img","hr","br","strong","em","del","ins","sup","sub","span","div","dl","dt","dd","figure","figcaption","mark","small","s","u","abbr","b","i","q","cite","kbd","samp","var","dfn","details","summary","input"],
    });
  }
  return html;
}

function renderDocument() {
  const content = state.editedContent || state.originalContent;
  renderedContentEl.innerHTML = renderMarkdown(content);
  applyCommentHighlights();
}

function applyCommentHighlights() {
  for (const c of state.selectionComments) {
    if (c.anchorStatus === "attached" && c.anchor?.selectedText) {
      highlightTextInDOM(renderedContentEl, c.anchor.selectedText);
    }
  }
  if (pendingHighlightText) {
    highlightTextInDOM(renderedContentEl, pendingHighlightText, "comment-highlight-pending");
  }
}

function highlightTextInDOM(root, text, className) {
  if (!root || !text) return;
  className = className || "comment-highlight";

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    const idx = node.textContent.toLowerCase().indexOf(text.toLowerCase());
    if (idx === -1) continue;
    if (node.parentElement?.classList.contains(className)) continue;

    const parent = node.parentElement;
    const frag = document.createDocumentFragment();
    if (idx > 0) frag.appendChild(document.createTextNode(node.textContent.slice(0, idx)));
    const span = document.createElement("span");
    span.className = className;
    span.textContent = node.textContent.slice(idx, idx + text.length);
    frag.appendChild(span);
    const after = node.textContent.slice(idx + text.length);
    if (after) frag.appendChild(document.createTextNode(after));
    parent.replaceChild(frag, node);
    break;
  }
}

// --------------------------------------------------------------------------
// Tracked changes rendering
// --------------------------------------------------------------------------

function renderTrackedChanges() {
  if (!state.editedContent) { renderDocument(); return; }
  if (state.editedContent === state.originalContent) { renderDocument(); return; }

  const origHtml = renderMarkdown(state.originalContent);
  const editHtml = renderMarkdown(state.editedContent);
  const origBlocks = extractBlockTexts(origHtml);
  const editBlocks = extractBlockTexts(editHtml);
  const changes = computeBlockChanges(origBlocks, editBlocks);

  const container = document.createElement("div");
  container.innerHTML = editHtml;

  const blockNodes = container.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, dl, dd");
  let blockIndex = 0;
  for (const node of blockNodes) {
    const change = changes.find((c) => c.type !== "unchanged" && c.editBlockIndex === blockIndex);
    if (change) {
      if (change.type === "insert" || change.type === "replace") {
        if (["PRE", "TABLE"].includes(node.tagName)) {
          node.classList.add("changed-block-marker");
          const badge = document.createElement("div");
          badge.className = "text-xs text-[#d29922] font-medium mb-1";
          badge.textContent = change.type === "insert" ? "▲ Added" : "◉ Changed";
          node.parentNode.insertBefore(badge, node);
        } else {
          wrapChanges(node);
        }
      }
    }
    blockIndex++;
  }

  // Render deletions
  const origContainer = document.createElement("div");
  origContainer.innerHTML = origHtml;
  const origBlockNodes = origContainer.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, dl, dd");

  const deletions = [];
  for (const change of changes) {
    if (change.type === "delete") {
      const origNode = origBlockNodes[change.origBlockIndex];
      if (!origNode) continue;
      const wrapper = document.createElement("div");
      wrapper.className = "opacity-60";
      const label = document.createElement("div");
      label.className = "text-xs text-[#f85149] font-medium mb-1";
      label.textContent = "▼ Removed";
      wrapper.appendChild(label);
      const del = document.createElement("del");
      del.style.textDecoration = "line-through";
      del.style.color = "#f85149";
      del.appendChild(origNode.cloneNode(true));
      wrapper.appendChild(del);
      deletions.push({ insertAfter: change.origBlockIndex, el: wrapper });
    }
  }

  deletions.sort((a, b) => a.insertAfter - b.insertAfter);
  for (const item of deletions) {
    const target = changes.find((c) => c.origBlockIndex >= item.insertAfter && c.type !== "delete");
    if (target && target.editBlockIndex !== undefined && blockNodes[target.editBlockIndex]) {
      blockNodes[target.editBlockIndex].parentNode.insertBefore(item.el, blockNodes[target.editBlockIndex]);
    } else {
      container.appendChild(item.el);
    }
  }

  renderedContentEl.innerHTML = container.innerHTML;
  applyCommentHighlights();
}

function extractBlockTexts(html) {
  const container = document.createElement("div");
  container.innerHTML = html;
  const blocks = [];
  for (const sel of ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "table", "dl", "dd"]) {
    for (const node of container.querySelectorAll(sel)) {
      blocks.push(node.textContent.trim());
    }
  }
  return blocks;
}

function computeBlockChanges(orig, edit) {
  const changes = [];
  const lcs = computeLCS(orig, edit);
  let oi = 0, ei = 0, lcsi = 0;
  while (oi < orig.length || ei < edit.length) {
    if (lcsi < lcs.length && oi < orig.length && ei < edit.length && orig[oi] === lcs[lcsi] && edit[ei] === lcs[lcsi]) {
      changes.push({ type: "unchanged", origBlockIndex: oi, editBlockIndex: ei });
      oi++; ei++; lcsi++;
    } else {
      const origStart = oi;
      while (oi < orig.length && (lcsi >= lcs.length || orig[oi] !== lcs[lcsi])) oi++;
      const editStart = ei;
      while (ei < edit.length && (lcsi >= lcs.length || edit[ei] !== lcs[lcsi])) ei++;
      for (let i = origStart; i < oi; i++) changes.push({ type: "delete", origBlockIndex: i });
      for (let i = editStart; i < ei; i++) changes.push({ type: i < editStart + (oi - origStart) ? "replace" : "insert", editBlockIndex: i });
    }
  }
  return changes;
}

function wrapChanges(node) {
  if (node.childNodes.length === 1 && node.childNodes[0].nodeType === Node.TEXT_NODE) {
    const ins = document.createElement("ins");
    ins.textContent = node.textContent;
    node.textContent = "";
    node.appendChild(ins);
  } else {
    node.style.borderLeft = "3px solid #2ea043";
    node.style.paddingLeft = "12px";
    node.style.background = "rgba(46, 160, 67, 0.06)";
    node.style.borderRadius = "4px";
  }
}

// --------------------------------------------------------------------------
// Selection comments
// --------------------------------------------------------------------------

function getHeadingPath(node) {
  const parts = [];
  let current = node.parentElement;
  while (current && current !== renderedContentEl && current !== document.body) {
    if (/^H[1-6]$/.test(current.tagName)) parts.unshift(current.textContent.trim());
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function getNearestBlockText(node) {
  let current = node;
  while (current && current !== renderedContentEl && current !== document.body) {
    if (/^(P|H[1-6]|LI|BLOCKQUOTE|PRE|TD)$/.test(current.tagName)) return current.textContent.trim().slice(0, 100);
    current = current.parentElement;
  }
  return "";
}

function getSelectionContext() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const text = sel.toString().trim();
  if (!text) return null;

  const fullText = range.startContainer.textContent || "";
  return {
    selectedText: text,
    beforeText: fullText.slice(Math.max(0, range.startOffset - 60), range.startOffset).trim(),
    afterText: fullText.slice(range.endOffset, range.endOffset + 60).trim(),
    headingPath: getHeadingPath(range.startContainer),
    nearestBlockText: getNearestBlockText(range.startContainer),
  };
}

function wouldOverlap(text, headingPath) {
  const textLower = text.toLowerCase();
  const headingLower = (headingPath || "").toLowerCase();
  for (const c of state.selectionComments) {
    const eText = (c.anchor?.selectedText || "").toLowerCase();
    const eHeading = (c.anchor?.headingPath || "").toLowerCase();
    if (eText === textLower && eHeading === headingLower) continue;
    if (textLower.includes(eText) || eText.includes(textLower)) return true;
  }
  return false;
}

function addSelectionComment() {
  if (!pendingSelectionContext) return;
  const ctx = pendingSelectionContext;

  if (wouldOverlap(ctx.selectedText, ctx.headingPath)) {
    const btn = addSelectionCommentButton;
    btn.textContent = "Overlaps!";
    btn.style.background = "#da3633";
    setTimeout(() => { btn.textContent = "Add"; btn.style.background = ""; }, 1500);
    return;
  }

  state.selectionComments.push({
    id: generateId(),
    body: selectionCommentInput ? selectionCommentInput.value.trim() : "",
    anchor: ctx,
    anchorStatus: "attached",
  });
  pendingHighlightText = null;
  hideSelectionPopup();
  renderDocument();
  renderCommentsSidebar();
}

// --------------------------------------------------------------------------
// Overall comments
// --------------------------------------------------------------------------

function addOverallComment() {
  state.overallComments.push({ id: generateId(), body: "" });
  renderOverallComments();
  renderCommentsSidebar();
}

function renderOverallComments() {
  overallCommentsBar.classList.remove("hidden");
  overallCommentsList.innerHTML = "";
  for (const comment of state.overallComments) {
    const card = document.createElement("div");
    card.className = "flex items-start gap-2 bg-[#0d1117] rounded-md border border-review-border p-2";
    const ta = document.createElement("textarea");
    ta.className = "scrollbar-thin flex-1 resize-none rounded border border-review-border bg-[#010409] px-2 py-1 text-xs text-review-text outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
    ta.rows = 2;
    ta.placeholder = "Add a note about the document...";
    ta.value = comment.body;
    ta.addEventListener("input", () => { comment.body = ta.value; });
    const del = document.createElement("button");
    del.className = "cursor-pointer rounded-md border border-transparent bg-transparent px-2 py-1 text-xs text-review-muted hover:bg-red-500/10 hover:text-red-400 shrink-0";
    del.textContent = "×";
    del.title = "Delete note";
    del.addEventListener("click", () => {
      state.overallComments = state.overallComments.filter((c) => c.id !== comment.id);
      renderOverallComments();
      renderCommentsSidebar();
    });
    card.appendChild(ta);
    card.appendChild(del);
    overallCommentsList.appendChild(card);
  }
}

// --------------------------------------------------------------------------
// Selection popup
// --------------------------------------------------------------------------

function showSelectionPopup(x, y) {
  selectionPopup.classList.remove("hidden");
  selectionPopup.style.left = `${x}px`;
  selectionPopup.style.top = `${y}px`;
}

function hideSelectionPopup() {
  selectionPopup.classList.add("hidden");
  if (selectionCommentInput) selectionCommentInput.value = "";
  pendingSelectionContext = null;
  pendingHighlightText = null;
  if (state.editedContent) renderTrackedChanges(); else renderDocument();
}

// --------------------------------------------------------------------------
// Comments sidebar
// --------------------------------------------------------------------------

function renderCommentsSidebar() {
  if (state.selectionComments.length === 0) { commentsSidebar.classList.add("hidden"); return; }
  commentsSidebar.classList.remove("hidden");
  commentsList.innerHTML = "";
  commentCountEl.textContent = state.selectionComments.length;

  for (const c of state.selectionComments) {
    const item = document.createElement("div");
    const isDetached = c.anchorStatus === "detached";
    item.className = `px-3 py-2 ${isDetached ? "detached-comment" : ""}`;
    const anchor = c.anchor || {};
    const heading = anchor.headingPath ? escapeHtml(anchor.headingPath) : "";
    const quote = anchor.selectedText ? `"${escapeHtml(anchor.selectedText.slice(0, 80))}"` : "";
    const statusLabel = isDetached ? ' <span class="text-[#f85149]">(detached)</span>' : "";
    item.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-review-accent">Selection comment${statusLabel}</span>
        <button data-id="${escapeHtml(c.id)}" class="delete-comment cursor-pointer text-xs text-review-muted hover:text-red-400">×</button>
      </div>
      ${heading ? `<div class="mt-0.5 text-[10px] text-review-muted">${heading}</div>` : ""}
      ${quote ? `<div class="mt-0.5 text-[10px] text-review-muted italic">${quote}</div>` : ""}
      <textarea data-comment-id="${escapeHtml(c.id)}" class="mt-1 scrollbar-thin w-full resize-none rounded border border-review-border bg-[#010409] px-2 py-1 text-xs text-review-text outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" rows="2" placeholder="Write a comment...">${escapeHtml(c.body)}</textarea>
    `;
    item.querySelector(".delete-comment").addEventListener("click", () => {
      state.selectionComments = state.selectionComments.filter((sc) => sc.id !== c.id);
      renderDocument();
      renderCommentsSidebar();
    });
    item.querySelector("textarea").addEventListener("input", (e) => { c.body = e.target.value; });
    commentsList.appendChild(item);
  }
}

// --------------------------------------------------------------------------
// Raw Markdown editing (Monaco)
// --------------------------------------------------------------------------

function setupMonacoEditor() {
  if (monacoApi && monacoEditor) {
    monacoEditor.setValue(state.editedContent || state.originalContent);
    monacoEditor.focus();
    return;
  }

  window.require.config({ paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs" } });
  window.require(["vs/editor/editor.main"], function () {
    monacoApi = window.monaco;
    monacoApi.editor.defineTheme("review-dark", { base: "vs-dark", inherit: true, rules: [], colors: { "editor.background": "#0d1117" } });
    monacoApi.editor.setTheme("review-dark");
    monacoEditor = monacoApi.editor.create(monacoEditorContainer, {
      value: state.editedContent || state.originalContent,
      language: "markdown",
      theme: "review-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontSize: 13,
      lineNumbers: "on",
      renderWhitespace: "selection",
    });
    monacoEditor.focus();
  });
}

function saveRawEdits() {
  const newContent = monacoEditor ? monacoEditor.getValue() : state.editedContent || state.originalContent;
  state.editedContent = newContent === state.originalContent ? null : newContent;
  exitRawEditMode();
}

function exitRawEditMode() {
  state.editing = false;
  docContentEl.classList.remove("hidden");
  monacoEditorContainer.classList.add("hidden");
  editRawButton.classList.remove("hidden");
  showDiffButton.classList.toggle("hidden", !state.editedContent);
  const toolbar = document.getElementById("monaco-toolbar");
  if (toolbar) toolbar.classList.add("hidden");
  if (state.editedContent) { renderTrackedChanges(); reanchorAfterEdit(); } else { renderDocument(); }
}

function reanchorAfterEdit() {
  const editedText = renderedContentEl.textContent || "";
  const origText = originalContentText();

  for (const c of state.selectionComments) {
    if (!c.anchor?.selectedText) { c.anchorStatus = "detached"; continue; }
    const quote = c.anchor.selectedText.trim();
    if (!quote) { c.anchorStatus = "detached"; continue; }
    if (editedText.includes(quote)) { c.anchorStatus = "attached"; continue; }
    const words = quote.split(/\s+/).filter((w) => w.length > 2);
    const matched = words.filter((w) => editedText.includes(w)).length;
    c.anchorStatus = (words.length > 0 && matched / words.length >= 0.6) ? "attached" : "detached";
  }
  renderCommentsSidebar();
  renderDocument();
}

function originalContentText() {
  const c = document.createElement("div");
  c.innerHTML = renderMarkdown(state.originalContent);
  return c.textContent || "";
}

// --------------------------------------------------------------------------
// Diff computation
// --------------------------------------------------------------------------

function computeUnifiedDiff(original, edited) {
  if (original === edited) return "No changes.";
  const origLines = original.split("\n");
  const editLines = edited.split("\n");
  const lcs = computeLCS(origLines, editLines);
  return buildDiffText(origLines, editLines, lcs).join("\n") || "No changes.";
}

function computeLCS(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const result = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { result.unshift(a[i - 1]); i--; j--; }
    else if (dp[i - 1][j] > dp[i][j - 1]) i--;
    else j--;
  }
  return result;
}

function buildDiffText(origLines, editLines, lcs) {
  const hunks = [];
  let oi = 0, ei = 0, lcsi = 0;
  while (oi < origLines.length || ei < editLines.length) {
    if (lcsi < lcs.length && oi < origLines.length && ei < editLines.length && origLines[oi] === lcs[lcsi] && editLines[ei] === lcs[lcsi]) {
      oi++; ei++; lcsi++; continue;
    }
    const hunk = { origStart: oi + 1, editStart: ei + 1, origLines: [], editLines: [] };
    while (oi < origLines.length && (lcsi >= lcs.length || origLines[oi] !== lcs[lcsi])) hunk.origLines.push(origLines[oi++]);
    while (ei < editLines.length && (lcsi >= lcs.length || editLines[ei] !== lcs[lcsi])) hunk.editLines.push(editLines[ei++]);
    hunks.push(hunk);
  }
  const output = [];
  for (const h of hunks) {
    output.push(`@@ -${h.origLines.length ? h.origStart : `${h.origStart},0`} +${h.editLines.length ? h.editStart : `${h.editStart},0`} @@`);
    for (const l of h.origLines) output.push(`-${l}`);
    for (const l of h.editLines) output.push(`+${l}`);
  }
  return output;
}

// --------------------------------------------------------------------------
// Submit / Cancel
// --------------------------------------------------------------------------

function submitReview() {
  const editedContent = state.editedContent || state.originalContent;
  const diff = state.editedContent ? computeUnifiedDiff(state.originalContent, editedContent) : "No changes.";
  const payload = {
    type: "submit",
    payload: {
      originalContent: state.originalContent,
      editedContent, diff,
      overallComments: state.overallComments.map((c) => ({ id: c.id, body: c.body.trim() })),
      selectionComments: state.selectionComments.map((c) => ({ id: c.id, body: c.body.trim(), anchor: c.anchor, anchorStatus: c.anchorStatus })),
      docPath: state.docPath,
    },
  };
  if (window.glimpse?.send) { window.glimpse.send(payload); window.glimpse.close(); }
}

function cancelReview() {
  if (window.glimpse?.send) { window.glimpse.send({ type: "cancel" }); window.glimpse.close(); }
}

// --------------------------------------------------------------------------
// Utility
// --------------------------------------------------------------------------

function generateId() {
  return `${Date.now()}:${Math.random().toString(16).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --------------------------------------------------------------------------
// Event listeners
// --------------------------------------------------------------------------

docContentEl.addEventListener("mouseup", () => {
  if (state.editing) return;
  if (!selectionPopup.classList.contains("hidden")) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const text = sel.toString().trim();
  if (!text || text.length < 2) return;
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  pendingSelectionContext = getSelectionContext();
  pendingHighlightText = text;
  if (state.editedContent) renderTrackedChanges(); else renderDocument();
  showSelectionPopup(Math.min(rect.left + rect.width / 2 - 100, docContentEl.clientWidth - 220), rect.bottom + 8);
});

document.addEventListener("mousedown", (e) => {
  if (!selectionPopup.contains(e.target) && e.target !== docContentEl) hideSelectionPopup();
});

addSelectionCommentButton.addEventListener("click", addSelectionComment);
cancelSelectionButton.addEventListener("click", hideSelectionPopup);
overallCommentButton.addEventListener("click", addOverallComment);
addOverallButton.addEventListener("click", addOverallComment);

editRawButton.addEventListener("click", () => {
  if (state.editing) return;
  state.editing = true;
  docContentEl.classList.add("hidden");
  monacoEditorContainer.classList.remove("hidden");
  editRawButton.classList.add("hidden");
  showDiffButton.classList.add("hidden");

  let toolbar = document.getElementById("monaco-toolbar");
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.id = "monaco-toolbar";
    toolbar.className = "flex items-center justify-between border-b border-review-border bg-review-panel px-4 py-2 shrink-0";
    toolbar.innerHTML = `<span class="text-xs font-medium text-review-text">Editing raw Markdown</span><div class="flex gap-2"><button id="save-raw-button" class="cursor-pointer rounded-md border border-[rgba(240,246,252,0.1)] bg-[#238636] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2ea043]">Save & return</button><button id="cancel-raw-button" class="cursor-pointer rounded-md border border-review-border bg-review-panel px-3 py-1.5 text-xs font-medium text-review-text hover:bg-[#21262d]">Cancel</button></div>`;
    monacoEditorContainer.parentNode.insertBefore(toolbar, monacoEditorContainer);
    toolbar.querySelector("#save-raw-button").addEventListener("click", saveRawEdits);
    toolbar.querySelector("#cancel-raw-button").addEventListener("click", exitRawEditMode);
  }
  toolbar.classList.remove("hidden");
  setupMonacoEditor();
});

showDiffButton.addEventListener("click", () => {
  if (!state.editedContent) return;
  diffContent.textContent = computeUnifiedDiff(state.originalContent, state.editedContent);
  diffModal.classList.remove("hidden");
});

closeDiffModal.addEventListener("click", () => diffModal.classList.add("hidden"));
diffModal.addEventListener("mousedown", (e) => { if (e.target === diffModal) diffModal.classList.add("hidden"); });
submitButton.addEventListener("click", submitReview);
cancelButton.addEventListener("click", cancelReview);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!diffModal.classList.contains("hidden")) { diffModal.classList.add("hidden"); return; }
    if (state.editing) { exitRawEditMode(); return; }
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitReview();
});

// --------------------------------------------------------------------------
// Init
// --------------------------------------------------------------------------

docTitleEl.textContent = `doc review: ${state.filename || ""}`;
docPathEl.textContent = state.docPath || "";
renderDocument();
editRawButton.classList.remove("hidden");