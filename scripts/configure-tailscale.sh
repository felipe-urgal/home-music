#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-status}"
case "${MODE}" in
  enable|disable|status) ;;
  *)
    echo "Uso: $0 [enable|disable|status]" >&2
    exit 2
    ;;
esac

if [[ ${EUID} -eq 0 ]]; then
  echo "Execute este script como seu usuário normal. Ele usa sudo apenas para reiniciar o serviço." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
SERVICE_UNIT="home-music.service"
TAILSCALE_BIN="$(command -v tailscale || true)"
NODE_BIN="$(command -v node || true)"
CURL_BIN="$(command -v curl || true)"

fail() {
  echo "Erro: $*" >&2
  return 1
}

require_common_tools() {
  [[ -n "${TAILSCALE_BIN}" ]] || fail "Tailscale não encontrado. Instale e autentique o cliente antes de continuar."
  [[ -n "${NODE_BIN}" ]] || fail "Node.js não encontrado no PATH."
  [[ -n "${CURL_BIN}" ]] || fail "curl não encontrado no PATH."
  [[ -f "${ENV_FILE}" ]] || fail "${ENV_FILE} não encontrado."
  systemctl cat "${SERVICE_UNIT}" >/dev/null 2>&1 || fail "O serviço ${SERVICE_UNIT} não está instalado. Rode npm run service:install primeiro."
}

