#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="${ROOT_DIR}/scripts/install-systemd.sh"

EXPECTED_EXEC_START='ExecStart="${NODE_ARG_ESCAPED}" --import "${ROOT_ARG_ESCAPED}/apps/server/dist/bootstrap-preload.js" "${ROOT_ARG_ESCAPED}/apps/server/dist/index.js"'
EXPECTED_BUILD_GUARD='if [[ ! -f "${ROOT_DIR}/apps/web/dist/index.html" || ! -f "${ROOT_DIR}/apps/server/dist/index.js" || ! -f "${ROOT_DIR}/apps/server/dist/bootstrap-preload.js" ]]; then'
EXPECTED_HELPER_PATH='CONTROL_HELPER_PATH="/usr/local/sbin/home-music-service-control"'
EXPECTED_HELPER_METADATA="  HELPER_METADATA=\"\$(stat -Lc '%U:%G:%a' \"\${CONTROL_HELPER_PATH}\" 2>/dev/null || true)\""
EXPECTED_HELPER_OWNERSHIP='  if [[ "${HELPER_METADATA}" != "root:root:755" ]]; then'
EXPECTED_PREFLIGHT='if ! sudo -n "${CONTROL_HELPER_PATH}" check >/dev/null 2>&1; then'
EXPECTED_STOP='run_privileged_update_action stop'
EXPECTED_RESTART='run_privileged_update_action restart'
EXPECTED_SYSTEMCTL='SYSTEMCTL_BIN="/usr/bin/systemctl"'
EXPECTED_ARG_GUARD='if [[ $# -ne 1 ]]; then'
EXPECTED_SUDOERS='${RUN_USER} ALL=(root) NOPASSWD: ${CONTROL_HELPER_PATH} check, ${CONTROL_HELPER_PATH} stop, ${CONTROL_HELPER_PATH} restart'

assert_exact_line() {
  local expected="$1"
  local message="$2"
  if ! grep -Fqx "${expected}" "${INSTALLER}"; then
    echo "Erro: ${message}" >&2
    exit 1
  fi
}

assert_contains() {
  local expected="$1"
  local message="$2"
  if ! grep -Fq "${expected}" "${INSTALLER}"; then
    echo "Erro: ${message}" >&2
    exit 1
  fi
}

assert_exact_line "${EXPECTED_EXEC_START}" "o unit systemd precisa iniciar bootstrap-preload.js antes de dist/index.js."
assert_exact_line "${EXPECTED_BUILD_GUARD}" "o installer precisa validar a presença do bootstrap-preload.js no build."
assert_exact_line "${EXPECTED_HELPER_PATH}" "o helper privilegiado precisa usar caminho absoluto fixo e root-owned."
assert_exact_line "${EXPECTED_HELPER_METADATA}" "service:update precisa inspecionar ownership e modo do helper antes de confiar no NOPASSWD."
assert_exact_line "${EXPECTED_HELPER_OWNERSHIP}" "service:update precisa recusar helper que não seja root:root 0755."
assert_contains "${EXPECTED_PREFLIGHT}" "service:update precisa validar NOPASSWD antes de parar o serviço."
assert_contains "${EXPECTED_STOP}" "service:update precisa parar o serviço somente pelo helper limitado."
assert_contains "${EXPECTED_RESTART}" "service:update precisa reiniciar o serviço somente pelo helper limitado."
assert_exact_line "${EXPECTED_SYSTEMCTL}" "o helper precisa usar /usr/bin/systemctl fixo, sem PATH controlável."
assert_exact_line "${EXPECTED_ARG_GUARD}" "o helper precisa recusar argumentos extras."
assert_exact_line "${EXPECTED_SUDOERS}" "a regra sudoers precisa limitar exatamente check, stop e restart do helper."

if grep -Eq 'NOPASSWD:.*(systemctl|/bin/(ba)?sh|ALL)' "${INSTALLER}"; then
  echo "Erro: a regra NOPASSWD não pode liberar systemctl, shell ou ALL diretamente." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT
HELPER_FIXTURE="${TMP_DIR}/home-music-service-control"
SUDOERS_FIXTURE="${TMP_DIR}/home-music-sudoers"

awk '
  /cat > "\$\{TMP_HELPER\}" <<'"'"'EOF_HELPER'"'"'/ { capture=1; next }
  /^EOF_HELPER$/ { capture=0 }
  capture { print }
' "${INSTALLER}" > "${HELPER_FIXTURE}"

if [[ ! -s "${HELPER_FIXTURE}" ]]; then
  echo "Erro: não foi possível extrair o helper privilegiado do installer." >&2
  exit 1
fi
bash -n "${HELPER_FIXTURE}"

if ! grep -Fqx 'case "$1" in' "${HELPER_FIXTURE}" || \
   ! grep -Fqx '  check)' "${HELPER_FIXTURE}" || \
   ! grep -Fqx '  stop)' "${HELPER_FIXTURE}" || \
   ! grep -Fqx '  restart)' "${HELPER_FIXTURE}"; then
  echo "Erro: o helper precisa manter catálogo fechado de check, stop e restart." >&2
  exit 1
fi

if grep -Fq '"$@"' "${HELPER_FIXTURE}"; then
  echo "Erro: o helper não pode encaminhar argumentos arbitrários." >&2
  exit 1
fi

cat > "${SUDOERS_FIXTURE}" <<'EOF_SUDOERS'
runner ALL=(root) NOPASSWD: /usr/local/sbin/home-music-service-control check, /usr/local/sbin/home-music-service-control stop, /usr/local/sbin/home-music-service-control restart
EOF_SUDOERS
chmod 0440 "${SUDOERS_FIXTURE}"

if command -v visudo >/dev/null 2>&1; then
  visudo -cf "${SUDOERS_FIXTURE}" >/dev/null
fi

echo "Systemd startup e helper NOPASSWD preservam privilégio mínimo."
