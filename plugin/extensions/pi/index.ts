import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  async function reviewDocument(rawArgs: string, ctx: ExtensionCommandContext): Promise<void> {
    const args = rawArgs.trim();
    const docReviewBin = new URL("../../bin/doc-review.js", import.meta.url).pathname;
    const argv = args.length > 0 ? [docReviewBin, ...args.split(/\s+/)] : [docReviewBin];

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    try {
      const result = await pi.exec("node", argv, { cwd: ctx.cwd });
      stdout = result.stdout ?? "";
      stderr = result.stderr ?? "";
      exitCode = result.exitCode ?? 0;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`doc-review failed: ${message}`, "error");
      return;
    }

    for (const line of stderr.split("\n").filter(Boolean)) {
      ctx.ui.notify(line, "info");
    }

    if (exitCode !== 0) {
      ctx.ui.notify(`doc-review exited with code ${exitCode}.`, "error");
      return;
    }

    const feedbackMatch = stdout.match(/^FEEDBACK_FILE:\s+(.+)$/m);
    if (feedbackMatch) {
      const feedbackPath = feedbackMatch[1].trim();
      try {
        const { readFileSync } = await import("node:fs");
        const feedback = readFileSync(feedbackPath, "utf8");
        ctx.ui.setEditorText(feedback);
        ctx.ui.notify("Inserted document review feedback into the editor.", "info");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not read feedback file: ${message}`, "error");
      }
      return;
    }

    if (/^REVIEW_CANCELLED$/m.test(stdout)) {
      ctx.ui.notify("Document review cancelled.", "info");
      return;
    }

    ctx.ui.notify(`Unexpected doc-review output: ${stdout.slice(0, 200)}`, "error");
  }

  pi.registerCommand("doc-review", {
    description: "Open the native document review window for a Markdown file.",
    argumentHint: "[path]",
    getArgumentCompletions: () => null,
    handler: async (args, ctx) => {
      await reviewDocument(args, ctx);
    },
  });
}