read_env_value() {
  local key="$1"
  local raw
  raw="$(awk -v key="${key}" '
    $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
      sub("^[[:space:]]*" key "[[:space:]]*=[[:space:]]*", "")
      value=$0
    }
    END { if (value != "") print value }
  ' "${ENV_FILE}")"

  if [[ "${raw}" == \"*\" && "${raw}" == *\" ]]; then
    raw="${raw:1:${#raw}-2}"
  elif [[ "${raw}" == \'*\' && "${raw}" == *\' ]]; then
    raw="${raw:1:${#raw}-2}"
  fi
  printf '%s' "${raw}"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"

  awk -v key="${key}" -v value="${value}" '
    BEGIN { replaced=0 }
    $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
      if (!replaced) {
        print key "=" value
        replaced=1
      }
      next
    }
    { print }
    END {
      if (!replaced) print key "=" value
    }
  ' "${ENV_FILE}" > "${tmp}"

  chmod 600 "${tmp}"
  mv "${tmp}" "${ENV_FILE}"
}

json_field() {
  local expression="$1"
  "${NODE_BIN}" -e '
    const fs = require("node:fs");
    const expression = process.argv[1];
    const input = fs.readFileSync(0, "utf8");
    const data = JSON.parse(input);
    const value = expression.split(".").reduce((current, key) => current?.[key], data);
    if (value !== undefined && value !== null) process.stdout.write(String(value));
  ' "${expression}"
}

check_tailscale_version() {
  local version
  version="$("${TAILSCALE_BIN}" version 2>/dev/null | head -n 1 | tr -d '[:space:]')"
  [[ -n "${version}" ]] || fail "Não foi possível identificar a versão do Tailscale."

  if ! "${NODE_BIN}" -e '
    const match = process.argv[1].match(/^(\d+)\.(\d+)/);
    if (!match) process.exit(1);
    const major = Number(match[1]);
    const minor = Number(match[2]);
    process.exit(major > 1 || (major === 1 && minor >= 52) ? 0 : 1);
  ' "${version}"; then
    fail "Tailscale ${version} é antigo para este fluxo. Atualize para 1.52 ou superior."
  fi
}

load_tailscale_identity() {
  local status_json backend_state dns_name
  status_json="$("${TAILSCALE_BIN}" status --json)" || fail "Não foi possível consultar o status do Tailscale."
  backend_state="$(printf '%s' "${status_json}" | json_field "BackendState")"
  [[ "${backend_state}" == "Running" ]] || fail "Tailscale não está conectado (BackendState=${backend_state:-desconhecido}). Rode sudo tailscale up."

  dns_name="$(printf '%s' "${status_json}" | json_field "Self.DNSName")"
  dns_name="${dns_name%.}"
  [[ -n "${dns_name}" ]] || fail "O Tailscale não informou um nome MagicDNS para esta máquina."

  TAILSCALE_DNS_NAME="${dns_name}"
  TAILSCALE_URL="https://${dns_name}"
}

home_music_port() {
  local port
  port="$(read_env_value PORT)"
  port="${port:-8787}"
  [[ "${port}" =~ ^[0-9]+$ ]] || fail "PORT inválida no .env: ${port}"
  (( port >= 1 && port <= 65535 )) || fail "PORT fora do intervalo válido: ${port}"
  printf '%s' "${port}"
}

serve_443_state() {
  local expected_proxy="$1"
  local serve_json
  serve_json="$("${TAILSCALE_BIN}" serve status --json 2>/dev/null || printf '{}')"

  printf '%s' "${serve_json}" | "${NODE_BIN}" -e '
    const fs = require("node:fs");
    const expected = process.argv[1];
    const input = fs.readFileSync(0, "utf8").trim() || "{}";
    let data;
    try { data = JSON.parse(input); } catch { process.stdout.write("unknown"); process.exit(0); }
    if (!data || typeof data !== "object") data = {};

    const web = data.Web && typeof data.Web === "object" ? data.Web : {};
    const tcp = data.TCP && typeof data.TCP === "object" ? data.TCP : {};
    const handlers = [];

    for (const [host, config] of Object.entries(web)) {
      if (!host.endsWith(":443")) continue;
      const currentHandlers = config?.Handlers && typeof config.Handlers === "object" ? config.Handlers : {};
      for (const [path, handler] of Object.entries(currentHandlers)) {
        handlers.push({ path, proxy: handler?.Proxy });
      }
    }

    const has443 = Boolean(tcp["443"]) || handlers.length > 0;
    if (!has443) {
      process.stdout.write("empty");
      process.exit(0);
    }

    const expectedValues = new Set([expected, `http://${expected}`]);
    const isExpected = handlers.length === 1 && handlers[0].path === "/" && expectedValues.has(handlers[0].proxy);
    process.stdout.write(isExpected ? "expected" : "conflict");
  ' "${expected_proxy}"
}

wait_for_url() {
  local url="$1"
  local attempts="${2:-15}"
  local delay_seconds="${3:-2}"
  local i

  for ((i=1; i<=attempts; i+=1)); do
    if "${CURL_BIN}" --fail --silent --show-error --max-time 8 "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${delay_seconds}"
  done
  return 1
}

print_status() {
  require_common_tools
  check_tailscale_version
  load_tailscale_identity

  local port target serve_state production_host secure_cookie service_state profile
  port="$(home_music_port)"
  target="127.0.0.1:${port}"
  serve_state="$(serve_443_state "${target}")"
  production_host="$(read_env_value PRODUCTION_HOST)"
  secure_cookie="$(read_env_value HOME_MUSIC_COOKIE_SECURE)"
  service_state="$(systemctl is-active "${SERVICE_UNIT}" 2>/dev/null || true)"
  profile="lan-http"
  if [[ "${production_host}" == "127.0.0.1" && "${secure_cookie}" == "true" ]]; then profile="tailscale-https"; fi

  echo "Home Music / Tailscale"
  echo "  Serviço:          ${service_state:-desconhecido}"
  echo "  URL HTTPS:        ${TAILSCALE_URL}"
  echo "  Serve :443:       ${serve_state}"
  echo "  Backend esperado: ${target}"
  echo "  PRODUCTION_HOST:  ${production_host:-não definido}"
  echo "  Cookie Secure:    ${secure_cookie:-false}"
  echo "  Perfil:           ${profile}"
}

enable_tailscale() {
  require_common_tools
  check_tailscale_version
  load_tailscale_identity

  local port target local_url serve_state env_backup serve_created=0 rollback_needed=0
  port="$(home_music_port)"
  target="127.0.0.1:${port}"
  local_url="http://${target}"
  serve_state="$(serve_443_state "${target}")"

  if [[ "${serve_state}" == "unknown" ]]; then
    fail "Não foi possível interpretar 'tailscale serve status --json'. Atualize o Tailscale antes de continuar."
  fi
  if [[ "${serve_state}" == "conflict" ]]; then
    echo "Já existe uma configuração Tailscale Serve em HTTPS/443 nesta máquina." >&2
    echo "Nenhuma alteração foi feita. Revise antes de substituir:" >&2
    "${TAILSCALE_BIN}" serve status >&2 || true
    exit 1
  fi

  if ! "${CURL_BIN}" --fail --silent --show-error --max-time 8 "${local_url}/health" >/dev/null; then
    fail "Home Music não responde em ${local_url}/health. Confirme o serviço antes de habilitar o proxy."
  fi

  echo "Atenção: o certificado HTTPS usa ${TAILSCALE_DNS_NAME}."
  echo "O nome da máquina e o domínio *.ts.net do certificado ficam registrados publicamente em Certificate Transparency; o serviço continua privado ao tailnet."
  if [[ "${HOME_MUSIC_TAILSCALE_YES:-0}" != "1" ]]; then
    read -r -p "Continuar com Tailscale Serve + HTTPS? [y/N] " answer
    [[ "${answer}" =~ ^[Yy]$ ]] || { echo "Cancelado sem alterações."; exit 0; }
  fi

  env_backup="$(mktemp)"
  cp "${ENV_FILE}" "${env_backup}"
  chmod 600 "${env_backup}"
  rollback_needed=1

  rollback() {
    local rc=$?
    if [[ ${rollback_needed} -eq 1 ]]; then
      echo >&2
      echo "Falha durante a ativação; restaurando configuração anterior." >&2
      cp "${env_backup}" "${ENV_FILE}" || true
      chmod 600 "${ENV_FILE}" || true
      sudo systemctl restart "${SERVICE_UNIT}" >/dev/null 2>&1 || true
      if [[ ${serve_created} -eq 1 ]]; then
        "${TAILSCALE_BIN}" serve --https=443 off >/dev/null 2>&1 || true
      fi
    fi
    rm -f "${env_backup}"
    exit "${rc}"
  }
  trap rollback ERR INT TERM

  if [[ "${serve_state}" == "empty" ]]; then
    echo "==> Configurando Tailscale Serve persistente em HTTPS/443"
    if ! "${TAILSCALE_BIN}" serve --bg --yes --https=443 "${target}"; then
      echo >&2
      echo "O Tailscale Serve não pôde ser habilitado." >&2
      echo "Confirme MagicDNS e HTTPS Certificates no painel DNS do tailnet e tente novamente." >&2
      false
    fi
    serve_created=1
  else
    echo "==> Tailscale Serve já aponta HTTPS/443 para ${target}"
  fi

  echo "==> Validando TLS/proxy antes de fechar a porta da LAN"
  wait_for_url "${TAILSCALE_URL}/health" 20 2 || fail "${TAILSCALE_URL}/health não ficou acessível via HTTPS."

  echo "==> Restringindo Fastify ao loopback e habilitando cookie Secure"
  set_env_value PRODUCTION_HOST 127.0.0.1
  set_env_value HOME_MUSIC_COOKIE_SECURE true

  echo "==> Reiniciando Home Music"
  sudo systemctl restart "${SERVICE_UNIT}"
  sudo systemctl is-active --quiet "${SERVICE_UNIT}" || fail "Home Music não ficou ativo após o restart."

  wait_for_url "${local_url}/health" 10 1 || fail "Backend local não respondeu após o restart."
  wait_for_url "${TAILSCALE_URL}/ready" 15 2 || fail "Home Music não ficou pronto via Tailscale HTTPS."

  rollback_needed=0
  trap - ERR INT TERM
  rm -f "${env_backup}"

  echo
  echo "Tailscale + HTTPS habilitado com sucesso."
  echo "URL: ${TAILSCALE_URL}"
  echo "O backend agora escuta apenas em 127.0.0.1:${port}."
  echo "No celular, mantenha o Tailscale conectado e abra a URL HTTPS acima."
}

disable_tailscale() {
  require_common_tools
  check_tailscale_version
  load_tailscale_identity

  local port target serve_state env_backup rollback_needed=0 serve_removed=0
  port="$(home_music_port)"
  target="127.0.0.1:${port}"
  serve_state="$(serve_443_state "${target}")"

  if [[ "${serve_state}" == "conflict" || "${serve_state}" == "unknown" ]]; then
    fail "A configuração Serve em 443 não corresponde ao Home Music; nenhuma alteração foi feita."
  fi

  env_backup="$(mktemp)"
  cp "${ENV_FILE}" "${env_backup}"
  chmod 600 "${env_backup}"
  rollback_needed=1

  rollback() {
    local rc=$?
    if [[ ${rollback_needed} -eq 1 ]]; then
      echo >&2
      echo "Falha durante o rollback; restaurando .env anterior." >&2
      cp "${env_backup}" "${ENV_FILE}" || true
      chmod 600 "${ENV_FILE}" || true
      sudo systemctl restart "${SERVICE_UNIT}" >/dev/null 2>&1 || true
      if [[ ${serve_removed} -eq 1 ]]; then
        "${TAILSCALE_BIN}" serve --bg --yes --https=443 "${target}" >/dev/null 2>&1 || true
      fi
    fi
    rm -f "${env_backup}"
    exit "${rc}"
  }
  trap rollback ERR INT TERM

  if [[ "${serve_state}" == "expected" ]]; then
    echo "==> Desabilitando Tailscale Serve em HTTPS/443"
    "${TAILSCALE_BIN}" serve --https=443 off
    serve_removed=1
  fi

  echo "==> Restaurando acesso HTTP pela LAN"
  set_env_value HOME_MUSIC_COOKIE_SECURE false
  set_env_value PRODUCTION_HOST 0.0.0.0
  sudo systemctl restart "${SERVICE_UNIT}"
  sudo systemctl is-active --quiet "${SERVICE_UNIT}" || fail "Home Music não ficou ativo após o rollback."

  rollback_needed=0
  trap - ERR INT TERM
  rm -f "${env_backup}"

  echo
  echo "Tailscale Serve desabilitado."
  echo "Home Music voltou a escutar na LAN em http://IP_DO_PC:${port}."
  echo "Não faça port-forwarding dessa porta para a internet."
}

case "${MODE}" in
  enable) enable_tailscale ;;
  disable) disable_tailscale ;;
  status) print_status ;;
esac
