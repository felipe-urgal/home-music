# Identidade, multiusuário e autorização

Este documento registra a arquitetura **atual** de identidade do Home Music. Os documentos da fase 7.5 foram arquivados em [`history/phase-7.5/`](history/phase-7.5/) como contexto histórico da migração; este arquivo é a fonte de verdade documental para o modelo vigente incorporado à `main`.

> Status: **concluído para o escopo da fase 7.5**. Evoluções de identidade, como o login da TV pelo celular, são documentadas aqui quando alteram as invariantes vigentes.

## Objetivo

O Home Music é self-hosted e possui biblioteca física compartilhada, mas precisa distinguir quem está autenticado e o que cada identidade pode fazer.

Não existe cadastro público.

```text
primeiro admin
    ↓
Administração
    ↓
Usuários
    ↓
Novo usuário
```

Somente `admin` autenticado pode criar e gerenciar outras contas.

## Papéis

Papéis atuais:

- `admin`: usa o produto normalmente e também acessa Administração;
- `user`: usa player/biblioteca e os próprios dados pessoais, sem administrar biblioteca/contas.

Não existe sistema genérico de permissões configuráveis no momento.

## Backend é a fronteira de autorização

Esconder Administração no frontend é apenas UX.

Princípios:

- `deny by default`;
- menor privilégio necessário;
- política central `public / authenticated / admin`;
- nenhuma decisão depende de `role` enviado pelo cliente;
- ownership pessoal é aplicado no servidor, preferencialmente na própria query SQL;
- recurso pessoal de outra conta pode responder `404` quando revelar sua existência não for necessário.

Exemplo:

```text
user autenticado
    ↓
POST /api/admin/...
    ↓
403 Forbidden
```

## Biblioteca compartilhada, dados pessoais isolados

| Dado | Compartilhado | Por usuário |
| --- | :---: | :---: |
| Arquivos em `MUSIC_DIR` | ✅ | |
| Índice de faixas | ✅ | |
| Metadata física/indexada | ✅ | |
| Capas da biblioteca | ✅ | |
| Scanner | ✅ | |
| Cache de transcoding | ✅ | |
| Playlists Rekordbox | ✅ | |
| Favoritos | | ✅ |
| Histórico/estatísticas | | ✅ |
| Playlists manuais | | ✅ |
| Fila/estado do player | | ✅ |
| Volume/shuffle/repeat | | ✅ |
| Namespace de downloads offline | | ✅ |

Remover uma conta não pode remover a biblioteca física compartilhada.

## Usuários no SQLite

A tabela `users` mantém:

```text
id
username
username_normalized
password_hash
role
enabled
password_must_change
created_at
updated_at
password_changed_at
```

Invariantes importantes:

- `username_normalized` único;
- role somente `admin`/`user`;
- conta pode ser ativa/inativa;
- senha nunca em claro;
- nunca permitir estado operacional sem administrador ativo;
- ações sobre a própria conta administrativa são limitadas para evitar auto-lockout.

## Senhas

Senhas usam `scrypt` assíncrono de `node:crypto`, com salt aleatório e formato versionado.

Formato atual:

```text
scrypt$v1$<N>$<r>$<p>$<salt-base64url>$<derived-key-base64url>
```

A implementação:

- usa salt independente;
- compara chave com `timingSafeEqual`;
- valida formato/parâmetros antes de executar KDF;
- limita entrada e custo defensivamente;
- nunca normaliza semanticamente a senha;
- falha fechado em hash inválido;
- permite detectar necessidade de rehash quando parâmetros evoluírem.

A política de produto exige senha forte nas superfícies de criação/troca/reset sem misturar essa regra com a primitiva criptográfica.

## Bootstrap do primeiro administrador

`HOME_MUSIC_USER` e `HOME_MUSIC_PASSWORD` existem para **bootstrap quando `users` está vazia**.

Fluxo:

```text
startup
  ↓
users vazio?
  ├─ não → login usa SQLite
  └─ sim
      ↓
credenciais de bootstrap válidas?
      ├─ não → configuração incompleta
      └─ sim → cria primeiro admin
```

Depois de validar a conta persistida, a recomendação é remover essas duas variáveis do `.env`.

O Home Music não depende permanentemente delas para autenticação normal.

## Recuperação local

Se acesso administrativo for perdido, existe fluxo local offline para uma conta já existente:

```bash
sudo systemctl stop home-music
npm run admin:recover -- --username <usuario-existente> --confirm-service-stopped
sudo systemctl start home-music
```

A recuperação pode reativar/promover a conta e gerar senha temporária, exigindo troca no próximo login. O runbook operacional vigente está em [`PRODUCTION.md`](PRODUCTION.md).

## Sessões

Sessões continuam opacas; não usam JWT.

```text
token aleatório
    ↓
sessão em memória
├── userId
├── createdAt
├── authenticatedAt
└── expiresAt
```

Cookie:

- `HttpOnly`;
- `SameSite=Strict`;
- `Secure` em HTTPS.

