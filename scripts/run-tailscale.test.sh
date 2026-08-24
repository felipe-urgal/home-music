#!/usr/bin/env bash
set -euo pipefail

SCRIPT_UNDER_TEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-tailscale.sh"
FIXTURE="$(mktemp -d)"
trap 'rm -rf "${FIXTURE}"' EXIT

mkdir -p "${FIXTURE}/scripts"
cp "${SCRIPT_UNDER_TEST}" "${FIXTURE}/scripts/run-tailscale.sh"
chmod +x "${FIXTURE}/scripts/run-tailscale.sh"

cat > "${FIXTURE}/scripts/configure-tailscale.sh" <<'MOCK'
#!/usr/bin/env bash
echo 'Access denied: serve config denied' >&2
echo "Use sudo tailscale serve para continuar" >&2
exit 1
MOCK
chmod +x "${FIXTURE}/scripts/configure-tailscale.sh"

set +e
OUTPUT="$(bash "${FIXTURE}/scripts/run-tailscale.sh" enable 2>&1)"
RC=$?
set -e

[[ ${RC} -ne 0 ]] || { echo 'FAIL: erro de permissão deveria preservar código de falha' >&2; exit 1; }
grep -Fq 'Access denied: serve config denied' <<<"${OUTPUT}" || { echo 'FAIL: stderr original deveria ser preservado' >&2; exit 1; }
grep -Fq 'sudo tailscale set --operator="$USER"' <<<"${OUTPUT}" || { echo 'FAIL: orientação de operator ausente' >&2; exit 1; }

cat > "${FIXTURE}/scripts/configure-tailscale.sh" <<'MOCK'
#!/usr/bin/env bash
echo 'ok'
exit 0
MOCK
chmod +x "${FIXTURE}/scripts/configure-tailscale.sh"

OUTPUT="$(bash "${FIXTURE}/scripts/run-tailscale.sh" status 2>&1)"
grep -Fxq 'ok' <<<"${OUTPUT}" || { echo 'FAIL: saída de sucesso deveria ser preservada' >&2; exit 1; }
if grep -Fq 'set --operator' <<<"${OUTPUT}"; then
  echo 'FAIL: não deve sugerir operator em execução bem-sucedida' >&2
  exit 1
fi

echo 'Tailscale wrapper tests passed.'
