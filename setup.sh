#!/usr/bin/env bash
# setup.sh — run once after cloning.
#
# tcl/ and tk/ are not tracked in git (they are large vendor source tarballs
# managed entirely by the Makefile). This script downloads and prepares them,
# then prints the full build sequence so you can continue manually.
set -euo pipefail

TCLVERSION=${TCLVERSION:-8.6.6}
TKVERSION=${TKVERSION:-8.6.6}

# ---------------------------------------------------------------------------
# Prerequisite check
# ---------------------------------------------------------------------------
missing=()
for cmd in emcc make autoconf wget; do
    command -v "$cmd" &>/dev/null || missing+=("$cmd")
done

if [ ${#missing[@]} -gt 0 ]; then
    echo "ERROR: missing required tools: ${missing[*]}"
    echo "  emcc   — Emscripten SDK (source emsdk_env.sh first)"
    echo "  make   — GNU make"
    echo "  autoconf"
    echo "  wget"
    exit 1
fi

# ---------------------------------------------------------------------------
# Tcl source tree (make waclprep also downloads tDOM / rl_json / tcllib)
# ---------------------------------------------------------------------------
if [ -d tcl/unix ]; then
    echo "tcl/ already present — skipping waclprep."
else
    echo "==> Downloading and preparing Tcl $TCLVERSION ..."
    make waclprep
fi

# ---------------------------------------------------------------------------
# Tk source tree
# ---------------------------------------------------------------------------
if [ -d tk/unix ]; then
    echo "tk/ already present — skipping tkprep."
else
    echo "==> Downloading and preparing Tk $TKVERSION ..."
    make tkprep
fi

# ---------------------------------------------------------------------------
# Done — print next steps
# ---------------------------------------------------------------------------
cat <<'EOF'

Source trees ready. Build sequence:

  # Build Tcl static archive
  make config
  make waclinstall

  # Build Tk static archive (needs em-x11 headers at ../em-x11/native/include)
  make tkinstall

  # Build and serve the Tk demo
  pnpm install
  pnpm build:native
  pnpm dev

Then open the URL printed by pnpm dev (demos/tk-hello/).
EOF
