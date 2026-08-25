#!/usr/bin/env bash
set -euo pipefail

EXPECTED_TAG="${HOME_MUSIC_TAILSCALE_TAG:-tag:home-music}"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "Erro: Tailscale não encontrado no PATH." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Erro: Node.js não encontrado no PATH." >&2
  exit 1
fi

if ! STATUS_JSON="$(tailscale status --json 2>/dev/null)"; then
  echo "Erro: não foi possível consultar 'tailscale status --json'." >&2
  exit 1
fi

HOME_MUSIC_TAILSCALE_STATUS_JSON="${STATUS_JSON}" node -e '
const expectedTag = process.argv[1];
let status;
try {
  status = JSON.parse(process.env.HOME_MUSIC_TAILSCALE_STATUS_JSON || "");
} catch {
  console.error("Erro: o Tailscale retornou JSON inválido em status --json.");
  process.exit(1);
}

const backend = typeof status.BackendState === "string" ? status.BackendState : "desconhecido";
const self = status.Self && typeof status.Self === "object" ? status.Self : {};
const dnsName = typeof self.DNSName === "string" ? self.DNSName.replace(/\.$/, "") : "indisponível";
const tags = Array.isArray(self.Tags) ? self.Tags.filter(tag => typeof tag === "string") : [];
const hasExpectedTag = tags.includes(expectedTag);

console.log("Home Music / least-privilege Tailscale");
console.log(`  BackendState:     ${backend}`);
console.log(`  DNS:              ${dnsName}`);
console.log(`  Tag esperada:     ${expectedTag}`);
console.log(`  Tag aplicada:     ${hasExpectedTag ? "sim" : "NÃO"}`);
console.log(`  Tags atuais:      ${tags.length ? tags.join(", ") : "nenhuma"}`);
console.log("  Grants/nodeAttrs: validar no Admin Console (não são expostos de forma confiável pelo CLI local)");

if (backend !== "Running") {
  console.error("Erro: o Tailscale não está conectado.");
  process.exit(1);
}
if (!hasExpectedTag) {
  console.error(`Erro: aplique ${expectedTag} ao servidor antes de remover regras amplas da policy.`);
  process.exit(2);
}
' "${EXPECTED_TAG}"
