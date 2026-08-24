#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -eq 0 ]]; then
  echo "Execute este script como seu usuário normal. Ele usa sudo apenas para instalar o serviço." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="$(id -un)"
NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"
SERVICE_NAME="home-music"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ -z "${NODE_BIN}" || -z "${NPM_BIN}" ]]; then
  echo "Node.js e npm precisam estar disponíveis no PATH." >&2
  exit 1
fi

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  echo "Arquivo ${ROOT_DIR}/.env não encontrado. Configure-o antes de instalar o serviço." >&2
  exit 1
fi

cd "${ROOT_DIR}"

echo "==> Instalando dependências reproduzíveis"
"${NPM_BIN}" ci

echo "==> Gerando build de produção"
"${NPM_BIN}" run build

if [[ ! -f "${ROOT_DIR}/apps/web/dist/index.html" || ! -f "${ROOT_DIR}/apps/server/dist/index.js" ]]; then
  echo "Build de produção incompleto." >&2
  exit 1
fi

TMP_SERVICE="$(mktemp)"
trap 'rm -f "${TMP_SERVICE}"' EXIT

cat > "${TMP_SERVICE}" <<EOF
[Unit]
Description=Home Music personal streaming server
After=network-online.target local-fs.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${ROOT_DIR}
Environment=NODE_ENV=production
Environment=HOME=${HOME}
ExecStart=${NODE_BIN} ${ROOT_DIR}/apps/server/dist/index.js
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

echo "==> Instalando ${SERVICE_PATH}"
sudo install -m 0644 "${TMP_SERVICE}" "${SERVICE_PATH}"
sudo systemctl daemon-reload
sudo systemctl enable --now "${SERVICE_NAME}.service"

echo
echo "Home Music instalado e iniciado."
echo "Status:  sudo systemctl status ${SERVICE_NAME} --no-pager"
echo "Logs:    journalctl -u ${SERVICE_NAME} -f"
echo "Reinício: sudo systemctl restart ${SERVICE_NAME}"
