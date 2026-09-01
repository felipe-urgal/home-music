# Documentação do Home Music

Este diretório mistura documentação **corrente** e registros históricos de implementação. Esta página define qual material deve ser usado como fonte de verdade.

> Inventário e backlog revisados em 2026-09-01. Os PRs #204, #205, #206 e #207 concluíram #119–#122 e o backlog planejado da Fase 11. A #174 foi entregue pelo PR #218 e a #175 pelo PR #220; a #81 permanece como validação separada em dispositivos móveis reais.

## Desenvolvimento e agentes de IA

Antes de alterar o repositório, leia [`../AGENTS.md`](../AGENTS.md).

Ele define o fluxo obrigatório de desenvolvimento, postura fullstack sênior, padrão de PR, gates de segurança/testes e a regra de **auto code review completo no head final** antes de aprovar qualquer merge.

## Fontes atuais

Comece por:

1. [`../README.md`](../README.md) — instalação, operação e visão geral do produto;
2. [`architecture.md`](architecture.md) — arquitetura corrente;
3. [`roadmap.md`](roadmap.md) — estado técnico das fases e pendências reais;
4. [issue #123](https://github.com/felipe-urgal/home-music/issues/123) — índice executivo do backlog aberto;
5. [`administration-ui.md`](administration-ui.md) — composição atual de Minha conta/Administração;
6. documentos funcionais abaixo para invariantes específicas.

## Backlog aberto e ordem atual

As pendências executivas abertas após a entrega da #175 são:

| Issue | Estado corrente |
| --- | --- |
| [#81](https://github.com/felipe-urgal/home-music/issues/81) | validação separada em Android e iPhone/iPad reais de background/tela bloqueada; não é fechada por CI/emulação |
| [#176](https://github.com/felipe-urgal/home-music/issues/176) | próximo backlog visual/PWA: ícone, favicon e identidade de instalação |
| [#123](https://github.com/felipe-urgal/home-music/issues/123) | índice executivo; não é uma implementação separada |

A Fase 11 planejada (#111–#122), a #174 e a #175 estão concluídas. Nova priorização deve ser refletida em `roadmap.md`, #123 e nas issues afetadas no mesmo trabalho.

## Composição do frontend

- [`app-composition.md`](app-composition.md) — limites entre raiz de sessão/conectividade, aplicação autenticada e aplicação offline.
- [`artwork-fallback.md`](artwork-fallback.md) — política canônica de capa efetiva e fallback visual reutilizável entre biblioteca, player e administração.

## Composição do backend

- [`server-composition.md`](server-composition.md) — limites entre composition root, rotas por domínio, serviços e infraestrutura compartilhada do Fastify.

## Segurança e regressões

- [`security-regressions.md`](security-regressions.md) — gate dedicado de regressões negativas para Administração/Importação, invariantes cobertas e regras de isolamento das fixtures.

## Dependências e CI

- [`dependency-management.md`](dependency-management.md) — Dependabot, cadência, agrupamento patch/minor, tratamento de majors e vulnerabilidades, GitHub Actions/supply chain, lockfiles e regra de ausência de auto-merge.

## Performance

- [`large-library-benchmark.md`](large-library-benchmark.md) — dataset sintético, cenários, baseline operacional e limites do gate de regressão grave para bibliotecas grandes.

## Acessibilidade

- [`accessibility.md`](accessibility.md) — baseline de teclado/foco, nomes e estados acessíveis, movimento reduzido, fila do player, regressões automatizadas e limites conhecidos da revisão da #120.

## Navegação e URLs

- [`deep-links.md`](deep-links.md) — rotas canônicas, integração com o histórico do browser, refresh direto, preservação do player e fallbacks de navegação.

## Operação

- [`production.md`](production.md)
- [`production-contract.md`](production-contract.md) — interface operacional padronizada `prod:*` e manifesto para automação local.
- [`production-verification.md`](production-verification.md) — contrato read-only de readiness e retry usado por `prod:verify`.
- [`long-job-observability.md`](long-job-observability.md) — lifecycle estruturado, correlação com Histórico operacional, redaction, retenção e investigação de scans/imports/transcodes no journal.
- [`backup-restore.md`](backup-restore.md)
- [`ffmpeg.md`](ffmpeg.md)
- [`tailscale.md`](tailscale.md)
- [`public-access.md`](public-access.md)
- [`tailscale-hardening.md`](tailscale-hardening.md)
- [`tailscale-funnel-troubleshooting.md`](tailscale-funnel-troubleshooting.md)

## PWA e offline

- [`pwa.md`](pwa.md) — shell, service worker, namespace e integração das coleções offline;
- [`offline-downloads.md`](offline-downloads.md) — scheduler global, bytes físicos, referências lógicas, playlist/pasta, deduplicação, sincronização, quota e limites da #81.

Pendências relacionadas: #81 e #176.

## Biblioteca e inteligência

- [`library-screen-responsibilities.md`](library-screen-responsibilities.md) — limites de responsabilidade de `LibraryScreen` e das superfícies extraídas.
- [`player-screen-responsibilities.md`](player-screen-responsibilities.md) — limites de responsabilidade de `PlayerScreen` e fonte única de estado de playback.
- [`smart-playlists.md`](smart-playlists.md) — regras, ownership, preview, persistência e invariantes das playlists inteligentes.
- [`library-views.md`](library-views.md) — busca/filtros/ordenação salvos como views pessoais reutilizáveis.
- [`library-metadata-normalization.md`](library-metadata-normalization.md) — aliases lógicos, revisão administrativa e projeção canônica de artistas/álbuns.

## Administração

- [`administration-ui.md`](administration-ui.md)
- [`admin-bulk-actions.md`](admin-bulk-actions.md)
- [`admin-quarantine.md`](admin-quarantine.md)
- [`admin-metadata-overrides.md`](admin-metadata-overrides.md)
- [`admin-cover-overrides.md`](admin-cover-overrides.md)
- [`admin-file-moves.md`](admin-file-moves.md)
- [`admin-transcode-cache.md`](admin-transcode-cache.md)
- [`admin-operation-history.md`](admin-operation-history.md)

O fallback visual de artwork entregue pela #175 reutiliza uma única política/componente entre as superfícies e respeita a precedência documentada de capa. Consulte [`artwork-fallback.md`](artwork-fallback.md); não crie comportamento paralelo por tela.

## Importação

Documentação corrente do pipeline:

- [`import-staging.md`](import-staging.md)
- [`import-staging-cleanup.md`](import-staging-cleanup.md)
- [`import-upload.md`](import-upload.md)
- [`import-url.md`](import-url.md)
- [`external-providers.md`](external-providers.md)
- [`external-provider-batches.md`](external-provider-batches.md)
- [`yt-dlp-provider.md`](yt-dlp-provider.md)
- [`import-metadata-preview.md`](import-metadata-preview.md)
- [`import-duplicate-detection.md`](import-duplicate-detection.md)
- [`import-safe-destination.md`](import-safe-destination.md)
- [`import-job-retry.md`](import-job-retry.md)
- [`import-incremental-library-update.md`](import-incremental-library-update.md)

Registro de decisão arquitetural:

- [`external-provider-engine-decision.md`](external-provider-engine-decision.md) — avaliação datada que levou à escolha do yt-dlp; preserve como ADR/registro de decisão, não como status do backlog atual.

## Identidade e contas

Fontes atuais:

- [`multi-user-auth.md`](multi-user-auth.md)
- [`password-ux.md`](password-ux.md)
- [`phase-7.5-operations.md`](phase-7.5-operations.md)
- [`phase-7.5-admin-users-screen.md`](phase-7.5-admin-users-screen.md)
- [`phase-7.5-my-account-screen.md`](phase-7.5-my-account-screen.md)
- [`phase-7.5-remove-env-auth-recovery.md`](phase-7.5-remove-env-auth-recovery.md)

## Registros históricos `phase-7.5-*`

Os demais arquivos `phase-7.5-*` preservam o desenho, decisões e gates dos slices usados durante a migração multiusuário. Eles podem usar linguagem relativa ao momento da implementação.

Para saber **como o sistema funciona hoje**, prefira `README.md`, `architecture.md`, `multi-user-auth.md`, os documentos funcionais atuais e os arquivos `phase-7.5-*` explicitamente listados acima como fonte corrente.

Não use um registro histórico isolado para inferir que uma funcionalidade ainda está pendente. O estado de entrega fica em `roadmap.md`, #123 e nas issues abertas.

## E2E

A suíte Playwright tem instruções próprias em [`../e2e/README.md`](../e2e/README.md). O gate crítico inclui smoke geral, coleções offline deduplicadas, fluxo desktop individual/lote e isolamento offline entre contas; a regressão completa continua disponível conforme o risco da mudança.

## Regra para manutenção da documentação

Ao alterar comportamento ou backlog:

- atualize a documentação funcional canônica afetada;
- atualize `roadmap.md` quando a fase ou pendência mudar;
- atualize #123 quando o backlog executivo mudar;
- mantenha a issue de implementação com estado/gate reais;
- preserve ADRs e registros históricos em vez de reescrevê-los como se tivessem sido produzidos hoje;
- não crie datas/status artificiais em arquivos sem mudança semântica apenas para aparentar revisão.
