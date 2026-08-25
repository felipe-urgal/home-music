#!/usr/bin/env bash
set -euo pipefail

SCRIPT_UNDER_TEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/configure-funnel.sh"

fail_test() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq "${expected}" "${file}" || fail_test "${file} não contém: ${expected}"
}

assert_state() {
  local expected="$1"
  local actual
  actual="$(cat "${STATE}")"
  [[ "${actual}" == "${expected}" ]] || fail_test "estado esperado=${expected}, atual=${actual}"
}

make_fixture() {
  local initial_state="${1:-serve}"
  FIXTURE="$(mktemp -d)"
  REPO="${FIXTURE}/repo"
  BIN="${FIXTURE}/bin"
  STATE="${FIXTURE}/tailscale-state"
  mkdir -p "${REPO}/scripts" "${BIN}"
  cp "${SCRIPT_UNDER_TEST}" "${REPO}/scripts/configure-funnel.sh"
  printf '%s' "${initial_state}" > "${STATE}"

  if [[ "${initial_state}" == "empty" ]]; then
    cat > "${REPO}/.env" <<'ENV'
MUSIC_DIR="/mnt/musicas"
HOME_MUSIC_USER=home-music
HOME_MUSIC_PASSWORD=uma-senha-publica-exclusiva-com-mais-de-vinte
HOME_MUSIC_COOKIE_SECURE=false
HOME_MUSIC_TRUST_TAILSCALE_PROXY=false
PORT=8787
PRODUCTION_HOST=0.0.0.0
ENV
  elif [[ "${initial_state}" == "funnel" || "${initial_state}" == "stale_funnel" || "${initial_state}" == "stale_funnel_extra" ]]; then
    cat > "${REPO}/.env" <<'ENV'
MUSIC_DIR="/mnt/musicas"
HOME_MUSIC_USER=home-music
HOME_MUSIC_PASSWORD=uma-senha-publica-exclusiva-com-mais-de-vinte
HOME_MUSIC_COOKIE_SECURE=true
HOME_MUSIC_TRUST_TAILSCALE_PROXY=true
PORT=8787
PRODUCTION_HOST=127.0.0.1
ENV
  else
    cat > "${REPO}/.env" <<'ENV'
MUSIC_DIR="/mnt/musicas"
HOME_MUSIC_USER=home-music
HOME_MUSIC_PASSWORD=uma-senha-publica-exclusiva-com-mais-de-vinte
HOME_MUSIC_COOKIE_SECURE=true
HOME_MUSIC_TRUST_TAILSCALE_PROXY=false
PORT=8787
PRODUCTION_HOST=127.0.0.1
ENV
  fi

  cat > "${BIN}/tailscale" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
state="$(cat "${MOCK_STATE}")"
case "$1" in
  version)
    echo "${MOCK_TS_VERSION:-1.102.3}"
    ;;
  status)
    if [[ "${2:-}" == "--json" ]]; then
      printf '{"BackendState":"Running","Self":{"DNSName":"%s."}}\n' "${MOCK_DNS_NAME:-home-music.example.ts.net}"
    else
      echo 'mock tailscale status'
    fi
    ;;
  serve)
    shift
    if [[ "${1:-}" == "status" ]]; then
      if [[ "${2:-}" == "--json" ]]; then
        if [[ "${MOCK_STATUS_FAIL:-0}" == "1" ]]; then
          exit 1
        fi
        case "${state}" in
          empty) echo '{}' ;;
          serve) echo '{"TCP":{"443":{"HTTPS":true}},"Web":{"home-music.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"}}}}}' ;;
          funnel) echo '{"TCP":{"443":{"HTTPS":true}},"Web":{"home-music.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"}}}},"AllowFunnel":{"home-music.example.ts.net:443":true}}' ;;
          stale_serve) echo '{"TCP":{"443":{"HTTPS":true}},"Web":{"old-home-music.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"}}}}}' ;;
          stale_funnel) echo '{"TCP":{"443":{"HTTPS":true}},"Web":{"old-home-music.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"}}}},"AllowFunnel":{"old-home-music.example.ts.net:443":true}}' ;;
          stale_funnel_extra) echo '{"TCP":{"443":{"HTTPS":true},"8443":{"HTTPS":true}},"Web":{"old-home-music.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"}}},"old-home-music.example.ts.net:8443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:9999"}}}},"AllowFunnel":{"old-home-music.example.ts.net:443":true}}' ;;
          conflict) echo '{"TCP":{"443":{"HTTPS":true}},"Web":{"home-music.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:9999"}}}}}' ;;
          *) exit 2 ;;
        esac
      else
        echo "mock serve status (${state})"
      fi
    elif [[ "${1:-}" == "reset" ]]; then
      if [[ "${MOCK_FAIL_SERVE_RESET:-0}" == "1" ]]; then
        exit 1
      fi
      printf '%s' empty > "${MOCK_STATE}"
    elif [[ "$*" == *"off"* ]]; then
      if [[ "${state}" == stale_serve || "${state}" == stale_funnel || "${state}" == stale_funnel_extra ]]; then
        echo 'error: failed to remove web serve: handler does not exist' >&2
        exit 1
      fi
      printf '%s' empty > "${MOCK_STATE}"
    else
      if [[ "${MOCK_FAIL_SERVE:-0}" == "1" ]]; then
        exit 1
      fi
      printf '%s' serve > "${MOCK_STATE}"
    fi
    ;;
  funnel)
    shift
    if [[ "${1:-}" == "status" ]]; then
      echo "mock funnel status (${state})"
    elif [[ "${1:-}" == "reset" ]]; then
      if [[ "${MOCK_FAIL_FUNNEL_RESET:-0}" == "1" ]]; then
        exit 1
      fi
      printf '%s' empty > "${MOCK_STATE}"
    elif [[ "$*" == *"off"* ]]; then
      if [[ "${state}" == stale_funnel || "${state}" == stale_funnel_extra ]]; then
        echo 'error: failed to remove web serve: handler does not exist' >&2
        exit 1
      fi
      if [[ "${MOCK_FAIL_FUNNEL_OFF:-0}" == "1" ]]; then
        exit 1
      fi
      printf '%s' empty > "${MOCK_STATE}"
    else
      if [[ "${state}" == stale_funnel || "${state}" == stale_funnel_extra ]]; then
        echo 'error: stale hostname must be reset first' >&2
        exit 1
      fi
      if [[ "${MOCK_PARTIAL_FUNNEL_FAIL:-0}" == "1" ]]; then
        printf '%s' funnel > "${MOCK_STATE}"
        exit 1
      fi
      if [[ "${MOCK_FAIL_FUNNEL:-0}" == "1" ]]; then
        exit 1
      fi
      printf '%s' funnel > "${MOCK_STATE}"
    fi
    ;;
  *) exit 2 ;;
