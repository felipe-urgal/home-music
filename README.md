# Home Music

Servidor pessoal de música para transformar uma pasta local do Ubuntu em uma biblioteca de streaming acessível pelo navegador, celular ou PWA.

O Home Music combina **React + TypeScript + Vite** no frontend com **Fastify + TypeScript + SQLite** no backend. Em produção existe um único processo Fastify: ele serve a API, o frontend compilado, capas e streaming de áudio pela mesma porta interna.

O projeto foi pensado para uso self-hosted: sua biblioteca continua no seu computador, o estado da aplicação fica em SQLite e o acesso remoto recomendado usa **Tailscale Serve + HTTPS**. Quando é necessário acessar sem instalar Tailscale no telefone, há também um perfil público opcional usando **Tailscale Funnel**.

> O Home Music não é um serviço de hospedagem pública de música. O perfil LAN usa HTTP e não deve ser exposto por port-forwarding. Para acesso remoto, prefira Tailscale Serve.

## Sumário

- [Visão geral](#visão-geral)
- [Principais recursos](#principais-recursos)
- [Arquitetura](#arquitetura)
- [Requisitos](#requisitos)
- [Instalação rápida](#instalação-rápida)
- [Configuração do ambiente](#configuração-do-ambiente)
- [Primeiro administrador e autenticação](#primeiro-administrador-e-autenticação)
- [Desenvolvimento](#desenvolvimento)
- [Produção](#produção)
- [Serviço systemd](#serviço-systemd)
- [Atualização segura](#atualização-segura)
- [Acesso remoto com Tailscale](#acesso-remoto-com-tailscale)
- [Biblioteca e scanner](#biblioteca-e-scanner)
- [Integridade da biblioteca](#integridade-da-biblioteca)
- [Importação de mídia](#importação-de-mídia)
- [Administração](#administração)
- [Minha conta](#minha-conta)
- [Player e reprodução](#player-e-reprodução)
- [Downloads offline e PWA](#downloads-offline-e-pwa)
- [FFmpeg, compatibilidade e ReplayGain](#ffmpeg-compatibilidade-e-replaygain)
- [Persistência](#persistência)
- [Backup e restore](#backup-e-restore)
- [Health checks](#health-checks)
- [Segurança](#segurança)
- [Comandos úteis](#comandos-úteis)
- [Testes e CI](#testes-e-ci)
- [Troubleshooting](#troubleshooting)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Documentação complementar](#documentação-complementar)

## Visão geral

Fluxo de produção em uma instalação local:

```text
Navegador / celular / PWA
          |
          | HTTP ou HTTPS
          v
       Fastify
          |
          +--> React compilado
          +--> autenticação e sessões
          +--> API
          +--> streaming HTTP Range
          +--> scanner / indexação
          +--> importação de mídia
          +--> administração
          +--> SQLite
          |
          v
      MUSIC_DIR
```

Em desenvolvimento, o Vite roda separado apenas para HMR:

```text
Navegador
   |
   v
Vite :5173
   |
   | /api via proxy
   v
Fastify :8787 em 127.0.0.1
```

Em produção, o Vite não fica em execução. `npm run build` gera `apps/web/dist` e o Fastify serve essa build junto da API.

## Principais recursos

### Biblioteca

- scanner recursivo de `MP3`, `FLAC`, `WAV`, `M4A`, `AAC`, `OGG` e `OPUS`;
- navegação por pastas e subpastas;
- artistas, álbuns e faixas;
- favoritos;
- playlists;
- histórico e estatísticas pessoais;
- busca por música, artista, álbum e pasta, ignorando acentos;
- leitura de metadados incorporados;
- leitura e cache de capas incorporadas;
- scanner incremental por `size + mtime`;
- atualização automática opcional da biblioteca;
- tolerância a subpastas temporariamente inacessíveis;
- letras locais em `.lrc` ou `.txt`;
- gerenciamento administrativo de disponibilidade, metadados e lixeira;
- diagnóstico de saúde e integridade da biblioteca.

### Player

- play/pause;
- anterior/próxima;
- seek;
- fila contextual;
- reordenação da fila por mouse, teclado ou touch;
- shuffle;
- repeat `off`, `all` e `one`;
- restauração de faixa, posição e estado do player;
- mini-player persistente;
- Media Session para controles do sistema/tela bloqueada;
- qualidade original, automática, economia e seleção por conexão;
- fallback de compatibilidade via FFmpeg;
- normalização ReplayGain por faixa ou álbum;
- downloads offline no navegador/PWA.

### Contas e segurança

- múltiplas contas persistidas no SQLite;
- papéis `admin` e `user`;
- senha armazenada como hash, nunca em claro no banco;
- cookie de sessão `HttpOnly` + `SameSite=Strict`;
- `Secure` nos perfis HTTPS;
- troca obrigatória de senha temporária;
- alteração da própria senha;
- gerenciamento das próprias sessões;
- logout explícito;
- revogação de outras sessões sem encerrar o dispositivo atual;
- rate limit no login;
- ações administrativas protegidas por role;
- mutações protegidas também pelo header `X-Home-Music-Request: 1`.

### Administração

A área **Minha conta → Administração** oferece hoje:

- visão geral da biblioteca;
- quantidade de faixas indexadas;
- espaço usado pela biblioteca física;
- tamanho do SQLite;
- estado do scanner;
- cache de transcoding;
- problemas de qualidade de metadados;
- gerenciamento de músicas;
- edição de metadados sem alterar o áudio original;
- integridade da biblioteca;
- lixeira/quarentena;
- importação de mídia;
- histórico operacional de scans e importações;
- gerenciamento de usuários, papéis, acesso e sessões.

## Arquitetura

O monorepo usa npm workspaces:

```text
home-music/
├── apps/
│   ├── web/        React + TypeScript + Vite
│   └── server/     Fastify + TypeScript + SQLite
├── packages/
│   └── shared/     contratos e tipos compartilhados
├── data/           SQLite e estado local derivado
├── scripts/        operação, systemd, Tailscale e smoke tests
├── docs/           documentação técnica detalhada
├── .env.example
└── package.json
```

### Fronteiras principais

- `MUSIC_DIR` é a fonte física da biblioteca;
- SQLite mantém índice, contas e estado persistente;
- sessões autenticadas ficam em memória no processo;
- arquivos de áudio originais não são alterados pelo scanner ou pelo player;
- metadados administrativos usam overrides persistidos, preservando os arquivos originais;
- transcoding gera arquivos derivados em cache;
- importações passam por staging antes de entrar em `MUSIC_DIR`.

Mais detalhes: [`docs/architecture.md`](docs/architecture.md).

## Requisitos

Obrigatórios:

- Ubuntu/Linux para o fluxo operacional suportado;
- Node.js **22 ou superior**;
- npm;
- uma pasta local contendo a biblioteca de áudio.

Recomendados:

- FFmpeg + FFprobe para compatibilidade, transcoding e validação técnica completa;
- Tailscale para acesso remoto seguro;
- `yt-dlp` se você quiser usar importação por YouTube/YouTube Music.

Confira as versões instaladas:

```bash
node --version
npm --version
ffmpeg -version
ffprobe -version
```

Para verificar a integração FFmpeg pelo próprio projeto:

```bash
npm run ffmpeg:status
```

## Instalação rápida

Clone o projeto e instale dependências:

```bash
git clone https://github.com/felipe-urgal/home-music.git
cd home-music
npm ci
```

Crie o arquivo de configuração:

```bash
cp .env.example .env
```

Edite pelo menos:

```env
MUSIC_DIR="/caminho/para/suas/musicas"
HOME_MUSIC_USER=home-music
HOME_MUSIC_PASSWORD=uma-senha-exclusiva-com-12-ou-mais-caracteres
HOME_MUSIC_COOKIE_SECURE=false
PORT=8787
HOST=127.0.0.1
PRODUCTION_HOST=0.0.0.0
```

Para desenvolvimento:

```bash
npm run dev
```

Para produção local:

```bash
npm run build
npm start
```

Para instalar como serviço do Ubuntu:

```bash
npm run service:install
```

## Configuração do ambiente

Use `.env.example` como referência principal. As variáveis carregadas pela aplicação a partir do `.env` são:

| Variável | Finalidade | Padrão / observação |
| --- | --- | --- |
| `MUSIC_DIR` | Raiz física da biblioteca | obrigatória |
| `HOME_MUSIC_DATABASE_PATH` | Caminho do SQLite principal | `data/home-music.db` quando omitida |
| `HOME_MUSIC_IMPORT_STAGING_DIR` | Staging temporário de importações | `data/import-staging` quando omitida |
| `HOME_MUSIC_IMPORT_STAGING_TTL_HOURS` | TTL dos workspaces órfãos do staging | `24`, faixa `1..720` horas |
| `HOME_MUSIC_IMPORT_UPLOAD_MAX_MB` | Limite de upload por arquivo | `512`, faixa `1..8192` MB |
| `HOME_MUSIC_IMPORT_URL_MAX_MB` | Limite de download por URL direta | `512`, faixa `1..8192` MB |
| `HOME_MUSIC_IMPORT_URL_TIMEOUT_SECONDS` | Timeout total de importação por URL | `120`, faixa `5..900` s |
| `HOME_MUSIC_IMPORT_URL_MAX_REDIRECTS` | Máximo de redirects seguidos | `3`, faixa `0..10` |
| `HOME_MUSIC_YT_DLP_PATH` | Caminho customizado do `yt-dlp` | autodetectado quando omitido |
| `HOME_MUSIC_EXTERNAL_PROVIDER_SCRATCH_DIR` | Scratch dos providers externos | `data/provider-scratch` quando omitida |
| `HOME_MUSIC_RESCAN_INTERVAL_SECONDS` | Re-scan automático | `0` desativa; para habilitar use `60..86400` |
| `HOME_MUSIC_FFMPEG_PATH` | Executável FFmpeg | `ffmpeg` no `PATH` |
| `HOME_MUSIC_FFPROBE_PATH` | Executável FFprobe | `ffprobe` no `PATH` ou irmão do FFmpeg configurado |
| `HOME_MUSIC_TRANSCODE_CACHE_MB` | Limite do cache de transcoding | `512`, faixa `64..8192` MB |
| `HOME_MUSIC_USER` | Username somente do primeiro bootstrap | remover após validar o primeiro admin |
| `HOME_MUSIC_PASSWORD` | Senha somente do primeiro bootstrap | remover junto com `HOME_MUSIC_USER` |
| `HOME_MUSIC_COOKIE_SECURE` | Cookie somente HTTPS | `false` na LAN; scripts Tailscale gerenciam o modo HTTPS |
| `HOME_MUSIC_TRUST_TAILSCALE_PROXY` | Confiança restrita no proxy Tailscale | não habilitar manualmente para proxy genérico |
| `PORT` | Porta interna do backend | `8787` |
| `HOST` | Bind do backend em desenvolvimento | `127.0.0.1` |
| `VITE_PROXY_TARGET` | Destino do proxy `/api` do Vite | `http://127.0.0.1:8787`; Compose usa `http://server:8787` |
| `PRODUCTION_HOST` | Bind de produção | `0.0.0.0` na LAN; `127.0.0.1` atrás do Tailscale |

Os overrides de `npm run prod:verify` são variáveis de processo e ficam documentados separadamente em [`docs/production-verification.md`](docs/production-verification.md); eles não fazem parte da configuração persistente do `.env.example`.

### Regras importantes para diretórios de importação

O staging deve ficar **fora de `MUSIC_DIR`**. Para a promoção atômica/no-clobber, mantenha staging e biblioteca no mesmo filesystem sempre que possível.

Exemplo:

```env
MUSIC_DIR=/mnt/media/musicas
HOME_MUSIC_IMPORT_STAGING_DIR=/mnt/media/.home-music-import-staging
```

## Primeiro administrador e autenticação

`HOME_MUSIC_USER` e `HOME_MUSIC_PASSWORD` têm uma função específica: **bootstrap do primeiro administrador**.

Fluxo recomendado:

1. configure as duas variáveis antes do primeiro start;
2. inicie o Home Music;
3. confirme que o usuário administrador foi criado e que o login funciona;
4. confirme que a tabela `users` já contém a conta persistida;
5. remova `HOME_MUSIC_USER` e `HOME_MUSIC_PASSWORD` do `.env`;
6. reinicie o serviço;
7. faça login novamente para confirmar a autenticação persistida no SQLite.

Em uma instalação systemd:

```bash
npm run service:update
npm run service:status
curl -i http://127.0.0.1:8787/ready
```

Depois de validar o login, remova as credenciais de bootstrap e execute:

```bash
sudo systemctl restart home-music
npm run service:status
curl -i http://127.0.0.1:8787/ready
```

> Não deixe credenciais de bootstrap no `.env` sem necessidade. Logins normais usam as contas e hashes persistidos no SQLite.

### Recuperação local de administrador

Se todas as credenciais administrativas forem perdidas, a recuperação exige acesso local ao Ubuntu e uma conta **já existente**:

```bash
sudo systemctl stop home-music
npm run admin:recover -- --username <usuario-existente> --confirm-service-stopped
sudo systemctl start home-music
```

O comando:

- recusa execução enquanto `home-music.service` estiver ativo;
- não cria uma nova conta;
- reativa/promove a conta indicada para `admin`;
- gera senha temporária aleatória;
- exige troca de senha no próximo login.

Veja [`docs/phase-7.5-remove-env-auth-recovery.md`](docs/phase-7.5-remove-env-auth-recovery.md).

## Desenvolvimento

Instale dependências reproduzíveis:

```bash
npm ci
```

Inicie frontend e backend juntos:

```bash
npm run dev
```

Endereços padrão:

```text
Web / Vite: http://localhost:5173
API:        http://127.0.0.1:8787
```

O Vite faz proxy de `/api` para o backend local. Se o backend estiver em outro endereço, configure `VITE_PROXY_TARGET` no `.env`.

Para testar no celular pela mesma LAN durante o desenvolvimento, abra:

```text
http://IP_DO_PC:5173
```

Descubra o IP local com:

```bash
hostname -I
```

## Produção

Build manual:

```bash
npm ci
npm run build
npm start
```

No perfil LAN, o acesso padrão é:

```text
http://IP_DO_PC:8787
```

Em produção:

- React é servido a partir de `apps/web/dist`;
- `/api/*` e frontend compartilham a mesma origem;
- o Vite não fica rodando;
- `index.html` usa política `no-store`;
- assets hashados podem usar cache imutável;
- arquivos estáticos inexistentes retornam `404`;
- rotas `/api` inválidas continuam sendo API/JSON, não fallback SPA.

Veja [`docs/production.md`](docs/production.md).

## Serviço systemd

Depois de configurar `.env`:

```bash
npm run service:install
```

O instalador:

- restringe `.env` para `0600`;
- restringe `data/` para `0700`;
- endurece os arquivos SQLite para `0600`;
- para o serviço existente antes de alterar dependências/build;
- executa `npm ci`;
- executa `npm run build`;
- valida os artefatos produzidos;
- gera `/etc/systemd/system/home-music.service`;
- usa o binário Node atual diretamente;
- executa `systemctl daemon-reload`;
- habilita início automático;
- reinicia o serviço com o build novo;
- confirma que a unidade terminou em estado ativo;
- aplica hardening do processo systemd.

Comandos úteis:

```bash
npm run service:status
sudo systemctl restart home-music
journalctl -u home-music -f
```

Para ver as linhas completas do status:

```bash
sudo systemctl status home-music --no-pager -l
```

## Atualização segura

Depois de um merge no `main`:

```bash
git switch main
git pull --ff-only origin main
npm run service:update
```

O `service:update` para o Home Music antes de `npm ci` e do build. Isso evita servir um processo antigo ao mesmo tempo em que `apps/web/dist` está sendo substituído.

Ao final, valide:

```bash
npm run service:status
curl -i http://127.0.0.1:8787/ready
```

Esperado:

```text
Active: active (running)
HTTP/1.1 200 OK
{"ready":true}
```

Configurações persistentes de Tailscale ficam no `tailscaled` e não são apagadas por `service:update`.

## Acesso remoto com Tailscale

### Opção recomendada: Tailscale Serve

Use quando o celular/computador cliente também pode participar do seu tailnet.

```text
Cliente com Tailscale
        |
        | HTTPS :443 (*.ts.net)
        v
  Tailscale Serve
        |
        | HTTP em loopback
        v
Fastify 127.0.0.1:8787
```

Ative:

```bash
npm run tailscale:enable
```

Consulte o estado:

```bash
npm run tailscale:status
```

Volte para HTTP/LAN:

```bash
npm run tailscale:disable
```

O script faz preflight, valida o backend, valida HTTPS, restringe o Fastify a loopback, habilita cookie `Secure` e possui rollback em caso de falha.

Guia: [`docs/tailscale.md`](docs/tailscale.md).

### Opção pública: Tailscale Funnel

Use somente quando você precisa acessar pelo navegador comum em Wi-Fi/4G/5G **sem instalar Tailscale no dispositivo cliente**.

Ative:

```bash
npm run tailscale:public:enable
```

Status:

```bash
npm run tailscale:public:status
```

Remova a exposição pública e volte para o perfil privado:

```bash
npm run tailscale:public:disable
```

O perfil Funnel:

- publica a URL `*.ts.net` na internet;
- mantém o backend real em loopback;
- mantém a autenticação própria do Home Music;
- habilita cookie `Secure`;
- valida a configuração antes de concluir;
- exige confirmação administrativa no fluxo operacional;
- executa rollback quando uma transição falha.

> Funnel torna a **tela de login** publicamente alcançável. Use senha exclusiva e forte. Nunca publique `8787` diretamente como substituto.

Guias:

- [`docs/public-access.md`](docs/public-access.md)
- [`docs/tailscale-funnel-troubleshooting.md`](docs/tailscale-funnel-troubleshooting.md)
- [`docs/tailscale-hardening.md`](docs/tailscale-hardening.md)

## Biblioteca e scanner

O scanner considera `MUSIC_DIR` a fonte de verdade física.

No primeiro scan:

1. percorre a biblioteca;
2. valida paths e tipos de arquivo;
3. lê metadata;
4. identifica faixas;
5. persiste o índice no SQLite;
6. publica o snapshot em memória.

Nos scans seguintes, usa `size + mtime` para evitar trabalho desnecessário:

```text
arquivo igual       -> reutiliza índice
arquivo novo        -> indexa
arquivo alterado    -> reprocessa
arquivo removido    -> reconcilia e remove do índice
```

### Atualizar biblioteca

A ação **Atualizar biblioteca** chama:

```text
POST /api/library/scan
```

Ela é uma operação de reconciliação real. Se um arquivo indexado foi fisicamente removido de `MUSIC_DIR`, o scan normal pode remover o registro correspondente do índice.

### Re-scan automático

Configure:

```env
HOME_MUSIC_RESCAN_INTERVAL_SECONDS=300
```

Valores válidos: `60..86400`. `0` desativa.

## Integridade da biblioteca

A tela **Administração → Integridade da biblioteca** existe para diagnosticar divergências sem modificar a biblioteca.

Ela classifica:

- falha de scanner;
- falha de media probe/FFprobe;
- registro indexado cujo arquivo não existe mais;
- arquivo encontrado em `MUSIC_DIR` que ainda não está no índice.

A ação **Verificar agora** executa uma auditoria dedicada e **read-only**.

Diferença importante:

| Ação | Objetivo | Pode reconciliar/remover registro do índice? |
| --- | --- | --- |
| **Verificar agora** em Integridade | diagnosticar | **não** |
| **Atualizar biblioteca** / scan normal | reconciliar biblioteca | **sim** |

A auditoria de integridade não remove arquivos nem registros automaticamente. Ela mostra o snapshot da última verificação, data/hora e inconsistências encontradas para revisão manual.

## Importação de mídia

A área **Administração → Importar mídia** centraliza três origens:

- YouTube / YouTube Music por provider externo;
- arquivo local enviado pelo navegador;
- URL direta HTTP/HTTPS para arquivo de áudio.

### Pipeline

O fluxo geral é:

```text
origem
  ↓
staging / scratch
  ↓
validação técnica
  ↓
decisão de mídia
  ↓
preview de metadata
  ↓
detecção de duplicatas
  ↓
escolha de destino
  ↓
promoção segura para MUSIC_DIR
  ↓
indexação incremental
  ↓
job concluído
```

### Validação técnica

A importação inspeciona o arquivo antes da promoção. Dependendo da origem e do formato, o pipeline pode:

- preservar o original;
- remuxar;
- transcodificar para um formato de compatibilidade/economia.

FFprobe é usado para inspeção técnica quando disponível/configurado.

### Metadata

Antes de concluir a importação, o fluxo mantém um preview com valores:

- incorporados no arquivo;
- fornecidos pelo provider quando houver;
- editados pelo administrador;
- efetivamente selecionados para a importação.

### Duplicatas

A promoção possui gate de duplicatas. Casos exatos são bloqueados; casos prováveis exigem revisão explícita; casos possíveis podem gerar aviso.

Veja [`docs/import-duplicate-detection.md`](docs/import-duplicate-detection.md).

### Destino seguro

Pasta padrão:

```text
Importados
```

Também é possível escolher uma pasta relativa dentro de `MUSIC_DIR`.

A promoção:

- nunca sobrescreve arquivo existente;
- sanitiza nome de artista/título;
- bloqueia path traversal;
- recusa symlinks inseguros;
- confina o destino a `MUSIC_DIR`;
- escolhe nomes alternativos como `(2)`, `(3)`, ... em caso de colisão.

Veja [`docs/import-safe-destination.md`](docs/import-safe-destination.md).

### Atualização incremental depois da importação

Depois que a mídia entra em `MUSIC_DIR`, o Home Music tenta indexar somente o arquivo recém-promovido, usando o mesmo lock de mutação da biblioteca. Se isso não for possível, pode cair para um scan completo seguro.

Veja [`docs/import-incremental-library-update.md`](docs/import-incremental-library-update.md).

### yt-dlp

O provider externo procura `yt-dlp` automaticamente em locais comuns. Configure `HOME_MUSIC_YT_DLP_PATH` somente quando o executável estiver em outro caminho.

Detalhes: [`docs/yt-dlp-provider.md`](docs/yt-dlp-provider.md).

## Administração

### Visão geral

Mostra:

- total de faixas;
- tamanho da biblioteca física;
- tamanho do SQLite;
- quantidade de problemas de qualidade;
- estado e data do scanner;
- configuração do re-scan automático;
- estado da última verificação de integridade;
- tamanho e limite do cache de transcoding;
- transcodings ativos/pendentes.

### Qualidade da biblioteca

Os indicadores atuais incluem:

- sem título;
- sem capa;
- artista desconhecido;
- álbum desconhecido;
- duração indisponível.

Ao clicar em um problema com ocorrências, a tela de Metadados abre filtrada para as faixas afetadas.

### Gerenciar músicas

Permite desativar/reativar faixas e usar operações de movimentação/lixeira com confirmação adequada.

### Metadados

Permite corrigir texto e capa usando overrides persistidos. O áudio original permanece intacto.

Documentação:

- [`docs/admin-metadata-overrides.md`](docs/admin-metadata-overrides.md)
- [`docs/admin-cover-overrides.md`](docs/admin-cover-overrides.md)

### Lixeira

A lixeira/quarentena separa remoção lógica/operacional da exclusão física permanente. O objetivo é tornar ações destrutivas explícitas e recuperáveis quando possível.

### Cache de transcoding

O cache contém somente arquivos derivados. A ação de limpar cache não altera as músicas originais e fica bloqueada quando há condições inseguras, como transcoding relevante em andamento.

Veja [`docs/admin-transcode-cache.md`](docs/admin-transcode-cache.md).

### Histórico operacional

Registra scans e importações para análise posterior, incluindo estado, duração, contagens e falhas acionáveis.

Veja [`docs/admin-operation-history.md`](docs/admin-operation-history.md).

### Usuários

Administradores podem criar e gerenciar contas, papéis, acesso, resets de senha e sessões. Senhas temporárias podem exigir troca no próximo login.

## Minha conta

A área **Minha conta** reúne fluxos pessoais e preferências.

### Perfil

Mostra somente dados que realmente existem no modelo atual:

- nome de usuário;
- tipo de conta (`Administrador` ou `Usuário`);
- estado da sessão atual.

### Alterar senha

A regra atual exige pelo menos **12 caracteres**. Também valida que:

- a senha nova não seja somente espaços;
- seja diferente da senha atual;
- a confirmação seja idêntica.

Ao alterar a senha, as sessões da conta são encerradas por segurança e o usuário precisa entrar novamente com a nova credencial.

### Outros dispositivos

Lista as sessões ativas da conta. Para cada sessão o backend fornece:

- identificador da sessão;
- se é a sessão atual;
- data de criação;
- última atividade;
- data de expiração.

É possível:

- encerrar uma sessão específica;
- encerrar todas as outras sessões preservando o dispositivo atual.

As sessões são mantidas em memória; reiniciar o processo encerra as sessões existentes.

### Reprodução

Preferências por dispositivo:

**Qualidade**

- Por conexão — Wi-Fi automático e economia em rede móvel;
- Automática — original com fallback de compatibilidade;
- Original — sem conversão;
- Economia — AAC 96 kbps.

**Normalização**

- Desativada;
- Por faixa;
- Por álbum.

Quando a faixa atual não possui ReplayGain necessário, a UI informa que a preferência não pode ser aplicada àquela faixa.

## Player e reprodução

### Streaming original

Quando possível, o Home Music entrega diretamente o arquivo original.

A rota de streaming suporta HTTP Range para seek:

```text
GET /api/tracks/:id/stream
```

O servidor resolve a faixa pelo ID indexado e revalida o arquivo antes de abri-lo.

### Autoplay

Navegadores móveis podem bloquear `audio.play()` sem interação do usuário. Nessa situação o Home Music preserva faixa/posição/intenção e aguarda um toque em Play.

### Volume mobile

Em dispositivos nos quais o volume é controlado pelo sistema, o elemento de áudio usa volume efetivo `1.0` e os botões físicos do dispositivo controlam o nível final. A preferência de volume do desktop continua preservada.

### Letras locais

Coloque a letra ao lado do áudio com o mesmo nome-base:

```text
Minha música.flac
Minha música.lrc
```

Também são aceitos:

```text
Minha música.flac.lrc
Minha música.txt
```

- `.lrc` com timestamps acompanha a reprodução;
- `.txt` é exibido como texto simples;
- leitura limitada a 512 KiB;
- nenhuma letra é enviada para serviço externo.

## Downloads offline e PWA

O frontend possui downloads offline armazenados no Cache Storage do navegador.

Características importantes:

- scheduler global com até **3 downloads simultâneos**;
- jobs continuam enquanto você navega dentro da SPA;
- downloads concluídos ficam associados ao usuário que os criou;
- cache e manifesto são separados por `userId`;
- troca de conta não reutiliza downloads privados da conta anterior;
- conteúdo autenticado normal de `/api/*` não entra no cache estático da PWA.

Limite atual: continuidade em background/tela bloqueada depende da plataforma. Fechar aba, recarregar ou o sistema suspender JavaScript pode interromper um download ainda não concluído.

Veja:

- [`docs/offline-downloads.md`](docs/offline-downloads.md)
- [`docs/pwa.md`](docs/pwa.md)

## FFmpeg, compatibilidade e ReplayGain

O streaming original é o caminho preferencial. FFmpeg entra quando necessário para:

- modo Economia;
- compatibilidade com o navegador;
- normalização ReplayGain;
- pipeline de importação/transcoding.

### Cache de transcoding

Configure:

```env
HOME_MUSIC_TRANSCODE_CACHE_MB=512
```

O cache é derivado e recriável. Não faz parte do backup de estado e pode ser limpo pela Administração.

### ReplayGain

Modos:

- `off`: sem ajuste;
- `track`: ganho da faixa;
- `album`: ganho do álbum com fallback para faixa.

O ganho vem do índice do servidor, não de um valor arbitrário enviado pelo cliente. O arquivo original nunca é modificado.

Detalhes: [`docs/ffmpeg.md`](docs/ffmpeg.md).

## Persistência

O banco padrão fica em:

```text
data/home-music.db
```

O caminho pode ser sobrescrito por `HOME_MUSIC_DATABASE_PATH`; servidor, bootstrap, backup/restore e recuperação local usam a mesma configuração.

SQLite armazena, entre outros dados:

- usuários e hashes de senha;
- índice da biblioteca;
- favoritos;
- histórico;
- playlists;
- estado do player;
- fila e ordem base;
- volume;
- shuffle/repeat;
- metadata/overrides administrativos;
- histórico e estado operacional necessário às funcionalidades atuais.

O schema usa migrations versionadas via `PRAGMA user_version`.

### O que não é persistido no SQLite

Tokens de sessão autenticada ficam em memória. Por isso um restart do serviço revoga as sessões existentes.

### Arquivos derivados

Além do SQLite, a instalação pode ter:

- cache de transcoding;
- staging de importação;
- scratch de providers;
- backups criados pelo CLI.

Esses diretórios têm finalidades diferentes e não substituem `MUSIC_DIR`.

## Backup e restore

### Criar backup

Pode ser feito com o serviço ativo:

```bash
npm run backup:create
```

Destino customizado:

```bash
npm run backup:create -- --output /mnt/backup/home-music
```

O artefato contém:

```text
home-music-....backup/
├── home-music.db
└── manifest.json
```

O snapshot usa a Online Backup API do SQLite, valida `PRAGMA integrity_check`, tamanho, SHA-256 e schema antes de ser considerado concluído.

### Verificar backup

```bash
npm run backup:verify -- --artifact backups/home-music-....backup
```

### Restaurar

Restore é offline:

```bash
sudo systemctl stop home-music
npm run backup:restore -- --artifact /caminho/home-music-....backup --confirm-service-stopped
sudo systemctl start home-music
npm run service:status
curl -i http://127.0.0.1:8787/ready
```

O restore:

- valida o backup antes de tocar no banco atual;
- prepara cópia temporária;
- cria snapshot de rollback do estado atual;
- troca o SQLite somente depois das validações;
- tenta rollback automático se algo falhar depois da troca.

### O backup não inclui

- os arquivos de áudio de `MUSIC_DIR`;
- cache de transcoding;
- `.env` completo;
- senhas em claro;
- sessões em memória;
- build/binários da aplicação.

Mantenha backup independente da sua biblioteca de áudio.

Guia completo: [`docs/backup-restore.md`](docs/backup-restore.md).

## Health checks

### Liveness

```text
GET /health
```

Público e mínimo. Indica que o processo HTTP está vivo.

### Readiness

```text
GET /ready
```

Público e mínimo.

- `200` quando a aplicação está pronta;
- `503` quando frontend/autenticação/biblioteca ainda não estão prontos.

Resposta saudável:

```json
{"ready":true}
```

### Diagnóstico autenticado

```text
GET /api/health
```

Exige sessão e pode expor diagnóstico detalhado de modo, uptime, scanner, SQLite, biblioteca e frontend.

## Segurança

Princípios operacionais do projeto:

- não exponha `8787` diretamente à internet;
- não use port-forwarding como forma de acesso remoto;
- prefira Tailscale Serve;
- use Funnel somente quando aceitar conscientemente uma tela de login pública;
- use senha exclusiva para cada conta;
- remova credenciais de bootstrap depois da criação validada do primeiro admin;
- `.env` não deve entrar no Git;
- o instalador systemd força permissões restritas;
- em desenvolvimento a API fica em `127.0.0.1`;
- em HTTPS/Tailscale o Fastify fica em loopback;
- `/api/*` exige autenticação salvo endpoints públicos explicitamente definidos;
- mutações exigem sessão e header anti-CSRF da aplicação;
- login possui rate limit;
- cookies são `HttpOnly` e `SameSite=Strict`;
- cookies recebem `Secure` no perfil HTTPS;
- o backend não confia cegamente em `X-Forwarded-Proto`/headers de proxy;
- streaming aceita somente IDs indexados e revalida confinamento;
- paths físicos da biblioteca não são enviados ao frontend;
- symlinks, FIFOs, devices e escapes de `MUSIC_DIR` são bloqueados nas superfícies sensíveis;
- arquivos estáticos de produção rejeitam traversal, NUL, ocultos e symlinks;
- CSP, `nosniff`, frame denial, referrer policy, permissions policy e CORP são aplicados em produção;
- ações administrativas perigosas exigem confirmação e são separadas de diagnósticos read-only;
- dependências são instaladas de forma reproduzível via `npm ci` e lockfile.

### HTTP na LAN

HTTP local não criptografa credenciais nem áudio. Use apenas em rede confiável. Para acesso fora de casa, use HTTPS via Tailscale.

## Comandos úteis

| Comando | Uso |
| --- | --- |
| `npm run dev` | backend + frontend em desenvolvimento |
| `npm run build` | build compartilhado + servidor + frontend |
| `npm start` | servidor de produção |
| `npm run typecheck` | TypeScript de todos os workspaces |
| `npm run test:security` | regressões negativas dedicadas de segurança |
| `npm test` | testes server + web |
| `npm run benchmark:large-library` | guard de regressão grave com biblioteca sintética grande |
| `npm run e2e` | build + suíte E2E completa |
| `npm run smoke:production` | smoke real de produção e autenticação |
| `npm run smoke:backup-restore` | valida fluxo de backup/restore |
| `npm run service:install` | instalar/gerar serviço systemd |
| `npm run service:update` | atualização segura do serviço |
| `npm run service:status` | status systemd |
| `npm run admin:recover -- --username USER --confirm-service-stopped` | recuperação local de admin |
| `npm run backup:create` | criar snapshot SQLite consistente |
| `npm run backup:verify -- --artifact PATH` | verificar backup |
| `npm run backup:restore -- --artifact PATH --confirm-service-stopped` | restaurar backup offline |
| `npm run tailscale:enable` | ativar perfil privado HTTPS |
| `npm run tailscale:status` | verificar perfil privado |
| `npm run tailscale:disable` | voltar à LAN |
| `npm run tailscale:public:enable` | ativar Funnel público |
| `npm run tailscale:public:status` | verificar Funnel |
| `npm run tailscale:public:disable` | remover Funnel e voltar ao privado |
| `npm run tailscale:hardening:status` | revisar hardening Tailscale |
| `npm run ffmpeg:status` | verificar FFmpeg/FFprobe |

## Testes e CI

Validação local recomendada antes de merge/deploy:

```bash
npm run typecheck
npm run test:security
npm test
npm run benchmark:large-library
npm run build
npm run smoke:production
```

Outras validações relevantes:

```bash
npm run smoke:backup-restore
npm run e2e
npm audit --audit-level=high
```

O CI obrigatório executa, no mesmo job de validação:

- `npm ci`;
- audit de dependências;
- typecheck;
- regressões negativas dedicadas de segurança;
- testes funcionais server/web;
- guard de performance com biblioteca sintética grande;
- smoke de backup/restore;
- validação dos scripts operacionais;
- teste de startup systemd;
- testes operacionais de Tailscale;
- build;
- Playwright crítico em mobile/tablet/desktop;
- smoke real de produção e autenticação.

O smoke de produção, a suíte de segurança e o benchmark usam fixtures/diretórios controlados e não devem tocar na biblioteca/SQLite reais do usuário. O benchmark possui limites deliberadamente largos para regressões graves; não é SLA de produto.

Detalhes dos gates: [`docs/security-regressions.md`](docs/security-regressions.md), [`docs/large-library-benchmark.md`](docs/large-library-benchmark.md) e [`e2e/README.md`](e2e/README.md).

## Troubleshooting

### Serviço não inicia depois de um update

```bash
sudo systemctl status home-music --no-pager -l
journalctl -u home-music -n 100 --no-pager
```

Depois de corrigir o erro:

```bash
npm run service:update
```

### `/ready` retorna 503

Verifique:

- `MUSIC_DIR` existe e está acessível;
- o usuário do serviço possui permissão de leitura;
- frontend foi compilado em produção;
- autenticação está configurada/persistida;
- logs do scanner não mostram falha de inicialização.

```bash
curl -i http://127.0.0.1:8787/ready
journalctl -u home-music -n 100 --no-pager
```

### Biblioteca não atualiza

Use o scan normal:

```text
Atualizar biblioteca
```

Se você quer apenas investigar divergências sem alterar o índice, use:

```text
Administração → Integridade da biblioteca → Verificar agora
```

Não confunda as duas ações.

### Importação falha no probe/transcoding

```bash
npm run ffmpeg:status
which ffmpeg
which ffprobe
```

Se necessário, configure paths absolutos no `.env`.

### YouTube/YouTube Music indisponível

Verifique:

```bash
yt-dlp --version
which yt-dlp
```

Se estiver em caminho não padrão:

```env
HOME_MUSIC_YT_DLP_PATH=/caminho/absoluto/yt-dlp
```

### Problema com Funnel

Use:

```bash
npm run tailscale:public:status
```

Depois consulte [`docs/tailscale-funnel-troubleshooting.md`](docs/tailscale-funnel-troubleshooting.md).

## Estrutura do repositório

```text
home-music/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   └── dist/
│   └── web/
│       ├── src/
│       └── dist/
├── packages/
│   └── shared/
├── data/
├── docs/
├── scripts/
├── e2e/
├── .env.example
├── package-lock.json
└── package.json
```

### `apps/server`

Responsável por:

- Fastify;
- autenticação;
- sessões;
- SQLite;
- scanner/indexação;
- streaming;
- FFmpeg/FFprobe;
- importação;
- endpoints administrativos;
- arquivos estáticos em produção.

### `apps/web`

Responsável por:

- React;
- player;
- biblioteca;
- PWA/offline;
- Minha conta;
- Administração;
- importação e ferramentas administrativas.

### `packages/shared`

Contém contratos e tipos utilizados pelos dois lados para reduzir divergência entre API e UI.

### `scripts`

Inclui automação de:

- instalação/update systemd;
- produção smoke;
- autenticação smoke;
- Tailscale Serve;
- Tailscale Funnel;
- hardening operacional.

## Documentação complementar

O README é a porta de entrada operacional. Para implementação e decisões específicas, consulte primeiro [`docs/README.md`](docs/README.md), que diferencia fontes correntes de registros históricos e mantém o estado do backlog atual.

### Operação, arquitetura e qualidade

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/production.md`](docs/production.md)
- [`docs/production-verification.md`](docs/production-verification.md)
- [`docs/backup-restore.md`](docs/backup-restore.md)
- [`docs/ffmpeg.md`](docs/ffmpeg.md)
- [`docs/pwa.md`](docs/pwa.md)
- [`docs/offline-downloads.md`](docs/offline-downloads.md)
- [`docs/security-regressions.md`](docs/security-regressions.md)
- [`docs/large-library-benchmark.md`](docs/large-library-benchmark.md)

### Tailscale

- [`docs/tailscale.md`](docs/tailscale.md)
- [`docs/public-access.md`](docs/public-access.md)
- [`docs/tailscale-hardening.md`](docs/tailscale-hardening.md)
- [`docs/tailscale-funnel-troubleshooting.md`](docs/tailscale-funnel-troubleshooting.md)
- [`docs/tailscale-policy.example.hujson`](docs/tailscale-policy.example.hujson)

### Importação

- [`docs/import-upload.md`](docs/import-upload.md)
- [`docs/import-url.md`](docs/import-url.md)
- [`docs/import-staging.md`](docs/import-staging.md)
- [`docs/import-staging-cleanup.md`](docs/import-staging-cleanup.md)
- [`docs/import-metadata-preview.md`](docs/import-metadata-preview.md)
- [`docs/import-duplicate-detection.md`](docs/import-duplicate-detection.md)
- [`docs/import-safe-destination.md`](docs/import-safe-destination.md)
- [`docs/import-incremental-library-update.md`](docs/import-incremental-library-update.md)
- [`docs/import-job-retry.md`](docs/import-job-retry.md)
- [`docs/external-providers.md`](docs/external-providers.md)
- [`docs/yt-dlp-provider.md`](docs/yt-dlp-provider.md)

### Administração

- [`docs/admin-metadata-overrides.md`](docs/admin-metadata-overrides.md)
- [`docs/admin-cover-overrides.md`](docs/admin-cover-overrides.md)
- [`docs/admin-file-moves.md`](docs/admin-file-moves.md)
- [`docs/admin-bulk-actions.md`](docs/admin-bulk-actions.md)
- [`docs/admin-transcode-cache.md`](docs/admin-transcode-cache.md)
- [`docs/admin-operation-history.md`](docs/admin-operation-history.md)

### Autenticação e contas

A pasta `docs/` também contém o histórico técnico detalhado da evolução multiusuário (`phase-7.5-*` e `multi-user-auth.md`). Alguns desses documentos registram etapas intermediárias da implementação; para operação da versão atual, prefira primeiro este README, `docs/README.md` e `.env.example`.

## Roadmap

Veja [`docs/roadmap.md`](docs/roadmap.md).
