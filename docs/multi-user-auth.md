# Identidade, multiusuário e autorização

Este documento registra as decisões arquiteturais da **Fase 7.5** do Home Music. Ele existe para manter explícitos o motivo das escolhas, a fronteira de segurança, o modelo de dados, os fluxos de usuário, a ordem de implementação e os critérios de aceite antes de iniciar a Administração da biblioteca.

> Status: em implementação. O roadmap continua sendo a fonte de acompanhamento de tarefas; este documento é a fonte das decisões e invariantes da Fase 7.5.

## 1. Por que esta fase existe

A Fase 8 adicionará operações administrativas como importação, scan, movimentação de arquivos, limpeza de cache, backup/restore e futuramente exclusões físicas. Essas operações não podem depender apenas de um item de menu escondido no frontend.

Antes da Administração, o Home Music precisa distinguir **quem está autenticado** e **o que essa identidade pode fazer**.

Estado anterior à Fase 7.5:

- um único login vindo de `HOME_MUSIC_USER` e `HOME_MUSIC_PASSWORD`;
- sessão opaca em cookie HttpOnly;
- qualquer sessão autenticada acessa as rotas privadas;
- nenhuma sessão carrega identidade de usuário ou papel;
- favoritos, histórico, estatísticas, playlists manuais e estado do player são globais;
- downloads offline são armazenados em namespace global da origem do navegador.

A Fase 7.5 transforma esse modelo em multiusuário sem transformar o Home Music em um SaaS público.

## 2. Decisões fechadas

### 2.1 Não haverá cadastro público

Não será criada uma rota pública de `sign up`/`register`.

Fluxo adotado:

```text
primeiro admin
    ↓
Administração
    ↓
Usuários
    ↓
Novo usuário
```

Somente um `admin` autenticado poderá criar novas contas.

Motivos:

- Home Music é uma aplicação pessoal/self-hosted;
- cadastro público não traz benefício relevante para o cenário;
- evitar nova superfície para spam, criação automatizada de contas, enumeração e escalada de privilégio;
- não depender de e-mail, SMS ou serviços externos de identidade.

### 2.2 Papéis iniciais: `admin` e `user`

Não será implementado um sistema genérico de permissões configuráveis nesta fase.

Papéis:

- `admin`: usa o produto normalmente e também acessa operações administrativas;
- `user`: usa player, biblioteca e os próprios dados pessoais, mas não administra biblioteca nem usuários.

Esse modelo é simples o suficiente para o projeto atual e pode evoluir para permissões mais granulares somente se surgir necessidade real.

### 2.3 O backend é a fronteira real de autorização

Esconder `Administração` no frontend é somente UX.

Toda operação sensível deve ser recusada pelo backend quando a identidade não tiver autorização, inclusive se a requisição for construída manualmente pelo DevTools, curl ou outro cliente.

Princípios:

- `deny by default`;
- menor privilégio necessário;
- política centralizada para evitar esquecer proteção ao adicionar novas rotas;
- nenhuma decisão de segurança depende de `role` enviado pelo cliente;
- ownership de recursos pessoais deve ser aplicado preferencialmente na própria query SQL.

Exemplo esperado:

```text
user autenticado
    ↓
POST /api/admin/...
    ↓
403 Forbidden
```

Para recurso pessoal de outro usuário, quando não houver necessidade de revelar sua existência, a resposta deve ser `404` em vez de `403`.

### 2.4 Biblioteca compartilhada, experiência pessoal isolada

Os arquivos físicos e o índice da biblioteca continuam compartilhados por todos os usuários autorizados. Dados de uso pessoal passam a ser isolados.

| Dado | Compartilhado | Por usuário |
| --- | :---: | :---: |
| Arquivos em `MUSIC_DIR` | ✅ | |
| Índice de faixas | ✅ | |
| Metadata física/indexada | ✅ | |
| Capas da biblioteca | ✅ | |
| Scanner | ✅ | |
| Cache de transcoding | ✅ | |
| Playlists importadas do Rekordbox | ✅ | |
| Favoritos | | ✅ |
| Histórico | | ✅ |
| Estatísticas pessoais | | ✅ |
| Playlists manuais | | ✅ |
| Fila | | ✅ |
| Faixa atual/posição | | ✅ |
| Volume | | ✅ |
| Shuffle/repeat | | ✅ |
| Downloads offline no navegador | | ✅ |

