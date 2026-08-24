# Home Music

Streaming pessoal das músicas do seu computador para o celular.

O Home Music roda no Ubuntu, lê uma pasta local de músicas e expõe uma interface mobile **Player First**. Em produção, o React compilado e a API são servidos pelo mesmo processo Fastify. Para uso remoto, o caminho recomendado é **Tailscale Serve + HTTPS**, sem port-forwarding público.

## Recursos atuais

### Biblioteca

- scanner recursivo de MP3, FLAC, WAV, M4A, AAC, OGG e OPUS;
- navegação hierárquica por pastas e subpastas;
- artistas, álbuns, músicas, favoritos, playlists e histórico;
- busca por música, artista, álbum e pasta, ignorando acentos;
- leitura de metadados e capas incorporadas;
- re-scan incremental por `size + mtime`;
- scanner tolerante a subpastas inacessíveis.

### Autenticação

- tela de login própria e responsiva;
- sessão aleatória mantida pelo backend;
- cookie `HttpOnly` + `SameSite=Strict`;
- cookie `Secure` quando o perfil Tailscale/HTTPS está habilitado;
- sessão com expiração e logout explícito;
- rate limit para credenciais inválidas;
- `/api/*` protegido por sessão;
- sessão expirada devolve o usuário para a tela de login.

### Player

- play/pause, anterior/próxima e seek;
- reprodução automática da próxima faixa;
- retomada automática da sessão quando permitida pelo navegador;
- restauração da última faixa, posição e volume;
- shuffle + repeat `off`, `all` e `one`;
- fila contextual reordenável, inclusive por touch no mobile;
- carregamento progressivo da fila para pastas grandes;
- retorno contextual para pasta, artista, álbum, playlist, favoritos ou busca;
- mini-player persistente;
- Media Session para tela bloqueada/notificações.

> Navegadores móveis podem bloquear autoplay ao abrir uma nova página sem interação. O Home Music preserva faixa/posição e aguarda um toque em **Play**.

### Persistência

O estado local usa SQLite em `data/home-music.db`:

- índice da biblioteca;
- favoritos;
- histórico;
- playlists;
- última faixa e posição;
- volume;
- shuffle/repeat;
- fila efetiva e ordem base;
- estado de reprodução.

> Sessões de login ficam em memória e são invalidadas quando o processo reinicia.

## Estrutura

```text
home-music/
├── apps/
│   ├── web/       # React + TypeScript + Vite (build)
│   └── server/    # Fastify + TypeScript + SQLite + frontend em produção
├── packages/
│   └── shared/
├── data/
├── scripts/
└── docs/
```

## Configuração

Requisitos: Node.js 22+ e npm.

```bash
cp .env.example .env
```

Configure pelo menos:

```env
MUSIC_DIR="/caminho/para/suas/musicas"
HOME_MUSIC_USER=home-music
HOME_MUSIC_PASSWORD=uma-senha-exclusiva-com-12-ou-mais-caracteres
HOME_MUSIC_COOKIE_SECURE=false
PORT=8787
HOST=127.0.0.1
PRODUCTION_HOST=0.0.0.0
```

O perfil Tailscale altera automaticamente `PRODUCTION_HOST` para `127.0.0.1` e `HOME_MUSIC_COOKIE_SECURE` para `true` somente depois de validar o HTTPS real.

## Desenvolvimento

```bash
npm ci
npm run dev
```

- Web/Vite: `http://localhost:5173`
- API: `http://127.0.0.1:8787`

O Vite faz proxy de `/api` para o backend local.

## Produção no Ubuntu

```bash
npm ci
npm run build
npm start
```

Em produção existe um único processo Fastify servindo frontend + API. Para operação cotidiana, instale como serviço:

```bash
npm run service:install
```

Comandos úteis:

```bash
sudo systemctl status home-music --no-pager
sudo systemctl restart home-music
journalctl -u home-music -f
```

Depois de novos merges:

```bash
git checkout main
git pull --ff-only
npm run service:update
```

O update para o processo antes de alterar dependências/build, evitando servir HTML antigo com assets de outra versão.

### Health checks

- `GET /health`: liveness público mínimo;
- `GET /ready`: readiness público mínimo (`200` ou `503`);
- `GET /api/health`: diagnóstico detalhado autenticado.

Detalhes em [`docs/production.md`](docs/production.md).

## Acesso remoto seguro: Tailscale + HTTPS

O modo recomendado para acessar o Home Music fora de casa usa **Tailscale Serve**. **Tailscale Funnel não é usado**, porque Funnel tornaria o serviço público na internet.

Arquitetura:

```text
celular com Tailscale
        |
        | HTTPS :443 (*.ts.net)
        v
   Tailscale Serve
        |
        | HTTP loopback
        v
  127.0.0.1:8787
      Fastify
```

Pré-requisitos:

- Tailscale instalado e autenticado no Ubuntu e no celular;
- MagicDNS habilitado;
- HTTPS Certificates habilitado no tailnet;
- `home-music.service` instalado.

Ative com:

```bash
npm run tailscale:enable
```

O setup valida HTTPS **antes** de fechar a porta da LAN, recusa sobrescrever outro Serve em `443`, faz rollback do `.env` se algo falhar e deixa o backend somente em loopback.

Status:

```bash
npm run tailscale:status
```

Rollback para HTTP/LAN:

```bash
npm run tailscale:disable
```

O Tailscale Serve é configurado com `--bg`, portanto persiste após reboot. `npm run service:update` atualiza o Home Music sem remover a URL HTTPS.

Guia completo: [`docs/tailscale.md`](docs/tailscale.md).

## Re-scan da biblioteca

O botão **Atualizar biblioteca** chama `POST /api/library/scan`.

O re-scan é incremental: arquivos inalterados reutilizam o índice, somente arquivos novos/alterados têm metadados processados novamente e arquivos removidos são limpos do SQLite.

## Segurança

- não publique a porta `8787` diretamente na internet;
- não use Tailscale Funnel para este app;
- use uma senha exclusiva para o Home Music;
- `.env` é ignorado pelo Git e o instalador força permissão `0600`;
- `data/` e SQLite recebem permissões restritas;
- no perfil Tailscale o Fastify fica em `127.0.0.1` e só o Serve recebe conexões remotas;
- o cookie de sessão é `Secure` + `HttpOnly` + `SameSite=Strict` no perfil HTTPS;
- endpoints mutáveis exigem sessão + header anti-CSRF do frontend;
- login tem rate limit;
- symlinks/devices/FIFOs/escapes de `MUSIC_DIR` não são servidos;
- caminhos físicos não são enviados ao frontend;
- capas têm limites de tipo, tamanho, concorrência e cache;
- arquivos estáticos rejeitam traversal, ocultos, NUL e symlinks;
- respostas de produção aplicam CSP e headers de hardening;
- CI usa lockfile, audit, typecheck, testes, build, smoke real e validação sintática dos scripts operacionais.

Para tailnets compartilhados, use **grants** least-privilege e permita apenas TCP/443 ao servidor Home Music para as identidades autorizadas. O login do app continua como segunda camada.

## Docker

O Compose atual continua voltado a desenvolvimento:

```bash
docker compose up
```

Para uso cotidiano no Ubuntu, o caminho recomendado é systemd + Tailscale Serve.

## Qualidade

```bash
npm run typecheck
npm test
npm run build
npm run smoke:production
npm audit --audit-level=high
bash -n scripts/install-systemd.sh
bash -n scripts/configure-tailscale.sh
```

## Próximos passos

Veja [`docs/roadmap.md`](docs/roadmap.md).
