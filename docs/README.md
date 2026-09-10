# Documentação do Home Music

Este índice separa **documentação atual**, **planos** e **histórico**. A intenção é evitar que uma decisão antiga seja usada como runbook ou especificação vigente.

## Ordem de confiança

Quando houver divergência, use esta ordem:

1. código, testes, `package.json`, workflows e contratos executáveis;
2. documentação canônica atual;
3. roadmap e issues abertas;
4. planos/ADRs ainda não incorporados;
5. `docs/history/` como contexto histórico.

## Comece aqui

- [`../README.md`](../README.md) — visão geral, comandos e recursos do produto;
- [`DEVELOPMENT.md`](DEVELOPMENT.md) — setup e fluxo de engenharia;
- [`PRODUCTION.md`](PRODUCTION.md) — operação canônica da instalação real;
- [`architecture.md`](architecture.md) — arquitetura do sistema;
- [`testing-and-quality.md`](testing-and-quality.md) — baseline local, CI e checks direcionados;
- [`roadmap.md`](roadmap.md) — estado técnico corrente e próxima fase.

## Estado técnico atual

Em **2026-09-10**:

- fase 7.5 (multiusuário/autenticação) está concluída; os documentos de implementação foram arquivados;
- fase 14 (portabilidade de dados pessoais) está implementada na `main` após o PR #324;
- fase 15 (Library Assistant) é o ciclo técnico ativo, rastreado pela issue #310;
- a fundação do Assistente (#311), a identificação explicável via MusicBrainz (#312), a revisão/aplicação segura de metadata (#313), artwork via Cover Art Archive (#314), lyrics operacionais via LRCLIB (#315), a operação em volume/monitoramento (#356), a normalização assistida por evidência MusicBrainz (#319) e a identificação opcional por áudio (#320) estão implementadas; os contratos estão em [`library-assistant.md`](library-assistant.md), [`library-metadata-normalization.md`](library-metadata-normalization.md), [`library-assistant-audio-fingerprint.md`](library-assistant-audio-fingerprint.md) e [`lyrics.md`](lyrics.md);
- as capacidades posteriores da fase 15 permanecem no [`library-assistant-plan.md`](library-assistant-plan.md).

Para o estado instantâneo de issues/PRs, GitHub é a fonte de verdade; este índice não tenta reproduzir todo o tracker.

## Arquitetura e composição

- [`architecture.md`](architecture.md) — visão arquitetural canônica;
- [`server-composition.md`](server-composition.md) — composição do backend/Fastify;
- [`app-composition.md`](app-composition.md) — composição do frontend;
- [`frontend-code-splitting.md`](frontend-code-splitting.md) — estratégia de code splitting;
- [`library-screen-responsibilities.md`](library-screen-responsibilities.md) — responsabilidades da Biblioteca;
- [`player-screen-responsibilities.md`](player-screen-responsibilities.md) — responsabilidades do Player;
- [`deep-links.md`](deep-links.md) — deep links e navegação.

## Identidade, contas e segurança

- [`multi-user-auth.md`](multi-user-auth.md) — identidade, papéis, sessões, ownership e recovery;
- [`administration-ui.md`](administration-ui.md) — Administração e Minha conta;
- [`personal-data-portability.md`](personal-data-portability.md) — exportação/importação de dados pessoais;
- [`login-abuse-protection.md`](login-abuse-protection.md) — proteção contra abuso de login;
- [`password-ux.md`](password-ux.md) — contrato de UX de senha;
- [`security-regressions.md`](security-regressions.md) — regressões sensíveis e suíte de segurança.

## Biblioteca, metadata e administração

- [`library-views.md`](library-views.md) — projeções/visões da biblioteca;
- [`library-http-delivery.md`](library-http-delivery.md) — entrega HTTP da mídia;
- [`library-metadata-normalization.md`](library-metadata-normalization.md) — normalização de metadata e evidência externa reutilizada do Assistente;
- [`library-navigation-performance.md`](library-navigation-performance.md) — performance de navegação;
- [`library-assistant.md`](library-assistant.md) — contrato implementado do Assistente: triagem de faixas com pendências, matching via MusicBrainz, artwork via Cover Art Archive, revisão individual/em lote, lyrics via LRCLIB, reset seguro, fila e observabilidade administrativa;
- [`library-assistant-audio-fingerprint.md`](library-assistant-audio-fingerprint.md) — fallback manual de identificação por áudio com Chromaprint/fpcalc local, cache físico e AcoustID opcional reaproveitando o matcher/review existentes;
- [`lyrics.md`](lyrics.md) — resolução canônica de lyrics, sidecars, override gerenciado, integração LRCLIB, rollback e política de conteúdo;
- [`admin-metadata-overrides.md`](admin-metadata-overrides.md) — overrides de metadata e autoridade usada pelo apply do Assistente;
- [`admin-cover-overrides.md`](admin-cover-overrides.md) — overrides de capa e autoridade usada pelo apply individual de artwork do Assistente;
- [`admin-file-moves.md`](admin-file-moves.md) — organização/movimentação de arquivos;
- [`admin-bulk-actions.md`](admin-bulk-actions.md) — ações em lote;
- [`admin-quarantine.md`](admin-quarantine.md) — lixeira/quarentena;
- [`admin-operation-history.md`](admin-operation-history.md) — histórico operacional;
- [`admin-transcode-cache.md`](admin-transcode-cache.md) — cache de transcode;
- [`smart-playlists.md`](smart-playlists.md) — playlists inteligentes;
- [`m3u8-playlists.md`](m3u8-playlists.md) — playlists M3U8.

## Importação e providers

- [`import-upload.md`](import-upload.md) — upload local;
- [`import-url.md`](import-url.md) — importação por URL;
- [`import-staging.md`](import-staging.md) — staging;
- [`import-staging-cleanup.md`](import-staging-cleanup.md) — limpeza do staging;
- [`import-safe-destination.md`](import-safe-destination.md) — destino seguro;
- [`import-duplicate-detection.md`](import-duplicate-detection.md) — duplicatas;
- [`import-incremental-library-update.md`](import-incremental-library-update.md) — atualização incremental após importação;
- [`import-metadata-preview.md`](import-metadata-preview.md) — preview de metadata;
- [`import-job-retry.md`](import-job-retry.md) — retry de jobs;
- [`external-providers.md`](external-providers.md) — contrato de providers externos;
- [`external-provider-batches.md`](external-provider-batches.md) — execução em lotes;
- [`external-provider-engine-decision.md`](external-provider-engine-decision.md) — decisão arquitetural do engine de providers;
- [`jamendo.md`](jamendo.md) — descoberta/importação Jamendo;
- [`yt-dlp-provider.md`](yt-dlp-provider.md) — provider baseado em yt-dlp.

## Player, PWA e offline

- [`pwa.md`](pwa.md) — arquitetura PWA/service worker;
- [`pwa-icon-identity.md`](pwa-icon-identity.md) — identidade visual dos ícones PWA;
- [`offline-downloads.md`](offline-downloads.md) — downloads offline e isolamento por usuário;
- [`artwork-fallback.md`](artwork-fallback.md) — fallback de artwork e contrato visual do vinil do player;
- [`ffmpeg.md`](ffmpeg.md) — FFmpeg/FFprobe.

## OpenSubsonic

- [`open-subsonic.md`](open-subsonic.md) — subset suportado, autenticação, ownership e compatibilidade;
- [`lyrics.md`](lyrics.md) — fonte de verdade da resolução de letras também consumida por `getLyricsBySongId`.

A compatibilidade externa deve ser registrada nesse documento e nos testes/validações correspondentes; não use requisitos históricos de fechamento de issue como contrato atual.

## Produção, backup e acesso remoto

- [`PRODUCTION.md`](PRODUCTION.md) — runbook canônico;
- [`production.md`](production.md) — detalhes de systemd/helper privilegiado;
- [`production-contract.md`](production-contract.md) — contrato consumido pelo Dev Dashboard;
- [`production-verification.md`](production-verification.md) — verificação funcional;
- [`backup-restore.md`](backup-restore.md) — backup e restore SQLite;
- [`tailscale.md`](tailscale.md) — Tailscale Serve;
- [`public-access.md`](public-access.md) — acesso público/Funnel;
- [`tailscale-hardening.md`](tailscale-hardening.md) — hardening;
- [`tailscale-funnel-troubleshooting.md`](tailscale-funnel-troubleshooting.md) — troubleshooting.

Os pares `PRODUCTION.md`/`production.md` e `DEVELOPMENT.md`/`development-environments.md` são intencionais: o arquivo em maiúsculas é o ponto de entrada canônico; o complementar aprofunda detalhes mecânicos.

## Desenvolvimento, dependências e qualidade

- [`development-environments.md`](development-environments.md) — isolamento DEV/produção;
- [`testing-and-quality.md`](testing-and-quality.md) — política de testes e CI;
- [`dependency-management.md`](dependency-management.md) — dependências e lifecycle;
- [`large-library-benchmark.md`](large-library-benchmark.md) — benchmark de biblioteca grande;
- [`long-job-observability.md`](long-job-observability.md) — observabilidade de jobs longos;
- [`accessibility.md`](accessibility.md) — acessibilidade.

## Planos e decisões

- [`library-assistant-plan.md`](library-assistant-plan.md) — plano ativo das capacidades restantes da fase 15; o comportamento concluído em #311/#312/#313/#314/#315/#319/#320/#356 é descrito nos documentos canônicos de Assistente, normalização, fingerprint e lyrics;
- documentos com `*-decision.md` preservam decisões arquiteturais específicas e devem ser lidos junto do código atual.

## Histórico

- [`history/phase-7.5/`](history/phase-7.5/) — slices e runbooks produzidos durante a migração multiusuário; **não são fonte de verdade atual**;
- [`history/roadmap-through-phase-14.md`](history/roadmap-through-phase-14.md) — snapshot do roadmap acumulado antes da simplificação para a fase 15.

Arquivar não significa apagar conhecimento: significa impedir que material de transição concorra com a documentação canônica.

## Manutenção deste índice

Ao concluir uma mudança relevante:

- atualize a doc de domínio no mesmo PR;
- se um documento virou apenas contexto histórico, mova-o para `docs/history/` e remova referências operacionais a ele;
- se uma nova doc for plano, deixe isso explícito no nome e no texto;
- não duplique contratos executáveis que já têm uma fonte melhor no código/workflow;
- links para issues/PRs ajudam a explicar história, mas não devem ser usados como status permanente.