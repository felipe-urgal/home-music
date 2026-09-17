# Roadmap técnico

Este documento descreve **o estado técnico corrente e o próximo trabalho relevante** do Home Music. Histórico detalhado de ciclos encerrados fica em [`history/`](history/).

## Estado em 2026-09-17

A base consolidada anterior continua válida:

- **Fase 7.5 — multiusuário/autenticação:** concluída e incorporada à arquitetura atual;
- **Fase 14 — portabilidade de dados pessoais:** concluída na `main` com o PR #324;
- **Fase 15 — Assistente da Biblioteca:** concluída tecnicamente; umbrella #310 encerrada;
- **#322 — Whisper local para lyrics:** incorporada pelo PR #375;
- **#325 — artwork no Media Session:** implementação incorporada e issue encerrada;
- **#327 — continuidade de playback no iOS:** instrumentação/hardening incorporados e issue encerrada;
- **#328 — cold start offline no iOS:** correções de bootstrap/performance incorporadas e issue encerrada;
- **#388 — redesign imersivo de Tocando agora:** concluído pelo PR #389.

Depois dessa consolidação, o ciclo ativo passou a ser a experiência de **Home Music TV**.

### TV / controle remoto / offline LAN

A implementação do modo TV totalmente offline pela LAN está incorporada na `main`:

- PR #423 entregou serviço LAN efêmero, receiver offline embarcado, controle offline no PWA e transporte compartilhado;
- PR #427 adicionou hardening pós-QA físico, navegação das coleções offline e bridge LAN para iPhone/iPad;
- PR #430 fez o receiver abrir automaticamente após `join` LAN autenticado e tornou `RTCPeerConnection.disconnected` recuperável, mantendo `failed`, `closed` e erro/fechamento real do DataChannel como terminais.

O caminho principal **iPhone → bridge LAN → WebRTC/DataChannel → envio de música offline → reprodução na BTV** já foi observado em hardware real. Isso ainda não fecha a homologação: as issues #417 e #422 permanecem abertas para registrar matriz de versões, background/lock, perda real de rede, AP/client isolation, QR expirado/regenerado e demais negativos físicos. A Epic #416 deve ser encerrada somente depois da decisão final sobre esse QA.

As issues de implementação #418, #419, #420 e #421 já estão cobertas pelo código mergeado; não representam backlog de feature pendente.

### Próxima feature de produto: login da TV pelo celular

A issue **#428 — Login da TV pelo celular via QR** é o próximo desenvolvimento funcional ainda não implementado.

Objetivo do MVP:

1. TV mostra QR + código curto;
2. celular abre o Home Music e autentica se necessário;
3. celular confirma **Entrar nesta TV?**;
4. servidor cria uma sessão própria e revogável para a TV;
5. senha/cookie/token da sessão do celular nunca são transferidos para a TV;
6. usuário/senha na TV continua como fallback;
7. fluxo de login online permanece separado do pareamento LAN/WebRTC offline.

A implementação planejada é dividida em backend/segurança e depois TV/celular/E2E. O PR #429 contém documentação de desenho/planejamento e não altera runtime por si só.

## Fase 15 — estado consolidado

A Fase 15 entregou um fluxo de manutenção de biblioteca assistido, seguro e reversível, sem criar uma segunda autoridade de catálogo.

| Issue | Entrega | Estado |
| --- | --- | --- |
| #311 | fundação de runs, sugestões, evidências, proveniência, stale protection e lifecycle admin | concluída |
| #312 | identificação de metadata com MusicBrainz e matching explicável | concluída |
| #313 | revisão/aplicação segura de sugestões | concluída |
| #314 | artwork via Cover Art Archive usando cover override canônico | concluída |
| #315 | enriquecimento de lyrics via LRCLIB com run próprio | concluída |
| #316 | resolução unificada de lyrics entre web/offline/OpenSubsonic | concluída |
| #318 | autonomia progressiva opt-in | concluída |
| #319 | normalização artista/álbum com evidência MusicBrainz | concluída |
| #320 | Chromaprint/AcoustID opcional para casos difíceis | concluída |
| #321 | fallback canônico de artwork e materialização explícita/reversível | concluída |
| #322 | transcrição/alinhamento local opcional com Whisper/whisper.cpp | concluída |
| #325 | artwork canônica no Media Session | concluída; risco físico residual aceito |
| #326 | vinil animado no player Agora | concluída |
| #327 | continuidade de playback no iOS | concluída; risco físico residual aceito |
| #328 | cold start offline no iOS | concluída; risco físico residual aceito |
| #356 | operação em volume, reset seguro e abas operacionais | concluída |

