#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_PATHS_HELPER="${ROOT_DIR}/scripts/systemd-runtime-paths.mjs"
REQUIRE_SYSTEMD_SMOKE="${HOME_MUSIC_REQUIRE_SYSTEMD_SMOKE:-0}"

skip_or_fail() {
  local message="$1"
  if [[ "${REQUIRE_SYSTEMD_SMOKE}" == "1" ]]; then
    echo "Erro: ${message}" >&2
    exit 1
  fi
  echo "Aviso: ${message}; smoke systemd ignorado neste ambiente." >&2
  exit 0
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

command -v node >/dev/null 2>&1 || skip_or_fail "Node.js não está disponível"
command -v systemctl >/dev/null 2>&1 || skip_or_fail "systemctl não está disponível"
command -v systemd-run >/dev/null 2>&1 || skip_or_fail "systemd-run não está disponível"
command -v sudo >/dev/null 2>&1 || skip_or_fail "sudo não está disponível"

if ! systemctl is-system-running >/dev/null 2>&1 && ! systemctl is-system-running 2>/dev/null | grep -Eq '^(running|degraded)$'; then
  skip_or_fail "systemd de sistema não está ativo"
fi
if ! sudo -n true >/dev/null 2>&1; then
  skip_or_fail "sudo sem prompt não está disponível para o smoke transitório"
fi

SMOKE_BASE="${RUNNER_TEMP:-${HOME}}"
SMOKE_DIR="$(mktemp -d "${SMOKE_BASE%/}/home-music-systemd-smoke.XXXXXX")"
UNIT_NAME="home-music-filesystem-smoke-${RANDOM}-${RANDOM}"
cleanup() {
  sudo -n systemctl stop "${UNIT_NAME}.service" >/dev/null 2>&1 || true
  rm -rf "${SMOKE_DIR}"
}
trap cleanup EXIT

POLICY_ROOT="${SMOKE_DIR}/project"
POLICY_RUNTIME="${SMOKE_DIR}/runtime"
POLICY_MUSIC="${SMOKE_DIR}/Music Library"
mkdir -p \
  "${POLICY_ROOT}/apps/server/dist" \
  "${POLICY_ROOT}/apps/web/dist" \
  "${POLICY_ROOT}/scripts" \
  "${POLICY_MUSIC}"

printf 'env-original\n' > "${POLICY_ROOT}/.env"
printf 'package-original\n' > "${POLICY_ROOT}/package.json"
printf 'server-original\n' > "${POLICY_ROOT}/apps/server/dist/index.js"
printf 'web-original\n' > "${POLICY_ROOT}/apps/web/dist/index.html"
printf 'script-original\n' > "${POLICY_ROOT}/scripts/install-systemd.sh"

cat > "${POLICY_ROOT}/.env" <<EOF_ENV
MUSIC_DIR=${POLICY_MUSIC}
HOME_MUSIC_DATABASE_PATH=${POLICY_RUNTIME}/db/home-music.db
HOME_MUSIC_IMPORT_STAGING_DIR=${POLICY_RUNTIME}/import-staging
HOME_MUSIC_EXTERNAL_PROVIDER_SCRATCH_DIR=${POLICY_RUNTIME}/provider-scratch
EOF_ENV
cp "${POLICY_ROOT}/.env" "${SMOKE_DIR}/env-before"

mapfile -t WRITABLE_PATHS < <(node "${RUNTIME_PATHS_HELPER}" "${POLICY_ROOT}" "${POLICY_ROOT}/.env")
if [[ ${#WRITABLE_PATHS[@]} -lt 5 ]]; then
  echo "Erro: helper não retornou todas as exceções de escrita esperadas para o smoke." >&2
  exit 1
fi

PROBE_SCRIPT="${POLICY_ROOT}/filesystem-probe.sh"
cat > "${PROBE_SCRIPT}" <<EOF_PROBE
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "${POLICY_ROOT}/data/transcode-cache"
printf 'db\n' > "${POLICY_ROOT}/data/home-music.db"
printf 'cache\n' > "${POLICY_ROOT}/data/transcode-cache/probe"
printf 'wal\n' > "${POLICY_RUNTIME}/db/home-music.db-wal"
printf 'staging\n' > "${POLICY_RUNTIME}/import-staging/payload.bin"
printf 'scratch\n' > "${POLICY_RUNTIME}/provider-scratch/media.bin"
mkdir -p "${POLICY_MUSIC}/.home-music-trash/files"
printf 'media\n' > "${POLICY_MUSIC}/imported.mp3"
printf 'trash\n' > "${POLICY_MUSIC}/.home-music-trash/files/probe.mp3"
for protected in \
  "${POLICY_ROOT}/.env" \
  "${POLICY_ROOT}/package.json" \
  "${POLICY_ROOT}/apps/server/dist/index.js" \
  "${POLICY_ROOT}/apps/web/dist/index.html" \
  "${POLICY_ROOT}/scripts/install-systemd.sh"; do
  if printf 'tamper\n' >> "\${protected}" 2>/dev/null; then
    echo "Filesystem protegido ficou gravável: \${protected}" >&2
    exit 21
  fi
done
EOF_PROBE
chmod 0755 "${PROBE_SCRIPT}"

RUN_ARGS=(
  --quiet
  --wait
  --pipe
  --collect
  --unit="${UNIT_NAME}"
  --property="User=$(id -un)"
  --property="Group=$(id -gn)"
  --property="NoNewPrivileges=yes"
  --property="PrivateTmp=yes"
  --property="ProtectSystem=strict"
  --property="ReadOnlyPaths=$(systemd_path_value "${POLICY_ROOT}")"
)
for writable_path in "${WRITABLE_PATHS[@]}"; do
  RUN_ARGS+=(--property="ReadWritePaths=$(systemd_path_value "${writable_path}")")
done

sudo -n systemd-run "${RUN_ARGS[@]}" /bin/bash "${PROBE_SCRIPT}"

for allowed_file in \
  "${POLICY_ROOT}/data/home-music.db" \
  "${POLICY_ROOT}/data/transcode-cache/probe" \
  "${POLICY_RUNTIME}/db/home-music.db-wal" \
  "${POLICY_RUNTIME}/import-staging/payload.bin" \
  "${POLICY_RUNTIME}/provider-scratch/media.bin" \
  "${POLICY_MUSIC}/imported.mp3" \
  "${POLICY_MUSIC}/.home-music-trash/files/probe.mp3"; do
  if [[ ! -f "${allowed_file}" ]]; then
    echo "Erro: escrita runtime permitida falhou: ${allowed_file}" >&2
    exit 1
  fi
done

if ! cmp -s "${SMOKE_DIR}/env-before" "${POLICY_ROOT}/.env"; then
  echo "Erro: .env foi alterado apesar do sandbox read-only." >&2
  exit 1
fi
if [[ "$(cat "${POLICY_ROOT}/package.json")" != "package-original" ]] || \
   [[ "$(cat "${POLICY_ROOT}/apps/server/dist/index.js")" != "server-original" ]] || \
   [[ "$(cat "${POLICY_ROOT}/apps/web/dist/index.html")" != "web-original" ]] || \
   [[ "$(cat "${POLICY_ROOT}/scripts/install-systemd.sh")" != "script-original" ]]; then
  echo "Erro: arquivo protegido foi alterado durante o smoke." >&2
  exit 1
fi

echo "Smoke systemd confirmou filesystem read-only e escrita apenas nos paths runtime previstos."
