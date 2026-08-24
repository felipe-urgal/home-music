#!/usr/bin/env bash
set -u

MODE="${1:-status}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STDERR_FILE="$(mktemp)"
trap 'rm -f "${STDERR_FILE}"' EXIT

set +e
bash "${SCRIPT_DIR}/configure-tailscale.sh" "${MODE}" 2>"${STDERR_FILE}"
RC=$?
set -e

cat "${STDERR_FILE}" >&2

if [[ ${RC} -ne 0 ]] && grep -Eqi 'access denied|serve config denied|to not require root' "${STDERR_FILE}"; then
  echo >&2
  echo "O Tailscale recusou a alteração por permissão do usuário." >&2
  echo "Autorize seu usuário uma vez e repita o comando:" >&2
  echo "  sudo tailscale set --operator=\"\$USER\"" >&2
fi

exit "${RC}"
