# Home Music

Streaming pessoal das músicas do seu computador para o celular.

O Home Music roda no Ubuntu, lê uma pasta local de músicas e expõe uma interface mobile **Player First**. Em produção, o React compilado e a API são servidos pelo mesmo processo Fastify e pela mesma porta interna. Para uso remoto, o caminho recomendado é **Tailscale Serve + HTTPS**, sem port-forwarding público.

## Recursos atuais

### Biblioteca

- scanner recursivo de MP3, FLAC, WAV, M4A, AAC, OGG e OPUS;
- navegação hierárquica por pastas e subpastas;
- artistas, álbuns, músicas, favoritos, playlists e histórico;
- busca por música, artista, álbum e pasta, ignorando acentos;
- leitura de metadados e capas incorporadas;
- capas confinadas aos slots da interface para não alterar o layout mobile;
- abas responsivas sem overflow horizontal;
- re-scan incremental por `size + mtime` para arquivos novos, alterados e removidos;
- scanner tolerante a subpastas inacessíveis.

### Autenticação

- tela de login própria e responsiva;
- sessão aleatória mantida pelo backend;
- cookie `HttpOnly` + `SameSite=Strict`;
- cookie `Secure` em HTTPS direto ou quando `HOME_MUSIC_COOKIE_SECURE=true` é configurado explicitamente atrás de um proxy HTTPS confiável;
- sessão com expiração e logout explícito;
- rate limit para credenciais inválidas;
- manifest, favicon e assets públicos, com `/api/*` protegido;
- sessão expirada devolve o usuário para a tela de login.

### Player

- play/pause, anterior/próxima e seek;
- reprodução automática da próxima faixa;
- retomada automática da sessão quando permitida pelo navegador;
- restauração da última faixa, posição e volume;
- shuffle com ordem original persistida;
- repeat `off`, `all` e `one`;
- fila contextual com carregamento progressivo e reordenação por mouse, setas ou touch no mobile;
- retorno contextual para pasta, artista, álbum, playlist, favoritos ou busca;
- mini-player persistente;
- Media Session para tela bloqueada/notificações;
- letras locais em `.lrc` sincronizado ou `.txt`, carregadas sob demanda no player;
- normalização ReplayGain opcional por faixa ou álbum, sem alterar os arquivos originais.

> Navegadores móveis podem bloquear autoplay ao abrir uma nova página sem interação. O Home Music preserva faixa/posição e aguarda um toque em **Play**.

> Em dispositivos que usam o volume do sistema, o `<audio>` opera em volume `1.0` e o controle final fica nos botões físicos/aparelho. O volume salvo do desktop não é sobrescrito.

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

O schema usa `PRAGMA user_version` e migrations versionadas.

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

`HOME_MUSIC_COOKIE_SECURE=true` deve ser usado somente quando o navegador acessa o Home Music por **HTTPS** e um proxy confiável encaminha a requisição ao Fastify. O comando `npm run tailscale:enable` aplica essa configuração automaticamente apenas depois de validar o HTTPS real.

## Desenvolvimento

```bash
npm ci
npm run dev
```

- Web/Vite: `http://localhost:5173`
- API: `http://127.0.0.1:8787`
- celular na mesma LAN: `http://IP_DO_PC:5173`

O Vite faz proxy de `/api` para o backend local.

## Produção

```bash
npm ci
npm run build
npm start
```

No perfil LAN existe apenas um servidor externo:

```text
http://IP_DO_PC:8787
```

O Fastify serve o frontend compilado e `/api` na mesma origem. O Vite não fica rodando.

Para descobrir o IP do Ubuntu:

```bash
hostname -I
```

A política de cache mantém `index.html` sem cache, usa cache imutável apenas para assets com nome hashado pelo Vite e devolve `404` para arquivos estáticos inexistentes.

### Health checks

- `GET /health` é um **liveness** público e mínimo: informa apenas se o processo HTTP está vivo;
- `GET /ready` é um **readiness** público e mínimo: retorna `200` quando frontend, autenticação e biblioteca estão prontos, ou `503` quando não estão;
- `GET /api/health` exige sessão e contém diagnóstico detalhado de modo, uptime, biblioteca, scan, SQLite e frontend.

Detalhes em [`docs/production.md`](docs/production.md).

## Iniciar automaticamente com o Ubuntu

Depois de configurar `.env`:

```bash
npm run service:install
```

O instalador:

- restringe `.env` para `0600`, `data/` para `0700` e arquivos SQLite para `0600`;
- se já existir um processo ativo, para o serviço **antes** de alterar dependências/build;
- executa `npm ci` e `npm run build`;
- instala/regenera `home-music.service` com o usuário atual;
- escapa caminhos usados pelo unit do systemd;
- usa o binário Node atual diretamente;
- habilita início automático;
- faz `restart` explícito com o build novo;
- configura `Restart=on-failure`;
- envia logs para o journal.

Comandos úteis:

```bash
sudo systemctl status home-music --no-pager
sudo systemctl restart home-music
journalctl -u home-music -f
```

Depois de novos merges, use o fluxo seguro:

```bash
git checkout main
git pull --ff-only
npm run service:update
```

`service:update` para o processo antes de `npm ci/build`, evitando servir `index.html` antigo junto com assets de uma versão nova. A configuração persistente do Tailscale Serve fica no `tailscaled` e não é removida pelo update.

