# Offline Cast to TV Implementation Plan

> Issue: #413
> Branch: `feature/tv-offline-cast`

## Goal

Permitir que a superfície remota no celular envie uma faixa já salva no cache offline diretamente para a experiência TV usando WebRTC DataChannel, mantendo o player canônico da TV como única autoridade de reprodução.

## Decisão arquitetural

A primeira versão mantém o backend no caminho de **autenticação, pareamento e sinalização**. Offer/answer/ICE passam pela sessão remota existente; bytes de áudio nunca passam por REST, SSE ou memória do servidor.

```text
Celular /remote/<sessionId>                 TV ?tv=1
┌──────────────────────────────┐           ┌────────────────────────────┐
│ sessão autenticada           │           │ sessão autenticada         │
│ downloads offline do usuário │           │ useCrossfadeAudioPlayer    │
│ Cache Storage                │           │ player canônico            │
│                              │           │                            │
│ RTCPeerConnection ───────────┼──────────►│ RTCPeerConnection          │
│ RTCDataChannel   áudio P2P   │           │ fonte transitória (Blob)   │
└──────────────┬───────────────┘           └─────────────┬──────────────┘
               │ offer/answer/ICE                        │
               └──────────────┬──────────────────────────┘
                              ▼
                  sessão remota no servidor
                  (sinalização somente)
```

O APK Android TV não muda nesta etapa. O frontend continua rodando no GeckoView embarcado e nenhuma bridge JavaScript nativa é adicionada.

## Invariantes

- `App.tsx` continua sendo a raiz de sessão/conectividade.
- `/remote/<sessionId>` continua sem `AuthenticatedApp`, `useAudioPlayer` ou `<audio>` local.
- `useCrossfadeAudioPlayer`/`useAudioPlayer` da TV continuam sendo a autoridade de fila, faixa corrente, posição e playback.
- o cache offline do celular permanece isolado por usuário; leitura P2P usa o namespace já associado ao usuário autenticado.
- a mídia recebida pela TV é transitória: não cria manifesto/referência offline e não altera o namespace `home-music-offline-audio-v2-*`.
- o backend autentica e aplica ownership da sessão a toda sinalização.
- eventos de sinalização não são interpretados como comandos de playback.
- falha/ausência de WebRTC degrada para o comportamento remoto/online atual sem bloquear o controle existente.

## Protocolo de sinalização

Adicionar ao contrato compartilhado:

- papéis `tv` e `remote`;
- `description` com `offer`/`answer` e SDP limitado;
- `ice-candidate` com campos serializáveis e limites de tamanho;
- evento SSE `signal` contendo o papel de origem.

Um endpoint autenticado publica sinalização na sessão. Ambos os peers observam o mesmo SSE e ignoram mensagens originadas pelo próprio papel.

A sinalização é efêmera como a sessão existente, herda TTL/ownership e entra no buffer pequeno de eventos apenas para permitir reconexão curta do `EventSource`.

## Protocolo de mídia no DataChannel

Um DataChannel dedicado (`home-music-media-v1`) usa controle JSON + chunks binários. Apenas uma transferência fica ativa por canal na primeira versão.

Mensagens de controle:

```text
media-start { transferId, trackId, mimeType, size }
media-complete { transferId }
media-cancel { transferId, reason? }
```

Os chunks binários pertencem à transferência ativa. Regras:

- chunk alvo: 64 KiB;
- `binaryType = 'arraybuffer'`;
- backpressure via `bufferedAmount`/`bufferedamountlow`;
- tamanho anunciado deve coincidir com bytes recebidos;
- tamanho máximo explícito: 256 MiB por faixa;
- somente MIME de áudio não vazio é aceito;
- IDs têm limites de comprimento;
- nova transferência cancela/limpa a anterior;
- fechamento/erro/unmount limpa buffers e callbacks.

A primeira versão monta um `Blob` completo na TV antes de disponibilizar a fonte. Isso simplifica seek e compatibilidade com o player HTML atual. O limite de tamanho impede crescimento de memória sem fronteira. Streaming progressivo via MediaSource fica fora de escopo.

## Fonte transitória na TV

A TV mantém um pequeno registro de fontes P2P por `trackId`, com `URL.createObjectURL(blob)`. Ao substituir/remover uma fonte, o URL anterior é revogado.

O player recebe um resolvedor de fonte opcional, sem criar outro player:

```text
fonte P2P disponível para trackId?
  sim -> object URL transitório
  não -> fonte online canônica atual
```

O mesmo resolvedor deve ser usado tanto no deck ativo quanto no deck de crossfade para não criar divergência entre os caminhos de áudio.

