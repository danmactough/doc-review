#!/usr/bin/env node
// doc-review — Glimpse-powered native document review window for agent-generated Markdown.
//
// Usage:
//   doc-review [path-to-markdown-file]
//   doc-review --help
//
// Opens a Glimpse window showing the target Markdown document as sanitized rendered
// Markdown. The user can add document-level and selection comments, edit raw Markdown,
// see tracked changes, and submit the review back to the agent.
//
// On submit: writes composed feedback to $TMPDIR/doc-review-<ts>.md and prints
//            "FEEDBACK_FILE: <path>" to stdout.
// On cancel / window close: prints "REVIEW_CANCELLED" to stdout.
// On error: prints message to stderr and exits 1.

import { existsSync, readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { open } from "glimpseui";
import { buildDocReviewHtml } from "../src/doc-review/ui.js";
import { composeDocReviewPrompt } from "../src/doc-review/prompt.js";
import { computeDiff } from "../src/doc-review/markdown.js";

const HELP = `doc-review — open a native document review window for Markdown documents.

Usage:
  doc-review [path]       Review the specified Markdown document
  doc-review --help       Show this help and exit

Arguments:
  path    Path to a Markdown (.md) file to review. May be absolute or relative
          to the current directory. If omitted, usage is shown.

The agent should supply the path to the Markdown document it just created.
If no path is provided, usage is shown and the command exits.

On submit: writes feedback to a temp file and prints FEEDBACK_FILE: <path>.
`;

function escapeForInlineScript(value) {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function log(...args) {
  process.stderr.write(args.join(" ") + "\n");
}

function preflightGlimpse() {
  let glimpseEntry;
  try {
    const require = createRequire(import.meta.url);
    glimpseEntry = require.resolve("glimpseui");
  } catch {
    process.stderr.write(
      "glimpseui is not installed. If you're running this directly, do `npm install`\n" +
      "in the project root. If you're running via the Claude Code plugin, the\n" +
      "plugin-run.sh dispatcher should have done that for you.\n",
    );
    process.exit(1);
  }
  const marker = join(dirname(dirname(glimpseEntry)), ".glimpse-build-skipped");
  if (existsSync(marker)) {
    const detail = readFileSync(marker, "utf8").trim();
    process.stderr.write(
      `glimpseui's native helper was not built:\n  ${detail}\n\n` +
      "After installing the required toolchain, run:\n" +
      "  npm rebuild -g glimpseui    # if installed globally\n" +
      "  npm rebuild glimpseui       # if installed locally\n",
    );
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(HELP);
    return;
  }

  // Resolve the document path
  const rawPath = args[0];
  const docPath = resolve(process.cwd(), rawPath);

  if (!existsSync(docPath)) {
    log(`File not found: ${docPath}`);
    process.stdout.write("REVIEW_CANCELLED\n");
    return;
  }

  const lower = docPath.toLowerCase();
  if (!lower.endsWith(".md") && !lower.endsWith(".markdown")) {
    log(`Not a Markdown file: ${docPath}`);
    process.stdout.write("REVIEW_CANCELLED\n");
    return;
  }

  preflightGlimpse();

  // Read the document
  const originalContent = readFileSync(docPath, "utf8");
  const filename = docPath.split("/").pop() || docPath;
  let origHash = null;
  let origStat = null;
  try {
    origStat = statSync(docPath);
    origHash = `${origStat.mtimeMs}-${origStat.size}`;
  } catch {
    // stat failed, skip change detection
  }

  log(`Opened doc review for ${docPath}`);

  // Build and open the review window
  const html = buildDocReviewHtml({
    originalContent,
    docPath,
    filename,
  });

  const win = open(html, {
    width: 1400,
    height: 900,
    title: `doc review: ${filename}`,
  });

  const terminalMessage = await new Promise((resolve, reject) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      win.removeListener("message", onMessage);
      win.removeListener("closed", onClosed);
      win.removeListener("error", onError);
      resolve(value);
    };
    const onMessage = (data) => {
      const message = data;
      if (message?.type === "submit" || message?.type === "cancel") {
        settle(message);
      }
    };
    const onClosed = () => settle(null);
    const onError = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    win.on("message", onMessage);
    win.on("closed", onClosed);
    win.on("error", onError);

    process.once("SIGINT", () => {
      try { win.close(); } catch {}
      settle(null);
    });
  });

  try { win.close(); } catch {}

  if (terminalMessage == null || terminalMessage.type === "cancel") {
    log("Review cancelled.");
    process.stdout.write("REVIEW_CANCELLED\n");
    return;
  }

  // Process submit
  const payload = terminalMessage.payload || {};

  const editedContent = payload.editedContent || originalContent;
  const diff = payload.diff || computeDiff(originalContent, editedContent);

  // Check if document changed on disk
  let changedOnDisk = false;
  if (origHash) {
    try {
      const currentStat = statSync(docPath);
      const currentHash = `${currentStat.mtimeMs}-${currentStat.size}`;
      if (currentHash !== origHash) changedOnDisk = true;
    } catch {
      // File removed or inaccessible — still mark as changed
      changedOnDisk = true;
    }
  }

  // Compose feedback
  const prompt = composeDocReviewPrompt({
    originalContent,
    editedContent,
    diff,
    overallComments: payload.overallComments || [],
    selectionComments: payload.selectionComments || [],
    docPath,
    changedOnDisk,
  });

  const outPath = join(tmpdir(), `doc-review-${Date.now()}.md`);
  await writeFile(outPath, prompt + "\n", "utf8");
  process.stdout.write(`FEEDBACK_FILE: ${outPath}\n`);
  log(`Wrote feedback to ${outPath}`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`doc-review failed: ${message}\n`);
  process.exit(1);
});