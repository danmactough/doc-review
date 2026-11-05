#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version) {
	process.stderr.write("version-manifests: missing version. Run `npm version <patch|minor|major>` from the repo root.\n");
	process.exit(1);
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// `npm version` at the root only updates the root package.json and lockfile.
const PACKAGE_MANIFESTS = [
	"plugin/package.json",
	"plugin/.claude-plugin/plugin.json",
	"plugin/.codex-plugin/plugin.json",
];
const MARKETPLACE_MANIFESTS = [
	".claude-plugin/marketplace.json",
	".agents/plugins/marketplace.json",
];

function updateJson(file, update) {
	const abs = path.join(REPO_ROOT, file);
	const json = JSON.parse(fs.readFileSync(abs, "utf8"));
	update(json);
	fs.writeFileSync(abs, `${JSON.stringify(json, null, 2)}\n`);
}

for (const file of PACKAGE_MANIFESTS) {
	updateJson(file, (json) => {
		json.version = version;
	});
}
for (const file of MARKETPLACE_MANIFESTS) {
	updateJson(file, (json) => {
		json.plugins[0].version = version;
	});
}