esac
MOCK

  cat > "${BIN}/systemctl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  cat) exit 0 ;;
  is-active)
    if [[ "${2:-}" == "--quiet" ]]; then
      [[ "${MOCK_FAIL_ACTIVE:-0}" != "1" ]]
    else
      echo active
    fi
    ;;
  restart)
    [[ "${MOCK_FAIL_RESTART:-0}" != "1" ]]
    ;;
  *) exit 0 ;;
esac
MOCK

  cat > "${BIN}/sudo" <<'MOCK'
#!/usr/bin/env bash
exec "$@"
MOCK

  cat > "${BIN}/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${MOCK_FAIL_PUBLIC_CURL:-0}" == "1" && "$(cat "${MOCK_STATE}")" == "funnel" ]]; then
  exit 1
fi
[[ "${MOCK_FAIL_CURL:-0}" != "1" ]]
MOCK

  cat > "${BIN}/sleep" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK

  chmod +x "${BIN}"/* "${REPO}/scripts/configure-funnel.sh"
  export MOCK_STATE="${STATE}"
  export PATH="${BIN}:${ORIGINAL_PATH}"
  export HOME_MUSIC_FUNNEL_YES=1
  unset MOCK_DNS_NAME MOCK_TS_VERSION MOCK_STATUS_FAIL MOCK_FAIL_SERVE MOCK_FAIL_SERVE_RESET MOCK_FAIL_FUNNEL MOCK_FAIL_FUNNEL_OFF MOCK_FAIL_FUNNEL_RESET MOCK_PARTIAL_FUNNEL_FAIL MOCK_FAIL_ACTIVE MOCK_FAIL_RESTART MOCK_FAIL_CURL MOCK_FAIL_PUBLIC_CURL
}

cleanup_fixture() {
  rm -rf "${FIXTURE}"
  export PATH="${ORIGINAL_PATH}"
  unset HOME_MUSIC_FUNNEL_YES MOCK_STATE MOCK_DNS_NAME MOCK_TS_VERSION MOCK_STATUS_FAIL MOCK_FAIL_SERVE MOCK_FAIL_SERVE_RESET MOCK_FAIL_FUNNEL MOCK_FAIL_FUNNEL_OFF MOCK_FAIL_FUNNEL_RESET MOCK_PARTIAL_FUNNEL_FAIL MOCK_FAIL_ACTIVE MOCK_FAIL_RESTART MOCK_FAIL_CURL MOCK_FAIL_PUBLIC_CURL
}

ORIGINAL_PATH="${PATH}"
trap '[[ -n "${FIXTURE:-}" ]] && rm -rf "${FIXTURE}"' EXIT

# Serve privado -> Funnel público -> idempotência -> Serve privado.
make_fixture serve
"${REPO}/scripts/configure-funnel.sh" enable >/dev/null
assert_state funnel
assert_contains "${REPO}/.env" 'HOME_MUSIC_COOKIE_SECURE=true'
assert_contains "${REPO}/.env" 'HOME_MUSIC_TRUST_TAILSCALE_PROXY=true'
assert_contains "${REPO}/.env" 'PRODUCTION_HOST=127.0.0.1'
"${REPO}/scripts/configure-funnel.sh" enable >/dev/null
assert_state funnel
"${REPO}/scripts/configure-funnel.sh" disable >/dev/null
assert_state serve
assert_contains "${REPO}/.env" 'HOME_MUSIC_COOKIE_SECURE=true'
assert_contains "${REPO}/.env" 'HOME_MUSIC_TRUST_TAILSCALE_PROXY=false'
assert_contains "${REPO}/.env" 'PRODUCTION_HOST=127.0.0.1'
cleanup_fixture

# LAN -> Funnel fecha o backend em loopback antes da publicação.
make_fixture empty
"${REPO}/scripts/configure-funnel.sh" enable >/dev/null
assert_state funnel
assert_contains "${REPO}/.env" 'HOME_MUSIC_COOKIE_SECURE=true'
assert_contains "${REPO}/.env" 'HOME_MUSIC_TRUST_TAILSCALE_PROXY=true'
assert_contains "${REPO}/.env" 'PRODUCTION_HOST=127.0.0.1'
cleanup_fixture

# Renomear a máquina com Funnel ativo: status identifica explicitamente o hostname antigo.
make_fixture stale_funnel
OUTPUT="$("${REPO}/scripts/configure-funnel.sh" status)"
grep -Fq 'HTTPS :443:       funnel-hostname-anterior' <<<"${OUTPUT}" || fail_test "status deveria identificar Funnel no hostname anterior"
grep -Fq 'Host configurado: old-home-music.example.ts.net' <<<"${OUTPUT}" || fail_test "hostname anterior ausente do status"
grep -Fq 'Perfil:           hostname-renomeado' <<<"${OUTPUT}" || fail_test "perfil de rename ausente"
cleanup_fixture

# Disable após rename usa reset seguro e restaura Serve no hostname atual; o off antigo falharia no mock.
make_fixture stale_funnel
"${REPO}/scripts/configure-funnel.sh" disable >/dev/null
assert_state serve
assert_contains "${REPO}/.env" 'HOME_MUSIC_TRUST_TAILSCALE_PROXY=false'
cleanup_fixture

# Enable após rename migra diretamente o Funnel para o hostname atual.
make_fixture stale_funnel
"${REPO}/scripts/configure-funnel.sh" enable >/dev/null
assert_state funnel
assert_contains "${REPO}/.env" 'HOME_MUSIC_TRUST_TAILSCALE_PROXY=true'
cleanup_fixture

# Serve privado persistente no hostname antigo também pode ser migrado com segurança.
make_fixture stale_serve
"${REPO}/scripts/configure-funnel.sh" enable >/dev/null
assert_state funnel
cleanup_fixture

# Reset é recusado quando existem outras rotas Tailscale além do Home Music.
make_fixture stale_funnel_extra
set +e
"${REPO}/scripts/configure-funnel.sh" enable >/dev/null 2>&1
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "configuração antiga não exclusiva deveria abortar"
assert_state stale_funnel_extra
cleanup_fixture

# Se o reset do Funnel antigo falhar, a URL antiga é tratada como potencialmente pública e nada é substituído.
make_fixture stale_funnel
export MOCK_FAIL_FUNNEL_RESET=1
set +e
OUTPUT="$("${REPO}/scripts/configure-funnel.sh" disable 2>&1)"
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "falha de reset do Funnel antigo deveria abortar"
assert_state stale_funnel
grep -Fq 'PODE CONTINUAR PÚBLICA' <<<"${OUTPUT}" || fail_test "aviso de exposição antiga potencial ausente"
assert_contains "${REPO}/.env" 'HOME_MUSIC_TRUST_TAILSCALE_PROXY=true'
cleanup_fixture

# Senha curta bloqueia exposição pública antes de qualquer mutação.
make_fixture serve
sed -i 's/^HOME_MUSIC_PASSWORD=.*/HOME_MUSIC_PASSWORD=curta/' "${REPO}/.env"
set +e
"${REPO}/scripts/configure-funnel.sh" enable >/dev/null 2>&1
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "senha curta deveria ser rejeitada"
assert_state serve
assert_contains "${REPO}/.env" 'HOME_MUSIC_TRUST_TAILSCALE_PROXY=false'
cleanup_fixture

