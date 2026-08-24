# Execução em produção

O modo de produção elimina o Vite da execução diária. O build React e a API são servidos pelo mesmo processo Fastify e pela mesma porta.

```text
Celular / navegador
        |
        | http://IP_DO_PC:8787
        v
      Fastify
      /     \
 React dist  /api
              |
          SQLite + MUSIC_DIR
```

## Execução manual

Na raiz do projeto:

```bash
npm ci
npm run build
npm start
```

`npm start` define `NODE_ENV=production`. Nesse modo:

- `apps/web/dist` é servido pelo Fastify;
- `/api` continua no mesmo processo;
- `PORT` continua definindo a porta, por padrão `8787`;
- `PRODUCTION_HOST` define a interface de rede, por padrão `0.0.0.0`;
- `HOST` continua reservado ao backend no modo de desenvolvimento.

No celular conectado à mesma LAN:

```text
http://IP_DO_PC:8787
```

O Vite em `:5173` deixa de ser necessário para uso cotidiano.

## Cache do frontend

O servidor usa políticas diferentes por tipo de recurso:

- `/assets/*`: um ano + `immutable`, pois o Vite gera nomes com hash;
- `manifest.webmanifest` e favicon: cache curto com revalidação;
- `index.html` e fallback SPA: `no-store`;
- API e streaming continuam com suas próprias regras privadas.

O servidor rejeita `..`, arquivos ocultos e symlinks ao resolver arquivos do build.

## Instalar como serviço systemd

O instalador usa o usuário atual, detecta o caminho real do projeto e o binário Node atual, executa `npm ci`, gera o build e instala `/etc/systemd/system/home-music.service`.

```bash
npm run service:install
```

O script pede `sudo` apenas para instalar/ativar o unit do systemd. Não execute o script inteiro como root.

Depois:

```bash
sudo systemctl status home-music --no-pager
journalctl -u home-music -f
```

O serviço possui:

- início automático com o Ubuntu;
- `Restart=on-failure`;
- shutdown por `SIGTERM` com fechamento do Fastify/SQLite;
- timeout de 30 segundos;
- `NoNewPrivileges` e outras restrições básicas do systemd;
- logs centralizados no journal.

## Atualizar depois de um novo merge

```bash
git checkout main
git pull --ff-only
npm ci
npm run build
sudo systemctl restart home-music
```

O banco `data/home-music.db` e o `.env` não são removidos pelo build.

## Parar ou desabilitar

Parar temporariamente:

```bash
sudo systemctl stop home-music
```

Impedir início automático:

```bash
sudo systemctl disable --now home-music
```

Para remover o unit:

```bash
sudo rm -f /etc/systemd/system/home-music.service
sudo systemctl daemon-reload
```

## Segurança

O modo de produção abre `8787` para a LAN por padrão (`PRODUCTION_HOST=0.0.0.0`) e mantém login/sessão na própria API. Isso não torna HTTP criptografado.

Não faça port-forwarding dessa porta para a internet. Para acesso fora da rede doméstica, a próxima etapa é Tailscale + HTTPS/ACL.
