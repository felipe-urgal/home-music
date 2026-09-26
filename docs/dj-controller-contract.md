# Contrato de controladores DJ

## Objetivo

Este contrato define a fronteira entre o player do Home Music e qualquer superfície externa de controle. Ele existe para permitir dual-deck, mixer e navegação sem acoplar o player a um fabricante, protocolo ou API de dispositivo.

A implementação inicial vive em `apps/web/src/dj-controller-contract.ts` porque o owner do playback continua sendo o frontend. Não existe contrato HTTP ou persistência nova nesta etapa.

## Regra principal

A direção de dependência é:

```text
UI / teclado / adapter externo
          |
          v
DjControllerCommand
          |
          v
player / dual-deck engine
          |
          v
DjControllerSnapshot
          |
          +----> UI
          +----> adapters de feedback
```

A engine recebe intenções de alto nível. Adapters traduzem dispositivos para essas intenções e nunca chamam hooks React ou manipulam `HTMLAudioElement` diretamente.

## Identidade dos decks

Os decks lógicos são sempre `a` e `b`.

`primaryPlaybackDeck` representa qual deck está servindo como playback principal do fluxo comum quando essa informação for relevante. Isso é diferente de qualquer deck selecionado por UI ou hardware. Seleção de controle não redefine automaticamente a autoridade do playback.

Cada deck mantém estado independente de:

- faixa;
- play/pause;
- posição e duração;
- cue point;
- playback rate;
- BPM/confiança rítmica;
- sync;
- channel volume.

## Comandos

O contrato cobre:

### Deck

- load de faixa;
- play;
- pause;
- toggle play;
- definir cue;
- retornar ao cue;
- seek absoluto;
- nudge relativo;
- alterar tempo via playback rate;
- sync com master opcional.

### Mixer

- channel volume A/B;
- crossfader normalizado em `-1..1`.

### Browser

- mover seleção por delta inteiro;
- selecionar;
- carregar a seleção no deck A/B.

Valores vindos de adapters precisam passar por `isDjControllerCommand` antes de chegar à engine. O validador não executa playback nem corrige silenciosamente valores inválidos: rejeita a intenção inteira.

## Snapshot observável

`DjControllerSnapshot` é a projeção mínima para UI e adapters:

- modo ativo/inativo;
- revisão monotônica futura da engine;
- deck principal do playback comum;
- dois snapshots de deck;
- posição do crossfader;
- faixa selecionada no browser;
- capability flags.

O snapshot contém apenas dados serializáveis. Referências de DOM, callbacks e objetos de API de hardware não pertencem a essa fronteira.

## Capabilities do MVP

O contrato prevê explicitamente:

- load de faixa;
- transport;
- cue;
- seek;
- nudge;
- tempo;
- beat sync;
- channel volume;
- crossfader;
- navegação de biblioteca.

Capability indica que a engine/superfície combinada pode executar a intenção. Presença de hardware não é inferida por esses flags.

## Concorrência e ownership

### Comando manual durante automix/crossfade

Uma intenção manual que altera playback deve cancelar scheduling automático incompatível antes da mutação, reutilizando o contrato de cancelamento estabilizado pela epic #500. Cancelar scheduling não autoriza limpar o outro deck se ele continuar válido.

### Seek durante sync

Seek é uma intenção manual prioritária. A implementação deve invalidar alinhamentos/timers dependentes da posição antiga antes de aplicar a nova posição. O estado de sync pode permanecer ativo somente se a engine puder recalcular a partir da nova posição sem preservar trabalho obsoleto.

### Load em deck tocando

Load é explícito e pertence somente ao deck alvo. A engine deve interromper/limpar a fonte anterior daquele deck antes de adotar a nova. O outro deck não é alterado.

### Desconexão do controlador

Desconectar uma superfície de controle não pausa, descarrega ou reseta o player. O dispositivo é entrada/saída opcional; o snapshot do player continua sendo a fonte de verdade.

### UI e hardware simultâneos

Comandos são processados na ordem em que chegam à Controller API. A engine publica um snapshot novo após mutações observáveis. Adapters não mantêm uma segunda fonte de verdade e devem reconciliar feedback a partir do snapshot mais recente.

### Mudança pelo player comum

O player comum continua sendo autoridade. Se ele trocar a faixa/deck ativo fora do modo DJ, o snapshot precisa refletir o novo estado. Nenhum adapter pode restaurar estado antigo apenas porque seu último comando apontava para outro valor.

## Idempotência

Play em deck já tocando, pause em deck já pausado e reenvio de estado equivalente devem ser tratados como operações idempotentes pela engine quando implementada. O contrato desta issue não simula side effects para não duplicar a futura dual-deck engine da #520.

## Fora desta etapa

- Web MIDI;
- mapping de Pioneer/DDJ-400;
- mensagens binárias de dispositivo;
- scratch;
- time-stretching profissional;
- áudio multicanal;
- persistência de estado DJ.

Essas responsabilidades dependem deste contrato, e não o contrário.