# Conflito em 443 nunca é sobrescrito.
make_fixture conflict
set +e
"${REPO}/scripts/configure-funnel.sh" enable >/dev/null 2>&1
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "conflito em 443 deveria abortar"
assert_state conflict
cleanup_fixture

# Falha ao habilitar Funnel restaura o Serve privado e o .env original.
make_fixture serve
export MOCK_FAIL_FUNNEL=1
set +e
"${REPO}/scripts/configure-funnel.sh" enable >/dev/null 2>&1
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "falha de Funnel deveria abortar"
assert_state serve
assert_contains "${REPO}/.env" 'HOME_MUSIC_COOKIE_SECURE=true'
assert_contains "${REPO}/.env" 'HOME_MUSIC_TRUST_TAILSCALE_PROXY=false'
assert_contains "${REPO}/.env" 'PRODUCTION_HOST=127.0.0.1'
cleanup_fixture

# Mesmo se o CLI mutar para Funnel e só depois falhar, o rollback restaura o Serve.
make_fixture serve
export MOCK_PARTIAL_FUNNEL_FAIL=1
set +e
"${REPO}/scripts/configure-funnel.sh" enable >/dev/null 2>&1
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "falha parcial de Funnel deveria abortar"
assert_state serve
assert_contains "${REPO}/.env" 'HOME_MUSIC_TRUST_TAILSCALE_PROXY=false'
cleanup_fixture

