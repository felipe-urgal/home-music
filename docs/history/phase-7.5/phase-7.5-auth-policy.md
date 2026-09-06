# Fase 7.5 — Contexto autenticado e política central de acesso

Este documento registra a implementação da sexta atividade da Fase 7.5. As decisões gerais e invariantes continuam em `multi-user-auth.md`.

## Objetivo

Criar uma única fronteira de autenticação/autorização para a árvore `/api/*`, evitando que cada rota implemente sua própria checagem de cookie, usuário ativo ou role.

A política suportada é:

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

## Deny by default

Dentro de `/api/*`, a ausência de configuração explícita significa `authenticated`, exceto quando a política central reconhece uma operação administrativa obrigatória.

Portanto:

- uma nova rota de API não nasce pública por acidente;
- `public` precisa ser declarado explicitamente;
- operações sob `/api/admin` e `/api/admin/*` são sempre `admin`;
- operações administrativas históricas classificadas centralmente também são sempre `admin`;
- um config local mais permissivo não reduz essas duas proteções;
- valores inválidos de política declarada são rejeitados pelo TypeScript.

`/api/auth/status` e `/api/auth/login` são as rotas públicas de autenticação atuais.

A classificação das operações administrativas históricas está registrada em `phase-7.5-admin-routes.md`.

## Contexto `request.user`

Para rotas autenticadas com sessão associada a um usuário persistido, o Fastify recebe:

```text
request.user = {
  id,
  username,
  role
}
```

O cliente nunca envia esse objeto como fonte de identidade confiável.

A resolução é sempre:

```text
cookie
  ↓
token de sessão
  ↓
session.userId
  ↓
SQLite users
  ↓
usuário ativo atual
```

A role é lida novamente do SQLite a cada request protegido. Alterar `role` ou `enabled` não depende do TTL da sessão para produzir efeito.

## Usuário desativado ou ausente

Se uma sessão possui `userId`, mas esse usuário não existe mais ou está com `enabled = 0`:

- a requisição protegida recebe `401`;
- o token é revogado em memória;
- `request.user` permanece `null`.

Falha ao consultar a fonte de identidade não abre acesso: o erro sobe como falha do servidor, mantendo o comportamento fail-closed.

## Fallback legado transitório

Enquanto o bootstrap ainda não tiver conseguido persistir o primeiro usuário, pode existir temporariamente uma sessão legada sem `userId`.

Para evitar lockout durante a migração:

- essa sessão pode acessar rotas `authenticated`;
- `request.user` permanece `null`;
- essa sessão **nunca** satisfaz `admin` e recebe `403` em rota administrativa.

Esse fallback será removido quando a autenticação deixar de depender permanentemente das credenciais do `.env`.

## Semântica HTTP

A política central usa:

- `401` quando sessão é ausente, inválida, expirada ou perdeu um usuário ativo correspondente;
- `403` quando existe autenticação suficiente para a rota comum, mas a role não permite `admin`;
- `503` quando a autenticação da instalação ainda não está configurada, preservando `/api/auth/status` para diagnóstico.

## Proteção de mutações

A checagem existente de `X-Home-Music-Request: 1` continua centralizada para `POST`, `PUT`, `PATCH` e `DELETE`.

Isso permanece defesa em profundidade junto com:

- cookie `HttpOnly`;
- `SameSite=Strict`;
- `Secure` no perfil HTTPS.

## Rotas fora de `/api/*`

A política não interfere em `/health`, `/ready` nem nos arquivos do frontend. Esses endpoints continuam com a superfície pública mínima definida na operação do Home Music.

## Testes de regressão

A atividade inclui testes para validar:

- rota `public` sem sessão;
- rota de API sem configuração explícita exigindo autenticação;
- preenchimento de `request.user` com identidade ativa;
- `user` recebendo `403` em rota `admin`;
- `admin` acessando rota `admin`;
- usuário desativado recebendo `401` e tendo sessão revogada;
- sessão legada podendo acessar `authenticated`, mas nunca `admin`;
- mutações continuando protegidas pelo header customizado;
- instalação sem autenticação configurada expondo somente o status necessário para diagnóstico.

A atividade seguinte acrescenta regressões específicas para as operações administrativas históricas e para o namespace `/api/admin/*`.
