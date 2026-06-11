# doc-review

A native Markdown document review window for terminal coding agents, powered by [Glimpse](https://github.com/hazat/glimpse). Ships for **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)**, **[Codex CLI](https://github.com/openai/codex)**, and **[pi](https://pi.dev)**.

- In **Claude Code** it adds a `/doc-review` slash command.
- In **Codex CLI** it ships as a `doc-review` skill.
- In **pi** it registers a `/doc-review` slash command.

All three open the same native review window, render a Markdown file, let the user leave selection and document comments, allow direct raw Markdown edits, and write feedback back to the agent.

## Install

### pi

```bash
pi install npm:pi-doc-review
# or
pi install git:github.com/danmactough/doc-review
```

Then in pi:

```bash
/doc-review [path/to/file.md]
```

### Claude Code

```bash
/plugin marketplace add danmactough/doc-review
/plugin install doc-review@doc-review
```

### Codex CLI

```bash
codex plugin marketplace add danmactough/doc-review
```

Then enable the plugin in Codex and invoke:

```text
@doc-review [path/to/file.md]
```

### Standalone CLI

```bash
git clone https://github.com/danmactough/doc-review.git
cd doc-review/plugin
npm install
npm install -g .
npm run install-command
```

Then:

```bash
doc-review [path/to/file.md]
```

## Prior Art

Based on (https://github.com/danmactough/slop-review) by Dan Bachelder, which is a port of pi-diff-review (https://github.com/badlogic/pi-diff-review) by Mario Zechner.

