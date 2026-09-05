#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NPM_BIN="$(command -v npm || true)"
GIT_BIN="$(command -v git || true)"
CHECKPOINT_PARENT="${ROOT_DIR}/backups/update-checkpoints"
CHECKPOINT_KEEP=5
CHECKPOINT_DIR=""
CHECKPOINT_ARTIFACT=""

if [[ ${EUID} -eq 0 ]]; then
  echo "Execute service:update como seu usuário normal." >&2
  exit 1
fi

if [[ -z "${NPM_BIN}" || -z "${GIT_BIN}" ]]; then
  echo "npm e git precisam estar disponíveis no PATH." >&2
  exit 1
fi

ensure_private_checkpoint_root() {
  if [[ -L "${CHECKPOINT_PARENT}" ]]; then
    echo "O diretório de checkpoints automáticos não pode ser um symlink: ${CHECKPOINT_PARENT}" >&2
    exit 1
  fi
  mkdir -p "${CHECKPOINT_PARENT}"
  chmod 700 "${CHECKPOINT_PARENT}"
  if [[ ! -d "${CHECKPOINT_PARENT}" ]]; then
    echo "Não foi possível preparar o diretório de checkpoints: ${CHECKPOINT_PARENT}" >&2
    exit 1
  fi
}

create_verified_checkpoint() {
  local revision short_revision timestamp backup_output
  revision="$("${GIT_BIN}" -C "${ROOT_DIR}" rev-parse --verify HEAD)"
  if [[ ! "${revision}" =~ ^[0-9a-fA-F]{40,64}$ ]]; then
    echo "Não foi possível identificar com segurança a revisão que será atualizada." >&2
    exit 1
  fi
  short_revision="${revision:0:12}"
  timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
  CHECKPOINT_DIR="$(mktemp -d "${CHECKPOINT_PARENT}/${timestamp}-${short_revision}-XXXXXX")"
  chmod 700 "${CHECKPOINT_DIR}"

  echo "==> Criando checkpoint SQLite pré-update para ${short_revision}"
  if ! backup_output="$(cd "${ROOT_DIR}" && "${NPM_BIN}" run backup:create -- --output "${CHECKPOINT_DIR}")"; then
    echo "Falha ao criar o checkpoint. O serviço não será parado nem reiniciado." >&2
    rmdir "${CHECKPOINT_DIR}" 2>/dev/null || true
    CHECKPOINT_DIR=""
    exit 1
  fi
  printf '%s\n' "${backup_output}"

  CHECKPOINT_ARTIFACT="$(printf '%s\n' "${backup_output}" | sed -n 's/^Backup criado e validado: //p' | tail -n1)"
  if [[ -z "${CHECKPOINT_ARTIFACT}" || ! -d "${CHECKPOINT_ARTIFACT}" || -L "${CHECKPOINT_ARTIFACT}" ]]; then
    echo "O backup canônico não retornou um artefato verificável. O update foi abortado antes do stop." >&2
    exit 1
  fi

  case "${CHECKPOINT_ARTIFACT}" in
    "${CHECKPOINT_DIR}"/*) ;;
    *)
      echo "O artefato retornado escapou do diretório exclusivo do update. O update foi abortado." >&2
      exit 1
      ;;
  esac

  echo "==> Verificando checkpoint pré-update"
  if ! (cd "${ROOT_DIR}" && "${NPM_BIN}" run backup:verify -- --artifact "${CHECKPOINT_ARTIFACT}"); then
    echo "O checkpoint não passou pela verificação canônica. O serviço não será parado nem reiniciado." >&2
    exit 1
  fi

  printf '%s\n' "${revision}" > "${CHECKPOINT_DIR}/source-revision.txt"
  chmod 600 "${CHECKPOINT_DIR}/source-revision.txt"
  echo "Checkpoint verificado: ${CHECKPOINT_ARTIFACT}"
}

prune_old_automatic_checkpoints() {
  local index
  local -a checkpoint_dirs=()
  mapfile -t checkpoint_dirs < <(
    find "${CHECKPOINT_PARENT}" -mindepth 1 -maxdepth 1 -type d \
      -name '????????T??????Z-????????????-*' -printf '%f\n' \
      | LC_ALL=C sort -r
  )

  for ((index = CHECKPOINT_KEEP; index < ${#checkpoint_dirs[@]}; index++)); do
    rm -rf -- "${CHECKPOINT_PARENT}/${checkpoint_dirs[index]}"
  done
}

on_error() {
  local exit_code=$?
  if [[ -n "${CHECKPOINT_ARTIFACT}" ]]; then
    echo >&2
    echo "service:update falhou. O checkpoint associado a esta tentativa foi preservado:" >&2
    echo "  ${CHECKPOINT_ARTIFACT}" >&2
    echo "Recovery: pare o serviço e use npm run backup:restore -- --artifact \"${CHECKPOINT_ARTIFACT}\" --confirm-service-stopped" >&2
    echo "Restaure estado e código de forma coordenada; não inicie código antigo contra schema incompatível sem validar compatibilidade." >&2
  fi
  exit "${exit_code}"
}
trap on_error ERR

ensure_private_checkpoint_root
create_verified_checkpoint
prune_old_automatic_checkpoints

cd "${ROOT_DIR}"
"${ROOT_DIR}/scripts/install-systemd.sh" update

echo "Checkpoint pré-update preservado para recovery: ${CHECKPOINT_ARTIFACT}"
