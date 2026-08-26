# Fase 7.5 — Status de autenticação e identidade mínima

Este documento registra a implementação da quinta atividade da Fase 7.5. As decisões e invariantes gerais continuam em `multi-user-auth.md`.

## Objetivo

Evoluir `GET /api/auth/status` para que o frontend conheça a identidade mínima autenticada sem expor senha, hash, flags internas ou outros dados sensíveis.

Contrato estável:

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

Quando não existe sessão válida, `user` é `null`.

## Fonte de verdade

A sessão continua armazenando somente `userId` como identidade. `username`, `role` e `enabled` não são tratados como verdade permanente da sessão.

Ao resolver `/api/auth/status`:

1. o cookie resolve a sessão em memória;
2. a sessão fornece `userId`;
3. o servidor consulta o usuário atual no SQLite;
4. somente usuário com `enabled = 1` é retornado;
5. o payload público contém apenas `id`, `username` e `role`.

Isso prepara a atividade seguinte, em que a mesma resolução será centralizada no contexto autenticado do Fastify para todas as rotas.

## Usuário desativado ou ausente

Se uma sessão contém `userId`, mas esse ID não corresponde mais a um usuário ativo, `/api/auth/status`:

- responde `authenticated: false`;
- responde `user: null`;
- revoga o token de sessão em memória.

A autorização de todas as rotas ainda será centralizada na atividade seguinte; esta etapa não substitui a futura política `public / authenticated / admin`.

## Fallback legado transitório

Enquanto o bootstrap do primeiro usuário ainda não tiver conseguido persistir um usuário, o mecanismo legado existente pode manter uma sessão sem `userId` para evitar lockout durante a transição.

Nesse estado excepcional e temporário, o status pode ser:

```json
{
  "configured": true,
  "authenticated": true,
  "user": null
}
```

Esse estado não é o modelo final multiusuário e será removido quando a autenticação deixar de depender das credenciais permanentes do `.env`.

## Frontend

`useAuth` passa a manter `currentUser` usando o contrato compartilhado.

Depois de um login HTTP bem-sucedido, o frontend não inventa identidade nem role com base no formulário enviado. Ele consulta novamente `/api/auth/status` e utiliza o resultado autoritativo do backend.

`currentUser` é limpo em logout, sessão expirada e falha de verificação.

A visibilidade de Administração por `role` será implementada em etapa posterior e continuará sendo apenas UX; a proteção real ficará no backend.