O snapshot detalhado anterior ao fechamento foi preservado em [`history/roadmap-through-phase-15.md`](history/roadmap-through-phase-15.md).

## Base técnica consolidada

A `main` atual possui, entre outras capacidades:

- contratos compartilhados/versionados para runs, sugestões, evidências, confiança, proveniência e decisões;
- análise de metadata via MusicBrainz com matching conservador e explicável;
- artwork via Cover Art Archive com aplicação somente pelas autoridades de cover override;
- LRCLIB com conteúdo completo obtido apenas no apply e persistência local aprovada;
- resolução efetiva de lyrics `override gerenciado → sidecar .lrc/.txt → nenhuma letra` para player, offline e OpenSubsonic;
- fallback local opcional com Whisper/whisper.cpp, FFmpeg, scratch fora de `MUSIC_DIR`, revisão humana obrigatória e rollback;
- normalização de artista/álbum reutilizando aliases existentes e evidência externa;
- Chromaprint/`fpcalc` local + AcoustID opcional reutilizando o matcher existente;
- artwork fallback determinística/versionada, representação estática para Media Session e materialização explícita quando desejada;
- workspace **Administração → Assistente da Biblioteca** com Sugestões, Fila, Estatísticas e Configurações;
- revisão individual/em lote, sucesso parcial, stale protection e proteção de decisões humanas;
- autonomia progressiva opt-in após eventos consistentes da biblioteca;
- PWA/offline com shell cacheado, `OfflineApp` no bundle inicial, bootstrap manifest-first e reconciliação posterior do Cache Storage;
- hardening de playback/Media Session para Apple mobile sem criar segundo player ou retry infinito;
- player **Tocando agora** imersivo/responsivo com estado de playback canônico preservado;
- Home Music TV com GeckoView, controle remoto online, envio P2P de downloads, receiver offline embarcado e modo LAN sem backend;
- protocolo LAN `home-music-lan-remote-v2` com TTL, HMAC, replay protection e signaling efêmero;
- bridge LAN restrito para iPhone/iPad, mantendo mídia no DataChannel;
- regressões de lifecycle que distinguem `disconnected` recuperável de falha terminal real.

Documentos canônicos principais:

- [`library-assistant.md`](library-assistant.md);
- [`lyrics.md`](lyrics.md);
- [`library-metadata-normalization.md`](library-metadata-normalization.md);
- [`library-assistant-audio-fingerprint.md`](library-assistant-audio-fingerprint.md);
- [`artwork-fallback.md`](artwork-fallback.md);
- [`pwa.md`](pwa.md);
- [`offline-downloads.md`](offline-downloads.md);
- [`player-screen-responsibilities.md`](player-screen-responsibilities.md);
- [`android-tv.md`](android-tv.md);
- [`tv-remote-control.md`](tv-remote-control.md);
- [`tv-offline-cast.md`](tv-offline-cast.md);
- [`tv-offline-lan-protocol.md`](tv-offline-lan-protocol.md).

## Próximo trabalho

Há dois tipos de trabalho diferentes e eles não devem ser confundidos:

1. **QA/evidência do modo TV offline já implementado** — concluir ou explicitamente dispensar os critérios físicos de #417/#422 e então encerrar a Epic #416;
2. **nova feature #428** — implementar login da TV pelo celular via QR, começando pelo backend/protocolo/segurança antes da UX final TV/celular.

Bugs e melhorias pontuais continuam sendo rastreados diretamente em issues próprias.

## Política de QA e evidência

Fechar uma issue por decisão de projeto não reescreve o histórico de validação. Quando um teste manual, aparelho físico, serviço externo ou cenário operacional não tiver sido executado, a documentação deve registrar uma destas situações de forma explícita:

- validação pendente;
- risco aceito;
- validação dispensada;
- limitação de plataforma conhecida.

Nunca usar “validado”, “testado” ou equivalente sem evidência correspondente.

## Fontes de verdade

Ordem prática para resolver divergências:

1. código, testes, `package.json`, workflows e contratos executáveis;
2. documentação canônica atual;
3. este roadmap e issues abertas;
4. documentos em `docs/history/` como contexto histórico.

Planos exploratórios devem usar nome explícito (`*-plan.md`, ADR ou issue) e não ser apresentados como comportamento já entregue.
