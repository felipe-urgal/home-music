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
     +--> login + sessão HttpOnly
     +--> proteção de mutações
     +--> scanner incremental
     +--> music-metadata
     +--> SQLite
     +--> endpoint de capa
     +--> streaming HTTP Range
     |
     v
MUSIC_DIR no Ubuntu
```

O frontend, manifest e favicon ficam públicos para o navegador conseguir montar a aplicação sem challenge nativo. O conteúdo pessoal continua protegido em `/api/*`.

## Autenticação

O Home Music não usa mais HTTP Basic Auth no Vite. Em vez disso:

```text
GET /
  ↓
React carrega normalmente
  ↓
GET /api/auth/status
  ↓
sem sessão
  ↓
Tela de login do Home Music
  ↓
POST /api/auth/login
  ↓
token aleatório no backend
  ↓
Set-Cookie: HttpOnly; SameSite=Strict
  ↓
/api/* autenticado
```

Características:

- credenciais continuam vindo de `HOME_MUSIC_USER` e `HOME_MUSIC_PASSWORD`;
- o frontend nunca recebe a senha configurada no servidor;
- a sessão usa token aleatório e expira automaticamente;
- o cookie recebe `Secure` quando a conexão é HTTPS;
- sessões ficam apenas em memória e são invalidadas quando o backend reinicia;
- logout revoga a sessão atual;
- tentativas inválidas são limitadas por origem;
- endpoints mutáveis continuam exigindo `X-Home-Music-Request: 1`, além da sessão;
- uma resposta `401` das chamadas da aplicação dispara retorno à tela de login.

Não há `WWW-Authenticate`, evitando o popup de login nativo e permitindo que `manifest.webmanifest` e assets sejam carregados sem `401`.

## Biblioteca

A biblioteca possui duas camadas:

1. `MUSIC_DIR` continua sendo a fonte física dos arquivos de áudio;
2. SQLite mantém o índice e os dados pessoais do usuário.

No primeiro scan, o backend percorre a biblioteca e processa metadados. Depois disso, o startup pode carregar o índice diretamente do SQLite sem reprocessar todos os arquivos.

O re-scan compara `size + mtime` para reaproveitar arquivos inalterados. Arquivos novos ou modificados são processados novamente e arquivos removidos são excluídos do índice.

A navegação de pastas usa apenas caminhos relativos à `MUSIC_DIR`. Caminhos físicos do computador não são expostos ao frontend.

## Layout mobile

A superfície principal usa largura limitada à viewport e não permite que conteúdos internos alterem sua largura.

Decisões importantes:

- containers flex/grid críticos usam `min-width: 0`;
- a página não possui scroll horizontal global;
- as abas da biblioteca usam grid responsivo em vez de uma faixa que ultrapassa a viewport;
- telas muito estreitas reduzem a quantidade de colunas;
- breadcrumbs podem rolar internamente sem deslocar a página inteira;
- títulos longos usam truncamento onde necessário.

### Capas

As capas são tratadas como conteúdo não confiável do ponto de vista de dimensão/proporção.

Todo artwork é confinado a um slot conhecido:

```text
container com tamanho definido
        ↓
overflow: hidden
        ↓
<img width=100% height=100%>
        ↓
object-fit: cover
```

A capa grande do player usa `aspect-ratio: 1 / 1` e `max-width: 100%`. Imagens verticais, panorâmicas ou com dimensões internas muito grandes não podem aumentar a largura da interface.

Capas continuam sendo extraídas sob demanda. Há limites para:

- tipos aceitos (`JPEG`, `PNG`, `WebP`);
- tamanho máximo da capa;
- quantidade de extrações simultâneas;
- tamanho e número de entradas do cache LRU.

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

## Segurança

Os endpoints pessoais usam sessão no backend. O frontend público contém somente os arquivos necessários para apresentar o app e a tela de login.

Outras decisões:

- backend em `127.0.0.1` por padrão no desenvolvimento;
- Docker não publica a porta `8787` no host;
- biblioteca montada read-only no Compose;
- symlinks, FIFOs, devices e escapes da raiz não são servidos;
- erros enviados ao cliente não incluem caminhos físicos internos;
- headers de segurança são aplicados no Vite e na API;
- dependências reproduzíveis via lockfile e `npm ci`.

HTTP puro na LAN não oferece confidencialidade. O Home Music não deve ser exposto diretamente na internet. Para acesso fora de casa, a direção planejada é Tailscale + ACLs e uma camada HTTPS adequada.

## Transcoding

Arquivos ainda são entregues no formato original. FFmpeg/transcoding adaptativo fica para uma fase posterior, principalmente para FLAC/WAV via 4G/5G.
