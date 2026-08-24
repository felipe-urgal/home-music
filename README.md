# Home Music

Streaming pessoal das músicas do seu computador para o celular.

O MVP foi pensado para rodar no Ubuntu, ler uma pasta local de músicas e expor uma interface mobile **Player First** na rede local. O acesso pela LAN exige autenticação HTTP Basic e o backend fica restrito ao próprio PC em desenvolvimento.

## MVP

- scanner recursivo de MP3, FLAC, WAV, M4A, AAC, OGG e OPUS;
- leitura de metadados e capas incorporadas;
- biblioteca por pastas, artistas, álbuns e músicas;
- busca por música, artista, álbum e pasta, ignorando acentos;
- mini-player persistente enquanto navega pela biblioteca;
- streaming com suporte a HTTP Range;
- player mobile com play/pause, anterior/próxima, seek e fila contextual;
- autenticação obrigatória no frontend acessível pela rede;
- validação de paths para impedir leitura fora de `MUSIC_DIR`;
- capas limitadas e cacheadas com limite de memória;
- interface responsiva baseada no protótipo Player First;
- PWA básica para instalar na tela inicial do celular.

## Estrutura

```text
home-music/
├── apps/
│   ├── web/       # React + TypeScript + Vite
│   └── server/    # Fastify + TypeScript
├── packages/
│   └── shared/    # tipos compartilhados
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

- Web autenticada: `http://localhost:5173`
- API: `http://127.0.0.1:8787` — somente local

No celular, conectado ao mesmo Wi-Fi, abra:

```text
http://IP_DO_SEU_PC:5173
```

O navegador solicitará usuário e senha antes de liberar a interface e o proxy `/api`.

Para descobrir o IP no Ubuntu:

```bash
hostname -I
```

## Segurança

- não publique as portas do Home Music diretamente na internet;
- use uma senha exclusiva no `HOME_MUSIC_PASSWORD`;
- o `.env` está ignorado pelo Git e não deve ser commitado;
- em desenvolvimento, o backend escuta somente em `127.0.0.1`;
- no Docker, a porta `8787` fica apenas na rede interna do Compose;
- arquivos simbólicos, devices, FIFOs e arquivos que escapem de `MUSIC_DIR` não são servidos;
- o endpoint de rescan remoto foi removido;
- dependências são reproduzidas por `package-lock.json` + `npm ci`;
- o CI executa audit, typecheck, testes e build.

Para acesso remoto futuro, prefira Tailscale com ACLs em vez de port-forwarding público.

## Docker

O Compose atual é voltado a desenvolvimento e expõe somente o frontend autenticado em `5173`:

```bash
docker compose up
```

A biblioteca é montada como read-only e o backend não publica `8787` no host.

## Qualidade

```bash
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

## Próximos passos

Veja [`docs/roadmap.md`](docs/roadmap.md).