# Se a validação HTTPS falhar depois da publicação, o Funnel é removido e o Serve volta.
make_fixture serve
export MOCK_FAIL_PUBLIC_CURL=1
set +e
"${REPO}/scripts/configure-funnel.sh" enable >/dev/null 2>&1
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "falha de validação pública deveria abortar"
assert_state serve
assert_contains "${REPO}/.env" 'HOME_MUSIC_TRUST_TAILSCALE_PROXY=false'
cleanup_fixture

# Se a migração de hostname limpar o antigo mas a nova publicação falhar, cai para Serve privado no hostname atual.
make_fixture stale_funnel
export MOCK_FAIL_FUNNEL=1
set +e
"${REPO}/scripts/configure-funnel.sh" enable >/dev/null 2>&1
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "falha pós-migração deveria abortar"
assert_state serve
assert_contains "${REPO}/.env" 'HOME_MUSIC_COOKIE_SECURE=true'
assert_contains "${REPO}/.env" 'HOME_MUSIC_TRUST_TAILSCALE_PROXY=false'
assert_contains "${REPO}/.env" 'PRODUCTION_HOST=127.0.0.1'
cleanup_fixture

# Se o próprio comando de desligar Funnel falhar, o script não finge que fechou a exposição.
make_fixture funnel
export MOCK_FAIL_FUNNEL_OFF=1
set +e
OUTPUT="$("${REPO}/scripts/configure-funnel.sh" disable 2>&1)"
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "falha ao desligar Funnel deveria abortar disable"
assert_state funnel
grep -Fq 'PODE CONTINUAR PÚBLICA' <<<"${OUTPUT}" || fail_test "aviso de exposição potencial ausente"
assert_contains "${REPO}/.env" 'HOME_MUSIC_TRUST_TAILSCALE_PROXY=true'
cleanup_fixture

# Se a restauração do Serve falhar depois de desligar o Funnel, permanece fail-closed.
make_fixture funnel
export MOCK_FAIL_SERVE=1
set +e
"${REPO}/scripts/configure-funnel.sh" disable >/dev/null 2>&1
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "falha ao restaurar Serve deveria abortar disable"
assert_state empty
assert_contains "${REPO}/.env" 'HOME_MUSIC_COOKIE_SECURE=true'
assert_contains "${REPO}/.env" 'HOME_MUSIC_TRUST_TAILSCALE_PROXY=false'
assert_contains "${REPO}/.env" 'PRODUCTION_HOST=127.0.0.1'
cleanup_fixture

# Falha ao interpretar status aborta antes de mutação.
make_fixture serve
export MOCK_STATUS_FAIL=1
set +e
"${REPO}/scripts/configure-funnel.sh" enable >/dev/null 2>&1
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "status inválido deveria abortar"
assert_state serve
cleanup_fixture

# Versões antigas do CLI são rejeitadas.
make_fixture serve
export MOCK_TS_VERSION=1.50.1
set +e
"${REPO}/scripts/configure-funnel.sh" enable >/dev/null 2>&1
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "Tailscale antigo deveria ser rejeitado"
assert_state serve
cleanup_fixture

echo "Tailscale Funnel operational tests passed."