A remoção de um usuário não pode alterar a biblioteca física compartilhada.

## 3. Custo financeiro

A solução foi desenhada para não exigir um provedor externo de autenticação.

Continuaremos usando:

- React;
- Fastify;
- SQLite;
- `node:crypto`;
- a infraestrutura já usada para executar o Home Music.

Não são necessários nesta fase:

- Auth0;
- Clerk;
- Firebase Auth;
- Supabase Auth;
- serviço de e-mail;
- SMS;
- login Google/Apple;
- banco externo.

Portanto, não existe custo recorrente adicional obrigatório para suportar `admin` e `user` além da infraestrutura já existente.

Custos poderiam surgir futuramente apenas se decidirmos adicionar serviços externos, por exemplo e-mail transacional, SMS/2FA ou login social.

## 4. Modelo de usuário

A tabela base introduzida na migration v6 é:

```text
users
────────────────────────────────────
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

Invariantes no SQLite:

- `id` obrigatório e chave primária;
- `username_normalized` único;
- `role` somente `admin` ou `user`;
- `enabled` somente `0` ou `1`;
- `password_must_change` somente `0` ou `1`;
- `password_hash` não vazio;
- limites de tamanho para username e username normalizado.

A camada de serviço adicionará validações mais específicas, mas o banco deve rejeitar estados estruturalmente inválidos mesmo que um bug escape da aplicação.

### 4.1 Username normalizado

O username exibido e a identidade usada para unicidade são conceitos separados.

Exemplo:

```text
username:            Felipe
username_normalized: felipe
```

A função de normalização será única e testada. Não teremos diferentes partes do sistema inventando suas próprias regras.

A conta não poderá ser duplicada apenas mudando capitalização ou outra variação definida pela normalização oficial.

## 5. Senhas

### 5.1 Senha nunca em claro no SQLite

O banco armazena somente `password_hash`.

Fluxo:

```text
senha
  ↓
scrypt + salt aleatório
  ↓
formato versionado
  ↓
password_hash
```

### 5.2 Algoritmo escolhido

A decisão para esta fase é usar `scrypt` de `node:crypto`.

Motivos:

- algoritmo memory-hard adequado para armazenamento de senhas;
- disponível no próprio Node;
- evita nova dependência nativa para o deploy Ubuntu;
- reduz superfície de supply chain e problemas de compilação/instalação.

O formato persistido deverá ser versionado e conter todos os parâmetros necessários para validação e futuro upgrade de custo.

Conceitualmente:

```text
scrypt$v1$<params>$<salt>$<derived-key>
```

A representação final será definida na atividade de hashing e coberta por testes.

### 5.3 Regras defensivas

A implementação deverá:

- usar salt aleatório por senha;
- comparar material derivado em tempo constante;
- limitar tamanho máximo de senha recebido para impedir abuso de CPU/memória;
- nunca logar senha nem hash completo;
- permitir aumento futuro dos parâmetros sem invalidar hashes antigos;
- atualizar `password_changed_at` quando a senha for trocada.

## 6. Bootstrap do primeiro administrador

Existe um problema de bootstrap: se somente administradores podem criar usuários, alguém precisa criar o primeiro administrador.

Decisão: migrar de forma idempotente o login atual do `.env`.

Fluxo planejado:

```text
startup
  ↓
users vazio?
  ├─ não → autenticação multiusuário normal
  └─ sim
      ↓
HOME_MUSIC_USER + HOME_MUSIC_PASSWORD válidos?
      ├─ não → readiness/auth informa configuração incompleta
      └─ sim
          ↓
cria primeiro usuário
role = admin
enabled = true
password_must_change conforme política do bootstrap
          ↓
login existente continua funcionando
```

Requisitos:

- idempotente;
- nunca criar dois administradores por reinicialização;
- nunca substituir uma tabela `users` já inicializada;
- falha não pode deixar metade da migration persistida;
- não perder acesso durante o upgrade;
- não apagar `HOME_MUSIC_USER`/`HOME_MUSIC_PASSWORD` automaticamente do arquivo `.env`.

Depois que o bootstrap estiver concluído e existir mecanismo seguro de recuperação local, as credenciais do `.env` deixam de ser fonte permanente de autenticação e poderão ser removidas manualmente/documentadamente.

## 7. Sessões

### 7.1 Manter sessão opaca; não usar JWT

O Home Music já usa token aleatório em cookie HttpOnly. Essa abordagem será mantida.

Não há necessidade de JWT para um servidor self-hosted único com estado local.

Modelo anterior:

```text
token → expiresAt
```

Modelo alvo:

```text
token
  ↓