O servidor registra `SIGTERM`/`SIGINT` antes da inicialização potencialmente longa da biblioteca, aguarda scan em andamento e fecha Fastify + SQLite antes de encerrar.

## Acesso remoto seguro: Tailscale + HTTPS

O modo recomendado para acessar o Home Music fora de casa usa **Tailscale Serve**. **Tailscale Funnel não é usado**, porque Funnel torna o serviço acessível pela internet pública.

```text
celular com Tailscale
        |
        | HTTPS :443 (*.ts.net)
        v
   Tailscale Serve
        |
        | HTTP somente em loopback
        v
  Fastify 127.0.0.1:8787
```

Pré-requisitos:

- Tailscale instalado e autenticado no Ubuntu e no celular;
- MagicDNS e HTTPS Certificates habilitados no tailnet;
- `home-music.service` instalado.

Ative com:

```bash
npm run tailscale:enable
```

O setup valida o backend e o HTTPS **antes** de fechar o bind da LAN, recusa sobrescrever outro Serve em `443`, faz rollback do `.env`/serviço se algo falhar e, no perfil final, mantém `8787` somente em loopback com cookie `Secure`.

Status:

```bash
npm run tailscale:status
tailscale serve status
```

Rollback para HTTP/LAN:

```bash
npm run tailscale:disable
```

O Serve usa `--bg`, portanto persiste após reboot e após `tailscale down`/`tailscale up`.

> Certificados `*.ts.net` são públicos: o hostname da máquina/tailnet aparece em Certificate Transparency. O conteúdo e o acesso ao Home Music continuam privados ao tailnet, mas use um nome de máquina que não revele informação sensível.

Guia completo, grants e troubleshooting: [`docs/tailscale.md`](docs/tailscale.md).

## Re-scan da biblioteca

O botão **Atualizar biblioteca** chama `POST /api/library/scan`.

O re-scan é incremental: arquivos inalterados reutilizam o índice, somente arquivos novos/alterados têm metadados processados novamente e arquivos removidos são limpos do SQLite.

## Segurança

- não publique a porta do Home Music diretamente na internet;
- não use Tailscale Funnel para este app;
- use uma senha exclusiva;
- `.env` é ignorado pelo Git e o instalador do serviço força permissão `0600`;
- `data/` e os arquivos SQLite são endurecidos pelo instalador;
- em desenvolvimento a API fica em `127.0.0.1`;
- no perfil LAN, `PRODUCTION_HOST=0.0.0.0` permite acesso HTTP local;
- no perfil Tailscale, `PRODUCTION_HOST=127.0.0.1` remove o acesso direto a `8787` e somente o Serve recebe conexões remotas;
- frontend público não significa biblioteca pública: `/api/*` exige sessão;
- cookie de sessão é `HttpOnly` + `SameSite=Strict` e recebe `Secure` no perfil HTTPS;
- o backend não confia cegamente em `X-Forwarded-Proto`;
- endpoints mutáveis exigem sessão + header anti-CSRF do frontend;
- login tem rate limit;
- symlinks/devices/FIFOs/escapes de `MUSIC_DIR` não são servidos;
- caminhos físicos não são enviados ao frontend;
- capas têm limites de tipo, tamanho, concorrência e cache;
- arquivos estáticos de produção rejeitam traversal, ocultos, NUL e symlinks;
- respostas de produção aplicam CSP e headers de hardening;
- CI usa lockfile, audit, typecheck, testes, build, smoke real de produção e testes dos scripts operacionais.

Para tailnets compartilhados, prefira **grants** least-privilege e permita somente TCP/443 ao servidor Home Music para as identidades autorizadas. Não conceda acesso remoto à porta `8787`.

HTTP na LAN **não criptografa** usuário, senha ou áudio. O perfil Tailscale + HTTPS elimina esse transporte HTTP no caminho do navegador sem tornar o serviço público.

## Docker

O Compose atual continua voltado a desenvolvimento:

```bash
docker compose up
```

Para uso cotidiano no Ubuntu, o caminho recomendado é o serviço systemd; para acesso remoto, adicione Tailscale Serve.

## Qualidade

```bash
npm run typecheck
npm test
npm run build
npm run smoke:production
npm audit --audit-level=high
bash -n scripts/install-systemd.sh
bash -n scripts/configure-tailscale.sh
bash scripts/configure-tailscale.test.sh
```

## Próximos passos

Veja [`docs/roadmap.md`](docs/roadmap.md).

## Letras locais

Para exibir a letra, coloque um arquivo ao lado da música usando o mesmo nome-base:

```text
Minha música.flac
Minha música.lrc
```

Também são aceitos `Minha música.flac.lrc` e `Minha música.txt`. Arquivos LRC com timestamps acompanham a reprodução; TXT é exibido como texto simples. A leitura é local, limitada a 512 KiB e não envia músicas ou metadados para serviços externos.

## Normalização ReplayGain

No menu do player, **Normalização de volume** oferece:

- **Desativada**: mantém o comportamento original;
- **Por faixa**: reduz diferenças de volume entre músicas;
- **Por álbum**: preserva as diferenças internas do álbum e usa o ganho da faixa como fallback.

A preferência fica salva somente no dispositivo. Quando a faixa possui tags ReplayGain, o backend aplica o ganho durante o transcoding, limita valores extremos e usa um limiter contra clipping. O arquivo original nunca é modificado. Faixas sem tags continuam tocando normalmente, sem normalização.

Após esta atualização, o primeiro startup faz um re-scan completo único para indexar as tags ReplayGain existentes.
