#!/usr/bin/env bash
set -euo pipefail

SCRIPT_UNDER_TEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/configure-tailscale.sh"

fail_test() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq "${expected}" "${file}" || fail_test "${file} não contém: ${expected}"
}

assert_not_exists() {
  [[ ! -e "$1" ]] || fail_test "não deveria existir: $1"
}

make_fixture() {
  FIXTURE="$(mktemp -d)"
  REPO="${FIXTURE}/repo"
  BIN="${FIXTURE}/bin"
  STATE="${FIXTURE}/serve-state"
  mkdir -p "${REPO}/scripts" "${BIN}"
  cp "${SCRIPT_UNDER_TEST}" "${REPO}/scripts/configure-tailscale.sh"

  cat > "${REPO}/.env" <<'ENV'
MUSIC_DIR="/mnt/musicas/Musicas - Copia"
HOME_MUSIC_USER=home-music
HOME_MUSIC_PASSWORD=secret
HOME_MUSIC_COOKIE_SECURE=false
PORT=8787
PRODUCTION_HOST=0.0.0.0
ENV

  cat > "${BIN}/tailscale" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
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
        if [[ "${MOCK_SERVE_CONFLICT:-0}" == "1" ]]; then
          echo '{"TCP":{"443":{"HTTPS":true}},"Web":{"home-music.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:9999"}}}}}'
        elif [[ -f "${MOCK_STATE}" ]]; then
          echo '{"TCP":{"443":{"HTTPS":true}},"Web":{"home-music.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"}}}}}'
        else
          echo '{}'
        fi
      else
        echo 'mock serve status'
      fi
    elif [[ "$*" == *"off"* ]]; then
      rm -f "${MOCK_STATE}"
      echo 'off'
    else
      touch "${MOCK_STATE}"
      echo 'enabled'
    fi
    ;;
  *)
    exit 2
    ;;
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
[[ "${MOCK_FAIL_CURL:-0}" != "1" ]]
MOCK

  chmod +x "${BIN}"/* "${REPO}/scripts/configure-tailscale.sh"
  export MOCK_STATE="${STATE}"
  export PATH="${BIN}:${ORIGINAL_PATH}"
  export HOME_MUSIC_TAILSCALE_YES=1
  unset MOCK_SERVE_CONFLICT MOCK_FAIL_ACTIVE MOCK_FAIL_RESTART MOCK_FAIL_CURL MOCK_TS_VERSION
}

cleanup_fixture() {
  rm -rf "${FIXTURE}"
  export PATH="${ORIGINAL_PATH}"
  unset HOME_MUSIC_TAILSCALE_YES MOCK_STATE MOCK_SERVE_CONFLICT MOCK_FAIL_ACTIVE MOCK_FAIL_RESTART MOCK_FAIL_CURL MOCK_TS_VERSION
}

ORIGINAL_PATH="${PATH}"
trap '[[ -n "${FIXTURE:-}" ]] && rm -rf "${FIXTURE}"' EXIT

make_fixture
"${REPO}/scripts/configure-tailscale.sh" enable >/dev/null
assert_contains "${REPO}/.env" 'HOME_MUSIC_COOKIE_SECURE=true'
assert_contains "${REPO}/.env" 'PRODUCTION_HOST=127.0.0.1'
[[ -f "${STATE}" ]] || fail_test "Serve deveria estar ativo"
"${REPO}/scripts/configure-tailscale.sh" enable >/dev/null
"${REPO}/scripts/configure-tailscale.sh" disable >/dev/null
assert_contains "${REPO}/.env" 'HOME_MUSIC_COOKIE_SECURE=false'
assert_contains "${REPO}/.env" 'PRODUCTION_HOST=0.0.0.0'
assert_not_exists "${STATE}"
cleanup_fixture

make_fixture
export MOCK_SERVE_CONFLICT=1
set +e
"${REPO}/scripts/configure-tailscale.sh" enable >/dev/null 2>&1
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "conflito em 443 deveria falhar"
assert_contains "${REPO}/.env" 'HOME_MUSIC_COOKIE_SECURE=false'
assert_contains "${REPO}/.env" 'PRODUCTION_HOST=0.0.0.0'
assert_not_exists "${STATE}"
cleanup_fixture

make_fixture
export MOCK_FAIL_ACTIVE=1
set +e
"${REPO}/scripts/configure-tailscale.sh" enable >/dev/null 2>&1
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "falha de restart deveria abortar enable"
assert_contains "${REPO}/.env" 'HOME_MUSIC_COOKIE_SECURE=false'
assert_contains "${REPO}/.env" 'PRODUCTION_HOST=0.0.0.0'
assert_not_exists "${STATE}"
cleanup_fixture

make_fixture
"${REPO}/scripts/configure-tailscale.sh" enable >/dev/null
touch "${STATE}"
export MOCK_FAIL_ACTIVE=1
set +e
"${REPO}/scripts/configure-tailscale.sh" disable >/dev/null 2>&1
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "falha de restart deveria abortar disable"
assert_contains "${REPO}/.env" 'HOME_MUSIC_COOKIE_SECURE=true'
assert_contains "${REPO}/.env" 'PRODUCTION_HOST=127.0.0.1'
[[ -f "${STATE}" ]] || fail_test "Serve deveria ter sido restaurado"
cleanup_fixture

make_fixture
export MOCK_TS_VERSION=1.50.1
set +e
"${REPO}/scripts/configure-tailscale.sh" enable >/dev/null 2>&1
RC=$?
set -e
[[ ${RC} -ne 0 ]] || fail_test "Tailscale antigo deveria ser rejeitado"
assert_contains "${REPO}/.env" 'PRODUCTION_HOST=0.0.0.0'
assert_not_exists "${STATE}"
cleanup_fixture

echo "Tailscale operational tests passed."
