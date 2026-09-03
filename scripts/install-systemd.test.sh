#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="${ROOT_DIR}/scripts/install-systemd.sh"
RUNTIME_PATHS_HELPER="${ROOT_DIR}/scripts/systemd-runtime-paths.mjs"

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
EXPECTED_RUNTIME_HELPER='RUNTIME_PATHS_SCRIPT="${ROOT_DIR}/scripts/systemd-runtime-paths.mjs"'
EXPECTED_STRICT_FS='ProtectSystem=strict'
EXPECTED_READ_ONLY='${ROOT_READ_ONLY_DIRECTIVE}'
EXPECTED_WRITE_POLICY='${RUNTIME_READ_WRITE_UNIT_LINES}'
EXPECTED_UPDATE_POLICY_CHECK='verify_installed_runtime_policy'
EXPECTED_ROOT_QUOTING='ROOT_READ_ONLY_DIRECTIVE="ReadOnlyPaths=\"${ROOT_PATH_ESCAPED}\""'
EXPECTED_WRITE_QUOTING='    RUNTIME_READ_WRITE_DIRECTIVES+=("ReadWritePaths=\"$(systemd_quote_value "${runtime_path}")\"")'
EXPECTED_WORKING_DIRECTORY='WorkingDirectory="${ROOT_PATH_ESCAPED}"'
EXPECTED_STABILITY_CHECK='if ! verify_service_stable; then'

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