session
├── userId
├── createdAt
├── authenticatedAt
└── expiresAt
```

O cookie continua:

- `HttpOnly`;
- `SameSite=Strict`;
- `Secure` no perfil HTTPS;
- token aleatório sem dados pessoais embutidos.

### 7.2 Role não será verdade permanente da sessão

A sessão identifica `userId`. A autorização resolve o usuário atual no servidor para considerar `role` e `enabled` vigentes.

Isso permite que:

- usuário desativado perca acesso;
- rebaixamento de admin tenha efeito;
- mudança de senha possa revogar sessões;
- alteração administrativa não dependa de esperar o TTL expirar.

### 7.3 Revogação

Precisaremos de:

- revogar sessão atual no logout;
- revogar todas as sessões de um usuário;
- revogar sessões ao desativar conta;
- revogar sessões ao redefinir/trocar senha conforme regra definida;
- opção `Sair de outros dispositivos` em `Minha conta`.

## 8. Contexto autenticado no Fastify

Depois de validar o cookie, o servidor disponibilizará uma identidade interna mínima, conceitualmente:

```text
request.user = {
  id,
  username,
  role
}
```

Nunca usar objeto de usuário vindo diretamente de body/header como identidade confiável.

Políticas centrais:

```text
public
   ↓
sem sessão obrigatória

authenticated
   ↓
sessão válida + usuário ativo

admin
   ↓
sessão válida + usuário ativo + role=admin
```

Novas rotas administrativas devem nascer dentro de uma fronteira que exija `admin`, e não depender de cada handler lembrar de adicionar um `if` manual.

## 9. Matriz inicial de acesso

Classificação planejada:

| Operação | user | admin |
| --- | :---: | :---: |
| Login/logout/status | ✅ | ✅ |
| Ler biblioteca | ✅ | ✅ |
| Streaming | ✅ | ✅ |
| Capas/letras | ✅ | ✅ |
| Próprios favoritos | ✅ | ✅ |
| Próprio histórico/estatísticas | ✅ | ✅ |
| Próprias playlists manuais | ✅ | ✅ |
| Próprio playback state | ✅ | ✅ |
| Playlists Rekordbox compartilhadas | leitura | leitura |
| Scan manual | ❌ | ✅ |
| Diagnóstico operacional detalhado | ❌ | ✅ |
| Importação/reimportação Rekordbox | ❌ | ✅ |
| Gestão de usuários | ❌ | ✅ |
| Administração da biblioteca | ❌ | ✅ |
| Importar/mover/quarentena/excluir arquivo | ❌ | ✅ |
| Limpar cache | ❌ | ✅ |
| Backup/restore | ❌ | ✅ |

A matriz será revisada conforme novas rotas forem criadas.

## 10. Isolamento de dados pessoais

Adicionar login multiusuário sem alterar os dados atuais causaria vazamento lógico entre contas. Por isso a Fase 7.5 inclui ownership.

### 10.1 Favoritos

Modelo alvo:

```text
favorites
user_id
track_id
created_at

PRIMARY KEY(user_id, track_id)
```

Todas as consultas recebem a identidade atual.

### 10.2 Histórico e estatísticas

`history` recebe `user_id`.

Estatísticas deixam de agregar todos os plays do banco e passam a agregar somente o histórico do usuário atual.

A capacidade/limpeza do histórico deve ser definida por usuário, não globalmente de maneira que um usuário expulse registros recentes do outro.

### 10.3 Playlists

Playlists manuais têm proprietário.

Conceitualmente:

```text
manual
owner_user_id = <id>

