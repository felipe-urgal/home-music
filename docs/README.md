# Documentação do Home Music

Este diretório mistura dois tipos de material. Esta página existe para deixar claro qual documento usar como fonte atual e quais arquivos preservam histórico de implementação.

## Desenvolvimento e agentes de IA

Antes de alterar o repositório, leia [`../AGENTS.md`](../AGENTS.md).

Ele define o fluxo obrigatório de desenvolvimento, postura fullstack sênior, padrão de PR, gates de segurança/testes e a regra de **auto code review completo no head final** antes de aprovar qualquer merge.

## Fontes atuais

Comece por:

1. [`../README.md`](../README.md) — instalação, operação e visão geral do produto;
2. [`architecture.md`](architecture.md) — arquitetura corrente;
3. [`roadmap.md`](roadmap.md) — estado das fases e pendências reais;
4. [`administration-ui.md`](administration-ui.md) — composição atual de Minha conta/Administração;
5. documentos funcionais abaixo para invariantes específicas.

## Operação

- [`production.md`](production.md)
- [`backup-restore.md`](backup-restore.md)
- [`ffmpeg.md`](ffmpeg.md)
- [`tailscale.md`](tailscale.md)
- [`public-access.md`](public-access.md)
- [`tailscale-hardening.md`](tailscale-hardening.md)
- [`tailscale-funnel-troubleshooting.md`](tailscale-funnel-troubleshooting.md)

## PWA e offline

- [`pwa.md`](pwa.md)
- [`offline-downloads.md`](offline-downloads.md)

Pendências relacionadas: #81, #174 e #176.

## Administração

- [`administration-ui.md`](administration-ui.md)
- [`admin-bulk-actions.md`](admin-bulk-actions.md)
- [`admin-quarantine.md`](admin-quarantine.md)
- [`admin-metadata-overrides.md`](admin-metadata-overrides.md)
- [`admin-cover-overrides.md`](admin-cover-overrides.md)
- [`admin-file-moves.md`](admin-file-moves.md)
- [`admin-transcode-cache.md`](admin-transcode-cache.md)
- [`admin-operation-history.md`](admin-operation-history.md)

## Importação

- [`import-staging.md`](import-staging.md)
- [`import-staging-cleanup.md`](import-staging-cleanup.md)
- [`import-upload.md`](import-upload.md)
- [`import-url.md`](import-url.md)
- [`external-provider-engine-decision.md`](external-provider-engine-decision.md)
- [`external-providers.md`](external-providers.md)
- [`external-provider-batches.md`](external-provider-batches.md)
- [`yt-dlp-provider.md`](yt-dlp-provider.md)
- [`import-metadata-preview.md`](import-metadata-preview.md)
- [`import-duplicate-detection.md`](import-duplicate-detection.md)
- [`import-safe-destination.md`](import-safe-destination.md)
- [`import-job-retry.md`](import-job-retry.md)
- [`import-incremental-library-update.md`](import-incremental-library-update.md)

## Identidade e contas

Documentos canônicos para comportamento atual:

- [`multi-user-auth.md`](multi-user-auth.md)
- [`phase-7.5-operations.md`](phase-7.5-operations.md)
- [`phase-7.5-admin-users-screen.md`](phase-7.5-admin-users-screen.md)
- [`phase-7.5-my-account-screen.md`](phase-7.5-my-account-screen.md)
- [`phase-7.5-remove-env-auth-recovery.md`](phase-7.5-remove-env-auth-recovery.md)

## Registros históricos `phase-7.5-*`

Os demais arquivos `phase-7.5-*` preservam o desenho e os gates de slices específicos durante a migração multiusuário. Eles podem usar futuro/linguagem de implementação relativa àquele momento.

Para saber **como o sistema funciona hoje**, prefira `README.md`, `architecture.md`, `multi-user-auth.md` e os documentos funcionais atuais. Não use um registro histórico isolado para inferir que uma funcionalidade ainda está pendente; o estado de entrega fica em `roadmap.md` e nas issues abertas.

## E2E

A suíte Playwright tem instruções próprias em [`../e2e/README.md`](../e2e/README.md). A expansão de cobertura continua rastreada na #111.
