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
MIN_PUBLIC_PASSWORD_LENGTH=20

fail() {
  echo "Erro: $*" >&2
  return 1
}

require_common_tools() {
  [[ -n "${TAILSCALE_BIN}" ]] || fail "Tailscale não encontrado no Ubuntu. Instale e autentique o cliente antes de continuar."
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
  [[ "${backend_state}" == "Running" ]] || fail "Tailscale não está conectado no Ubuntu (BackendState=${backend_state:-desconhecido}). Rode sudo tailscale up."

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

  if [[ ! "${port}" =~ ^[0-9]+$ ]]; then
    fail "PORT inválida no .env: ${port}"
    return 1
  fi
  if (( port < 1 || port > 65535 )); then
    fail "PORT fora do intervalo válido: ${port}"
    return 1
  fi

  printf '%s' "${port}"
}

validate_public_credentials() {
  local username password
  username="$(read_env_value HOME_MUSIC_USER)"
  password="$(read_env_value HOME_MUSIC_PASSWORD)"

  [[ -n "${username}" ]] || fail "HOME_MUSIC_USER precisa estar configurado antes de publicar o Home Music."
  if (( ${#password} < MIN_PUBLIC_PASSWORD_LENGTH )); then
    fail "HOME_MUSIC_PASSWORD precisa ter pelo menos ${MIN_PUBLIC_PASSWORD_LENGTH} caracteres exclusivos para o perfil público."
    return 1
  fi
}

https_443_state() {
  local expected_proxy="$1"
  local serve_json

  if ! serve_json="$("${TAILSCALE_BIN}" serve status --json 2>/dev/null)"; then
    printf '%s' "unknown"
    return 0
  fi

  printf '%s' "${serve_json}" | "${NODE_BIN}" -e '
    const fs = require("node:fs");
    const expected = process.argv[1];
    const input = fs.readFileSync(0, "utf8").trim() || "{}";
    let data;
    try { data = JSON.parse(input); } catch { process.stdout.write("unknown"); process.exit(0); }
    if (!data || typeof data !== "object") data = {};

    const web = data.Web && typeof data.Web === "object" ? data.Web : {};
    const tcp = data.TCP && typeof data.TCP === "object" ? data.TCP : {};
    const allowFunnel = data.AllowFunnel && typeof data.AllowFunnel === "object" ? data.AllowFunnel : {};
    const handlers = [];

    for (const [host, config] of Object.entries(web)) {
      if (!host.endsWith(":443")) continue;
      const currentHandlers = config?.Handlers && typeof config.Handlers === "object" ? config.Handlers : {};
      for (const [path, handler] of Object.entries(currentHandlers)) {
        handlers.push({ path, proxy: handler?.Proxy });
      }
    }

    const funnelOn443 = Object.entries(allowFunnel).some(([host, enabled]) => enabled === true && host.endsWith(":443"));
    const has443 = Boolean(tcp["443"]) || handlers.length > 0 || funnelOn443;
    if (!has443) {
      process.stdout.write("empty");
      process.exit(0);
    }

    const expectedValues = new Set([expected, `http://${expected}`]);
    const expectedHandler = handlers.length === 1 && handlers[0].path === "/" && expectedValues.has(handlers[0].proxy);
    if (!expectedHandler) {
      process.stdout.write("conflict");
      process.exit(0);
    }

    process.stdout.write(funnelOn443 ? "funnel" : "serve");
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

restart_and_validate_local() {
  local local_url="$1"
  sudo systemctl restart "${SERVICE_UNIT}"
  if ! sudo systemctl is-active --quiet "${SERVICE_UNIT}"; then
    fail "Home Music não ficou ativo após o restart."
    return 1
  fi
  if ! wait_for_url "${local_url}/health" 10 1; then
    fail "Backend local não respondeu após o restart."
    return 1
  fi
}

print_status() {
  require_common_tools
  check_tailscale_version
  load_tailscale_identity

  local port target state production_host secure_cookie trusted_proxy service_state profile
  port="$(home_music_port)"
  target="127.0.0.1:${port}"
  state="$(https_443_state "${target}")"
  production_host="$(read_env_value PRODUCTION_HOST)"
  secure_cookie="$(read_env_value HOME_MUSIC_COOKIE_SECURE)"
  trusted_proxy="$(read_env_value HOME_MUSIC_TRUST_TAILSCALE_PROXY)"
  service_state="$(systemctl is-active "${SERVICE_UNIT}" 2>/dev/null || true)"
  profile="inconsistente"

  if [[ "${state}" == "funnel" && "${production_host}" == "127.0.0.1" && "${secure_cookie}" == "true" && "${trusted_proxy}" == "true" ]]; then
    profile="publico-funnel"
  elif [[ "${state}" == "serve" && "${production_host}" == "127.0.0.1" && "${secure_cookie}" == "true" ]]; then
    profile="privado-serve"
  elif [[ "${state}" == "empty" && "${production_host}" == "0.0.0.0" && "${secure_cookie}" != "true" ]]; then
    profile="lan-http"
  fi

  echo "Home Music / acesso sem cliente Tailscale"
  echo "  Serviço:          ${service_state:-desconhecido}"
  echo "  URL HTTPS:        ${TAILSCALE_URL}"
  echo "  HTTPS :443:       ${state}"
  echo "  Backend esperado: ${target}"
  echo "  PRODUCTION_HOST:  ${production_host:-não definido}"
  echo "  Cookie Secure:    ${secure_cookie:-false}"
  echo "  Proxy Tailscale:  ${trusted_proxy:-false}"
  echo "  Perfil:           ${profile}"
}

enable_public() {
  require_common_tools
  check_tailscale_version
  load_tailscale_identity
  validate_public_credentials

  local port target local_url state final_state env_backup previous_state rollback_needed=0 funnel_attempted=0
  port="$(home_music_port)"
  target="127.0.0.1:${port}"
  local_url="http://${target}"
  state="$(https_443_state "${target}")"
  previous_state="${state}"

  case "${state}" in
    unknown)
      fail "Não foi possível consultar/interpretar 'tailscale serve status --json'. Nenhuma alteração foi feita."
      return 1
      ;;
    conflict)
      echo "Já existe outra configuração Tailscale em HTTPS/443 nesta máquina." >&2
      echo "Nenhuma alteração foi feita. Revise antes de substituir:" >&2
      "${TAILSCALE_BIN}" serve status >&2 || true
      return 1
      ;;
    funnel|serve|empty) ;;
  esac

  if ! "${CURL_BIN}" --fail --silent --show-error --max-time 8 "${local_url}/health" >/dev/null; then
    fail "Home Music não responde em ${local_url}/health. Confirme o serviço antes de habilitar o acesso público."
    return 1
  fi

  if [[ "${state}" == "funnel" ]]; then
    if [[ "$(read_env_value PRODUCTION_HOST)" == "127.0.0.1" && "$(read_env_value HOME_MUSIC_COOKIE_SECURE)" == "true" && "$(read_env_value HOME_MUSIC_TRUST_TAILSCALE_PROXY)" == "true" ]]; then
      echo "Tailscale Funnel já está ativo para o Home Music."
      echo "URL pública: ${TAILSCALE_URL}"
      return 0
    fi
  fi

  echo "ATENÇÃO: este modo publica a URL ${TAILSCALE_URL} na internet via Tailscale Funnel."
  echo "O conteúdo continua protegido pelo login do Home Music, mas qualquer pessoa na internet pode alcançar a tela de login."
  echo "O celular não precisa instalar nem conectar o Tailscale."
  if [[ "${HOME_MUSIC_FUNNEL_YES:-0}" != "1" ]]; then
    read -r -p "Continuar e tornar o Home Music público em HTTPS? [y/N] " answer
    [[ "${answer}" =~ ^[Yy]$ ]] || { echo "Cancelado sem alterações."; exit 0; }
  fi

  env_backup="$(mktemp)"
  cp "${ENV_FILE}" "${env_backup}"
  chmod 600 "${env_backup}"
  rollback_needed=1

  rollback() {
    local rc="${1:-1}"
    trap - ERR INT TERM
    if [[ ${rollback_needed} -eq 1 ]]; then
      echo >&2
      echo "Falha durante a ativação pública; restaurando configuração anterior." >&2
      if [[ ${funnel_attempted} -eq 1 && "${previous_state}" != "funnel" ]]; then
        "${TAILSCALE_BIN}" funnel --yes --https=443 off >/dev/null 2>&1 || true
      fi
      if [[ "${previous_state}" == "serve" ]]; then
        "${TAILSCALE_BIN}" serve --bg --yes --https=443 "${target}" >/dev/null 2>&1 || true
      fi
      cp "${env_backup}" "${ENV_FILE}" || true
      chmod 600 "${ENV_FILE}" || true
      sudo systemctl restart "${SERVICE_UNIT}" >/dev/null 2>&1 || true
    fi
    rm -f "${env_backup}"
    exit "${rc}"
  }
  trap 'rollback $?' ERR
  trap 'rollback 130' INT
  trap 'rollback 143' TERM

  echo "==> Restringindo o backend ao loopback antes da exposição pública"
  set_env_value PRODUCTION_HOST 127.0.0.1
  set_env_value HOME_MUSIC_COOKIE_SECURE true
  set_env_value HOME_MUSIC_TRUST_TAILSCALE_PROXY true
  restart_and_validate_local "${local_url}"

  echo "==> Habilitando Tailscale Funnel persistente em HTTPS/443"
  funnel_attempted=1
  if ! "${TAILSCALE_BIN}" funnel --bg --yes --https=443 "${target}"; then
    echo >&2
    echo "O Tailscale Funnel não pôde ser habilitado." >&2
    echo "Confirme MagicDNS, HTTPS Certificates e a permissão Funnel no tailnet e tente novamente." >&2
    false
  fi
  final_state="$(https_443_state "${target}")"
  if [[ "${final_state}" != "funnel" ]]; then
    fail "A configuração final de HTTPS/443 não corresponde ao Funnel esperado (estado=${final_state})."
    return 1
  fi

  echo "==> Validando HTTPS após publicar"
  if ! wait_for_url "${TAILSCALE_URL}/ready" 20 2; then
    fail "Home Music não ficou pronto em ${TAILSCALE_URL}."
    return 1
  fi

  rollback_needed=0
  trap - ERR INT TERM
  rm -f "${env_backup}"

  echo
  echo "Acesso público HTTPS habilitado com sucesso."
  echo "URL: ${TAILSCALE_URL}"
  echo "O backend continua restrito a 127.0.0.1:${port}."
  echo "No celular, abra a URL acima no Safari/Chrome; o app Tailscale não é necessário."
}

disable_public() {
  require_common_tools
  check_tailscale_version
  load_tailscale_identity

  local port target local_url state rollback_needed=0
  port="$(home_music_port)"
  target="127.0.0.1:${port}"
  local_url="http://${target}"
  state="$(https_443_state "${target}")"

  case "${state}" in
    unknown)
      fail "Não foi possível consultar/interpretar a configuração Tailscale; nenhuma alteração foi feita."
      return 1
      ;;
    conflict)
      fail "A configuração HTTPS/443 não corresponde ao Home Music; nenhuma alteração foi feita."
      return 1
      ;;
    serve)
      echo "O Funnel já está desativado e o Home Music está no Serve privado."
      echo "URL privada: ${TAILSCALE_URL}"
      return 0
      ;;
    empty)
      fail "Não há Funnel do Home Music ativo em HTTPS/443. Use npm run tailscale:enable se quiser o perfil privado."
      return 1
      ;;
    funnel) ;;
  esac

  echo "==> Desabilitando exposição pública em HTTPS/443"
  if ! "${TAILSCALE_BIN}" funnel --yes --https=443 off; then
    fail "O Tailscale não confirmou a desativação do Funnel. A URL PODE CONTINUAR PÚBLICA; confira 'tailscale funnel status' antes de assumir que o acesso foi fechado."
    return 1
  fi

  rollback_needed=1
  rollback() {
    local rc="${1:-1}"
    trap - ERR INT TERM
    if [[ ${rollback_needed} -eq 1 ]]; then
      echo >&2
      echo "Falha ao voltar para o acesso privado. Mantendo a exposição pública DESATIVADA (fail-closed)." >&2
      "${TAILSCALE_BIN}" funnel --yes --https=443 off >/dev/null 2>&1 || true
      set_env_value PRODUCTION_HOST 127.0.0.1 || true
      set_env_value HOME_MUSIC_COOKIE_SECURE true || true
      set_env_value HOME_MUSIC_TRUST_TAILSCALE_PROXY false || true
      sudo systemctl restart "${SERVICE_UNIT}" >/dev/null 2>&1 || true
      echo "O Home Music pode ficar temporariamente inacessível remotamente; corrija o Serve antes de tentar novamente." >&2
    fi
    exit "${rc}"
  }
  trap 'rollback $?' ERR
  trap 'rollback 130' INT
  trap 'rollback 143' TERM

  echo "==> Restaurando Tailscale Serve privado em HTTPS/443"
  "${TAILSCALE_BIN}" serve --bg --yes --https=443 "${target}"

  if [[ "$(https_443_state "${target}")" != "serve" ]]; then
    fail "A configuração privada do Serve não foi restaurada corretamente."
    return 1
  fi

  set_env_value PRODUCTION_HOST 127.0.0.1
  set_env_value HOME_MUSIC_COOKIE_SECURE true
  set_env_value HOME_MUSIC_TRUST_TAILSCALE_PROXY false
  restart_and_validate_local "${local_url}"

  if ! wait_for_url "${TAILSCALE_URL}/ready" 15 2; then
    fail "Home Music não ficou pronto via Serve privado."
    return 1
  fi

  rollback_needed=0
  trap - ERR INT TERM

  echo
  echo "Acesso público desabilitado."
  echo "O Home Music voltou ao Tailscale Serve privado em ${TAILSCALE_URL}."
  echo "A partir de agora o celular volta a precisar estar conectado ao Tailscale."
}

case "${MODE}" in
  enable) enable_public ;;
  disable) disable_public ;;
  status) print_status ;;
esac
