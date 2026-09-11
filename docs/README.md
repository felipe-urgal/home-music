# Documentação do Home Music

Este índice separa **documentação atual**, **planos** e **histórico**. A intenção é impedir que uma decisão antiga ou um checklist de issue concorra com o comportamento real da `main`.

## Ordem de confiança

Quando houver divergência, use esta ordem:

1. código, testes, `package.json`, workflows e contratos executáveis;
2. documentação canônica atual;
3. `docs/roadmap.md` e issues abertas;
4. planos/ADRs ainda não incorporados;
5. `docs/history/` como contexto histórico.

## Estado técnico atual

Em **2026-09-11**:

- fase 7.5 (multiusuário/autenticação) está concluída e incorporada à arquitetura atual;
- fase 14 (portabilidade de dados pessoais) está concluída na `main`;
- fase 15 (Assistente da Biblioteca) está **concluída tecnicamente** e a umbrella #310 foi encerrada;
- o fallback local opcional de lyrics com Whisper/whisper.cpp (#322) foi incorporado pelo PR #375;
- artwork no Media Session (#325), continuidade de playback no iOS (#327) e cold start offline (#328) também foram incorporados e as issues foram encerradas por decisão do projeto;
- os QAs físicos residuais dessas frentes **não foram registrados como executados**: o projeto aceitou esse risco de plataforma e encerrou o ciclo sem transformar a ausência de teste em evidência falsa;
- não existe uma nova fase ativa definida neste momento. O próximo ciclo deve nascer de uma nova issue/decisão com objetivo e escopo próprios.

O GitHub continua sendo a fonte de verdade para o estado instantâneo de issues e PRs.

## Comece aqui

- [`../README.md`](../README.md) — visão geral, comandos e recursos do produto;
- [`roadmap.md`](roadmap.md) — estado técnico corrente e critério para o próximo ciclo;
- [`architecture.md`](architecture.md) — arquitetura vigente;
- [`DEVELOPMENT.md`](DEVELOPMENT.md) — setup e fluxo diário de engenharia;
- [`PRODUCTION.md`](PRODUCTION.md) — operação da instalação real;
- [`testing-and-quality.md`](testing-and-quality.md) — baseline local, CI e checks direcionados.

## Biblioteca, metadata e Assistente

- [`library-assistant.md`](library-assistant.md) — contrato corrente do Assistente da Biblioteca;
- [`library-assistant-plan.md`](library-assistant-plan.md) — fechamento do plano da Fase 15 e ponte para o snapshot histórico;
- [`library-assistant-audio-fingerprint.md`](library-assistant-audio-fingerprint.md) — Chromaprint/fpcalc e AcoustID opcional;
- [`library-metadata-normalization.md`](library-metadata-normalization.md) — normalização de artista/álbum e evidência externa;
- [`lyrics.md`](lyrics.md) — cadeia canônica de lyrics, LRCLIB, Whisper local, stale protection e rollback;
- [`admin-metadata-overrides.md`](admin-metadata-overrides.md) — overrides de metadata;
- [`admin-cover-overrides.md`](admin-cover-overrides.md) — overrides de capa;
- [`artwork-fallback.md`](artwork-fallback.md) — identidade canônica sem capa e projeção para Media Session/player;
- [`library-views.md`](library-views.md) — projeções da biblioteca;
- [`library-http-delivery.md`](library-http-delivery.md) — entrega HTTP da mídia;
- [`library-navigation-performance.md`](library-navigation-performance.md) — performance de navegação.

## Administração e conta

- [`administration-ui.md`](administration-ui.md) — composição atual de Administração/Minha conta;
- [`admin-file-moves.md`](admin-file-moves.md) — organização/movimentação de arquivos;
- [`admin-bulk-actions.md`](admin-bulk-actions.md) — ações em lote;
- [`admin-quarantine.md`](admin-quarantine.md) — lixeira/quarentena;
- [`admin-operation-history.md`](admin-operation-history.md) — histórico operacional;
- [`admin-transcode-cache.md`](admin-transcode-cache.md) — cache de transcode;
- [`personal-data-portability.md`](personal-data-portability.md) — exportação/importação de dados pessoais;
- [`multi-user-auth.md`](multi-user-auth.md) — identidade, papéis, sessões e ownership;
- [`password-ux.md`](password-ux.md) — contrato de UX de senha;
- [`login-abuse-protection.md`](login-abuse-protection.md) — proteção contra abuso de login;
- [`security-regressions.md`](security-regressions.md) — regressões sensíveis.

## Player, PWA e offline

- [`player-screen-responsibilities.md`](player-screen-responsibilities.md) — autoridade do player e continuidade;
- [`pwa.md`](pwa.md) — shell, service worker, Media Session e bootstrap offline;
- [`offline-downloads.md`](offline-downloads.md) — scheduler, cache físico, referências e matriz de regressão;
- [`pwa-icon-identity.md`](pwa-icon-identity.md) — identidade visual da instalação;
- [`artwork-fallback.md`](artwork-fallback.md) — artwork real/fallback e lock screen;
- [`accessibility.md`](accessibility.md) — acessibilidade.

## Composição e arquitetura

- [`app-composition.md`](app-composition.md) — composição do frontend online/offline;
- [`server-composition.md`](server-composition.md) — composição do backend/Fastify;
- [`library-screen-responsibilities.md`](library-screen-responsibilities.md) — responsabilidades da Biblioteca;
- [`deep-links.md`](deep-links.md) — deep links e navegação;
- [`frontend-code-splitting.md`](frontend-code-splitting.md) — code splitting.

## Importação e providers

- [`import-upload.md`](import-upload.md) — upload local;
- [`import-url.md`](import-url.md) — importação por URL;
- [`import-staging.md`](import-staging.md) — staging;
- [`import-staging-cleanup.md`](import-staging-cleanup.md) — limpeza de staging;
- [`import-safe-destination.md`](import-safe-destination.md) — destino seguro;
- [`import-duplicate-detection.md`](import-duplicate-detection.md) — duplicatas;
- [`import-incremental-library-update.md`](import-incremental-library-update.md) — atualização incremental;
- [`import-metadata-preview.md`](import-metadata-preview.md) — preview de metadata;
- [`import-job-retry.md`](import-job-retry.md) — retry de jobs;
- [`external-providers.md`](external-providers.md) — contrato de providers externos;
- [`external-provider-batches.md`](external-provider-batches.md) — execução em lotes;
- [`external-provider-engine-decision.md`](external-provider-engine-decision.md) — decisão do engine de providers;
- [`jamendo.md`](jamendo.md) — descoberta/importação Jamendo;
- [`yt-dlp-provider.md`](yt-dlp-provider.md) — provider baseado em yt-dlp.

## OpenSubsonic

- [`open-subsonic.md`](open-subsonic.md) — subset suportado, autenticação, ownership e compatibilidade;
- [`lyrics.md`](lyrics.md) — mesma resolução efetiva consumida por `getLyricsBySongId`.

## Produção, backup e acesso remoto

- [`PRODUCTION.md`](PRODUCTION.md) — runbook canônico;
- [`production.md`](production.md) — detalhes de systemd/helper privilegiado;
- [`production-contract.md`](production-contract.md) — contrato consumido pelo Dev Dashboard;
- [`production-verification.md`](production-verification.md) — verificação funcional;
- [`backup-restore.md`](backup-restore.md) — backup e restore SQLite;
- [`tailscale.md`](tailscale.md) — Tailscale Serve;
- [`public-access.md`](public-access.md) — Funnel/acesso público;
- [`tailscale-hardening.md`](tailscale-hardening.md) — hardening;
- [`tailscale-funnel-troubleshooting.md`](tailscale-funnel-troubleshooting.md) — troubleshooting.

## Desenvolvimento, dependências e qualidade

- [`development-environments.md`](development-environments.md) — isolamento DEV/produção;
- [`testing-and-quality.md`](testing-and-quality.md) — política de testes e CI;
- [`dependency-management.md`](dependency-management.md) — dependências/lifecycle;
- [`large-library-benchmark.md`](large-library-benchmark.md) — benchmark de biblioteca grande;
- [`long-job-observability.md`](long-job-observability.md) — observabilidade de jobs;
- [`ffmpeg.md`](ffmpeg.md) — FFmpeg/FFprobe e uso por jobs locais.

## Histórico

`docs/history/` preserva snapshots substituídos e material de implementação. Eles são úteis para contexto, mas **não são especificação operacional corrente**.

- [`history/roadmap-through-phase-14.md`](history/roadmap-through-phase-14.md) — roadmap acumulado antes da Fase 15;
- [`history/roadmap-through-phase-15.md`](history/roadmap-through-phase-15.md) — snapshot do roadmap antes do fechamento da Fase 15;
- [`history/library-assistant-plan-phase-15.md`](history/library-assistant-plan-phase-15.md) — plano detalhado original da Fase 15;
- [`history/phase-7.5/`](history/phase-7.5/) — material de transição multiusuário.

## Manutenção deste índice

Ao concluir uma mudança relevante:

- atualize a doc canônica do domínio no mesmo PR;
- mova planos encerrados/snapshots substituídos para `docs/history/` quando continuarem úteis;
- não use checklists antigos de issue como descrição do estado atual;
- não declare hardware/serviço externo como validado sem evidência;
- prefira links para uma única fonte canônica em vez de duplicar regras em vários documentos.
