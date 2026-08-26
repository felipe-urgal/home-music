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
SERVICE_NAME="home-music"
SERVICE_UNIT="${SERVICE_NAME}.service"
SERVICE_PATH="/etc/systemd/system/${SERVICE_UNIT}"
SERVICE_STOPPED=0

if [[ -z "${NODE_BIN}" || -z "${NPM_BIN}" ]]; then
  echo "Node.js e npm precisam estar disponíveis no PATH." >&2
  exit 1
fi

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  echo "Arquivo ${ROOT_DIR}/.env não encontrado. Configure-o antes de instalar o serviço." >&2
  exit 1
fi

if [[ "${MODE}" == "update" ]] && ! systemctl cat "${SERVICE_UNIT}" >/dev/null 2>&1; then
  echo "O serviço ainda não está instalado. Use npm run service:install primeiro." >&2
  exit 1
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

systemd_path_value() {
  local value="$1"
  value="${value//\\/\\x5c}"
  value="${value// /\\x20}"
  value="${value//$'\t'/\\x09}"
  value="${value//\"/\\x22}"
  value="${value//\'/\\x27}"
  value="${value//%/%%}"
  printf '%s' "${value}"
}

reject_multiline "ROOT_DIR" "${ROOT_DIR}"
reject_multiline "NODE_BIN" "${NODE_BIN}"
reject_multiline "HOME" "${HOME}"

ROOT_PATH_ESCAPED="$(systemd_path_value "${ROOT_DIR}")"
ROOT_ARG_ESCAPED="$(systemd_quote_value "${ROOT_DIR}")"
NODE_ARG_ESCAPED="$(systemd_quote_value "${NODE_BIN}")"
HOME_ESCAPED="$(systemd_quote_value "${HOME}")"

harden_local_files() {
  chmod 600 "${ROOT_DIR}/.env"
  mkdir -p "${ROOT_DIR}/data"
  chmod 700 "${ROOT_DIR}/data"
  find "${ROOT_DIR}/data" -maxdepth 1 -type f -name 'home-music.db*' -exec chmod 600 {} +
}

on_error() {
  if [[ ${SERVICE_STOPPED} -eq 1 ]]; then
    echo >&2
    echo "A atualização falhou depois que o serviço foi parado." >&2
    echo "Corrija o erro e execute novamente npm run service:${MODE}." >&2
  fi
}
trap on_error ERR

cd "${ROOT_DIR}"
harden_local_files

if systemctl is-active --quiet "${SERVICE_UNIT}"; then
  echo "==> Parando Home Music antes de alterar dependências/build"
  sudo systemctl stop "${SERVICE_UNIT}"
  SERVICE_STOPPED=1
fi

echo "==> Instalando dependências reproduzíveis"
"${NPM_BIN}" ci

echo "==> Gerando build de produção"
"${NPM_BIN}" run build

if [[ ! -f "${ROOT_DIR}/apps/web/dist/index.html" || ! -f "${ROOT_DIR}/apps/server/dist/index.js" || ! -f "${ROOT_DIR}/apps/server/dist/bootstrap-preload.js" ]]; then
  echo "Build de produção incompleto." >&2
  exit 1
fi

harden_local_files

TMP_DIR="$(mktemp -d)"
TMP_SERVICE="${TMP_DIR}/${SERVICE_UNIT}"
trap 'rm -rf "${TMP_DIR}"' EXIT

cat > "${TMP_SERVICE}" <<EOF
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
ProtectSystem=full
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
EOF

if [[ -n "${SYSTEMD_ANALYZE_BIN}" ]]; then
  echo "==> Validando unit do systemd"
  "${SYSTEMD_ANALYZE_BIN}" verify "${TMP_SERVICE}"
else
  echo "Aviso: systemd-analyze não encontrado; pulando validação local do unit." >&2
fi

echo "==> Instalando ${SERVICE_PATH}"
sudo install -m 0644 "${TMP_SERVICE}" "${SERVICE_PATH}"
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_UNIT}" >/dev/null
sudo systemctl restart "${SERVICE_UNIT}"
SERVICE_STOPPED=0

if ! sudo systemctl is-active --quiet "${SERVICE_UNIT}"; then
  echo "O serviço não ficou ativo após o restart." >&2
  sudo systemctl status "${SERVICE_UNIT}" --no-pager || true
  exit 1
fi

echo
if [[ "${MODE}" == "update" ]]; then
  echo "Home Music atualizado e reiniciado com segurança."
else
  echo "Home Music instalado e iniciado."
fi
echo "Status:   sudo systemctl status ${SERVICE_NAME} --no-pager"
echo "Logs:     journalctl -u ${SERVICE_NAME} -f"
echo "Reinício: sudo systemctl restart ${SERVICE_NAME}"
