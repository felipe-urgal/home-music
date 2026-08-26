# Fase 7.5 — Sessões associadas à identidade

Este documento registra a implementação da etapa de sessões da Fase 7.5 e complementa `multi-user-auth.md`.

## Objetivo

Trocar o estado interno da sessão de um simples `token -> expiresAt` para uma sessão capaz de identificar o usuário autenticado, sem migrar ainda o endpoint de login para validação direta do hash armazenado no SQLite.

## Modelo da sessão

Cada token continua sendo opaco e aleatório, com 32 bytes gerados por `randomBytes` e enviado apenas pelo cookie de sessão existente.

O registro em memória passa a ser:

```text
token
  ↓
{
  userId,
  createdAt,
  authenticatedAt,
  expiresAt
}
```

Em operação normal após o bootstrap, `userId` é o ID real do usuário persistido no SQLite.

`authenticatedAt` é registrado desde já para que operações críticas futuras possam exigir autenticação recente sem mudar novamente o formato da sessão.

## Persistência

As sessões continuam intencionalmente em memória.

Consequências:

- reiniciar o serviço encerra as sessões existentes;
- nenhum token de sessão é persistido no SQLite;
- o cookie continua contendo somente um identificador opaco;
- não é necessário JWT para o servidor self-hosted atual.

## Vínculo temporário com o login legado

Nesta etapa, `HOME_MUSIC_USER` / `HOME_MUSIC_PASSWORD` ainda validam a credencial, mas uma autenticação de produção não deve ficar desconectada do usuário persistido.

O preload resolve o vínculo antes de iniciar `index.js`:

```text
users vazio
    ↓
fallback legado de transição
sessão.userId = null

users possui registros
    ↓
username legado normalizado corresponde a usuário enabled=1?
    ├─ sim → sessão.userId = users.id
    └─ não → autenticação bloqueada
```

O fallback `userId = null` existe somente para preservar acesso se o bootstrap ainda não tiver conseguido criar nenhum usuário. Ele é temporário e será removido quando o login passar a verificar diretamente os usuários do SQLite.

## Regra contra bypass pelo `.env`

Depois que `users` possui qualquer registro, alterar `HOME_MUSIC_USER` para outro nome não cria uma segunda identidade nem um caminho de acesso paralelo.

A credencial legada precisa estar vinculada a um usuário persistido e ativo. Caso contrário, o `SessionManager` fica não configurado para autenticação.

Isso também impede que uma conta marcada como `enabled = false` continue entrando apenas porque sua antiga credencial ainda existe no `.env`.

## Revogação

O `SessionManager` suporta:

- revogar o token atual;
- revogar todas as sessões associadas a um `userId`;
- expiração por TTL;
- limite máximo de sessões em memória.

A revogação por usuário será usada nas próximas etapas para:

- desativação de conta;
- reset/troca de senha;
- alteração de papel quando aplicável;
- ação `sair de outros dispositivos`.

Sessões do fallback legado (`userId = null`) não são afetadas por `revokeUserSessions`, pois ainda não representam uma identidade persistida. Esse estado deixa de existir quando a migração de login estiver completa.

## Limites e invariantes

- token permanece CSPRNG de 32 bytes;
- sessão não contém senha, hash ou role;
- role e `enabled` não serão tratados como verdade permanente da sessão;
- `userId` identifica a conta, mas autorização futura continuará consultando o estado vigente do usuário no servidor;
- sessões expiradas são removidas quando acessadas e durante criação de novas sessões;
- em caso de colisão teórica de token, um novo token é gerado;
- um `userId` explícito inválido não pode ser usado para criar sessão programaticamente.

## Estado após esta etapa

O fluxo de produção saudável fica:

```text
.env credentials
    ↓
validação legada temporária
    ↓
vínculo com users.id
    ↓
token opaco
    ↓
SessionManager
    ↓
userId real
```

O endpoint `/api/auth/status` ainda retorna apenas `configured/authenticated`. A próxima atividade utilizará `SessionManager.getSession()` para retornar a identidade mínima (`id`, `username`, `role`) sem expor o hash ou outros dados sensíveis.

## Remoção futura do fluxo legado

`HOME_MUSIC_USER` / `HOME_MUSIC_PASSWORD` só poderão ser removidos depois que:

1. login validar `password_hash` diretamente no SQLite;
2. sessão resolver usuário ativo de forma definitiva;
3. existir recuperação local segura de administrador;
4. smoke/E2E cobrirem login sem credenciais permanentes no `.env`.

Até lá, as credenciais devem permanecer configuradas no servidor.