A fonte transitória não é persistida entre reloads/sessões e deve ser limpa ao encerrar/trocar a sessão remota.

## Leitura do offline no celular

A superfície remota recebe somente a projeção necessária dos downloads já reconciliados pelo `useOfflineDownloads`. Para enviar uma faixa:

1. confirmar que o `trackId` consta no manifesto físico do usuário atual;
2. abrir `home-music-offline-audio-v2-<userId>`;
3. buscar a mesma request virtual usada pelo modo offline;
4. exigir resposta `200` completa e MIME/tamanho válidos;
5. enviar pelo DataChannel com progresso derivado de bytes enviados.

Não duplicar o áudio em IndexedDB/localStorage e não criar novo cache.

## UX

Na superfície `/remote/<sessionId>`:

- a biblioteca continua funcionando como hoje;
- faixas que também estão baixadas neste celular recebem ação `Tocar na TV`/estado equivalente;
- a ação fica disponível apenas com TV presente + DataChannel aberto + blob offline disponível;
- durante envio, mostrar progresso e impedir uma segunda transferência concorrente;
- sucesso envia/aciona a seleção da faixa somente depois que a TV confirmou a mídia recebida;
- falha mantém os controles remotos existentes utilizáveis e apresenta erro acionável.

A superfície remota continua sem reproduzir áudio localmente.

## Ordem de implementação / commits

### Commit 1 — arquitetura e plano

Este documento. Validar coerência com `docs/pwa.md`, `docs/offline-downloads.md`, `docs/app-composition.md`, `docs/android-tv.md` e `docs/tv-remote-control.md`.

### Commit 2 — sinalização WebRTC

**Arquivos:** `packages/shared/src/tv-remote.ts`, `apps/server/src/tv-remote-session-manager.ts`, `apps/server/src/tv-remote-routes.ts`, clientes/testes correspondentes.

1. escrever/ajustar testes de contrato e servidor para sinalização válida, inválida, ownership e evento SSE;
2. implementar tipos/validação/manager/rota mínimos;
3. expor envio/recebimento no cliente web sem iniciar peer ainda.

### Commit 3 — transporte P2P de mídia

**Arquivos novos esperados:** helpers de peer, protocolo de mídia e leitura offline em `apps/web/src/` + testes.

1. testar serialização/validação do protocolo;
2. testar chunking/backpressure/limites usando doubles pequenos de DataChannel;
3. testar leitura do namespace offline correto;
4. implementar lifecycle do peer e sender/receiver desacoplados de React.

### Commit 4 — recepção e player da TV

**Arquivos:** player canônico/crossfade, hook TV e store transitório + testes.

1. testar precedência da fonte transitória e fallback online;
2. testar revogação/substituição/cleanup de object URL;
3. integrar receiver ao ciclo da sessão TV;
4. preservar mesma resolução de fonte nos dois decks.

### Commit 5 — UX no celular

**Arquivos:** `App.tsx`, `TvRemoteControlScreen` e componentes/helpers/testes necessários.

1. fornecer ao remoto somente os downloads do usuário atual;
2. iniciar peer remoto após sessão válida;
3. mostrar disponibilidade/progresso/erro da transferência;
4. transferir faixa e só então solicitar playback na TV;
5. preservar controles existentes quando P2P não estiver disponível.

### Commit 6 — regressão, E2E e documentação final

1. ampliar E2E do controle remoto com duas páginas/contexts para handshake e envio de mídia;
2. verificar que o telefone remoto continua sem `<audio>`;
3. cobrir desconexão/cleanup e fallback;
4. atualizar `docs/tv-remote-control.md`, `docs/android-tv.md`, `docs/pwa.md`/`offline-downloads.md` quando aplicável;
5. registrar validação física pendente no BTV 11.

## Gates

No head final:

```bash
npm run check
npm run test:e2e -- --grep "TV remote"
```

Se a forma exata do runner E2E do repositório diferir, usar o comando canônico documentado/CI equivalente. Como este ambiente de edição não possui checkout local funcional, CI do GitHub no SHA publicado é a evidência executável principal; nenhuma validação local/hardware deve ser declarada sem execução real.

## Validação física obrigatória antes de considerar suporte de hardware comprovado

No BTV 11 real:

- GeckoView cria `RTCPeerConnection` e DataChannel;
- QR/pareamento existente continua funcional;
- faixa offline real do celular chega e toca na TV;
- play/pause/seek/next continuam operando no player canônico;
- troca de faixa não vaza object URLs/memória de forma perceptível;
- desligar Wi-Fi/internet conforme o cenário suportado produz fallback/erro compreensível;
- reconectar/regenerar sessão limpa o peer anterior.