rekordbox
owner_user_id = NULL
source = rekordbox
```

Rekordbox continua sendo uma visão compartilhada da biblioteca, administrada pela importação e somente leitura para usuários comuns.

Queries e mutações de playlist manual devem conter `owner_user_id = currentUser.id` no SQL.

### 10.4 Playback state

O modelo atual possui uma única linha global (`id = 1`). Ele será migrado para estado por usuário.

Cada usuário terá seus próprios:

- current track;
- posição;
- volume;
- shuffle;
- repeat;
- fila base;
- fila efetiva;
- `wasPlaying`;
- timestamp.

### 10.5 Migration dos dados existentes

O primeiro administrador deve herdar os dados pessoais já existentes.

A migration futura deverá atribuir ao primeiro admin:

- favoritos atuais;
- histórico atual;
- playlists manuais atuais;
- playback state atual.

Playlists importadas do Rekordbox permanecem compartilhadas.

Não aceitaremos uma migration que simplesmente crie usuários e zere a experiência existente.

## 11. Proteção contra IDOR/acesso cruzado

Sempre que possível, ownership deve ser parte da query.

Preferido:

```sql
SELECT ...
FROM playlists
WHERE id = ?
  AND owner_user_id = ?;
```

Evitar depender somente de:

```text
SELECT pelo id
  ↓
carrega objeto alheio
  ↓
if owner != currentUser
```

Consequência esperada:

```text
usuário B tenta UUID da playlist de A
        ↓
query não encontra recurso no escopo de B
        ↓
404
```

IDs continuam imprevisíveis, mas a segurança nunca depende apenas disso.

## 12. Gestão de usuários

A tela `Administração > Usuários` será exclusiva para `admin`.

Operações planejadas:

- listar usuários;
- criar usuário;
- escolher `user` ou `admin`;
- ativar/desativar;
- redefinir senha;
- alterar role;
- revogar sessões;
- futuramente exibir último login, se houver valor operacional.

### 12.1 Criação

Fluxo simples:

```text
Novo usuário

Usuário
[ maria ]

Senha temporária
[ *************** ]

Perfil
(*) Usuário
( ) Administrador

[ Criar usuário ]
```

Não haverá envio de convite por e-mail nesta fase.

### 12.2 Senha temporária e primeiro login

Ao criar ou resetar uma conta, o admin fornece uma senha temporária forte.

A conta fica com `password_must_change = true`.

No primeiro login, o usuário é direcionado a trocar a senha antes de acessar o uso normal do produto.

O backend deve aplicar essa restrição; não basta uma tela no frontend.

### 12.3 Esqueci minha senha

Não haverá recuperação por e-mail nesta fase.

Fluxo:

```text
usuário esqueceu senha
     ↓
contata administrador
     ↓
admin redefine senha temporária
     ↓
sessões anteriores revogadas
     ↓
usuário troca senha no próximo login
```

### 12.4 Desativar em vez de excluir

A operação administrativa padrão será `enabled = false`, não exclusão física da conta.

Ao desativar:

- sessões são revogadas;
- novos logins falham;
- dados pessoais permanecem íntegros;
- referências não são quebradas.

Exclusão definitiva de conta não faz parte do escopo inicial.

## 13. Invariante do último administrador

O sistema nunca pode ficar com zero administradores ativos por uma operação normal da aplicação.

Se Felipe for o único admin ativo, o backend recusará:

- desativar Felipe;
- mudar Felipe de `admin` para `user`.

Para rebaixá-lo/desativá-lo, primeiro deve existir outro `admin` ativo.

Essa regra deve existir na camada de domínio/transação e ser testada contra concorrência. A UI pode antecipar o bloqueio, mas não é a proteção real.

## 14. Auto-lockout e alterações na própria conta

Operações que possam retirar o acesso administrativo da própria sessão exigem atenção especial.

Regras:

- nunca permitir auto-lockout se o usuário atual for o último admin;
- após alterar a própria senha, a política de sessões deve ser explícita e testada;
- ao desativar/rebaixar uma conta, qualquer sessão afetada deve refletir o novo estado imediatamente;
- respostas de erro não devem expor hash, detalhes internos do banco ou segredos.

## 15. Reautenticação para operações críticas

Operações administrativas destrutivas da Fase 8 poderão exigir autenticação recente.

Exemplos:

- exclusão física de mídia;
- restore de backup;
- redefinição de senha de outro administrador;
- mudança de role sensível;
- operações equivalentes de alto impacto.

Modelo planejado:

```text
authenticatedAt recente?
   ├─ sim → continua
   └─ não → solicitar senha novamente
