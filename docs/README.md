# Documentação do Home Music

A raiz de `docs/` contém apenas documentação **viva e operacional**. Planos encerrados, decisões de fases antigas e snapshots substituídos ficam em [`history/`](history/README.md).

## Ordem de confiança

Quando houver divergência:

1. código, testes, `package.json`, workflows e contratos executáveis;
2. documentação canônica atual;
3. [`roadmap.md`](roadmap.md) e issues abertas;
4. `docs/history/` apenas como contexto histórico.

## Comece aqui

- [`../README.md`](../README.md) — visão geral do produto;
- [`roadmap.md`](roadmap.md) — estado técnico corrente;
- [`architecture.md`](architecture.md) — arquitetura vigente;
- [`DEVELOPMENT.md`](DEVELOPMENT.md) — desenvolvimento;
- [`PRODUCTION.md`](PRODUCTION.md) — operação da instalação real;
- [`testing-and-quality.md`](testing-and-quality.md) — testes e CI.

## Biblioteca e player

- [`library-views.md`](library-views.md) — projeções da biblioteca;
- [`library-http-delivery.md`](library-http-delivery.md) — entrega HTTP de mídia;
- [`library-navigation-performance.md`](library-navigation-performance.md) — performance de navegação;
- [`library-screen-responsibilities.md`](library-screen-responsibilities.md) — fronteiras da tela de Biblioteca;
- [`player-screen-responsibilities.md`](player-screen-responsibilities.md) — autoridade do player, erros e continuidade;
- [`deep-links.md`](deep-links.md) — deep links;
- [`smart-playlists.md`](smart-playlists.md) — playlists inteligentes;
- [`m3u8-playlists.md`](m3u8-playlists.md) — playlists M3U8.

## Metadata, artwork e lyrics

- [`admin-metadata-overrides.md`](admin-metadata-overrides.md) — overrides de metadata;
- [`admin-cover-overrides.md`](admin-cover-overrides.md) — overrides de capa;
- [`library-metadata-normalization.md`](library-metadata-normalization.md) — normalização de artista/álbum;
- [`artwork-fallback.md`](artwork-fallback.md) — fallback visual e Media Session;
- [`lyrics.md`](lyrics.md) — resolução canônica, LRCLIB e Whisper local;
- [`lyrics-offline.md`](lyrics-offline.md) — snapshot de lyrics para reprodução offline.

## Assistente da Biblioteca

- [`library-assistant.md`](library-assistant.md) — contrato principal e estado atual;
- [`library-assistant-audio-fingerprint.md`](library-assistant-audio-fingerprint.md) — Chromaprint/AcoustID;
- [`library-assistant-autonomy.md`](library-assistant-autonomy.md) — autonomia opt-in;
- [`library-assistant-observability.md`](library-assistant-observability.md) — métricas, retries e baseline operacional.

A Fase 15 está encerrada. O planejamento original foi movido integralmente para [`history/library-assistant-plan-phase-15.md`](history/library-assistant-plan-phase-15.md).

## PWA e offline

- [`pwa.md`](pwa.md) — PWA, bootstrap e Media Session;
- [`offline-downloads.md`](offline-downloads.md) — downloads, cache e referências lógicas;
- [`pwa-icon-identity.md`](pwa-icon-identity.md) — identidade da instalação;
- [`ios-background-playback-diagnostics.md`](ios-background-playback-diagnostics.md) — protocolo local de diagnóstico/regressão no iOS.

## Administração e conta

