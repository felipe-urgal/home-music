# Documentação do Home Music

Este diretório mistura documentação **corrente** e registros históricos de implementação. Esta página define qual material deve ser usado como fonte de verdade.

> Inventário e backlog revisados em 2026-09-02. A Fase 11 e o ciclo funcional anterior estão concluídos. A Fase 12 está em andamento, centralizada na #239; #228, #229, #230, #237, #233, #234 e #235 já foram entregues, e a próxima atividade é a #236. A #123 permanece encerrada como índice executivo do ciclo anterior.

## Desenvolvimento e agentes de IA

Antes de alterar o repositório, leia [`../AGENTS.md`](../AGENTS.md).

Ele define o fluxo obrigatório de desenvolvimento, postura fullstack sênior, padrão de PR, gates de segurança/testes e a regra de **auto code review completo no head final** antes de aprovar qualquer merge.

## Fontes atuais

Comece por:

1. [`../README.md`](../README.md) — instalação, operação e visão geral do produto;
2. [`architecture.md`](architecture.md) — arquitetura corrente;
3. [`roadmap.md`](roadmap.md) — estado técnico das fases e pendências reais;
4. [issue #239](https://github.com/felipe-urgal/home-music/issues/239) — índice executivo do ciclo técnico atual de Segurança e Performance;
5. [issue #123](https://github.com/felipe-urgal/home-music/issues/123) — registro executivo do ciclo de backlog encerrado em 2026-09-02;
6. [`administration-ui.md`](administration-ui.md) — composição atual de Minha conta/Administração;
7. documentos funcionais abaixo para invariantes específicas.

## Estado do backlog atual

A Fase 12 está em andamento e concentra o backlog implementável atual.

| Issue | Estado corrente |
| --- | --- |
| [#228](https://github.com/felipe-urgal/home-music/issues/228) | isolamento de sessões entre usuários; concluída pelo PR #241 |
| [#229](https://github.com/felipe-urgal/home-music/issues/229) | proteção contra brute force distribuído e abuso de CPU no login; concluída pelo PR #242 |
| [#230](https://github.com/felipe-urgal/home-music/issues/230) | backpressure e limites para trabalho pesado; concluída pelo PR #243 |
| [#237](https://github.com/felipe-urgal/home-music/issues/237) | benchmark de biblioteca grande em Chromium real; concluída pelo PR #244 |
| [#233](https://github.com/felipe-urgal/home-music/issues/233) | concorrência limitada no scanner; concluída pelo PR #245 |
| [#234](https://github.com/felipe-urgal/home-music/issues/234) | persistência SQLite somente por delta do scan; concluída pelo PR #247 |
| [#235](https://github.com/felipe-urgal/home-music/issues/235) | revision, ETag e compressão da biblioteca; concluída pelo PR #248 |
| [#236](https://github.com/felipe-urgal/home-music/issues/236) | code splitting das telas secundárias; próxima atividade serial |
| [#238](https://github.com/felipe-urgal/home-music/issues/238) | reduzir recomputações da navegação da biblioteca; atividade serial após #236 |
| [#239](https://github.com/felipe-urgal/home-music/issues/239) | índice executivo ativo da Fase 12 — Segurança e Performance |
| [#123](https://github.com/felipe-urgal/home-music/issues/123) | encerrada como índice executivo do ciclo anterior |

A ordem corrente da Fase 12 está em `roadmap.md` e na #239. Itens concluídos de fases anteriores não devem ser reabertos artificialmente para representar trabalho novo.

## Composição do frontend

- [`app-composition.md`](app-composition.md) — limites entre raiz de sessão/conectividade, aplicação autenticada e aplicação offline, incluindo a entrada manual pelo painel da conta sem duplicar o estado de conectividade.
- [`artwork-fallback.md`](artwork-fallback.md) — política canônica de capa efetiva e fallback visual reutilizável entre biblioteca, player e administração.

## Composição do backend

- [`server-composition.md`](server-composition.md) — limites entre composition root, rotas por domínio, serviços e infraestrutura compartilhada do Fastify.

## Segurança e regressões

- [`security-regressions.md`](security-regressions.md) — gate dedicado de regressões negativas para Administração/Importação, invariantes cobertas e regras de isolamento das fixtures.
- [`login-abuse-protection.md`](login-abuse-protection.md) — rate limits por IP/identidade, gate global de `scrypt`, `Retry-After`, métricas agregadas e política de restart do login.

## Dependências e CI

- [`dependency-management.md`](dependency-management.md) — Dependabot, cadência, agrupamento patch/minor, tratamento de majors e vulnerabilidades, GitHub Actions/supply chain, lockfiles e regra de ausência de auto-merge.

## Performance

- [`large-library-benchmark.md`](large-library-benchmark.md) — dataset sintético, cenários, baseline operacional, scanner concorrente, persistência SQLite incremental e limites do gate de regressão grave para bibliotecas grandes.
- [`library-http-delivery.md`](library-http-delivery.md) — snapshot HTTP autenticado da biblioteca, `revision`, ETag privado, revalidação `304`, compressão Brotli/gzip e cache de projeção/serialização.

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
- [`pwa-icon-identity.md`](pwa-icon-identity.md) — identidade Casa + vinil, matriz `any`/`maskable`, iOS/Safari e geração determinística dos ícones;
- [`offline-downloads.md`](offline-downloads.md) — scheduler global, bytes físicos, referências lógicas, playlist/pasta, deduplicação, sincronização, quota, limites por plataforma e protocolo de regressão mobile;
- [`app-composition.md`](app-composition.md) — autoridade única de entrada/saída do modo offline, inclusive quando o usuário escolhe usar somente o conteúdo baixado mesmo com o servidor online.

Pendências relacionadas: nenhuma específica de PWA no backlog atual.

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
- [`login-abuse-protection.md`](login-abuse-protection.md)
- [`password-ux.md`](password-ux.md)
- [`phase-7.5-operations.md`](phase-7.5-operations.md)
- [`phase-7.5-admin-users-screen.md`](phase-7.5-admin-users-screen.md)
- [`phase-7.5-my-account-screen.md`](phase-7.5-my-account-screen.md)
- [`phase-7.5-remove-env-auth-recovery.md`](phase-7.5-remove-env-auth-recovery.md)

A política de capacidade e isolamento de sessões da #228 está documentada em `multi-user-auth.md`; a proteção de login entregue pela #229 está documentada em `login-abuse-protection.md`.

## Registros históricos `phase-7.5-*`

Os demais arquivos `phase-7.5-*` preservam o desenho, decisões e gates dos slices usados durante a migração multiusuário. Eles podem usar linguagem relativa ao momento da implementação.

Para saber **como o sistema funciona hoje**, prefira `README.md`, `architecture.md`, `multi-user-auth.md`, os documentos funcionais atuais e os arquivos `phase-7.5-*` explicitamente listados acima como fonte corrente.

Não use um registro histórico isolado para inferir que uma funcionalidade ainda está pendente. O estado de entrega fica em `roadmap.md` e nas issues abertas; a #123 preserva o índice executivo do ciclo encerrado e a #239 representa o ciclo técnico atual.

## E2E

A suíte Playwright tem instruções próprias em [`../e2e/README.md`](../e2e/README.md). O gate crítico inclui smoke geral, coleções offline deduplicadas, fluxo desktop individual/lote e isolamento offline entre contas; a regressão completa continua disponível conforme o risco da mudança.

## Regra para manutenção da documentação

Ao alterar comportamento ou backlog:

- atualize a documentação funcional canônica afetada;
- atualize `roadmap.md` quando a fase ou pendência mudar;
- atualize o índice executivo vigente quando houver um ciclo de backlog ativo; hoje é a #239, enquanto a #123 permanece como registro do ciclo encerrado em 2026-09-02;
- mantenha a issue de implementação com estado/gate reais;
- preserve ADRs e registros históricos em vez de reescrevê-los como se tivessem sido produzidos hoje;
- não crie datas/status artificiais em arquivos sem mudança semântica apenas para aparentar revisão.