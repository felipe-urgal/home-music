# Identidade, multiusuário e autorização

Este documento registra a arquitetura **atual** de identidade do Home Music. Os arquivos `phase-7.5-*` preservam decisões e slices históricos da migração; este arquivo resume o modelo final incorporado à `main`.

> Status: **concluído para o escopo da Fase 7.5**. Evoluções futuras de identidade devem abrir issue própria e atualizar este documento quando alterarem as invariantes abaixo.

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

A recuperação pode reativar/promover a conta e gerar senha temporária, exigindo troca no próximo login.

Detalhes: `phase-7.5-remove-env-auth-recovery.md`.

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
- configurar preferências de reprodução locais/por dispositivo conforme a superfície.

O backend deriva o alvo da sessão autenticada; o cliente não escolhe `userId` arbitrário para autosserviço.

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

Detalhes: `phase-7.5-admin-users-screen.md`.

## Ownership pessoal

Dados pessoais carregam `user_id` e queries sensíveis devem incluir ownership na própria busca sempre que possível.

Recursos cobertos:

- favoritos;
- histórico e estatísticas;
- playlists manuais;
- estado/fila do player;
- downloads offline no navegador.

Playlists importadas do Rekordbox permanecem compartilhadas/somente leitura fora do fluxo de reimportação.

## Downloads offline

O navegador compartilha um origin, então isolamento é explícito por `userId`.

Namespaces atuais:

```text
home-music:offline-tracks:v2:<userId>
home-music-offline-audio-v2-<userId>
```

O service worker associa cada client/aba ao usuário autenticado antes de servir áudio offline. Cache global legado sem ownership não é atribuído automaticamente a uma conta.

Detalhes: `offline-downloads.md` e `pwa.md`.

## Matriz de acesso resumida

| Operação | user | admin |
| --- | :---: | :---: |
| Login/logout/status | ✅ | ✅ |
| Ler/reproduzir biblioteca | ✅ | ✅ |
| Próprios favoritos/histórico/playlists | ✅ | ✅ |
| Minha conta | ✅ | ✅ |
| Administração da biblioteca | ❌ | ✅ |
| Scan manual | ❌ | ✅ |
| Importação | ❌ | ✅ |
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
- E2E multiusuário em diferentes viewports.

Expansões de cobertura permanecem rastreadas nas issues #111 e #118.

## Documentação relacionada

- `phase-7.5-operations.md` — runbook operacional;
- `phase-7.5-admin-users-screen.md` — UI atual de usuários;
- `phase-7.5-my-account-screen.md` — Minha conta atual;
- `phase-7.5-remove-env-auth-recovery.md` — remoção das credenciais permanentes e recuperação local;
- demais `phase-7.5-*` — registros históricos dos slices da migração.

Qualquer mudança futura que introduza cadastro público, novos papéis, autenticação externa, compartilhamento diferente de dados pessoais ou bibliotecas físicas separadas deve atualizar este documento e o roadmap no mesmo PR.