- [`administration-ui.md`](administration-ui.md) — composição atual de Administração/Minha conta;
- [`admin-bulk-actions.md`](admin-bulk-actions.md) — ações em lote;
- [`admin-file-moves.md`](admin-file-moves.md) — movimentação/organização de arquivos;
- [`admin-quarantine.md`](admin-quarantine.md) — lixeira/quarentena;
- [`admin-operation-history.md`](admin-operation-history.md) — histórico operacional;
- [`admin-transcode-cache.md`](admin-transcode-cache.md) — cache de transcode;
- [`multi-user-auth.md`](multi-user-auth.md) — usuários, papéis, sessões e ownership;
- [`password-ux.md`](password-ux.md) — UX segura de senha;
- [`login-abuse-protection.md`](login-abuse-protection.md) — proteção de login;
- [`personal-data-portability.md`](personal-data-portability.md) — exportação/importação pessoal;
- [`security-regressions.md`](security-regressions.md) — regressões sensíveis.

## Importação e providers

- [`import-upload.md`](import-upload.md) — upload;
- [`import-url.md`](import-url.md) — URL;
- [`import-staging.md`](import-staging.md) — staging;
- [`import-staging-cleanup.md`](import-staging-cleanup.md) — cleanup;
- [`import-safe-destination.md`](import-safe-destination.md) — destino seguro;
- [`import-duplicate-detection.md`](import-duplicate-detection.md) — duplicatas;
- [`import-incremental-library-update.md`](import-incremental-library-update.md) — atualização incremental;
- [`import-metadata-preview.md`](import-metadata-preview.md) — preview de metadata;
- [`import-job-retry.md`](import-job-retry.md) — retry;
- [`external-providers.md`](external-providers.md) — arquitetura atual de providers;
- [`external-provider-batches.md`](external-provider-batches.md) — lotes/playlists de provider;
- [`yt-dlp-provider.md`](yt-dlp-provider.md) — provider yt-dlp;
- [`jamendo.md`](jamendo.md) — Jamendo.

A avaliação original que escolheu yt-dlp como engine principal é histórica e está em [`history/external-provider-engine-decision-phase-9.md`](history/external-provider-engine-decision-phase-9.md).

## OpenSubsonic

- [`open-subsonic.md`](open-subsonic.md) — subset suportado, autenticação, ownership e compatibilidade.

## Arquitetura e composição

- [`app-composition.md`](app-composition.md) — composição do frontend;
- [`server-composition.md`](server-composition.md) — composição do backend;
- [`frontend-code-splitting.md`](frontend-code-splitting.md) — code splitting;
- [`long-job-observability.md`](long-job-observability.md) — observabilidade de jobs;
- [`ffmpeg.md`](ffmpeg.md) — FFmpeg/FFprobe.

## Produção e acesso remoto

- [`PRODUCTION.md`](PRODUCTION.md) — runbook principal;
- [`production.md`](production.md) — systemd/helper e detalhes operacionais;
- [`production-contract.md`](production-contract.md) — contrato do Dev Dashboard;
- [`production-verification.md`](production-verification.md) — verificação funcional;
- [`backup-restore.md`](backup-restore.md) — backup/restore;
- [`tailscale.md`](tailscale.md) — Tailscale Serve;
- [`public-access.md`](public-access.md) — Funnel/acesso público;
- [`tailscale-hardening.md`](tailscale-hardening.md) — hardening;
- [`tailscale-funnel-troubleshooting.md`](tailscale-funnel-troubleshooting.md) — troubleshooting.

## Engenharia

- [`development-environments.md`](development-environments.md) — isolamento DEV/produção;
- [`dependency-management.md`](dependency-management.md) — dependências/lifecycle;
- [`large-library-benchmark.md`](large-library-benchmark.md) — benchmark de biblioteca grande;
- [`accessibility.md`](accessibility.md) — acessibilidade.

## Histórico

Use [`history/README.md`](history/README.md) para navegar snapshots e decisões encerradas. Arquivos de `history/` não são especificação operacional corrente.

## Regra de manutenção

Ao concluir uma mudança relevante:

- atualize a doc canônica no mesmo PR;
- remova ou arquive planos encerrados;
- evite criar docs pequenas que apenas repetem outra fonte;
- não use checklists antigos de issue como estado do produto;
- não declare hardware/serviço externo como validado sem evidência;
- prefira uma única fonte canônica por regra.
