#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

install_dependencies() {
  if command -v sandbox-pnpm-install >/dev/null 2>&1; then
    # Generated games may add dependencies without updating pnpm-lock.yaml.
    # Let pnpm refresh the lockfile before building instead of failing first.
    sandbox-pnpm-install --no-frozen-lockfile
    return
  fi

  echo "[build] sandbox-pnpm-install not found; running pnpm install for local development..." >&2
  NODE_ENV=development PNPM_CONFIG_PRODUCTION=false pnpm install --config.confirmModulesPurge=false --no-frozen-lockfile
}

echo "[build] Installing dependencies..."
install_dependencies

rm -rf dist

echo "[build] Building production bundle..."
pnpm run build

echo "Build completed successfully."
