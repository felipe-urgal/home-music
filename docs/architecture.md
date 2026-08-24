# Arquitetura

## Fluxos de execução

### Desenvolvimento

```text
Celular / navegador
     |
     v
React + Vite :5173
     |
     | /api (proxy)
     v
Fastify :8787 em 127.0.0.1
```

O Vite continua existindo somente para HMR e desenvolvimento local.

### Produção

```text
Celular / PWA
     |
     | HTTP na LAN :8787
     v
Fastify
     |
     +--> React compilado (apps/web/dist)
     +--> login + sessão HttpOnly
     +--> /api
     +--> scanner incremental
     +--> music-metadata
     +--> SQLite
     +--> capas
     +--> streaming HTTP Range
     |
     v
MUSIC_DIR no Ubuntu
```

Produção usa **um processo, uma origem e uma porta**. O Vite não participa da execução cotidiana.

## Frontend de produção

`npm run build` gera o frontend em `apps/web/dist`. Quando `NODE_ENV=production`, o Fastify valida esse diretório antes de iniciar e falha com mensagem explícita se `index.html` não existir.

O servidor estático é implementado sem dependência adicional e possui contenção própria:

- rejeita `..`, paths codificados equivalentes, backslashes e arquivos ocultos;
- rejeita symlinks;
- resolve `realpath` e confirma que o arquivo permanece dentro do `dist`;
- arquivos inexistentes caem no `index.html` para permitir fallback SPA;
- `/api` inexistente continua retornando JSON/404, nunca o shell React.

Política de cache:

```text
/assets/*              1 ano + immutable
manifest / favicon     cache curto + revalidate
index.html / SPA       no-store
```

Assets do Vite recebem hash no nome, portanto podem ser tratados como imutáveis.

## Ciclo de vida do processo

Em produção o host padrão é `PRODUCTION_HOST=0.0.0.0`, enquanto `HOST=127.0.0.1` continua reservado ao backend de desenvolvimento.

`SIGTERM` e `SIGINT` iniciam shutdown controlado:

```text
systemd / Ctrl+C
      ↓
Fastify.close()
      ↓
onClose
      ↓
SQLite.close()
      ↓
processo termina
```

Há um timeout defensivo de 25 segundos para evitar processo preso durante shutdown.

O endpoint `/health` informa modo, uptime, disponibilidade do frontend, quantidade de faixas e estado de scan/configuração.

## systemd

`scripts/install-systemd.sh` detecta:

- usuário atual;
- raiz real do repositório;
- binário Node em uso.

Antes de instalar o serviço ele executa `npm ci` e `npm run build`. O unit instalado em `/etc/systemd/system/home-music.service` inicia o `dist/index.js` diretamente, sem depender do shell interativo/NVM durante cada boot.

O serviço usa `Restart=on-failure`, journal e hardening básico (`NoNewPrivileges`, `PrivateTmp`, `ProtectSystem`, restrições de kernel/control groups e `UMask=0077`).

## Autenticação

O frontend, manifest e favicon são públicos para que o navegador consiga montar a aplicação. O conteúdo pessoal continua protegido em `/api/*`.

```text
GET /
  ↓
React
  ↓
GET /api/auth/status
  ↓
sem sessão
  ↓
Tela de login
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

- credenciais vêm de `HOME_MUSIC_USER` e `HOME_MUSIC_PASSWORD`;
- frontend nunca recebe a senha configurada;
- sessão usa token aleatório, expira e fica apenas em memória;
- logout revoga a sessão atual;
- tentativas inválidas têm rate limit;
- mutações exigem `X-Home-Music-Request: 1` além da sessão;
- `401` da aplicação retorna o usuário ao login.

Em produção direta na LAN, o servidor não confia em `X-Forwarded-Proto` enviado pelo cliente para decidir o atributo `Secure` do cookie. O suporte correto a proxy/HTTPS será tratado junto da camada Tailscale/HTTPS.

## Biblioteca

A biblioteca possui duas camadas:

1. `MUSIC_DIR` é a fonte física dos arquivos;
2. SQLite mantém índice e dados pessoais.

No primeiro scan o backend processa metadados. Depois, o startup pode carregar o índice do SQLite sem reprocessar tudo.

O re-scan compara `size + mtime`: arquivos inalterados são reaproveitados, novos/modificados são processados e removidos saem do índice.

A navegação usa somente caminhos relativos a `MUSIC_DIR`; caminhos físicos não são expostos ao frontend.

## Layout mobile e capas

A superfície principal é limitada à viewport:

- containers flex/grid críticos usam `min-width: 0`;
- sem scroll horizontal global;
- abas usam grid responsivo;
- breadcrumbs rolam somente dentro do próprio componente;
- títulos longos são truncados.

Capas são tratadas como conteúdo não confiável quanto a dimensão/proporção:

```text
slot conhecido
   ↓
overflow: hidden
   ↓
<img width=100% height=100%>
   ↓
object-fit: cover
```

A capa grande usa `aspect-ratio: 1 / 1` e `max-width: 100%`. Extração continua sob demanda com limites de formato, tamanho, concorrência e cache.

## SQLite

O banco padrão fica em `data/home-music.db` e guarda:

- índice das faixas;
- favoritos;
- histórico;
- playlists;
- fila atual e ordem base;
- última faixa e posição;
- volume;
- shuffle/repeat;
- estado usado pela retomada automática.

O schema usa `PRAGMA user_version`, migrations incrementais, WAL e foreign keys.

## Player e play automático

O frontend separa intenção de reprodução do evento `pause` do `<audio>`, porque `audio.load()` pode emitir pausas técnicas durante troca de faixa.

```text
faixa termina
   ↓
resolve próxima / repeat
   ↓
mantém intenção
   ↓
troca src
   ↓
audio.play()
```

Ao recarregar, `wasPlaying` permite tentar restaurar a reprodução. Se o navegador bloquear autoplay, o estado é preservado e a UI aguarda um toque em **Play**.

### Volume mobile

Em ambientes touch-first/iOS, o sistema controla o volume final e o elemento usa `1.0`. A preferência salva para desktop continua preservada.

### Retorno à biblioteca

A biblioteca preserva pasta, artista, álbum, playlist, favoritos e busca enquanto o player está aberto. A ação superior retorna ao contexto real.

## Streaming

`GET /api/tracks/:id/stream` suporta `Range` para seek. A rota recebe somente ID indexado e revalida que o destino continua sendo arquivo regular dentro da raiz antes de abri-lo.

## Segurança

- desenvolvimento: API em `127.0.0.1`;
- produção: uma porta na LAN, protegida por sessão;
- frontend público não contém dados pessoais;
- symlinks/FIFOs/devices/escapes da biblioteca não são servidos;
- arquivos estáticos de produção também têm contenção de path/symlink;
- erros não expõem caminhos físicos;
- produção aplica CSP, `nosniff`, frame denial, referrer policy, permissions policy e CORP same-origin;
- dependências são reproduzíveis via lockfile + `npm ci`;
- systemd adiciona hardening do processo.

HTTP puro na LAN não oferece confidencialidade. Não deve haver port-forwarding público. O próximo marco é Tailscale + HTTPS/ACL.

## Transcoding

Arquivos ainda são entregues no formato original. FFmpeg/transcoding adaptativo permanece para etapa posterior, principalmente para FLAC/WAV em redes móveis.
