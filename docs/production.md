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

## Health e readiness

O servidor separa processo vivo de aplicação pronta:

```text
GET /health
  -> 200 { ok: true }

GET /ready
  -> 200 { ready: true }
  -> 503 { ready: false }

GET /api/health
  -> exige sessão
  -> diagnóstico detalhado
```

`/ready` só fica positivo quando:

- o frontend de produção foi preparado;
- a autenticação está configurada;
- `MUSIC_DIR` está acessível e a biblioteca pôde ser carregada/indexada.

O endpoint público não expõe contagem de músicas, horário de scan, configuração ou versão do banco. Esses detalhes ficam em `/api/health`, protegido pela sessão normal do Home Music.

## Cache do frontend

O servidor usa políticas diferentes por tipo de recurso:

- assets sob `/assets/*` com nome hashado pelo Vite: um ano + `immutable`;
- assets sem hash: cache curto com revalidação;
- `manifest.webmanifest` e favicon: cache curto com revalidação;
- `index.html` e fallback SPA: `no-store`;
- arquivo estático ausente retorna `404` em vez de cair no shell React;
- API e streaming continuam com suas próprias regras privadas.

O servidor rejeita `..`, arquivos ocultos, NUL, barras invertidas e symlinks ao resolver arquivos do build.

## Instalar como serviço systemd

O instalador usa o usuário atual, detecta o caminho real do projeto e o binário Node atual, endurece os arquivos locais, gera o build e instala `/etc/systemd/system/home-music.service`.

```bash
npm run service:install
```

O script pede `sudo` apenas para gerenciar o unit do systemd. Não execute o script inteiro como root.

Antes de iniciar o serviço ele aplica:

```text
.env                  0600
data/                  0700
data/home-music.db*    0600
```

Se já existir um Home Music ativo, ele é parado **antes** de `npm ci` e `npm run build`. Isso evita uma janela em que um processo antigo mantém `index.html` em memória enquanto o diretório `dist` já contém assets de outra versão.

Depois do build, o instalador:

- regenera o unit com os caminhos atuais;
- escapa caminhos com espaços/caracteres especiais usados pelo systemd;
- executa `daemon-reload`;
- habilita o serviço;
- executa `restart` explicitamente;
- confirma que o unit ficou ativo.

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

Faça o `git pull` normalmente e deixe a troca de build/serviço para o comando de update:

```bash
git checkout main
git pull --ff-only
npm run service:update
```

`service:update` usa o mesmo instalador em modo de atualização e exige que o unit já exista. O fluxo é:

```text
parar serviço
    ↓
npm ci
    ↓
npm run build
    ↓
validar artefatos
    ↓
regenerar unit
    ↓
daemon-reload
    ↓
restart
```

Há alguns segundos de indisponibilidade, mas não existe versão híbrida entre HTML antigo e assets novos.

Se a atualização falhar depois de o serviço ser parado, o script deixa uma mensagem explícita e mantém o serviço parado para não voltar com um build parcialmente substituído. Corrija o erro e execute `npm run service:update` novamente.

O banco `data/home-music.db` e o `.env` não são removidos pelo build.

## Shutdown durante scan

Os handlers de `SIGINT`/`SIGTERM` são registrados antes da inicialização potencialmente longa da biblioteca.

Se houver um scan em andamento quando o serviço receber `SIGTERM`, o servidor aguarda esse scan finalizar (limitado pelo timeout defensivo), e só depois fecha Fastify e SQLite. Isso evita fechar o banco enquanto o scanner ainda está persistindo o índice.

## Biblioteca em disco/volume montado

Se `MUSIC_DIR` estiver em um disco montado dinamicamente, por exemplo sob `/run/media/...`, o systemd pode iniciar o Home Music antes desse volume estar disponível. O servidor continua subindo, mas `/ready` fica `503` e a biblioteca não é marcada como pronta.

Depois de montar o volume, use uma destas opções:

```bash
sudo systemctl restart home-music
```

ou abra o app e use **Atualizar biblioteca**.

Para um servidor realmente sempre ligado, prefira um ponto de montagem estável configurado no sistema (por exemplo via `/etc/fstab`) e use esse caminho em `MUSIC_DIR`. Isso também evita que o caminho mude conforme a sessão gráfica/automount.

## Node instalado por NVM ou gerenciador semelhante

O instalador grava no unit do systemd o caminho absoluto do `node` encontrado no momento da instalação. Isso evita depender do shell/NVM durante o boot.

Se você trocar/remover a versão do Node e esse caminho deixar de existir, execute:

```bash
npm run service:update
```

O unit é regenerado com o novo caminho e o build é atualizado.

## HTTPS por proxy no futuro

O backend não confia automaticamente em `X-Forwarded-Proto` enviado pelo cliente.

Quando houver um proxy HTTPS confiável na frente do Home Music, configure explicitamente:

```env
HOME_MUSIC_COOKIE_SECURE=true
```

Assim o cookie de sessão recebe `Secure` mesmo que a conexão interna proxy → Fastify seja HTTP.

Use essa opção **somente** quando o navegador realmente acessar o site por HTTPS. Em acesso direto por `http://IP_DO_PC:8787`, deixe `false`, ou o navegador não enviará o cookie Secure.

## Smoke test de produção

Depois do build é possível validar a arquitetura completa sem tocar na biblioteca/banco reais:

```bash
npm run smoke:production
```

O smoke cria `MUSIC_DIR` e SQLite temporários, executa **`npm start`** e valida:

- `/health`;
- `/ready`;
- shell React;
- CSP/cache;
- asset real do Vite;
- manifest;
- asset inexistente = `404`;
- API sem sessão = `401`;
- login + cookie;
- `/api/health` autenticado;
- biblioteca autenticada;
- encerramento limpo por `SIGTERM`.

O CI executa esse smoke depois de `npm run build`.

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
