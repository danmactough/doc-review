// HTML builder for doc-review. Follows the same pattern as plugin/src/ui.js.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = join(__dirname, "..", "..", "web");

function escapeForInlineScript(value) {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function buildDocReviewHtml({ originalContent, docPath, filename }) {
  const templateHtml = readFileSync(join(webDir, "doc-review.html"), "utf8");
  const appJs = readFileSync(join(webDir, "doc-review-app.js"), "utf8");

  const payload = escapeForInlineScript(
    JSON.stringify({ originalContent, docPath, filename })
  );

  return templateHtml
    .replace("__INLINE_DATA__", () => payload)
    .replace("__INLINE_JS__", () => appJs);
}