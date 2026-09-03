#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-install}"
if [[ "${MODE}" != "install" && "${MODE}" != "update" ]]; then
  echo "Uso: $0 [install|update]" >&2
  exit 2
fi

if [[ ${EUID} -eq 0 ]]; then
  echo "Execute este script como seu usuário normal. Ele usa sudo apenas para gerenciar o serviço." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="$(id -un)"
NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"
SYSTEMD_ANALYZE_BIN="$(command -v systemd-analyze || true)"
VISUDO_BIN="$(command -v visudo || true)"
SERVICE_NAME="home-music"
SERVICE_UNIT="${SERVICE_NAME}.service"
SERVICE_PATH="/etc/systemd/system/${SERVICE_UNIT}"
CONTROL_HELPER_PATH="/usr/local/sbin/home-music-service-control"
SUDOERS_PATH="/etc/sudoers.d/home-music-${RUN_USER}"
RUNTIME_PATHS_SCRIPT="${ROOT_DIR}/scripts/systemd-runtime-paths.mjs"
SERVICE_STOPPED=0

if [[ -z "${NODE_BIN}" || -z "${NPM_BIN}" ]]; then
  echo "Node.js e npm precisam estar disponíveis no PATH." >&2
  exit 1
fi

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  echo "Arquivo ${ROOT_DIR}/.env não encontrado. Configure-o antes de instalar o serviço." >&2
  exit 1
fi

if [[ ! -f "${RUNTIME_PATHS_SCRIPT}" ]]; then
  echo "Helper ${RUNTIME_PATHS_SCRIPT} não encontrado. Atualize o checkout antes de instalar o serviço." >&2
  exit 1
fi

if [[ ! "${RUN_USER}" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]]; then
  echo "O usuário atual não possui um nome compatível com a regra sudoers gerenciada." >&2
  exit 1
fi

if [[ "${MODE}" == "install" && -z "${VISUDO_BIN}" ]]; then
  echo "visudo não foi encontrado. Ele é obrigatório para validar a regra sudoers do helper de produção." >&2
  exit 1
fi

if [[ "${MODE}" == "update" ]]; then
  if ! systemctl cat "${SERVICE_UNIT}" >/dev/null 2>&1; then
    echo "O serviço ainda não está instalado. Use npm run service:install primeiro." >&2
    exit 1
  fi
  if [[ ! -x "${CONTROL_HELPER_PATH}" ]]; then
    echo "O helper privilegiado ${CONTROL_HELPER_PATH} não está instalado. Execute npm run service:install no terminal para configurar o bootstrap seguro." >&2
    exit 1
  fi
  HELPER_METADATA="$(stat -Lc '%U:%G:%a' "${CONTROL_HELPER_PATH}" 2>/dev/null || true)"
  if [[ "${HELPER_METADATA}" != "root:root:755" ]]; then
    echo "O helper privilegiado precisa ser root:root com modo 0755. Execute npm run service:install no terminal para reparar o bootstrap seguro." >&2
    exit 1
  fi
  if ! sudo -n "${CONTROL_HELPER_PATH}" check >/dev/null 2>&1; then
    echo "O helper privilegiado do Home Music ainda não está autorizado sem senha. Execute npm run service:install no terminal para instalar/atualizar a regra NOPASSWD limitada." >&2
    exit 1
  fi
fi

reject_multiline() {
  local label="$1"
  local value="$2"
  if [[ "${value}" == *$'\n'* || "${value}" == *$'\r'* ]]; then
    echo "${label} contém quebra de linha e não pode ser usado no unit do systemd." >&2
    exit 1
  fi
}

systemd_quote_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//%/%%}"
  printf '%s' "${value}"
}

reject_multiline "ROOT_DIR" "${ROOT_DIR}"
reject_multiline "NODE_BIN" "${NODE_BIN}"
reject_multiline "HOME" "${HOME}"

ROOT_PATH_ESCAPED="$(systemd_quote_value "${ROOT_DIR}")"
ROOT_ARG_ESCAPED="$(systemd_quote_value "${ROOT_DIR}")"
NODE_ARG_ESCAPED="$(systemd_quote_value "${NODE_BIN}")"
HOME_ESCAPED="$(systemd_quote_value "${HOME}")"
ROOT_READ_ONLY_DIRECTIVE="ReadOnlyPaths=\"${ROOT_PATH_ESCAPED}\""
declare -a RUNTIME_READ_WRITE_DIRECTIVES=()
RUNTIME_READ_WRITE_UNIT_LINES=""

