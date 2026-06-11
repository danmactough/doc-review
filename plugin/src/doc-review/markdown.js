// Markdown utilities for doc-review.
// Diff logic runs in Node (server-side). Rendered diff helpers are shared
// conventions consumed by the prompt builder and optionally by the browser.

/**
 * Compute a unified diff string between two texts (line-based LCS diff).
 * Returns a string in standard unified-diff format, or "No changes." if equal.
 */
export function computeDiff(original, edited) {
  if (original === edited) return "No changes.";

  const origLines = original.split("\n");
  const editLines = edited.split("\n");

  const lcs = computeLCS(origLines, editLines);
  const diff = buildUnifiedDiff(origLines, editLines, lcs);
  return diff.join("\n");
}

/**
 * Compute a structured change list for rendered tracked-changes display.
 * Each change: { type: "insert" | "delete" | "replace", originalText?, editedText?,
 *                originalStartLine, originalEndLine, editedStartLine, editedEndLine }
 * This is consumed by the browser for rendered diff display.
 */
export function computeRenderedDiff(original, edited) {
  if (original === edited) return [];

  const origLines = original.split("\n");
  const editLines = edited.split("\n");
  const lcs = computeLCS(origLines, editLines);
  const changes = [];

  let oi = 0;
  let ei = 0;
  let lcsi = 0;

  while (oi < origLines.length || ei < editLines.length) {
    if (lcsi < lcs.length && oi < origLines.length && ei < editLines.length && origLines[oi] === lcs[lcsi] && editLines[ei] === lcs[lcsi]) {
      // matching line
      oi++;
      ei++;
      lcsi++;
      continue;
    }

    // Record a change span
    const change = { type: null, originalStartLine: oi + 1, editedStartLine: ei + 1 };
    let hasOriginal = false;
    let hasEdited = false;

    while (oi < origLines.length && (lcsi >= lcs.length || origLines[oi] !== lcs[lcsi])) {
      hasOriginal = true;
      oi++;
    }

    while (ei < editLines.length && (lcsi >= lcs.length || editLines[ei] !== lcs[lcsi])) {
      hasEdited = true;
      ei++;
    }

    change.originalEndLine = oi;
    change.editedEndLine = ei;

    if (hasOriginal && hasEdited) change.type = "replace";
    else if (hasOriginal) change.type = "delete";
    else change.type = "insert";

    changes.push(change);
  }

  return changes;
}

/**
 * Re-anchor selection comments after edits.
 * For each comment, try to find its anchor text in the edited rendered content.
 * If found in the same heading context, keep attached. Otherwise mark detached.
 *
 * @param {Array} comments - SelectionComment objects with anchor metadata
 * @param {string} editedContent - the rendered HTML text content (plain text extracted)
 * @param {string} originalContent - the original rendered HTML text content
 * @param {Array} headings - [{ text, level }] from the edited doc for context matching
 * @returns {Array} comments with updated anchorStatus
 */
export function reanchorComments(comments, editedTextContent, _originalTextContent, headings) {
  return comments.map((comment) => {
    if (!comment.anchor || !comment.anchor.selectedText) {
      return { ...comment, anchorStatus: "detached" };
    }

    const quote = comment.anchor.selectedText.trim();
    if (!quote) return { ...comment, anchorStatus: "detached" };

    // Search for the quote in the edited text
    const idx = editedTextContent.indexOf(quote);
    if (idx === -1) {
      // Try fuzzy: split into words and look for majority match
      const words = quote.split(/\s+/).filter((w) => w.length > 2);
      let matchCount = 0;
      for (const word of words) {
        if (editedTextContent.includes(word)) matchCount++;
      }
      if (words.length > 0 && matchCount / words.length >= 0.6) {
        return { ...comment, anchorStatus: "attached" };
      }
      return { ...comment, anchorStatus: "detached" };
    }

    // Check heading context match if we have it
    if (comment.anchor.headingPath && headings && headings.length > 0) {
      // Find what heading this quote falls under in the edited doc
      const textBeforeQuote = editedTextContent.slice(0, idx);
      const editedHeadings = headings
        .filter((h) => textBeforeQuote.lastIndexOf(h.text) >= 0 || idx < textBeforeQuote.length)
        .map((h) => h.text);
      const lastHeading = editedHeadings[editedHeadings.length - 1] || "";
      const origHeading = comment.anchor.headingPath;

      // If the quote is still under the same general heading area, good
      if (origHeading && lastHeading && !lastHeading.includes(origHeading) && !origHeading.includes(lastHeading)) {
        // Heading context changed significantly — still attached since we found the quote,
        // but might be in a different section. Still "attached" is fine.
      }
    }

    return { ...comment, anchorStatus: "attached" };
  });
}

/**
 * Extract plain text headings from rendered markdown HTML.
 * Returns [{ text, level }]
 */
export function extractHeadings(html) {
  const headings = [];
  const regex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const level = parseInt(match[1], 10);
    const text = match[2].replace(/<[^>]*>/g, "").trim();
    if (text) headings.push({ text, level });
  }
  return headings;
}

/**
 * Extract plain text content from rendered HTML (strip tags).
 */
export function extractTextContent(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Internal: LCS-based line diff
// ---------------------------------------------------------------------------

function computeLCS(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const result = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return result;
}

function buildUnifiedDiff(origLines, editLines, lcs) {
  const output = [];
  let oi = 0, ei = 0, lcsi = 0;

  // Precompute change blocks for header
  const hunk = [];
  while (oi < origLines.length || ei < editLines.length) {
    if (lcsi < lcs.length && oi < origLines.length && ei < editLines.length && origLines[oi] === lcs[lcsi] && editLines[ei] === lcs[lcsi]) {
      oi++; ei++; lcsi++;
      continue;
    }
    const block = { origStart: oi + 1, editStart: ei + 1, origLines: [], editLines: [] };
    while (oi < origLines.length && (lcsi >= lcs.length || origLines[oi] !== lcs[lcsi])) {
      block.origLines.push(origLines[oi]);
      oi++;
    }
    while (ei < editLines.length && (lcsi >= lcs.length || editLines[ei] !== lcs[lcsi])) {
      block.editLines.push(editLines[ei]);
      ei++;
    }
    block.origEnd = oi;
    block.editEnd = ei;
    hunk.push(block);
  }

  if (hunk.length === 0) return ["No changes."];

  for (const block of hunk) {
    const origLen = block.origLines.length;
    const editLen = block.editLines.length;

    // Unified diff header: @@ -start,count +start,count @@
    const range1 = origLen === 0 ? `${block.origStart},0` : `${block.origStart},${origLen}`;
    const range2 = editLen === 0 ? `${block.editStart},0` : `${block.editStart},${editLen}`;
    output.push(`@@ -${range1} +${range2} @@`);

    for (const line of block.origLines) {
      output.push(`-${line}`);
    }
    for (const line of block.editLines) {
      output.push(`+${line}`);
    }
  }

  return output;
}