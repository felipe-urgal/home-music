# Home Music

Streaming pessoal das músicas do seu computador para o celular.

O Home Music roda no Ubuntu, lê uma pasta local de músicas e expõe uma interface mobile **Player First** na rede local. O frontend e o manifest ficam públicos para o navegador carregar normalmente; os dados e o streaming continuam protegidos pela API, que usa uma sessão autenticada por cookie `HttpOnly`.

## Recursos atuais

### Biblioteca

- scanner recursivo de MP3, FLAC, WAV, M4A, AAC, OGG e OPUS;
- navegação hierárquica por pastas e subpastas;
- artistas, álbuns, músicas, favoritos, playlists e histórico;
- busca por música, artista, álbum e pasta, ignorando acentos;
- leitura de metadados e capas incorporadas;
- capas confinadas aos slots da interface para não alterar a largura/proporção do layout mobile;
- abas responsivas sem provocar overflow horizontal da página;
- re-scan incremental por `size + mtime` para arquivos novos, alterados e removidos;
- scanner tolerante a subpastas inacessíveis sem derrubar o restante da biblioteca.

### Autenticação

- tela de login própria do Home Music, responsiva para celular;
- não usa mais o popup nativo de HTTP Basic Auth do navegador;
- `POST /api/auth/login` cria uma sessão aleatória mantida pelo backend;
- a sessão é enviada em cookie `HttpOnly`, `SameSite=Strict` e recebe `Secure` quando a conexão for HTTPS;
- sessão com expiração e logout explícito;
- tentativas inválidas de login possuem limitação por origem;
- `manifest.webmanifest`, favicon e assets do frontend não recebem challenge de autenticação;
- quando a sessão expira, requisições da aplicação levam o usuário de volta para o login.

### Player

- play/pause, anterior/próxima e seek;
- reprodução automática da próxima faixa enquanto a fila estiver ativa;
- retomada automática da sessão quando a página anterior foi encerrada tocando;
- restauração da última faixa, posição e volume;
- shuffle com ordem original persistida separadamente;
- repeat `off`, `all` e `one`;
- fila contextual e reordenável;
- retorno contextual pela ação superior do player: pasta, artista, álbum, playlist, favoritos ou busca permanecem preservados;
- mini-player persistente enquanto navega pela biblioteca;
- Media Session com controles compatíveis na tela bloqueada/notificações.

> Navegadores móveis podem bloquear a retomada automática ao abrir uma nova página sem interação do usuário. Nessa situação o Home Music preserva a faixa e a posição, mostra um aviso e basta tocar em **Play** uma vez. A continuidade automática da fila segue funcionando depois da interação.

> Em dispositivos que usam o volume do sistema, o Home Music não exibe um slider que o navegador não consegue controlar. O elemento `<audio>` opera em volume `1.0` e o volume final fica nos botões físicos/controle do aparelho. A preferência de volume salva para uso no desktop continua preservada e não é sobrescrita pelo celular.

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
- estado de reprodução usado pela retomada automática.

O schema usa `PRAGMA user_version` e migrations versionadas.

> As sessões de login são mantidas em memória pelo backend e não são gravadas no SQLite. Reiniciar o processo invalida as sessões existentes e exige login novamente.

## Estrutura

```text
home-music/
├── apps/
│   ├── web/       # React + TypeScript + Vite
│   └── server/    # Fastify + TypeScript + SQLite
├── packages/
│   └── shared/    # tipos compartilhados
├── data/          # banco SQLite local, ignorado pelo Git
└── docs/
```

## Rodando no Ubuntu

Requisitos: Node.js 22+ e npm.

```bash
cp .env.example .env
```

Edite o `.env` e configure pelo menos:

```env
MUSIC_DIR="/caminho/para/suas/musicas"
HOME_MUSIC_USER=home-music
HOME_MUSIC_PASSWORD=uma-senha-exclusiva-com-12-ou-mais-caracteres
HOST=127.0.0.1
```

Depois:

```bash
npm ci
npm run dev
```

No computador:

- Web: `http://localhost:5173`
- API: `http://127.0.0.1:8787` — somente local

No celular, conectado ao mesmo Wi-Fi, abra:

```text
http://IP_DO_SEU_PC:5173
```

A página do Home Music será carregada normalmente e exibirá a tela própria de login. Use os valores de `HOME_MUSIC_USER` e `HOME_MUSIC_PASSWORD`.

Para descobrir o IP no Ubuntu:

```bash
hostname -I
```

## Re-scan da biblioteca

O botão **Atualizar biblioteca** chama o endpoint autenticado `POST /api/library/scan`.

O re-scan é incremental: arquivos inalterados reaproveitam o índice existente, enquanto somente arquivos novos/alterados têm os metadados processados novamente. Arquivos removidos também são limpos do SQLite e dos relacionamentos dependentes.

## Segurança

- não publique as portas do Home Music diretamente na internet;
- use uma senha exclusiva no `HOME_MUSIC_PASSWORD`;
- o `.env` está ignorado pelo Git e não deve ser commitado;
- em desenvolvimento, o backend escuta somente em `127.0.0.1`;
- no Docker, a porta `8787` fica apenas na rede interna do Compose;
- frontend/manifest públicos não significam biblioteca pública: `/api/*` continua protegido por sessão;
- o cookie de sessão é `HttpOnly` e `SameSite=Strict`; em HTTPS também recebe `Secure`;
- endpoints mutáveis exigem sessão e o header interno anti-CSRF do frontend;
- login possui limitação de tentativas inválidas;
- arquivos simbólicos, devices, FIFOs e arquivos que escapem de `MUSIC_DIR` não são servidos;
- caminhos físicos da biblioteca não são enviados para o cliente;
- capas possuem tipo, tamanho, concorrência e cache limitados;
- dependências são reproduzidas por `package-lock.json` + `npm ci`;
- o CI executa audit, typecheck, testes e build.

HTTP na rede local **não criptografa** usuário, senha nem áudio. Para acesso remoto ou redes que não sejam totalmente confiáveis, a direção planejada continua sendo Tailscale + HTTPS, sem port-forwarding público.

## Docker

O Compose atual é voltado a desenvolvimento e expõe somente o frontend em `5173`:

```bash
docker compose up
```

A biblioteca é montada como read-only, o SQLite fica persistido em `./data` e o backend não publica `8787` no host.

## Qualidade

```bash
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

## Próximos passos

Veja [`docs/roadmap.md`](docs/roadmap.md).
