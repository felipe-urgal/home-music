#!/usr/bin/env bash
set -euo pipefail

SCRIPT_UNDER_TEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-tailscale-hardening.sh"
ORIGINAL_PATH="${PATH}"
FIXTURE=""

fail_test() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local expected="$2"
  grep -Fq "${expected}" "${file}" || fail_test "${file} não contém: ${expected}"
}

make_fixture() {
  FIXTURE="$(mktemp -d)"
  mkdir -p "${FIXTURE}/bin"

  cat > "${FIXTURE}/bin/tailscale" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" != "status --json" ]]; then
  exit 2
fi
printf '%s\n' "${MOCK_TAILSCALE_STATUS_JSON}"
MOCK

  chmod +x "${FIXTURE}/bin/tailscale"
  export PATH="${FIXTURE}/bin:${ORIGINAL_PATH}"
}

cleanup_fixture() {
  rm -rf "${FIXTURE}"
  FIXTURE=""
  export PATH="${ORIGINAL_PATH}"
  unset MOCK_TAILSCALE_STATUS_JSON HOME_MUSIC_TAILSCALE_TAG
}

trap '[[ -n "${FIXTURE}" ]] && rm -rf "${FIXTURE}"' EXIT

make_fixture
export MOCK_TAILSCALE_STATUS_JSON='{"BackendState":"Running","Self":{"DNSName":"home-music.example.ts.net.","Tags":["tag:home-music"]}}'
"${SCRIPT_UNDER_TEST}" >"${FIXTURE}/out" 2>"${FIXTURE}/err"
assert_contains "${FIXTURE}/out" 'BackendState:     Running'
assert_contains "${FIXTURE}/out" 'DNS:              home-music.example.ts.net'
assert_contains "${FIXTURE}/out" 'Tag aplicada:     sim'
cleanup_fixture

make_fixture
export MOCK_TAILSCALE_STATUS_JSON='{"BackendState":"Running","Self":{"DNSName":"home-music.example.ts.net.","Tags":[]}}'
set +e
"${SCRIPT_UNDER_TEST}" >"${FIXTURE}/out" 2>"${FIXTURE}/err"
rc=$?
set -e
[[ ${rc} -eq 2 ]] || fail_test "sem tag deveria retornar 2; retornou ${rc}"
assert_contains "${FIXTURE}/out" 'Tag aplicada:     NÃO'
assert_contains "${FIXTURE}/err" 'aplique tag:home-music ao servidor'
cleanup_fixture

make_fixture
export MOCK_TAILSCALE_STATUS_JSON='{"BackendState":"Stopped","Self":{"DNSName":"home-music.example.ts.net.","Tags":["tag:home-music"]}}'
set +e
"${SCRIPT_UNDER_TEST}" >"${FIXTURE}/out" 2>"${FIXTURE}/err"
rc=$?
set -e
[[ ${rc} -eq 1 ]] || fail_test "Tailscale parado deveria retornar 1; retornou ${rc}"
assert_contains "${FIXTURE}/err" 'Tailscale não está conectado'
cleanup_fixture

make_fixture
export HOME_MUSIC_TAILSCALE_TAG='tag:music-server'
export MOCK_TAILSCALE_STATUS_JSON='{"BackendState":"Running","Self":{"DNSName":"home-music.example.ts.net.","Tags":["tag:music-server"]}}'
"${SCRIPT_UNDER_TEST}" >"${FIXTURE}/out" 2>"${FIXTURE}/err"
assert_contains "${FIXTURE}/out" 'Tag esperada:     tag:music-server'
assert_contains "${FIXTURE}/out" 'Tag aplicada:     sim'
cleanup_fixture

echo "Tailscale hardening status tests passed."
