# Planejamento — Assistente da Biblioteca (Fase 15)

> **Status: ENCERRADO.** A Fase 15 foi concluída em 2026-09-11. Este arquivo permanece apenas como ponte entre a documentação atual e o planejamento histórico.

O plano detalhado usado durante a execução foi preservado em [`history/library-assistant-plan-phase-15.md`](history/library-assistant-plan-phase-15.md). Não use o snapshot histórico como especificação operacional corrente.

## Resultado da fase

A Fase 15 entregou:

- fundação de runs/sugestões com evidências, proveniência, stale protection e lifecycle administrativo (#311);
- identificação de metadata via MusicBrainz (#312);
- revisão/aplicação segura de metadata (#313);
- artwork via Cover Art Archive (#314);
- enriquecimento de lyrics via LRCLIB (#315);
- resolução única de lyrics entre player, offline e OpenSubsonic (#316);
- autonomia progressiva opt-in (#318);
- normalização artista/álbum com evidência externa (#319);
- Chromaprint/AcoustID opcional para casos difíceis (#320);
- fallback canônico/materialização explícita de artwork (#321);
- transcrição/alinhamento local opcional com Whisper/whisper.cpp (#322);
- artwork estática canônica no Media Session (#325);
- vinil animado no player Agora (#326);
- hardening de continuidade de playback no iOS (#327);
- hardening de cold start offline no iOS (#328);
- operação em volume, reset seguro, fila, estatísticas e configurações (#356).

A umbrella #310 foi encerrada. As issues #325/#327/#328 também foram encerradas por decisão do projeto após a implementação; validações físicas residuais foram aceitas como risco e não devem ser descritas como executadas.

## Autoridades que permaneceram intactas

A implementação preservou as decisões centrais do plano:

```text
MUSIC_DIR + scanner
        ↓
LibraryService / projeção efetiva
        ↓
LibraryAssistantService
        ↓
evidências + sugestões
        ↓
revisão / política opt-in
        ↓
autoridades existentes
  ├─ TrackMetadataOverrideStore
  ├─ TrackCoverOverrideStore
  ├─ normalização/aliases
  └─ resolução canônica de lyrics
```

O Assistente não é um segundo catálogo e providers externos não escrevem diretamente na biblioteca física.

## Fontes atuais

Para comportamento vigente, use:

- [`library-assistant.md`](library-assistant.md) — Assistente e revisão;
- [`lyrics.md`](lyrics.md) — LRCLIB, Whisper local e resolução de letras;
- [`library-metadata-normalization.md`](library-metadata-normalization.md) — normalização;
- [`library-assistant-audio-fingerprint.md`](library-assistant-audio-fingerprint.md) — Chromaprint/AcoustID;
- [`artwork-fallback.md`](artwork-fallback.md) — identidade visual e Media Session;
- [`pwa.md`](pwa.md) — PWA/offline;
- [`roadmap.md`](roadmap.md) — estado do ciclo e próximo trabalho.

## Evoluções futuras

Qualquer nova capacidade do Assistente deve entrar como issue/novo ciclo com escopo próprio. Não reabra a Fase 15 para adicionar funcionalidade nova apenas porque ela usa `LibraryAssistantService`.
