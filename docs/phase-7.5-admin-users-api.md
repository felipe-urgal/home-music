# Fase 7.5 — APIs administrativas de usuários

Este documento registra a implementação da oitava atividade da Fase 7.5. As decisões gerais e invariantes continuam em `multi-user-auth.md`; a política central de autorização está em `phase-7.5-auth-policy.md`.

## Objetivo

Criar a base backend para gestão de contas sem cadastro público e sem expor campos sensíveis do SQLite.

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

## Reset de senha

O reset administrativo repete a geração de senha temporária forte, atualiza:

- `password_hash`;
- `password_must_change = 1`;
- `password_changed_at`;
- `updated_at`;

Depois revoga todas as sessões em memória associadas ao usuário alvo.

## Role, enabled e sessões

Alterar `role` ou `enabled` revoga as sessões existentes do usuário alvo imediatamente.

A autorização já resolve a role e o estado atual no SQLite a cada request, mas a revogação explícita reduz ainda mais a janela de estado antigo e segue a decisão arquitetural da Fase 7.5.

## Proteção provisória contra auto-lockout

A atividade seguinte implementará a invariável completa do último administrador ativo.

Até lá, esta API adota uma regra conservadora: operações administrativas sensíveis não podem ser aplicadas à própria conta pela árvore `/api/admin/users/*`.

Isso vale para:

- alterar a própria role;
- desativar/reativar a própria conta;
- resetar a própria senha;
- revogar as próprias sessões.

Essas tentativas retornam `409`.

Na atividade seguinte essa limitação será substituída por uma regra transacional explícita: uma alteração própria só poderá ocorrer quando não produzir zero administradores ativos nem auto-lockout.

## Login multiusuário ainda em transição

Criar uma conta nesta atividade persiste identidade e credencial corretamente, mas não antecipa a troca completa do endpoint de login para autenticação multiusuário.

O login corrente continua preservando o caminho legado/bootstrap enquanto ownership de favoritos, histórico, playlists manuais e estado do player ainda é global. Permitir login de um segundo usuário antes dessas migrations criaria vazamento lógico de dados pessoais.

Portanto a conta criada fica preparada no SQLite para o login multiusuário, que será liberado de forma coordenada quando o isolamento necessário estiver implementado.

## Semântica HTTP

- `400`: username, role ou estado inválido;
- `401`: sem sessão válida;
- `403`: sessão válida sem role `admin`;
- `404`: usuário alvo não existe;
- `409`: username duplicado ou tentativa de auto-operação provisoriamente bloqueada;
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
- bloqueio provisório das operações sobre a própria conta.

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
