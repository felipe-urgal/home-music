# Home Music

Servidor pessoal de música para transformar uma biblioteca local em streaming para navegador, PWA, Android TV/boxes e clientes OpenSubsonic.

## Stack

- React + TypeScript + Vite
- Fastify + TypeScript
- SQLite
- npm workspaces

## Desenvolvimento

    npm ci
    npm run dev

Gate principal:

    npm run check

E2E quando necessário:

    npm run test:e2e

## Segurança operacional

O Home Music é self-hosted. Não exponha a porta 8787 diretamente à internet. Preserve isolamento entre usuários, caminhos de mídia e a autoridade única da biblioteca.

## Documentação

- [Desenvolvimento](docs/DEVELOPMENT.md)
- [Template de tarefa](docs/TASK_TEMPLATE.md)
- [Guia de code review](docs/CODE_REVIEW.md)
- [Protocolo LAN offline da TV](docs/tv-offline-lan-protocol.md)
- [QA físico da TV](docs/TV_QA.md)

Regras para agentes estão em [AGENTS.md](AGENTS.md).