Role não fica congelada como verdade permanente do token. O servidor resolve o usuário vigente para aplicar `enabled`/`role` atuais.

Isso permite efeito imediato de:

- desativação;
- rebaixamento/promoção;
- troca/reset de senha;
- revogação de sessões.

### Capacidade e isolamento

A capacidade em memória é deliberadamente limitada, mas o limite nunca pode permitir que uma conta expulse sessões de outra conta.

Política atual:

- até **16 sessões simultâneas por usuário**;
- ao criar a 17ª sessão da mesma conta, apenas a sessão mais antiga **da própria conta** é revogada;
- até **128 sessões globais** no processo, após limpar sessões expiradas;
- se o limite global continuar cheio e a nova conta ainda estiver abaixo do próprio limite, o login falha de forma controlada com `503 Service Unavailable` e `Retry-After: 60`;
- pressão global nunca escolhe uma sessão de terceiro para eviction;
- listagem, revogação manual, logout, troca/reset de senha e expiração continuam usando as mesmas sessões em memória.

Essa separação impede que um usuário comum provoque logout do administrador ou de outra conta repetindo logins. O limite global permanece apenas como proteção de memória do processo.

Reiniciar o processo revoga as sessões em memória.

## Login da TV pelo celular — protocolo backend

O primeiro estágio da issue #428 foi incorporado pelo PR #429. A `main` já possui o protocolo backend para autorizar uma TV a partir de um celular autenticado, mas a experiência de UI TV/celular ainda é um estágio separado.

O objetivo é que a TV termine com **uma sessão web normal própria**, sem receber senha, cookie ou token da sessão do celular.

### Tokens e estado

`TvDeviceLoginManager` mantém solicitações somente em memória. Cada início gera valores independentes:

- `requestId`: identifica o pedido;
- `deviceToken`: segredo da TV para status/consume/cancel;
- `approvalToken`: segredo carregado pelo fluxo de aprovação no celular;
- `displayCode`: código visual de 6 dígitos para conferir TV ↔ celular;
- `expiresAt`: expiração do pedido.

Os segredos são armazenados internamente somente como hash SHA-256. `deviceToken` e `approvalToken` são distintos e não substituem a sessão final.

Estados atuais:

```text
pending → approved → consumed
        ↘ denied
        ↘ expired
```

O consumo possui reserva/commit/rollback para que falha ao criar a sessão final não destrua silenciosamente uma aprovação válida.

### Rotas

```text
POST   /api/auth/device/start
GET    /api/auth/device/:requestId/status
POST   /api/auth/device/approve
POST   /api/auth/device/deny
POST   /api/auth/device/:requestId/consume
DELETE /api/auth/device/:requestId
```

As mutações continuam sujeitas à política central de `X-Home-Music-Request: 1` conforme a rota/autenticação aplicável.

### Sessão independente da TV

Depois da aprovação, `consume` chama `SessionManager.createSessionForUser`. A TV recebe o mesmo tipo de cookie/sessão usado pelo login normal e passa a aparecer no gerenciamento normal de sessões.

Consequências:

- logout/revogação da TV não encerra a sessão do celular;
- logout do celular não transfere nem invalida magicamente o cookie já emitido para a TV;
- capacidade por usuário/global do `SessionManager` continua valendo;
- a sessão final pode ser revogada pelos mecanismos normais.

### TTL, replay e capacidade

Defaults do manager:

- TTL do pedido: **5 minutos**;
- retenção de estado terminal: **60 segundos**;
- até **64** pedidos ativos globais;
- até **4** pedidos ativos por origem/IP;
- até **8** inícios por origem a cada **60 segundos**;
- até **512** entradas diretas no limiter antes do bucket de overflow.

Aprovação, recusa e consumo são one-shot/estado-dependentes. Tokens malformados ou grandes são rejeitados e replay não cria uma segunda sessão.

Polling/status não expõe identidade do usuário aprovado nem segredos internos. Respostas do fluxo usam `Cache-Control: no-store`.

### Fronteira com o modo LAN offline

O device login online é separado de `home-music-lan-remote-v2`:

- device login usa o servidor Home Music para autorizar uma nova sessão web da TV;
- LAN offline usa segredo efêmero do QR local para autorizar uma sessão P2P na mesma rede;
- tokens/segredos de um fluxo não são reutilizados no outro;
- o bridge iOS da LAN não participa do login da conta.

### Estado da UI

Na `main` atual, o protocolo backend está disponível, mas a experiência completa **Entrar com o celular** ainda não deve ser descrita como entregue até o estágio de UI/E2E ser mergeado. Enquanto isso, usuário/senha continua sendo o fallback/fluxo visível existente na TV.

A implementação da superfície TV/celular é acompanhada pelo PR #431 e pela issue #428.

## Senha temporária

Criação/reset de conta retorna uma senha temporária somente naquela resposta.

O frontend não persiste essa credencial. O fluxo atual protege contra descartá-la silenciosamente ao navegar/trocar de usuário enquanto ainda está visível.

Conta com `password_must_change` passa por gate de troca obrigatória antes de usar o restante da aplicação.

