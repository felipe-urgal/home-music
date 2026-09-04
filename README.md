# Home Music

Servidor pessoal de música para transformar uma pasta local do Ubuntu em uma biblioteca de streaming acessível pelo navegador, celular ou PWA.

O Home Music combina **React + TypeScript + Vite** no frontend com **Fastify + TypeScript + SQLite** no backend. Em produção existe um único processo Fastify: ele serve a API, o frontend compilado, capas e streaming de áudio pela mesma porta interna.

O projeto foi pensado para uso self-hosted: sua biblioteca continua no seu computador, o estado da aplicação fica em SQLite e o acesso remoto recomendado usa **Tailscale Serve + HTTPS**. Quando é necessário acessar sem instalar Tailscale no telefone, há também um perfil público opcional usando **Tailscale Funnel**.

> O Home Music não é um serviço de hospedagem pública de música. O perfil LAN usa HTTP e não deve ser exposto por port-forwarding. Para acesso remoto, prefira Tailscale Serve.

## Ambientes

O desenvolvimento e a produção usam configurações separadas:

```text
DEV: .env.development -> Vite :5173 + API :8788 + SQLite em data/development/
PRD: .env             -> Fastify :8787 + SQLite de produção + systemd
```

Para preparar o DEV:

```bash
cp .env.development.example .env.development
mkdir -p music-dev data/development
```

Configure `HOME_MUSIC_PASSWORD` com pelo menos 12 caracteres no primeiro start e rode:

```bash
npm run dev
```

A documentação completa da separação está em [`docs/development-environments.md`](docs/development-environments.md).

Para a documentação completa do projeto, consulte a versão anterior deste README na `main` enquanto esta alteração está em revisão.
