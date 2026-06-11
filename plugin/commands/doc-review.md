---
description: Open a native Markdown document review window (rendered Markdown comments + raw editor) and address the resulting feedback
argument-hint: "[path]"
---

# /doc-review

Open the native document review window so the user can review a Markdown document they just had you create. The window renders the document as sanitized HTML, lets the user select rendered text and leave comments, edit the raw Markdown, and submit feedback.

## Step 1 — run the dispatcher

Invoke this exact shell command using your shell/bash tool. The window will block until the user clicks **Submit feedback** or closes it, so this call may take a long time — that is expected. Do **not** run anything else in parallel; wait for it to finish.

If the user gave a path, pass it as-is:

```bash
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -x "${CLAUDE_PLUGIN_ROOT}/bin/plugin-run.sh" ]; then
  bash "${CLAUDE_PLUGIN_ROOT}/bin/plugin-run.sh" doc-review $ARGUMENTS
elif [ -n "${CODEX_PLUGIN_ROOT:-}" ] && [ -x "${CODEX_PLUGIN_ROOT}/bin/plugin-run.sh" ]; then
  bash "${CODEX_PLUGIN_ROOT}/bin/plugin-run.sh" doc-review $ARGUMENTS
elif command -v doc-review >/dev/null 2>&1; then
  doc-review $ARGUMENTS
else
  echo "doc-review is not available. Install the plugin via your agent's plugin/marketplace command, or run: npm install -g pi-doc-review" >&2
  exit 1
fi
```

Substitute the user's `$ARGUMENTS` into that block verbatim. If no path was given and you just created a Markdown document, pass its absolute path as the argument. If you did not just create a document and no path was given, do not run the command — instead show this error:

```
doc-review requires a Markdown file path.
```

## Step 2 — interpret the dispatcher's stdout

Read the captured stdout from the previous step:

- **`FEEDBACK_FILE: <absolute path>`** → use the file-reading tool to load that file. Its contents are the document review feedback. Address each item carefully.
- **`REVIEW_CANCELLED`** → reply with a single short line confirming the review was cancelled. Do not do anything else.
- **anything else** (e.g. an error) → surface the error to the user verbatim and stop.

Status / progress messages from the dispatcher are written to **stderr**, not stdout, so they don't affect the parsing above.

### Applying feedback

When you receive the FEEDBACK_FILE, follow these steps:

1. **Apply the edited Markdown** from the feedback to the reviewed document file. This is the user's direct changes and should be treated as accepted.
2. **Check for changed-on-disk warning.** If the feedback includes `WARNING: file changed during review`, reconcile the edited Markdown against the current file contents instead of blindly replacing the file.
3. **Address each comment.** Edit the document to incorporate each item. Selection comments quote the relevant text — find it in the document and apply the suggested change.
4. **If a comment conflicts with an already-applied edit,** preserve the edit and adjust around the comment if possible. If impossible, report the conflict to the user.
5. **Report any unresolved conflicts** to the user so they can follow up.