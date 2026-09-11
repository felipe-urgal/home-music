# Diagnóstico de playback em background no iOS

**Status:** protocolo opcional de diagnóstico/regressão.

Este documento descreve a instrumentação local e opt-in usada para investigar interrupções de playback no PWA instalado no iPhone. Ela não é telemetria, não envia eventos ao servidor e não substitui a máquina de estados de `useAudioPlayer`.

A implementação nasceu na #327. A issue foi encerrada por decisão do projeto após o hardening técnico; o QA físico residual foi aceito como risco de plataforma. Este protocolo permanece disponível caso uma regressão real volte a ser observada.

## Objetivo

Separar, com evidência observável, situações como:

- pausa/interrupção no meio da faixa;
- falha perto do handoff para a próxima faixa;
- perda do pipeline de áudio pelo WebKit;
- erro de rede/decode;
- retorno do documento ao foreground;
- evento de reprodução que não volta a produzir áudio.

A instrumentação não tenta manter o processo vivo e não adiciona retry ilimitado de playback.

## Privacidade e retenção

O log guarda somente dados técnicos mínimos, como timestamp, evento, visibilidade da página, ID interno da faixa e estado do elemento de áudio.

Não são registrados título, artista, álbum, URL de stream, headers, cookies, tokens, path físico, capa ou bytes de mídia.

O buffer usa `localStorage`, mantém no máximo **150 eventos** e fica desabilitado por padrão.

## Habilitar

Via Web Inspector/DevTools no contexto do Home Music:

```js
localStorage.setItem('home-music:playback-diagnostics:v1:enabled', '1');
location.reload();
```

Ler o buffer:

```js
JSON.parse(localStorage.getItem('home-music:playback-diagnostics:v1:events') || '[]');
```

Desabilitar e limpar:

```js
localStorage.removeItem('home-music:playback-diagnostics:v1:enabled');
localStorage.removeItem('home-music:playback-diagnostics:v1:events');
```

## Eventos observados

A instrumentação pode registrar eventos do elemento de áudio, lifecycle do documento, handoff e configuração de audio session, entre eles:

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

A revalidação da audio session, quando suportada pela plataforma, é idempotente e não deve disparar reprodução por conta própria.

## Como interpretar

Exemplos de sinais úteis:

- estado React de reprodução ativo + elemento de áudio pausado após suspensão pode indicar divergência entre UI e pipeline real;
- erro de rede em background pode pertencer à classe transitória tratada pela política Apple;
- erro de decode/source deve continuar sendo tratado como falha de mídia, não como simples suspensão;
- `background-handoff` imediatamente antes da falha direciona a investigação para a troca de faixa;
- ausência completa de eventos durante ação na lock screen pode indicar que o WebKit não devolveu tempo de CPU/evento ao documento.

Diagnóstico não deve inferir intenção interna do usuário apenas a partir do DOM. A autoridade continua em `useAudioPlayer`.

## Protocolo de regressão física

Quando houver uma regressão reproduzível, registre:

1. modelo do iPhone e versão exata do iOS;
2. PWA instalada versus Safari normal;
3. faixa longa com tela bloqueada;
4. sequência de faixas curtas para vários handoffs;
5. pause/resume e next/previous pela lock screen;
6. retorno ao app depois da falha;
7. quando possível, alternância Wi-Fi/celular e interrupção de sistema;
8. trecho relevante do ring buffer local.

Esse protocolo é diagnóstico futuro, não gate retroativo para as issues já encerradas.
