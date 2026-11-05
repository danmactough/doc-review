#!/usr/bin/env bash
set -euo pipefail

ROOT=""
for candidate in "${CLAUDE_PLUGIN_ROOT:-}" "${CODEX_PLUGIN_ROOT:-}"; do
  if [[ -n "$candidate" && -f "$candidate/package.json" ]]; then
    ROOT="$candidate"
    break
  fi
done
if [[ -z "$ROOT" ]]; then
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

if [[ ! -f "$ROOT/bin/doc-review.js" ]]; then
  echo "doc-review: could not locate plugin root (looked in '$ROOT')." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "doc-review: node is not on PATH. Install Node.js 20+ and retry." >&2
  exit 1
fi

STAMP="$ROOT/node_modules/.doc-review-installed"
needs_install=0
if [[ ! -d "$ROOT/node_modules/glimpseui" ]]; then
  needs_install=1
elif [[ ! -f "$STAMP" ]] || [[ "$ROOT/package.json" -nt "$STAMP" ]]; then
  needs_install=1
fi

if [[ "$needs_install" == "1" ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "doc-review: npm is not on PATH. Install Node.js 20+ (which ships npm) and retry." >&2
    exit 1
  fi
  echo "doc-review: installing plugin dependencies (first run)..." >&2
  (cd "$ROOT" && npm install --omit=dev --no-audit --no-fund --workspaces=false --no-package-lock) >&2
  touch "$STAMP"
fi

GLIMPSEUI_DIR="$ROOT/node_modules/glimpseui"
HOST_BIN=""
BUILD_TARGET=""
HOST_DEPS_HINT=""

case "$(uname -s)" in
  Darwin)
    HOST_BIN="$GLIMPSEUI_DIR/src/glimpse"
    BUILD_TARGET="build:macos"
    HOST_DEPS_HINT="macOS requires Xcode Command Line Tools (provides swiftc). Install with: xcode-select --install"
    ;;
  Linux)
    HOST_BIN="$GLIMPSEUI_DIR/src/glimpse"
    BUILD_TARGET="build:linux"
    HOST_DEPS_HINT="Linux requires Rust (https://rustup.rs) and GTK4/WebKit2GTK dev packages. See: https://github.com/badlogic/glimpseui#linux"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    HOST_BIN="$GLIMPSEUI_DIR/native/windows/bin/Glimpse.Windows.exe"
    BUILD_TARGET="build:windows"
    HOST_DEPS_HINT="Windows requires the .NET 8 SDK. Install from: https://dotnet.microsoft.com/download/dotnet/8.0"
    ;;
esac

if [[ -n "$HOST_BIN" && -d "$GLIMPSEUI_DIR" && ! -x "$HOST_BIN" ]]; then
  echo "doc-review: Glimpse native helper not found at '$HOST_BIN'." >&2
  echo "doc-review: this usually means the host agent ran 'npm install --ignore-scripts'." >&2

  if [[ -f "$GLIMPSEUI_DIR/.glimpse-build-skipped" ]]; then
    echo "doc-review: glimpseui's postinstall reported:" >&2
    sed 's/^/  /' "$GLIMPSEUI_DIR/.glimpse-build-skipped" >&2
  fi

  echo "doc-review: building Glimpse native helper now..." >&2
  if ! command -v npm >/dev/null 2>&1; then
    echo "doc-review: npm is required to build the Glimpse native helper. Install Node.js 20+ and retry." >&2
    exit 1
  fi

  build_status=0
  (cd "$GLIMPSEUI_DIR" && npm run "$BUILD_TARGET") >&2 || build_status=$?

  if [[ "$build_status" -ne 0 || ! -x "$HOST_BIN" ]]; then
    echo "" >&2
    echo "doc-review: failed to build Glimpse native helper." >&2
    if [[ -n "$HOST_DEPS_HINT" ]]; then
      echo "doc-review: $HOST_DEPS_HINT" >&2
    fi
    echo "doc-review: after fixing the build prerequisites, you can retry by running:" >&2
    echo "  (cd '$GLIMPSEUI_DIR' && npm run $BUILD_TARGET)" >&2
    echo "  …or just re-run the review and this script will retry the build." >&2
    exit 1
  fi
fi

exec node "$ROOT/bin/doc-review.js" "$@"
