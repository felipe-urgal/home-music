#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="${ROOT_DIR}/scripts/install-systemd.sh"

EXPECTED_EXEC_START='ExecStart="${NODE_ARG_ESCAPED}" --import "${ROOT_ARG_ESCAPED}/apps/server/dist/bootstrap-preload.js" "${ROOT_ARG_ESCAPED}/apps/server/dist/index.js"'

if ! grep -Fqx "${EXPECTED_EXEC_START}" "${INSTALLER}"; then
  echo "Erro: o unit systemd precisa iniciar bootstrap-preload.js antes de dist/index.js." >&2
  exit 1
fi

if ! grep -Fq 'apps/server/dist/bootstrap-preload.js' "${INSTALLER}"; then
  echo "Erro: o installer precisa validar a presença do bootstrap-preload.js no build." >&2
  exit 1
fi

echo "Systemd startup preserva o bootstrap de autenticação."