line_number() {
  local needle="$1"
  grep -nF "${needle}" "${INSTALLER}" | head -n1 | cut -d: -f1
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
assert_exact_line "${EXPECTED_RUNTIME_HELPER}" "o installer precisa calcular a política de runtime por helper versionado."
assert_exact_line "${EXPECTED_STRICT_FS}" "o serviço precisa usar ProtectSystem=strict."
assert_exact_line "${EXPECTED_READ_ONLY}" "o diretório do projeto precisa ser explicitamente somente leitura."
assert_exact_line "${EXPECTED_WRITE_POLICY}" "o unit precisa incluir somente as exceções graváveis calculadas."
assert_contains "${EXPECTED_UPDATE_POLICY_CHECK}" "service:update precisa recusar política de filesystem desatualizada."
assert_exact_line "${EXPECTED_ROOT_QUOTING}" "ReadOnlyPaths precisa usar valor quoted do systemd."
assert_exact_line "${EXPECTED_WRITE_QUOTING}" "ReadWritePaths precisa usar valor quoted do systemd para preservar espaços."
assert_exact_line "${EXPECTED_WORKING_DIRECTORY}" "WorkingDirectory precisa ser quoted para suportar checkout com espaço."
assert_exact_line "${EXPECTED_STABILITY_CHECK}" "installer precisa confirmar que o serviço permaneceu ativo após o restart."

if grep -Fq '\x20' "${INSTALLER}"; then
  echo "Erro: paths do unit não podem codificar espaços como \\x20; systemd interpreta isso incorretamente em ReadWritePaths." >&2
  exit 1
fi

BUILD_LINE="$(line_number '"${NPM_BIN}" run build')"
UPDATE_STOP_LINE="$(line_number '    run_privileged_update_action stop')"
SUDOERS_VALIDATE_LINE="$(line_number '  "${VISUDO_BIN}" -cf "${TMP_SUDOERS}" >/dev/null')"
INSTALL_STOP_LINE="$(line_number '    sudo systemctl stop "${SERVICE_UNIT}"')"
SERVICE_INSTALL_LINE="$(line_number '  sudo install -o root -g root -m 0644 "${TMP_SERVICE}" "${SERVICE_PATH}"')"
POLICY_CHECK_LINE="$(line_number '  verify_installed_runtime_policy')"
NPM_CI_LINE="$(line_number '"${NPM_BIN}" ci')"
STABILITY_CHECK_LINE="$(line_number 'if ! verify_service_stable; then')"
SUCCESS_MESSAGE_LINE="$(line_number '  echo "Home Music instalado e iniciado."')"

if [[ -z "${BUILD_LINE}" || -z "${UPDATE_STOP_LINE}" || ${UPDATE_STOP_LINE} -le ${BUILD_LINE} ]]; then
  echo "Erro: service:update precisa concluir o build antes de parar produção." >&2
  exit 1
fi

if [[ -z "${SUDOERS_VALIDATE_LINE}" || -z "${INSTALL_STOP_LINE}" || ${INSTALL_STOP_LINE} -le ${SUDOERS_VALIDATE_LINE} ]]; then
  echo "Erro: service:install precisa validar unit/helper/sudoers antes de parar produção." >&2
  exit 1
fi

if [[ -z "${SERVICE_INSTALL_LINE}" || ${SERVICE_INSTALL_LINE} -le ${INSTALL_STOP_LINE} ]]; then
  echo "Erro: service:install deve parar o serviço somente imediatamente antes da troca privilegiada." >&2
  exit 1
fi

if [[ -z "${POLICY_CHECK_LINE}" || -z "${NPM_CI_LINE}" || ${POLICY_CHECK_LINE} -ge ${NPM_CI_LINE} ]]; then
  echo "Erro: service:update precisa validar a política de filesystem antes de instalar dependências/buildar." >&2
  exit 1
fi

if [[ -z "${STABILITY_CHECK_LINE}" || -z "${SUCCESS_MESSAGE_LINE}" || ${STABILITY_CHECK_LINE} -ge ${SUCCESS_MESSAGE_LINE} ]]; then
  echo "Erro: o installer só pode declarar sucesso depois da checagem de estabilidade do serviço." >&2
  exit 1
fi

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

POLICY_ROOT="${TMP_DIR}/project"
POLICY_RUNTIME="${TMP_DIR}/runtime"
POLICY_MUSIC="${TMP_DIR}/Music Library"
mkdir -p "${POLICY_ROOT}" "${POLICY_MUSIC}"
cat > "${POLICY_ROOT}/.env" <<EOF_ENV
MUSIC_DIR=${POLICY_MUSIC}
HOME_MUSIC_DATABASE_PATH=${POLICY_RUNTIME}/db/home music.db
HOME_MUSIC_IMPORT_STAGING_DIR=${POLICY_RUNTIME}/staging uploads
HOME_MUSIC_EXTERNAL_PROVIDER_SCRATCH_DIR=${POLICY_RUNTIME}/provider scratch
EOF_ENV

mapfile -t WRITABLE_PATHS < <(node "${RUNTIME_PATHS_HELPER}" "${POLICY_ROOT}" "${POLICY_ROOT}/.env")
for expected_path in \
  "${POLICY_ROOT}/data" \
  "${POLICY_MUSIC}" \
  "${POLICY_RUNTIME}/db" \
  "${POLICY_RUNTIME}/staging uploads" \
  "${POLICY_RUNTIME}/provider scratch"; do
  if ! printf '%s\n' "${WRITABLE_PATHS[@]}" | grep -Fqx "${expected_path}"; then
    echo "Erro: política systemd não liberou o path esperado: ${expected_path}" >&2
    exit 1
  fi
done

for prepared_dir in \
  "${POLICY_ROOT}/data" \
  "${POLICY_RUNTIME}/db" \
  "${POLICY_RUNTIME}/staging uploads" \
  "${POLICY_RUNTIME}/provider scratch"; do
  if [[ ! -d "${prepared_dir}" ]]; then
    echo "Erro: helper não preparou o diretório runtime: ${prepared_dir}" >&2
    exit 1
  fi
done

cat > "${POLICY_ROOT}/.env" <<EOF_ENV
MUSIC_DIR=${POLICY_MUSIC}
EOF_ENV
mapfile -t DEFAULT_PATHS < <(node "${RUNTIME_PATHS_HELPER}" "${POLICY_ROOT}" "${POLICY_ROOT}/.env")
if [[ ${#DEFAULT_PATHS[@]} -ne 2 ]] || \
   ! printf '%s\n' "${DEFAULT_PATHS[@]}" | grep -Fqx "${POLICY_ROOT}/data" || \
   ! printf '%s\n' "${DEFAULT_PATHS[@]}" | grep -Fqx "${POLICY_MUSIC}"; then
  echo "Erro: defaults de banco/cache/staging/scratch precisam ficar cobertos somente por data/ + MUSIC_DIR." >&2
  exit 1
fi

TRAILING_SCRATCH="${POLICY_RUNTIME}/scratch com espaço final "
cat > "${POLICY_ROOT}/.env" <<EOF_ENV
HOME_MUSIC_EXTERNAL_PROVIDER_SCRATCH_DIR="${TRAILING_SCRATCH}"
EOF_ENV
mapfile -t EXACT_PATHS < <(node "${RUNTIME_PATHS_HELPER}" "${POLICY_ROOT}" "${POLICY_ROOT}/.env")
if ! printf '%s\n' "${EXACT_PATHS[@]}" | grep -Fqx "${TRAILING_SCRATCH}"; then
  echo "Erro: helper precisa preservar exatamente paths quoted do dotenv, inclusive espaço final." >&2
  exit 1
fi

cat > "${POLICY_ROOT}/.env" <<'EOF_ENV'
HOME_MUSIC_DATABASE_PATH=runtime.db
EOF_ENV
if node "${RUNTIME_PATHS_HELPER}" "${POLICY_ROOT}" "${POLICY_ROOT}/.env" >/dev/null 2>&1; then
  echo "Erro: política não pode reabrir escrita no diretório raiz do projeto." >&2
  exit 1
fi

echo "Systemd startup preserva privilégio mínimo, downtime mínimo, paths quoted e filesystem somente leitura fora dos paths runtime necessários."
