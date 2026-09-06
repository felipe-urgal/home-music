# Diagnóstico de playback em background no iOS

Status: protocolo de investigação da #327.

Este documento descreve a instrumentação **local e opt-in** usada para investigar interrupções de playback no PWA instalado no iPhone. Ela não é telemetria, não envia eventos ao servidor e não substitui a máquina de estados de `useAudioPlayer`.

## Objetivo

Separar, com evidência observável, situações como:

- pausa/interrupção no meio da faixa;
- falha perto do handoff para a próxima faixa;
- perda de pipeline do `HTMLAudioElement` pelo WebKit;
- erro de rede/decode;
- retorno do documento ao foreground;
- evento `play`/`playing` que não volta a produzir áudio.

A instrumentação não tenta manter o processo vivo e não adiciona retry de `play()`.

## Privacidade e retenção

O log contém somente:

- timestamp;
- nome do evento;
- `document.visibilityState`;
- ID interno da faixa atual;
- estado React `playing` observado;
- `paused`, `ended`, `readyState`, `networkState`, `currentTime`, `duration` e `MediaError.code` do elemento de áudio;
- detalhe técnico curto para handoff/audio session quando aplicável.

Não são registrados título, artista, álbum, URL de stream, headers, cookies, tokens, path físico, capa ou bytes de mídia.

O buffer usa `localStorage`, mantém no máximo **150 eventos** e fica desabilitado por padrão. Os eventos permanecem somente no perfil local até serem limpos ou substituídos pelo ring buffer.

## Habilitar

No contexto do Home Music, via Web Inspector/DevTools:

```js
localStorage.setItem('home-music:playback-diagnostics:v1:enabled', '1');
location.reload();
```

Depois da reprodução, ler o buffer:

```js
JSON.parse(localStorage.getItem('home-music:playback-diagnostics:v1:events') || '[]');
```

Desabilitar e limpar:

```js
localStorage.removeItem('home-music:playback-diagnostics:v1:enabled');
localStorage.removeItem('home-music:playback-diagnostics:v1:events');
```

## Eventos observados

Em Apple mobile WebKit, `useBackgroundPlaybackContinuity` registra quando o modo está habilitado:

- `continuity:attached`;
- `audio:waiting`;
- `audio:stalled`;
- `audio:suspend`;
- `audio:emptied`;
- `audio:abort`;
- `audio:error`;
- `audio:pause`;
- `audio:ended`;
- `audio:playing`;
- `document:visibilitychange`;
- `window:pagehide` / `window:pageshow`;
- `background-handoff`;
- `audio-session-configure`.

Ao receber `playing`, `pageshow` ou `visibilitychange` durante reprodução, a camada de continuidade também revalida `navigator.audioSession.type = "playback"` quando a API existe. Isso é idempotente e não chama `audio.play()`.

## Como interpretar

Alguns padrões úteis:

- `reactPlaying: true` + `audio.paused: true` após suspensão sugere divergência entre estado observado da UI e pipeline real;
- `audio:error` com `errorCode: 2` em `hidden` é compatível com a classe transitória já tratada pela política Apple;
- `audio:error` com código 3/4 continua sendo evidência de decode/source e não deve ser mascarado como suspensão;
- `background-handoff` imediatamente antes da falha aponta investigação para troca de faixa;
- ausência completa de eventos durante a tentativa de Play na lock screen sugere que o WebKit não devolveu tempo de CPU/evento ao documento, mas isso precisa ser comparado com Safari normal antes de classificar como limite de plataforma.

O campo `reactPlaying` **não é chamado de intenção do usuário**: a intenção interna continua pertencendo a `useAudioPlayer`. Se a investigação exigir distinguir diretamente `resumeIntent`/`stop-transient`, a instrumentação deve ser estendida na autoridade do player em um passo posterior, sem inferir esse estado a partir do DOM.

## Protocolo físico mínimo

Registrar na issue/PR:

1. modelo do iPhone e versão exata do iOS;
2. PWA instalada versus Safari normal;
3. faixa longa com tela bloqueada;
4. sequência de faixas curtas para vários handoffs;
5. pause/resume e next/previous pela lock screen;
6. retorno ao app depois da falha;
7. quando possível, alternância Wi-Fi/celular e interrupção de sistema.

O PR de instrumentação pode ficar verde em CI, mas a #327 só pode ser encerrada depois da reprodução/validação em iPhone real.