```

O intervalo exato e as rotas obrigatórias serão definidos quando essas operações forem implementadas. Não precisamos implementar reautenticação antes de existir uma operação que a exija.

## 16. Downloads offline e navegador compartilhado

Hoje os downloads offline usam nomes globais da origem. Em multiusuário isso pode misturar dados quando duas contas usam o mesmo navegador/perfil.

A Fase 7.5 deve separar manifesto e cache por identidade.

Conceitualmente:

```text
home-music:offline:<userId>:tracks
home-music-offline-audio:<userId>
```

E a resolução offline deve incluir o escopo do usuário de forma que o usuário B não herde o manifesto/cache do usuário A.

Logout/troca de conta não precisa apagar automaticamente os arquivos do outro usuário, mas a aplicação não pode apresentá-los ou reutilizá-los fora do namespace correto.

## 17. Frontend

`/api/auth/status` evoluirá de um booleano de autenticação para identidade mínima.

Conceitualmente:

```json
{
  "configured": true,
  "authenticated": true,
  "user": {
    "id": "...",
    "username": "felipe",
    "role": "admin"
  }
}
```

O frontend mantém `currentUser`.

### 17.1 Navegação

`user`:

```text
Player
Biblioteca
Favoritos
Playlists
Histórico
Estatísticas
Minha conta
```

`admin`:

```text
Tudo do user
Administração
```

O menu administrativo não é renderizado para `user`, mas isso é apenas comportamento visual.

### 17.2 Minha conta

Todo usuário autenticado poderá:

- ver seu username;
- trocar a própria senha;
- sair da sessão atual;
- revogar outras sessões/sair de outros dispositivos.

Não é necessário permitir alteração arbitrária de username na primeira versão.

## 18. Rotas administrativas

As rotas novas administrativas devem ser agrupadas sob `/api/admin/*` quando fizer sentido.

Rotas existentes que forem classificadas como administrativas também devem usar a mesma política central, mesmo que a URL histórica precise ser preservada por compatibilidade durante uma transição.

Não criar uma segunda autorização paralela específica para cada módulo.

## 19. Recuperação operacional

Quando as credenciais do `.env` deixarem de ser o login permanente, precisamos preservar uma forma segura de recuperar acesso em uma instalação self-hosted.

Requisitos para a futura ferramenta de recuperação local:

- executada somente no host/terminal, não como endpoint público;
- acesso ao arquivo/banco protegido pelas permissões já aplicadas no Ubuntu;
- operação explícita;
- nunca imprimir senha existente;
- permitir redefinir/criar um admin de recuperação sem quebrar a invariante de usuários;
- documentar backup do SQLite antes da intervenção quando aplicável.

A forma exata (CLI/script) será escolhida na atividade correspondente.

## 20. Migrations e rollback

Migrations da Fase 7.5 devem priorizar segurança de dados.

Regras:

- usar transação para transformações que precisam ser atômicas;
- atualizar `PRAGMA user_version` somente quando a etapa estiver concluída;
- preservar favoritos, histórico, playlists e playback state existentes;
- nunca utilizar o banco real nos testes de migration/smoke;
- migrations devem ser testadas partindo de versões antigas relevantes;
- antes de migrations destrutivas/rebuild de tabela, definir estratégia de rollback/backup;
- a aplicação deve falhar claramente se encontrar versão de schema não suportada em vez de improvisar.

## 21. Ordem de implementação

A ordem oficial está no `roadmap.md`. A estratégia é manter PRs pequenos e auditáveis, sem construir a tela de Administração antes da fundação de autorização.

Macro-ordem:

```text
Fase 7 concluída
   ↓
Fase 7.5
   ├── schema users
   ├── password hashing
   ├── bootstrap primeiro admin
   ├── sessões com identidade
   ├── auth status/current user
   ├── autorização backend
   ├── APIs de usuários
   ├── proteção último admin
   ├── troca de senha
   ├── ownership favoritos/histórico/playlists/player
   ├── offline por usuário
   ├── frontend role-aware
   ├── telas Usuários / Minha conta
   ├── recuperação operacional
   └── regressão completa de segurança
   ↓
Fase 8 — Administração
```

## 22. Estratégia de PRs

A divisão inicialmente planejada é incremental. O tamanho exato poderá variar para manter cada alteração segura, mas a regra é não juntar toda a Fase 7.5 em um único PR.

Primeiros blocos:

1. schema de usuários e migration;
2. hashing/verificação de senha;
3. bootstrap do primeiro admin;
4. sessões associadas a identidade;
5. autorização centralizada;
6. ownership/migrations de dados pessoais;
7. gestão de usuários e UI;
8. isolamento offline e regressões E2E/segurança.

Cada PR deve receber review sênior e CI antes do merge.

## 23. Testes obrigatórios

### 23.1 Unitários

Cobrir, conforme cada etapa existir:

- normalização de username;
- hashing/verificação;
- formato versionado de hash;
- limites de entrada;
- sessão e expiração;
- revogação;
- role;
- usuário desativado;
- último admin;
- troca obrigatória de senha.

### 23.2 Integração/API

Casos mínimos:

```text
sem sessão em rota privada            → 401
user em rota admin                     → 403
recurso pessoal de outro usuário       → 404
usuário disabled                       → sessão/login recusados
último admin: demote/disable            → recusado
senha resetada                          → sessões antigas revogadas
password_must_change                    → uso normal bloqueado
role adulterado no payload/frontend     → ignorado/recusado
```

### 23.3 Migration

Validar:

- banco novo;
- upgrade v5 → versão atual;
- upgrades legados relevantes;
- dados anteriores preservados;
- Rekordbox continua íntegro;
- falha no meio não deixa versão parcialmente aplicada.

### 23.4 E2E

Ter contas reais de fixture `admin` e `user`.

Cobrir mobile/tablet/desktop:

- login de ambos;
- menu Administração somente para admin;
- chamada manual/rota admin negada ao user;
- favoritos isolados;
- histórico/estatísticas isolados;
- playlists pessoais isoladas;
- player state isolado;
- troca de senha obrigatória;
- gestão de usuário pelo admin;
- desativação de usuário;
- logout e troca de conta;
- offline sem vazamento entre identidades.

### 23.5 Pipeline atual

Continuar exigindo:

- audit de dependências;
- typecheck;
- testes;
- scripts operacionais;
- testes de Tailscale;
- build;
- Playwright;
- E2E dedicado Ubuntu 26.04;
- smoke real de produção.

## 24. Critério de conclusão da Fase 7.5

A Fase 7.5 só estará concluída quando:

- mais de uma conta puder existir;
- `admin` e `user` tiverem acesso efetivamente distinto no backend;
- não existir cadastro público;
- somente admin puder criar/gerenciar contas;
- senha não for persistida em claro;
- sessões forem associadas a identidade e revogáveis;
- usuário desativado não puder continuar usando uma sessão antiga;
- último admin não puder ser removido/rebaixado por acidente;
- favoritos, histórico, estatísticas, playlists manuais e playback state estiverem isolados por usuário;
- Rekordbox continuar compartilhado conforme decisão atual;
- downloads offline não vazarem entre contas no mesmo navegador;
- dados existentes forem preservados na migration para o primeiro admin;
- chamada manual à API não permitir que `user` execute operações de `admin`;
- testes de segurança e regressão estiverem verdes.

Somente depois disso a área de Administração da Fase 8 será considerada segura para receber operações de biblioteca.

## 25. Não objetivos desta fase

Não implementar agora, salvo nova decisão explícita:

- cadastro público;
- autenticação social;
- recuperação de senha por e-mail;
- envio de SMS;
- MFA/2FA;
- SSO/OIDC;
- permissões arbitrárias configuráveis por usuário;
- grupos/equipes/organizações;
- cobrança/assinaturas;
- exclusão definitiva de usuário pela UI;
- multi-tenant com bibliotecas físicas diferentes por usuário.

Esses itens só entram se uma necessidade concreta justificar a complexidade.

## 26. Regra para mudanças futuras

Qualquer mudança nesta arquitetura que altere uma das decisões fechadas — por exemplo cadastro público, novos papéis, compartilhamento de playlists pessoais, autenticação externa ou bibliotecas separadas — deve atualizar este documento e o roadmap no mesmo PR.

Assim o código, o plano e as decisões permanecem sincronizados.