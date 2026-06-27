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