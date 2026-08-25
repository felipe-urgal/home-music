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

### Produção — LAN/fallback

```text
Celular / PWA
     |
     | HTTP :8787
     v
Fastify em 0.0.0.0
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

Esse perfil é compatível com a rede local, mas HTTP não oferece confidencialidade e nunca deve ser encaminhado pela internet.

### Produção — Tailscale/HTTPS

```text
Celular / PWA com Tailscale
     |
     | HTTPS :443 (*.ts.net)
     | tailnet privado
     v
Tailscale Serve / tailscaled
     |
     | HTTP somente em loopback
     v
Fastify :8787 em 127.0.0.1
     |
     +--> React compilado
     +--> login + cookie Secure/HttpOnly
     +--> /api + Range streaming
     +--> SQLite + MUSIC_DIR
```

Esse é o perfil recomendado para uso cotidiano fora de casa. **Serve** mantém o serviço privado ao tailnet; **Funnel não é usado**.

A aplicação continua com **um processo Fastify e uma porta interna**. O Tailscale é uma camada de rede/TLS externa ao deploy da aplicação.

## Fronteira de confiança do Tailscale

No perfil remoto:

- `PRODUCTION_HOST=127.0.0.1` impede conexão direta à porta `8787` pela LAN ou pelo tailnet;
- Tailscale Serve termina TLS em `443` e faz proxy para `127.0.0.1:8787`;
- `HOME_MUSIC_COOKIE_SECURE=true` força o cookie de sessão a ser aceito/enviado somente em HTTPS;
- o backend não precisa confiar em `X-Forwarded-Proto` do cliente;
- o login próprio do Home Music permanece como segunda camada de autenticação;
- grants do Tailscale podem restringir quais identidades alcançam o servidor em TCP/443.

O setup operacional valida o HTTPS antes de trocar o bind do Fastify para loopback. Assim, um erro de certificado/Serve não deixa o usuário sem o caminho LAN anterior.

O script também detecta uso prévio de HTTPS/443 pelo Tailscale Serve e não sobrescreve uma configuração desconhecida.

## Frontend de produção

`npm run build` gera o frontend em `apps/web/dist`. Quando `NODE_ENV=production`, o Fastify valida esse diretório antes de iniciar e falha com mensagem explícita se `index.html` não existir.

O servidor estático é implementado sem dependência adicional e possui contenção própria:

- rejeita `..`, equivalentes codificados, NUL, backslashes e arquivos ocultos;
- rejeita symlinks;
- resolve `realpath` e confirma que o arquivo permanece dentro do `dist`;
- fallback SPA é usado somente para rotas válidas sem extensão;
- arquivo estático inexistente retorna `404`;
- `/api` inexistente continua retornando JSON/404, nunca o shell React.

Política de cache:

```text
/assets/* com hash     1 ano + immutable
/assets/* sem hash     cache curto + revalidate
manifest / favicon     cache curto + revalidate
index.html / SPA       no-store
```

## Ciclo de vida do processo

`HOST=127.0.0.1` continua reservado ao backend de desenvolvimento. Em produção, `PRODUCTION_HOST` define o perfil de exposição:

```text
0.0.0.0     LAN HTTP
127.0.0.1   Tailscale Serve / proxy local
```

Os handlers de `SIGTERM` e `SIGINT` são registrados antes da inicialização potencialmente longa da biblioteca.

```text
systemd / Ctrl+C
      ↓
marca shutdown
      ↓
scan em andamento?
      ├─ sim → aguarda finalizar
      └─ não
      ↓
Fastify.close()
      ↓
onClose
      ↓
SQLite.close()
      ↓
processo termina
```

Há timeout defensivo de 25 segundos. Isso evita fechar o SQLite enquanto um scan ainda está persistindo o índice.

## Liveness e readiness

Os endpoints operacionais são separados por responsabilidade:

- `/health`: público, retorna somente `{ ok: true }` e representa liveness;
- `/ready`: público, retorna apenas `{ ready: boolean }` e usa HTTP `503` quando a aplicação ainda não está pronta;
- `/api/health`: autenticado, contém diagnóstico detalhado.

Readiness exige:

- frontend preparado em produção;
- autenticação configurada;
- `MUSIC_DIR` acessível e biblioteca carregada/indexada.

Contagem de faixas, estado de scan, uptime, versão do schema e demais detalhes não são expostos no health público.

No perfil Tailscale, `/health` e `/ready` continuam sendo os probes usados pelo script para validar a transição local -> HTTPS.

## systemd e atualizações

`scripts/install-systemd.sh` detecta usuário, raiz real do repositório e binário Node em uso.

Antes de build/install ele endurece:

```text
.env                  0600
data/                  0700
data/home-music.db*    0600
```

Se o serviço estiver ativo, ele é parado antes de `npm ci` e `npm run build`. O objetivo é impedir uma versão híbrida em que um processo antigo mantenha `index.html` em memória enquanto assets do `dist` já foram substituídos.

O unit instalado em `/etc/systemd/system/home-music.service`:

- usa caminhos absolutos escapados para sintaxe systemd;
- inicia o `dist/index.js` diretamente;
- usa `Restart=on-failure`;
- envia logs ao journal;
- aplica `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem`, restrições de kernel/control groups e `UMask=0077`.

Atualizações depois de um merge usam:

```bash
git pull --ff-only
npm run service:update
```

O modo `update` exige que o serviço exista, para o processo antes do build, regenera o unit e executa `restart` explicitamente.

A configuração Tailscale Serve fica no `tailscaled` e não é recriada a cada deploy. Por isso `service:update` preserva a URL HTTPS e apenas reinicia o backend atrás dela.

## Automação Tailscale

`scripts/configure-tailscale.sh` possui três modos:

```text
enable   habilita HTTPS privado e fecha o bind LAN
disable  remove somente o Serve esperado e volta para LAN
status   mostra serviço, URL, target e perfil de .env
```

O `enable` é transacional:

```text
preflight
   ↓
backend local saudável
   ↓
Serve HTTPS/443
   ↓
HTTPS real saudável
   ↓
backup temporário do .env
   ↓
127.0.0.1 + cookie Secure
   ↓
restart systemd
   ↓
/health local + /ready HTTPS
```

Se uma etapa após o backup falhar, o `.env` anterior é restaurado. Se o próprio script tiver criado o Serve, ele também o remove. O `disable` possui rollback simétrico e recria o Serve caso a restauração do perfil LAN falhe depois de removê-lo.

Não é usado `tailscale serve reset`, porque esse comando poderia apagar configurações Serve não relacionadas ao Home Music.

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
Set-Cookie: HttpOnly; SameSite=Strict; Secure (HTTPS)
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

O backend não confia cegamente em `X-Forwarded-Proto`. No perfil Tailscale, `HOME_MUSIC_COOKIE_SECURE=true` é configurado explicitamente depois que a URL HTTPS foi validada.

## Biblioteca

A biblioteca possui duas camadas:

1. `MUSIC_DIR` é a fonte física dos arquivos;
2. SQLite mantém índice e dados pessoais.

No primeiro scan o backend processa metadados. Depois, o startup pode carregar o índice do SQLite sem reprocessar tudo.

O re-scan compara `size + mtime`: arquivos inalterados são reaproveitados, novos/modificados são processados e removidos saem do índice.

A navegação usa somente caminhos relativos a `MUSIC_DIR`; caminhos físicos não são expostos ao frontend.

Letras são opcionais e lidas sob demanda de arquivos sidecar locais com o mesmo nome-base da faixa (`.lrc` ou `.txt`). A API retorna somente linhas e timestamps normalizados, limita cada arquivo a 512 KiB, rejeita symlinks/escapes com a mesma contenção usada pelo streaming e não consulta serviços externos.

Se a raiz da biblioteca não puder ser resolvida, `libraryReady` permanece falso e `/ready` responde `503`.

## Layout mobile e fila

A superfície principal é limitada à viewport:

- containers flex/grid críticos usam `min-width: 0`;
- sem scroll horizontal global;
- abas usam grid responsivo;
- breadcrumbs rolam somente dentro do próprio componente;
- títulos longos são truncados.

A fila do player é carregada progressivamente para não renderizar uma pasta inteira de uma vez. No mobile, reordenação usa interação touch/pointer no grip, mantendo o scroll normal quando o gesto começa fora da alça.

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

O smoke test pode definir `HOME_MUSIC_DATABASE_PATH` para usar um banco temporário e nunca tocar no SQLite real do usuário.

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

Tailscale Serve apenas transporta o HTTP local pelo túnel HTTPS; Range continua chegando ao Fastify e não requer uma rota separada para streaming.

## Smoke de produção

O CI não se limita a compilar. Depois do build, `npm run smoke:production` cria uma biblioteca e um SQLite temporários, sobe **`npm start`**, valida frontend/API/login/readiness/cache e encerra o processo com `SIGTERM`.

Além disso, o CI executa `bash -n` nos scripts de systemd e Tailscale. A integração real com o tailnet é validada manualmente porque depende de certificado, identidade e policy externos ao repositório.

## Segurança

- desenvolvimento: API em `127.0.0.1`;
- produção LAN: `0.0.0.0:8787`, somente como fallback local;
- produção remota: `127.0.0.1:8787` atrás de Tailscale Serve HTTPS/443;
- Funnel e port-forwarding público não fazem parte da arquitetura;
- frontend público não contém dados pessoais;
- symlinks/FIFOs/devices/escapes da biblioteca não são servidos;
- arquivos estáticos de produção também têm contenção de path/symlink/NUL;
- erros não expõem caminhos físicos;
- health público é mínimo;
- produção aplica CSP, `nosniff`, frame denial, referrer policy, permissions policy e CORP same-origin;
- dependências são reproduzíveis via lockfile + `npm ci`;
- systemd adiciona hardening do processo e permissões dos arquivos locais;
- Tailscale grants são a camada recomendada de least-privilege para tailnets compartilhados.

## Transcoding

Arquivos ainda são entregues no formato original. FFmpeg/transcoding adaptativo permanece para etapa posterior, principalmente para FLAC/WAV em redes móveis.
