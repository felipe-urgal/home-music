# Home Music

Streaming pessoal das músicas do seu computador para o celular.

O MVP foi pensado para rodar no Ubuntu, ler uma pasta local de músicas e expor uma interface mobile **Player First** na rede local. Depois, o acesso remoto pode ser feito com Tailscale sem publicar o servidor diretamente na internet.

## MVP

- scanner recursivo de MP3, FLAC, WAV, M4A, AAC, OGG e OPUS;
- leitura de metadados e capas incorporadas;
- API de biblioteca;
- streaming com suporte a HTTP Range;
- player mobile com play/pause, anterior/próxima, seek e fila;
- busca por música, artista e álbum;
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
# Edite MUSIC_DIR para apontar para sua pasta real.
npm install
npm run dev
```

No computador:

- Web: `http://localhost:5173`
- API: `http://localhost:8787`

No celular, conectado ao mesmo Wi‑Fi, abra:

```text
http://IP_DO_SEU_PC:5173
```

Para descobrir o IP no Ubuntu:

```bash
hostname -I
```

> O servidor ainda não possui login. Não abra as portas 5173/8787 diretamente para a internet. Para acesso remoto, a próxima etapa recomendada é Tailscale.

## Próximos passos

Veja [`docs/roadmap.md`](docs/roadmap.md).
