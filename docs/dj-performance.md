# Modo DJ — performance e validação

## Estado suportado

O Modo DJ funciona por software no browser e não depende de controladora física para o fluxo principal.

Recursos atuais:

- dois decks com mixer e crossfader;
- waveform navegável, beat grid e SYNC;
- EQ LOW/MID/HIGH e FILTER por deck;
- Echo/Delay e Reverb por deck, com bypass e wet/dry;
- Hot Cues persistentes com cor/label e integração ao waveform;
- loops manuais, Auto Loop quantizado, resize e movimento por beats;
- análise de tonalidade/key e compatibilidade harmônica;
- AutoMix com seleção musical determinística e fallback por ordem da biblioteca;
- gravação do master quando Web Audio + MediaRecorder estiverem disponíveis;
- histórico da sessão e exportação de setlist.

A biblioteca e o player existentes continuam sendo as fontes canônicas. O Modo DJ reutiliza o graph e o dual-deck atuais; não existe engine paralela.

## Degradação por capability

Recursos opcionais devem falhar de forma explícita sem bloquear o playback:

- sem Web Audio: EQ/FX/captura de master ficam indisponíveis, mantendo o caminho de playback suportado;
- sem MediaRecorder ou sem MIME compatível: REC fica indisponível;
- sem Web MIDI: a UI informa que Web MIDI está indisponível e o Modo DJ continua operável por UI/teclado;
- sem key/BPM/confidence suficiente: AutoMix, loops e SYNC usam os fallbacks definidos por cada recurso;
- metadata musical ausente não impede operação manual.

Hardware DDJ-400, saída separada de headphones/master e calibração física permanecem validações próprias e não são requisito para a fase de performance por software.

## Invariantes de lifecycle

- o graph Web Audio é criado uma vez por sessão e parâmetros não provocam rebuild;
- sair do Modo DJ restaura estado neutro de EQ/FX/mixer para o player normal;
- gravação conecta o destino de captura somente enquanto necessário;
- stop/saída encerra tracks de captura e remove a conexão extra do master;
- timers/intervals/animation frames pertencem ao ciclo de vida que os criou e possuem cleanup;
- AutoMix não deve depender de `requestAnimationFrame` para concluir transições em background.

## Validação automatizada

Gate principal:

    npm run check

Frontend focado:

    npm run test -w @home-music/web
    npm run typecheck -w @home-music/web

E2E do Modo DJ:

    npm run test:e2e

Cobertura relevante inclui:

- graph lifecycle, fallback e neutralidade;
- 10.000 updates de EQ/FX sem criação de novos nodes;
- ciclos repetidos de captura do master sem stream/conexão ativa residual;
- recording start/stop e exportação;
- AutoMix + FX + recording simultâneos;
- Hot Cues, loops, key e seleção inteligente;
- histórico/setlist;
- saída e reentrada do Modo DJ;
- ausência de Web MIDI e MediaRecorder sem bloquear playback;
- retorno ao player normal.

Limites de tempo em testes sintéticos servem como guard de regressão grosseira no CI, não como benchmark de áudio em tempo real ou garantia de hardware.

## Validação física separada

Não inferir compatibilidade de hardware a partir do CI. DDJ-400, LEDs, reconnect físico, latência real e roteamento separado de master/headphones continuam exigindo evidência no dispositivo alvo e nas issues específicas de hardware.