prepare_runtime_policy() {
  local runtime_paths_output
  if ! runtime_paths_output="$("${NODE_BIN}" "${RUNTIME_PATHS_SCRIPT}" "${ROOT_DIR}" "${ROOT_DIR}/.env")"; then
    echo "Falha ao preparar os diretórios graváveis do serviço." >&2
    exit 1
  fi

  local -a runtime_paths=()
  mapfile -t runtime_paths <<<"${runtime_paths_output}"
  if [[ ${#runtime_paths[@]} -eq 0 || -z "${runtime_paths[0]}" ]]; then
    echo "Nenhum diretório gravável foi calculado para o serviço." >&2
    exit 1
  fi

  local runtime_path
  for runtime_path in "${runtime_paths[@]}"; do
    reject_multiline "Runtime path" "${runtime_path}"
    RUNTIME_READ_WRITE_DIRECTIVES+=("ReadWritePaths=\"$(systemd_quote_value "${runtime_path}")\"")
  done
  RUNTIME_READ_WRITE_UNIT_LINES="$(printf '%s\n' "${RUNTIME_READ_WRITE_DIRECTIVES[@]}")"
}

verify_installed_runtime_policy() {
  local installed_unit
  if ! installed_unit="$(systemctl cat "${SERVICE_UNIT}")"; then
    echo "Não foi possível ler o unit instalado de ${SERVICE_UNIT}." >&2
    exit 1
  fi

  local expected
  for expected in "ProtectSystem=strict" "${ROOT_READ_ONLY_DIRECTIVE}" "${RUNTIME_READ_WRITE_DIRECTIVES[@]}"; do
    if ! grep -Fqx "${expected}" <<<"${installed_unit}"; then
      echo "O unit instalado não contém a política de filesystem esperada (${expected}). Execute npm run service:install no terminal antes de usar service:update." >&2
      exit 1
    fi
  done

  local installed_write
  while IFS= read -r installed_write; do
    [[ "${installed_write}" == ReadWritePaths=* ]] || continue
    local known=0
    for expected in "${RUNTIME_READ_WRITE_DIRECTIVES[@]}"; do
      if [[ "${installed_write}" == "${expected}" ]]; then
        known=1
        break
      fi
    done
    if [[ ${known} -ne 1 ]]; then
      echo "O unit instalado contém uma exceção de escrita obsoleta (${installed_write}). Execute npm run service:install no terminal para reconciliar a política." >&2
      exit 1
    fi
  done <<<"${installed_unit}"
}

harden_local_files() {
  chmod 600 "${ROOT_DIR}/.env"
  mkdir -p "${ROOT_DIR}/data"
  chmod 700 "${ROOT_DIR}/data"
  find "${ROOT_DIR}/data" -maxdepth 1 -type f -name 'home-music.db*' -exec chmod 600 {} +
}

run_privileged_update_action() {
  local action="$1"
  if ! sudo -n "${CONTROL_HELPER_PATH}" "${action}"; then
    echo "Falha ao executar a ação privilegiada '${action}' pelo helper do Home Music. Rode npm run service:install no terminal para reparar o bootstrap seguro." >&2
    exit 1
  fi
}

verify_service_stable() {
  local attempt
  for attempt in 1 2 3; do
    sleep 1
    if ! systemctl is-active --quiet "${SERVICE_UNIT}"; then
      echo "O serviço não permaneceu ativo após o restart (checagem ${attempt}/3)." >&2
      systemctl status "${SERVICE_UNIT}" --no-pager || true
      return 1
    fi
  done
}

on_error() {
  if [[ ${SERVICE_STOPPED} -eq 1 ]]; then
    echo >&2
    echo "A atualização falhou depois que o serviço foi parado." >&2
    echo "Corrija o erro e execute novamente npm run service:${MODE}." >&2
  fi
}
trap on_error ERR

prepare_runtime_policy
if [[ "${MODE}" == "update" ]]; then
  verify_installed_runtime_policy
fi

cd "${ROOT_DIR}"
harden_local_files

echo "==> Instalando dependências reproduzíveis"
"${NPM_BIN}" ci

echo "==> Gerando build de produção"
"${NPM_BIN}" run build

if [[ ! -f "${ROOT_DIR}/apps/web/dist/index.html" || ! -f "${ROOT_DIR}/apps/server/dist/index.js" || ! -f "${ROOT_DIR}/apps/server/dist/bootstrap-preload.js" ]]; then
  echo "Build de produção incompleto." >&2
  exit 1
fi

harden_local_files

if [[ "${MODE}" == "update" ]]; then
  if systemctl is-active --quiet "${SERVICE_UNIT}"; then
    echo "==> Parando ${SERVICE_UNIT} somente para a troca final"
    run_privileged_update_action stop
    SERVICE_STOPPED=1
  fi

  echo "==> Reiniciando ${SERVICE_UNIT} pelo helper privilegiado"
  run_privileged_update_action restart
  SERVICE_STOPPED=0
else
  TMP_DIR="$(mktemp -d)"
  TMP_SERVICE="${TMP_DIR}/${SERVICE_UNIT}"
  TMP_HELPER="${TMP_DIR}/home-music-service-control"
  TMP_SUDOERS="${TMP_DIR}/home-music-sudoers"
  trap 'rm -rf "${TMP_DIR}"' EXIT

  cat > "${TMP_SERVICE}" <<EOF_SERVICE
[Unit]
Description=Home Music personal streaming server
After=network-online.target local-fs.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${ROOT_PATH_ESCAPED}
Environment="NODE_ENV=production"
Environment="HOME=${HOME_ESCAPED}"
ExecStart="${NODE_ARG_ESCAPED}" --import "${ROOT_ARG_ESCAPED}/apps/server/dist/bootstrap-preload.js" "${ROOT_ARG_ESCAPED}/apps/server/dist/index.js"
Restart=on-failure
RestartSec=5s
TimeoutStopSec=30s
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
${ROOT_READ_ONLY_DIRECTIVE}
${RUNTIME_READ_WRITE_UNIT_LINES}
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
RestrictSUIDSGID=true
UMask=0077
LimitNOFILE=8192
StandardOutput=journal
StandardError=journal
SyslogIdentifier=home-music

[Install]
WantedBy=multi-user.target
EOF_SERVICE

  cat > "${TMP_HELPER}" <<'EOF_HELPER'
#!/bin/bash
set -euo pipefail

SYSTEMCTL_BIN="/usr/bin/systemctl"
SERVICE_UNIT="home-music.service"

if [[ ${EUID} -ne 0 ]]; then
  echo "Este helper precisa ser executado via sudo." >&2
  exit 1
fi

if [[ $# -ne 1 ]]; then
  echo "Uso: home-music-service-control <check|stop|restart>" >&2
  exit 2
fi

if [[ ! -x "${SYSTEMCTL_BIN}" ]]; then
  echo "systemctl não está disponível em ${SYSTEMCTL_BIN}." >&2
  exit 1
fi

case "$1" in
  check)
    "${SYSTEMCTL_BIN}" cat "${SERVICE_UNIT}" >/dev/null
    ;;
  stop)
    "${SYSTEMCTL_BIN}" stop "${SERVICE_UNIT}"
    ;;
  restart)
    "${SYSTEMCTL_BIN}" restart "${SERVICE_UNIT}"
    ;;
  *)
    echo "Ação não permitida. Use check, stop ou restart." >&2
    exit 2
    ;;
esac
EOF_HELPER

  cat > "${TMP_SUDOERS}" <<EOF_SUDOERS
${RUN_USER} ALL=(root) NOPASSWD: ${CONTROL_HELPER_PATH} check, ${CONTROL_HELPER_PATH} stop, ${CONTROL_HELPER_PATH} restart
EOF_SUDOERS

  chmod 0755 "${TMP_HELPER}"
  chmod 0440 "${TMP_SUDOERS}"

  if [[ -n "${SYSTEMD_ANALYZE_BIN}" ]]; then
    echo "==> Validando unit do systemd"
    "${SYSTEMD_ANALYZE_BIN}" verify "${TMP_SERVICE}"
  else
    echo "Aviso: systemd-analyze não encontrado; pulando validação local do unit." >&2
  fi

  echo "==> Validando regra sudoers limitada"
  "${VISUDO_BIN}" -cf "${TMP_SUDOERS}" >/dev/null

  if systemctl is-active --quiet "${SERVICE_UNIT}"; then
    echo "==> Parando ${SERVICE_UNIT} somente para instalar o bootstrap validado"
    sudo systemctl stop "${SERVICE_UNIT}"
    SERVICE_STOPPED=1
  fi

  echo "==> Instalando ${SERVICE_PATH}"
  sudo install -o root -g root -m 0644 "${TMP_SERVICE}" "${SERVICE_PATH}"

  echo "==> Instalando helper privilegiado ${CONTROL_HELPER_PATH}"
  sudo install -o root -g root -m 0755 "${TMP_HELPER}" "${CONTROL_HELPER_PATH}"

  echo "==> Instalando regra sudoers limitada ${SUDOERS_PATH}"
  sudo install -o root -g root -m 0440 "${TMP_SUDOERS}" "${SUDOERS_PATH}"

  sudo systemctl daemon-reload
  sudo systemctl enable "${SERVICE_UNIT}" >/dev/null
  sudo systemctl restart "${SERVICE_UNIT}"
  SERVICE_STOPPED=0

  if ! sudo -n "${CONTROL_HELPER_PATH}" check >/dev/null 2>&1; then
    echo "O helper foi instalado, mas a regra NOPASSWD não ficou utilizável para ${RUN_USER}." >&2
    exit 1
  fi
fi

if ! verify_service_stable; then
  exit 1
fi

echo
if [[ "${MODE}" == "update" ]]; then
  echo "Home Music atualizado e reiniciado com segurança."
else
  echo "Home Music instalado e iniciado."
  echo "Deploys futuros podem usar service:update/prod:deploy sem senha por meio do helper NOPASSWD limitado."
fi
echo "Status:   systemctl status ${SERVICE_NAME} --no-pager"
echo "Logs:     journalctl -u ${SERVICE_NAME} -f"
echo "Reinício: sudo ${CONTROL_HELPER_PATH} restart"