## Minha conta

Qualquer usuário autenticado pode:

- ver a própria identidade;
- trocar a própria senha informando a atual;
- revisar/encerrar sessões próprias;
- encerrar outras sessões preservando a atual quando a API específica permitir;
- gerenciar as próprias credenciais OpenSubsonic;
- exportar e importar os próprios dados pessoais conforme o contrato de portabilidade;
- configurar preferências de reprodução locais/por dispositivo conforme a superfície.

O backend deriva o alvo da sessão autenticada; o cliente não escolhe `userId` arbitrário para autosserviço.

A portabilidade pertence à conta autenticada e não é uma forma de importação administrativa de mídia. O formato, validação, dry-run e política de merge estão em [`personal-data-portability.md`](personal-data-portability.md).

## Administração → Usuários

Somente `admin` acessa a superfície.

O fluxo atual permite:

- listar e filtrar contas;
- criar usuário com senha temporária gerada automaticamente;
- alterar papel/status de outra conta quando permitido;
- resetar senha;
- revogar sessões;
- remover usuário dentro das invariantes do servidor.

A listagem atual usa tabela + inspetor lateral. A própria conta pode ser inspecionada, mas ações administrativas sobre ela permanecem protegidas.

Composição atual da interface: [`administration-ui.md`](administration-ui.md).

## Ownership pessoal

Dados pessoais carregam `user_id` e queries sensíveis devem incluir ownership na própria busca sempre que possível.

Recursos cobertos:

- favoritos;
- histórico e estatísticas;
- playlists manuais;
- estado/fila do player;
- downloads offline no navegador;
- exportação/importação dos dados pessoais pertencentes à conta autenticada.

Playlists importadas do Rekordbox permanecem compartilhadas/somente leitura fora do fluxo de reimportação.

## Downloads offline

O navegador compartilha um origin, então isolamento é explícito por `userId`.

Namespaces atuais:

```text
home-music:offline-tracks:v2:<userId>
home-music-offline-audio-v2-<userId>
```

O service worker associa cada client/aba ao usuário autenticado antes de servir áudio offline. Cache global legado sem ownership não é atribuído automaticamente a uma conta.

Detalhes: [`offline-downloads.md`](offline-downloads.md) e [`pwa.md`](pwa.md).

## Matriz de acesso resumida

| Operação | user | admin |
| --- | :---: | :---: |
| Login/logout/status | ✅ | ✅ |
| Aprovar login da própria TV | ✅ | ✅ |
| Ler/reproduzir biblioteca | ✅ | ✅ |
| Próprios favoritos/histórico/playlists | ✅ | ✅ |
| Minha conta/portabilidade pessoal | ✅ | ✅ |
| Administração da biblioteca | ❌ | ✅ |
| Scan manual | ❌ | ✅ |
| Importação administrativa de mídia | ❌ | ✅ |
| Integridade administrativa | ❌ | ✅ |
| Gerenciar usuários | ❌ | ✅ |
| Lixeira/exclusão permanente | ❌ | ✅ |

## Proteção de mutações

Além da sessão, mutações usam:

```text
X-Home-Music-Request: 1
```

Essa proteção deve continuar presente em novas mutações e ter teste negativo correspondente nas superfícies sensíveis.

## Testes e invariantes

A cobertura existente inclui, entre outros:

- hashing/verificação e formatos inválidos;
- sessão/revogação;
- isolamento de capacidade entre contas e saturação global sem cross-user eviction;
- último administrador;
- usuário desativado;
- troca obrigatória de senha;
- `401 / 403 / 404`;
- ownership/IDOR;
- chamadas administrativas como `user`;
- smoke de produção com admin e usuário comum;
- E2E multiusuário em diferentes viewports;
- importação pessoal com validação/ownership no fluxo dedicado;
- device login: TTL, tokens independentes, approve/deny/consume, replay, capacidade/rate limit, rollback e sessão da TV independente da sessão do celular.

A política de gates e o conjunto fixo atual do CI estão em [`testing-and-quality.md`](testing-and-quality.md).

## Documentação relacionada

- [`administration-ui.md`](administration-ui.md) — Administração e Minha conta;
- [`login-abuse-protection.md`](login-abuse-protection.md) — proteção contra abuso do login e pedidos de device login;
- [`personal-data-portability.md`](personal-data-portability.md) — exportação/importação de dados pessoais;
- [`offline-downloads.md`](offline-downloads.md) — isolamento de downloads por usuário;
- [`open-subsonic.md`](open-subsonic.md) — credenciais e projeção OpenSubsonic;
- [`android-tv.md`](android-tv.md) — autenticação e experiência no cliente TV;
- [`PRODUCTION.md`](PRODUCTION.md) — recovery administrativo e operação;
- [`history/phase-7.5/`](history/phase-7.5/) — registros históricos dos slices da migração.

Qualquer mudança futura que introduza cadastro público, novos papéis, autenticação externa, compartilhamento diferente de dados pessoais ou bibliotecas físicas separadas deve atualizar este documento e o roadmap no mesmo PR.
