#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRAPPER="${ROOT_DIR}/scripts/service-update-with-checkpoint.sh"

assert_contains() {
  local expected="$1"
  local message="$2"
  if ! grep -Fq "${expected}" "${WRAPPER}"; then
    echo "Erro: ${message}" >&2
    exit 1
  fi
}

line_number() {
  local needle="$1"
  grep -nF "${needle}" "${WRAPPER}" | head -n1 | cut -d: -f1
}

bash -n "${WRAPPER}"

assert_contains 'CHECKPOINT_PARENT="${ROOT_DIR}/backups/update-checkpoints"' "checkpoints automáticos precisam ficar isolados de backups manuais."
assert_contains 'CHECKPOINT_KEEP=5' "retenção automática precisa ser limitada e previsível."
assert_contains '"${NPM_BIN}" run backup:create' "service:update precisa reutilizar o comando canônico de criação de backup."
assert_contains '"${NPM_BIN}" run backup:verify' "service:update precisa verificar o checkpoint pelo mecanismo canônico."
assert_contains 'source-revision.txt' "checkpoint precisa registrar a revisão associada ao update."
assert_contains 'backup:restore' "falhas precisam apontar um recovery acionável pelo restore canônico."
assert_contains "-name '????????T??????Z-????????????-*'" "retenção só pode selecionar diretórios com o padrão de checkpoint automático."

CREATE_CALL_LINE="$(grep -nF 'create_verified_checkpoint' "${WRAPPER}" | tail -n1 | cut -d: -f1)"
PRUNE_CALL_LINE="$(grep -nF 'prune_old_automatic_checkpoints' "${WRAPPER}" | tail -n1 | cut -d: -f1)"
VERIFY_LINE="$(grep -nF '"${NPM_BIN}" run backup:verify' "${WRAPPER}" | tail -n1 | cut -d: -f1)"
UPDATE_LINE="$(line_number '"${ROOT_DIR}/scripts/install-systemd.sh" update')"

if [[ -z "${CREATE_CALL_LINE}" || -z "${VERIFY_LINE}" || -z "${UPDATE_LINE}" || ${CREATE_CALL_LINE} -ge ${UPDATE_LINE} || ${VERIFY_LINE} -ge ${UPDATE_LINE} ]]; then
  echo "Erro: checkpoint criado e verificado precisa ocorrer antes de delegar ao updater que pode parar o serviço." >&2
  exit 1
fi

if [[ -z "${PRUNE_CALL_LINE}" || ${PRUNE_CALL_LINE} -ge ${UPDATE_LINE} ]]; then
  echo "Erro: retenção deve ser concluída antes de iniciar a troca da versão." >&2
  exit 1
fi

if grep -Eq 'sudo|systemctl' "${WRAPPER}"; then
  echo "Erro: wrapper de checkpoint não pode ampliar a superfície privilegiada; isso pertence ao installer/helper existente." >&2
  exit 1
fi

if grep -Fq 'MUSIC_DIR' "${WRAPPER}"; then
  echo "Erro: checkpoint de update não pode tocar MUSIC_DIR." >&2
  exit 1
fi

echo "service:update cria/verifica checkpoint canônico antes do updater, mantém retenção isolada e não amplia privilégios."
