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
      echo '{"BackendState":"Running","Self":{"DNSName":"home-music.example.ts.net."}}'
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
          conflict) echo '{"TCP":{"443":{"HTTPS":true}},"Web":{"home-music.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:9999"}}}}}' ;;
          *) exit 2 ;;
        esac
      else
        echo "mock serve status (${state})"
      fi
    elif [[ "$*" == *"off"* ]]; then
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
    elif [[ "$*" == *"off"* ]]; then
      printf '%s' empty > "${MOCK_STATE}"
    else
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
  unset MOCK_TS_VERSION MOCK_STATUS_FAIL MOCK_FAIL_SERVE MOCK_FAIL_FUNNEL MOCK_PARTIAL_FUNNEL_FAIL MOCK_FAIL_ACTIVE MOCK_FAIL_RESTART MOCK_FAIL_CURL MOCK_FAIL_PUBLIC_CURL
}

cleanup_fixture() {
  rm -rf "${FIXTURE}"
  export PATH="${ORIGINAL_PATH}"
  unset HOME_MUSIC_FUNNEL_YES MOCK_STATE MOCK_TS_VERSION MOCK_STATUS_FAIL MOCK_FAIL_SERVE MOCK_FAIL_FUNNEL MOCK_PARTIAL_FUNNEL_FAIL MOCK_FAIL_ACTIVE MOCK_FAIL_RESTART MOCK_FAIL_CURL MOCK_FAIL_PUBLIC_CURL
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
assert_contains "${REPO}/.env" 'HOME_MUSIC_TRUST_TAILSCALE_PROXY=true'
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

# Se a restauração do Serve falhar, disable permanece fail-closed: Funnel não volta.
make_fixture funnel
export MOCK_FAIL_SERVE=1
set +e
"${REPO}/scripts/configure-funnel.sh" disable >/dev/null 2>&1
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "falha ao restaurar Serve deveria abortar disable"
assert_state empty
assert_contains "${REPO}/.env" 'HOME_MUSIC_COOKIE_SECURE=true'
assert_contains "${REPO}/.env" 'HOME_MUSIC_TRUST_TAILSCALE_PROXY=true'
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