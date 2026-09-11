# Roadmap técnico

Este documento descreve **o estado técnico corrente e o próximo trabalho relevante** do Home Music. Histórico detalhado de ciclos encerrados fica em [`history/`](history/).

## Estado em 2026-09-11

- **Fase 7.5 — multiusuário/autenticação:** concluída e incorporada à arquitetura atual.
- **Fase 14 — portabilidade de dados pessoais:** concluída na `main` com o PR #324.
- **Fase 15 — Assistente da Biblioteca:** concluída tecnicamente; umbrella #310 encerrada.
- **#322 — Whisper local para lyrics:** incorporada pelo PR #375.
- **#325 — artwork no Media Session:** implementação incorporada e issue encerrada.
- **#327 — continuidade de playback no iOS:** instrumentação/hardening incorporados e issue encerrada.
- **#328 — cold start offline no iOS:** correções de bootstrap/performance incorporadas e issue encerrada.

As issues #325, #327 e #328 tinham validações físicas residuais. Por decisão do projeto, esses QAs foram **dispensados como gate de encerramento e aceitos como risco de plataforma**. Isso não equivale a afirmar que os cenários em hardware foram executados ou aprovados.

Não existe uma nova fase ativa definida neste momento. O próximo ciclo deve nascer de uma nova necessidade de produto/arquitetura, não de checkboxes antigos da Fase 15.

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
- hardening de playback/Media Session para Apple mobile sem criar segundo player ou retry infinito.

Documentos canônicos:

- [`library-assistant.md`](library-assistant.md);
- [`lyrics.md`](lyrics.md);
- [`library-metadata-normalization.md`](library-metadata-normalization.md);
- [`library-assistant-audio-fingerprint.md`](library-assistant-audio-fingerprint.md);
- [`artwork-fallback.md`](artwork-fallback.md);
- [`pwa.md`](pwa.md);
- [`offline-downloads.md`](offline-downloads.md);
- [`player-screen-responsibilities.md`](player-screen-responsibilities.md).

## Próximo ciclo

Não há backlog de implementação da Fase 15 a ser “continuado” automaticamente. Uma nova fase deve entrar neste roadmap quando houver:

1. objetivo de produto ou arquitetura claro;
2. issue umbrella ou decisão equivalente;
3. fronteiras explícitas de escopo;
4. riscos e critérios de aceitação identificados;
5. relação com documentação canônica definida.

Bugs e melhorias pontuais podem existir fora de uma fase e devem ser rastreados diretamente em issues próprias.

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
