#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: pnpm not found. Install pnpm or run: corepack enable && corepack prepare pnpm@latest --activate" >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "error: node_modules missing. Run from repo root: pnpm install" >&2
  exit 1
fi

exec pnpm dev
