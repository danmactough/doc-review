// Feedback prompt composer for doc-review.

export function composeDocReviewPrompt({
  originalContent,
  editedContent,
  diff,
  overallComments,
  selectionComments,
  docPath,
  changedOnDisk,
}) {
  const lines = [];

  lines.push("Please incorporate this document review feedback.");
  lines.push("");

  // Only include document-level info. Diff is shown below.
  lines.push(`Document: ${docPath}`);
  lines.push(`Status: ${changedOnDisk ? "changed-on-disk-warning" : "clean"}`);
  if (changedOnDisk) {
    lines.push("");
    lines.push("WARNING: This file changed on disk during review. Reconcile the edited Markdown against the current file contents instead of blindly replacing it.");
  }
  lines.push("");

  // Diff
  lines.push("## Diff");
  lines.push("");
  if (diff && diff !== "No changes.") {
    lines.push("```diff");
    lines.push(diff);
    lines.push("```");
  } else {
    lines.push("No changes.");
  }
  lines.push("");

  // Overall comments
  lines.push("## Overall Comments");
  lines.push("");
  const ov = (overallComments || []).filter((c) => c.body.trim());
  if (ov.length === 0) {
    lines.push("None.");
  } else {
    ov.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.body.trim()}`);
      lines.push("");
    });
  }

  // Selection comments
  lines.push("## Selection Comments");
  lines.push("");
  const sel = (selectionComments || []).filter((c) => c.body.trim());
  if (sel.length === 0) {
    lines.push("None.");
  } else {
    sel.forEach((c, i) => {
      lines.push(`${i + 1}. Selected text: "${c.anchor?.selectedText || ""}"`);
      if (c.anchor?.headingPath) {
        lines.push(`   Context: ${c.anchor.headingPath}`);
      } else if (c.anchor?.nearestBlockText) {
        lines.push(`   Context: ${c.anchor.nearestBlockText}`);
      }
      if (c.anchorStatus === "detached") {
        lines.push(`   Note: This comment was detached after edits — the quoted text was not found in the current document.`);
      }
      lines.push(`   ${c.body.trim()}`);
      lines.push("");
    });
  }

  // Agent instructions
  lines.push("---");
  lines.push("Apply the diff changes to the document first (they represent the accepted edits).");
  lines.push("Then address each comment. If a comment conflicts with the applied edits, preserve the edits and adjust around them.");
  lines.push("Report any unresolved conflicts.");

  return lines.join("\n").trim();
}