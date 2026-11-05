---
name: doc-review
description: Open the native, rendered Markdown document review window (Monaco + Glimpse) so the user can review a Markdown document the agent just created, leave selection or overall comments, edit the raw Markdown, and submit feedback for the agent to incorporate.
---

# doc-review

Open the native document review window, wait for the user to submit feedback or close it, then address each item.

## When to use

- User asks to "review the document", "review the plan", "review the PRD", "review the spec", or "review the markdown" they just had you generate
- User explicitly invokes `@doc-review`

If you did not just create a Markdown document and no path was given, show an error: `doc-review requires a Markdown file path.`

## Step 1 — invoke the dispatcher via the shell tool

The plugin ships a self-contained dispatcher script. Invoke it via your shell tool with this exact command (substituting the document path for `<path>` or passing nothing if the user wants you to pass the document you just created):

```bash
if [ -n "${CLAUDE_PLUGIN_ROOT}" ] && [ -x "${CLAUDE_PLUGIN_ROOT}/bin/plugin-run.sh" ]; then
	bash "${CLAUDE_PLUGIN_ROOT}/bin/plugin-run.sh" <path>
elif [ -n "${CODEX_PLUGIN_ROOT:-}" ] && [ -x "${CODEX_PLUGIN_ROOT}/bin/plugin-run.sh" ]; then
	bash "${CODEX_PLUGIN_ROOT}/bin/plugin-run.sh" <path>
elif command -v doc-review >/dev/null 2>&1; then
	doc-review <path>
else
	echo "doc-review is not available. Install the plugin via your agent's plugin/marketplace command, or run: npm install -g doc-review" >&2
	exit 1
fi
```

Agent plugin hosts expose the plugin checkout through an environment variable such as `${CLAUDE_PLUGIN_ROOT}` or `${CODEX_PLUGIN_ROOT}`. The shell block above checks both names, then falls back to a globally installed `doc-review` binary. On first invocation the dispatcher does a one-time `npm install` inside the plugin checkout to pull `glimpseui` and build its native helper, then exec's the CLI.

If the user did not provide a path and you just created a Markdown document, pass its absolute path as `<path>`. If you did not just create a document and no path was given, do not run the command — instead show an error: `doc-review requires a Markdown file path.`

A native window will open. **The shell call will block until the user clicks Submit feedback or closes the window — this can take minutes. Do not run other tool calls in parallel; just wait.**

## Step 2 — interpret the dispatcher's stdout

The dispatcher writes a single line of stdout. Status / progress messages are on stderr; ignore those for parsing.

| stdout | What to do |
|---|---|
| `FEEDBACK_FILE: <absolute path>` | Read that file with your file-reading tool. The contents are the document review feedback. Address each item (see "Applying feedback" below). |
| `REVIEW_CANCELLED` | Reply with a single short line confirming the review was cancelled. Do nothing else. |
| Anything else (e.g. an error) | Surface the error verbatim and stop. |

## Applying feedback

When you receive the FEEDBACK_FILE, follow these steps:

1. **Apply the edited Markdown** from the feedback to the reviewed document file. This is the user's direct edits and should be treated as accepted.
2. **Check for changed-on-disk warning.** If the feedback includes `WARNING: file changed during review`, reconcile the edited Markdown against the current file contents instead of blindly replacing the file.
3. **Address each comment.** Edit the document to incorporate each item. Selection comments quote the relevant text — find it in the document and apply the suggested change.
4. **If a comment conflicts with an already-applied edit,** preserve the edit and adjust around the comment if possible. If impossible, report the conflict to the user.
5. **Report any unresolved conflicts** to the user so they can follow up.

## Notes

- The CLI writes its feedback file under `$TMPDIR/doc-review-<timestamp>.md`. It's a regular file you can `cat`, `wc`, etc.
- If the dispatcher reports that `glimpseui`'s native helper failed to build, follow the exact remediation it prints (usually: install Xcode Command Line Tools on macOS, then re-run).
- This skill never modifies files on its own — it only opens the review UI. All document changes happen in Step 2 after you've read the user's feedback.