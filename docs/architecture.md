# Arquitetura

## Fluxo

```text
Celular / PWA
     |
     | HTTP na LAN
     v
React + Vite
     |
     | /api (proxy same-origin)
     v
Fastify
     |
     +--> autenticação / proteção de mutações
     +--> scanner incremental
     +--> music-metadata
     +--> SQLite
     +--> endpoint de capa
     +--> streaming HTTP Range
     |
     v
MUSIC_DIR no Ubuntu
```

## Biblioteca

A biblioteca possui duas camadas:

1. `MUSIC_DIR` continua sendo a fonte física dos arquivos de áudio;
2. SQLite mantém o índice e os dados pessoais do usuário.

No primeiro scan, o backend percorre a biblioteca e processa metadados. Depois disso, o startup pode carregar o índice diretamente do SQLite sem reprocessar todos os arquivos.

O re-scan compara `size + mtime` para reaproveitar arquivos inalterados. Arquivos novos ou modificados são processados novamente e arquivos removidos são excluídos do índice.

A navegação de pastas usa apenas caminhos relativos à `MUSIC_DIR`. Caminhos físicos do computador não são expostos ao frontend.

## SQLite

O banco padrão fica em:

```text
data/home-music.db
```

Ele guarda:

- índice das faixas;
- favoritos;
- histórico;
- playlists;
- fila atual e ordem base da fila;
- última faixa e posição;
- volume;
- shuffle/repeat;
- indicação de que a sessão anterior estava tocando, usada pela retomada automática.

O schema usa `PRAGMA user_version` e migrations incrementais. O banco usa WAL e foreign keys.

## Player e play automático

O frontend mantém uma intenção de reprodução separada do evento `pause` do elemento `<audio>`.

Isso é importante porque `audio.load()` pode emitir `pause` durante uma troca de faixa. Esse evento técnico não deve cancelar a intenção de continuar tocando a fila.

Fluxo simplificado:

```text
faixa termina
   ↓
resolve próxima faixa / repeat
   ↓
mantém intenção de reprodução
   ↓
troca src
   ↓
audio.play()
```

Ao fechar/recarregar o app enquanto uma faixa está tocando, o estado `wasPlaying` é persistido. Na próxima abertura, o frontend tenta restaurar faixa, posição e reprodução.

Browsers podem bloquear autoplay com áudio ao abrir uma página sem interação prévia. Quando isso acontece, o Home Music não força nem contorna a política do navegador: preserva o estado, mostra um aviso e aguarda um toque em **Play**.

### Volume mobile

A preferência de volume salva no SQLite representa o controle do player em ambientes onde `HTMLMediaElement.volume` é controlável, como desktop.

Em dispositivos touch-first e ambientes iOS/iPadOS, o frontend trata o volume como responsabilidade do sistema operacional:

```text
volume salvo do desktop
        ↓ preservado no SQLite
mobile detectado
        ↓
<audio>.volume = 1.0
        ↓
volume final controlado pelo sistema/aparelho
```

O slider não é exibido nesses dispositivos. Assim o celular não sobrescreve a preferência salva do desktop e não apresenta um controle sem efeito real.

A detecção acompanha mudanças no media query de ponteiro para lidar melhor com dispositivos híbridos.

### Retorno à biblioteca

A biblioteca mantém o estado de navegação enquanto o player está aberto. A ação de retorno fica concentrada no controle superior do player, evitando duas ações idênticas na mesma tela.

O rótulo acessível considera pasta, artista, álbum, playlist, favoritos e busca ativa, para que o retorno corresponda ao contexto que será restaurado.

## Streaming

`GET /api/tracks/:id/stream` aceita o cabeçalho `Range`, permitindo seek sem baixar o arquivo inteiro.

A rota recebe somente um ID indexado. Antes de abrir um arquivo, o backend valida novamente que o destino continua sendo um arquivo regular dentro da raiz da biblioteca.

## Capas

Capas são extraídas sob demanda em vez de permanecerem todas em memória.

Há limites para:

- tipos aceitos (`JPEG`, `PNG`, `WebP`);
- tamanho máximo da capa;
- quantidade de extrações simultâneas;
- tamanho e número de entradas do cache LRU.

## Segurança

O acesso pela LAN usa HTTP Basic no frontend e validação também no backend.

Os endpoints que alteram dados exigem, além da autenticação, o header interno usado pelo frontend para reduzir risco de requisições cross-site triviais.

Outras decisões:

- backend em `127.0.0.1` por padrão no desenvolvimento;
- Docker não publica a porta `8787` no host;
- biblioteca montada read-only no Compose;
- symlinks, FIFOs, devices e escapes da raiz não são servidos;
- erros enviados ao cliente não incluem caminhos físicos internos;
- dependências reproduzíveis via lockfile e `npm ci`.

O Home Music não deve ser exposto diretamente na internet. Para acesso fora de casa, a direção planejada é Tailscale + ACLs e uma camada HTTPS adequada.

## Transcoding

Arquivos ainda são entregues no formato original. FFmpeg/transcoding adaptativo fica para uma fase posterior, principalmente para FLAC/WAV via 4G/5G.
