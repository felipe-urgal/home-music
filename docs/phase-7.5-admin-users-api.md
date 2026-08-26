# Fase 7.5 — APIs administrativas de usuários

Este documento registra a implementação das atividades 8 e 9 da Fase 7.5. As decisões gerais e invariantes continuam em `multi-user-auth.md`; a política central de autorização está em `phase-7.5-auth-policy.md`.

## Objetivo

Criar a base backend para gestão de contas sem cadastro público, sem expor campos sensíveis do SQLite e sem permitir que uma corrida administrativa deixe a instalação sem administrador ativo.

Todas as rotas ficam sob `/api/admin/*` e, portanto, exigem `role=admin` pela política central do servidor.

## Rotas

| Método | Rota | Operação |
| --- | --- | --- |
| `GET` | `/api/admin/users` | listar contas |
| `POST` | `/api/admin/users` | criar conta |
| `PATCH` | `/api/admin/users/:id/role` | alterar papel |
| `PATCH` | `/api/admin/users/:id/enabled` | ativar/desativar |
| `POST` | `/api/admin/users/:id/password-reset` | gerar nova senha temporária |
| `POST` | `/api/admin/users/:id/sessions/revoke` | revogar sessões do usuário |

As mutações continuam exigindo `X-Home-Music-Request: 1` pela proteção global já existente.

## Contrato público

A representação administrativa de usuário contém somente:

```text
id
username
role
enabled
passwordMustChange
createdAt
updatedAt
passwordChangedAt
```

Nunca retornamos:

- `password_hash`;
- username normalizado interno;
- conteúdo do cookie/token de sessão;
- qualquer senha anterior.

## Criação de conta

O servidor:

1. normaliza o username pela função oficial da Fase 7.5;
2. rejeita duplicidade após normalização;
3. gera um UUID para a conta;
4. gera uma senha temporária aleatória de 18 bytes, serializada em base64url com 24 caracteres;
5. persiste somente o hash `scrypt` dessa senha;
6. cria a conta ativa com `password_must_change = 1`;
7. retorna a senha temporária somente na resposta da criação.

A senha temporária não é armazenada em claro no SQLite e não pode ser recuperada depois. Se for perdida, deve ser gerado um reset.

Como o hash é calculado de forma assíncrona, o serviço revalida imediatamente antes do `INSERT` que o ator ainda é um administrador ativo. Uma autorização que ficou obsoleta durante o custo da KDF não consegue concluir a criação.

## Reset de senha

O reset administrativo repete a geração de senha temporária forte, atualiza:

- `password_hash`;
- `password_must_change = 1`;
- `password_changed_at`;
- `updated_at`.

Depois revoga todas as sessões em memória associadas ao usuário alvo.

A role do ator é revalidada depois do `scrypt` e antes do `UPDATE`, evitando que uma requisição iniciada por um admin que foi rebaixado durante a derivação continue autorizada por estado antigo.

## Role, enabled e sessões

Alterar `role` ou `enabled` revoga as sessões existentes do usuário alvo imediatamente.

A autorização já resolve a role e o estado atual no SQLite a cada request, mas a revogação explícita reduz ainda mais a janela de estado antigo e segue a decisão arquitetural da Fase 7.5.

## Último administrador e auto-lockout

As mudanças de `role` e `enabled` são serializadas com `BEGIN IMMEDIATE`.

Dentro da mesma transação o serviço:

1. confirma que o ator ainda existe, está ativo e continua com `role=admin`;
2. relê o usuário alvo;
3. impede uma transição que deixaria zero administradores ativos;
4. aplica a mudança;
5. só então confirma a transação.

A transação evita a corrida clássica em que dois administradores fazem alterações cruzadas ao mesmo tempo depois de ambos terem passado pelo hook de autorização.

Além disso, a árvore administrativa continua conservadora para auto-operações: alterar a própria role, desativar a própria conta, resetar a própria senha ou revogar as próprias sessões por `/api/admin/users/*` retorna `409`.

A gestão da própria senha e das próprias sessões será feita pela futura tela `Minha conta`, com regras próprias. Essa separação evita transformar a API administrativa em um caminho acidental de auto-lockout.

## Login multiusuário ainda em transição

Criar uma conta nesta atividade persiste identidade e credencial corretamente, mas não antecipa a troca completa do endpoint de login para autenticação multiusuário.

O login corrente continua preservando o caminho legado/bootstrap enquanto ownership de favoritos, histórico, playlists manuais e estado do player ainda é global. Permitir login de um segundo usuário antes dessas migrations criaria vazamento lógico de dados pessoais.

Portanto a conta criada fica preparada no SQLite para o login multiusuário, que será liberado de forma coordenada quando o isolamento necessário estiver implementado.

## Semântica HTTP

- `400`: username, role ou estado inválido;
- `401`: sem sessão válida;
- `403`: sessão válida sem role `admin`, ou ator que deixou de ser admin antes da mutação;
- `404`: usuário alvo não existe;
- `409`: username duplicado, tentativa de auto-operação bloqueada ou alteração que violaria a invariável administrativa;
- `201`: usuário criado;
- `200`: operação administrativa concluída.

## Testes de regressão

A implementação cobre:

- `user` recebendo `403` na listagem administrativa;
- admin listando usuários sem hash ou outros campos internos;
- criação com normalização e senha temporária verificável por `scrypt`;
- rejeição de username duplicado por normalização;
- alteração de role e enabled;
- reset de senha com `password_must_change = 1`;
- revogação de sessões após mudanças sensíveis;
- bloqueio das operações administrativas sobre a própria conta;
- ator que deixou de ser admin não conseguindo concluir uma mutação;
- serialização das mudanças críticas em transação `BEGIN IMMEDIATE`.

## Ajuste visual incluído no mesmo PR

Por decisão de produto, o mesmo PR também corrige a densidade da tabela desktop da biblioteca.

O CSS anterior aplicava a largura principal ao primeiro `th`, mas depois da introdução da coluna de seleção esse primeiro `th` passou a ser o checkbox. O resultado era uma coluna vazia excessivamente larga antes do título.

A correção:

- dá largura fixa pequena à seleção;
- devolve a largura principal ao título;
- redistribui artista/álbum/pasta;
- reduz altura de linha e capa;
- mostra ações inativas somente em hover/foco, mantendo favorito ativo visível;
- preserva a composição mobile, pois as regras continuam limitadas ao breakpoint desktop.
