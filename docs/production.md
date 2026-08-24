# Execução em produção

O modo de produção elimina o Vite da execução diária. O build React e a API são servidos pelo mesmo processo Fastify e pela mesma porta interna.

Existem dois perfis operacionais:

```text
LAN / fallback
celular -> http://IP_DO_PC:8787 -> Fastify

Tailscale / recomendado
celular -> HTTPS :443 (*.ts.net) -> Tailscale Serve -> http://127.0.0.1:8787 -> Fastify
```

No perfil Tailscale, a porta `8787` não fica exposta na LAN: o Fastify escuta somente em loopback e o único caminho remoto é HTTPS pelo tailnet.

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
- `PORT` define a porta, por padrão `8787`;
- `PRODUCTION_HOST` define a interface de rede;
- `HOST` continua reservado ao backend no modo de desenvolvimento.

Para HTTP local/LAN:

```env
PRODUCTION_HOST=0.0.0.0
HOME_MUSIC_COOKIE_SECURE=false
```

Para Tailscale Serve + HTTPS:

```env
PRODUCTION_HOST=127.0.0.1
HOME_MUSIC_COOKIE_SECURE=true
```

Não altere manualmente entre esses perfis durante o uso normal; prefira `npm run tailscale:enable` e `npm run tailscale:disable`, que fazem validação e rollback.

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

O banco `data/home-music.db`, o `.env` e a configuração persistente do Tailscale Serve não são removidos pelo build/update.

## Shutdown durante scan

Os handlers de `SIGINT`/`SIGTERM` são registrados antes da inicialização potencialmente longa da biblioteca.

Se houver um scan em andamento quando o serviço receber `SIGTERM`, o servidor aguarda esse scan finalizar (limitado pelo timeout defensivo), e só depois fecha Fastify e SQLite. Isso evita fechar o banco enquanto o scanner ainda está persistindo o índice.

## Biblioteca em disco/volume montado

Para um servidor sempre ligado, prefira um ponto de montagem estável configurado no sistema, por exemplo via `/etc/fstab`, e use esse caminho em `MUSIC_DIR`.

Se o volume não estiver disponível durante o boot, o servidor continua subindo, mas `/ready` fica `503` e a biblioteca não é marcada como pronta. Depois de montar o volume:

```bash
sudo systemctl restart home-music
```

ou use **Atualizar biblioteca** no app.

## Node instalado por NVM ou gerenciador semelhante

O instalador grava no unit do systemd o caminho absoluto do `node` encontrado no momento da instalação. Isso evita depender do shell/NVM durante o boot.

Se você trocar/remover a versão do Node e esse caminho deixar de existir, execute:

```bash
npm run service:update
```

## Tailscale + HTTPS

O perfil remoto recomendado usa **Tailscale Serve**, não Funnel.

Pré-requisitos:

- Tailscale conectado no Ubuntu e no celular;
- MagicDNS habilitado;
- HTTPS Certificates habilitado no tailnet;
- serviço `home-music.service` já instalado.

Ative com:

```bash
npm run tailscale:enable
```

O script:

- exige Tailscale 1.52+;
- obtém o nome MagicDNS da própria máquina;
- detecta conflito em HTTPS/443 e recusa sobrescrever outro Serve;
- valida o backend local antes da mudança;
- configura `tailscale serve --bg --yes --https=443 127.0.0.1:8787`;
- valida a URL HTTPS real antes de remover a exposição LAN;
- altera `PRODUCTION_HOST` para `127.0.0.1`;
- altera `HOME_MUSIC_COOKIE_SECURE` para `true`;
- reinicia o serviço;
- valida `/health` local e `/ready` via HTTPS;
- restaura `.env`/serviço/Serve se uma etapa da transição falhar.

Status:

```bash
npm run tailscale:status
tailscale serve status
```

Rollback para LAN:

```bash
npm run tailscale:disable
```

O rollback só remove a configuração de HTTPS/443 se ela corresponder exatamente ao proxy esperado do Home Music, evitando destruir um Serve não relacionado.

Detalhes completos, instalação no celular, grants e troubleshooting em [`docs/tailscale.md`](tailscale.md).

### Privacidade do certificado

O serviço permanece privado ao tailnet, porém certificados TLS públicos registram o hostname `*.ts.net` em Certificate Transparency. Use um nome de máquina não sensível antes de habilitar HTTPS.

### Controle de acesso

O login do Home Music continua obrigatório, mas o Tailscale deve ser tratado como a primeira camada de autorização de rede. Para tailnets compartilhados, use grants least-privilege e permita somente TCP/443 para o dispositivo/`tag:home-music` a partir dos usuários autorizados.

Não exponha `8787` por grant, ACL, port-forward ou Funnel.

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

O CI executa esse smoke depois de `npm run build` e também valida sintaticamente os scripts de systemd e Tailscale.

## Parar ou desabilitar o Home Music

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

Isso não remove automaticamente a configuração Tailscale Serve. Se o objetivo for desativar o acesso remoto mantendo o app em LAN, execute antes `npm run tailscale:disable`.

## Segurança

No perfil LAN, HTTP não criptografa usuário, senha ou áudio. Nunca faça port-forwarding da porta `8787`.

No perfil recomendado:

- acesso remoto somente pelo tailnet;
- HTTPS terminado pelo Tailscale Serve;
- Fastify somente em `127.0.0.1`;
- cookie de sessão `Secure`, `HttpOnly` e `SameSite=Strict`;
- autenticação do Home Music continua ativa;
- Tailscale Serve em background persiste após reboot;
- Funnel não é usado.
