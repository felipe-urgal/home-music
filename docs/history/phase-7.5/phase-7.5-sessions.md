# Fase 7.5 — Sessões associadas à identidade

Este documento registra a implementação da etapa de sessões da Fase 7.5 e complementa `multi-user-auth.md`.

## Objetivo

Trocar o estado interno da sessão de um simples `token -> expiresAt` para uma sessão capaz de identificar o usuário autenticado, preservando a transição segura do login legado enquanto as migrations de ownership ainda não estão completas.

## Modelo da sessão

Cada token continua sendo opaco e aleatório, com 32 bytes gerados por `randomBytes` e enviado apenas pelo cookie de sessão existente.

O registro em memória é:

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

Enquanto o login multiusuário completo aguarda as migrations de ownership, o primeiro usuário legado vinculado continua sendo reconhecido pelo username configurado no `.env`, mas sua senha atual é validada pelo hash persistido no SQLite.

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

O fallback `userId = null` existe somente para preservar acesso se o bootstrap ainda não tiver conseguido criar nenhum usuário. Ele é temporário e será removido quando o login passar a verificar diretamente todos os usuários do SQLite.

## Regra contra bypass pelo `.env`

Depois que `users` possui qualquer registro, alterar `HOME_MUSIC_USER` para outro nome não cria uma segunda identidade nem um caminho de acesso paralelo.

A credencial legada precisa estar vinculada a um usuário persistido e ativo. Caso contrário, o `SessionManager` fica não configurado para autenticação.

Isso também impede que uma conta marcada como `enabled = false` continue entrando apenas porque sua antiga credencial ainda existe no `.env`.

## Revogação

O `SessionManager` suporta:

- revogar o token atual;
- revogar todas as sessões associadas a um `userId`;
- revogar somente as outras sessões de um `userId`, preservando um token atual validado;
- expiração por TTL;
- limite máximo de sessões em memória.

A revogação de todas as sessões por usuário é usada para eventos que mudam a segurança da conta, como:

- desativação;
- reset de senha;
- troca de senha;
- alteração de papel quando aplicável.

A ação de autosserviço `POST /api/auth/sessions/revoke-others` usa a variante que preserva a sessão atual. Antes de remover qualquer token, o `SessionManager` confirma que o token preservado ainda está ativo e pertence ao mesmo `userId`. Se não pertencer, a operação falha em vez de usar uma exceção arbitrária.

Sessões do fallback legado (`userId = null`) não participam do autosserviço por identidade, pois ainda não representam uma conta persistida. Esse estado deixa de existir quando a migração de login estiver completa.

O contrato completo da ação de autosserviço está em `phase-7.5-self-service-account.md`.

## Limites e invariantes

- token permanece CSPRNG de 32 bytes;
- sessão não contém senha, hash ou role;
- role e `enabled` não são tratados como verdade permanente da sessão;
- `userId` identifica a conta, mas a autorização consulta o estado vigente do usuário no servidor;
- sessões expiradas são removidas quando acessadas e durante criação de novas sessões;
- em caso de colisão teórica de token, um novo token é gerado;
- um `userId` explícito inválido não pode ser usado para criar sessão programaticamente;
- `revokeUserSessionsExcept` nunca preserva um token pertencente a outro usuário.

## Estado atual

O fluxo saudável do primeiro administrador fica:

```text
username legado configurado
    ↓
vínculo com users.id
    ↓
password_hash atual do SQLite
    ↓
token opaco
    ↓
SessionManager
    ↓
userId real
```

`/api/auth/status` resolve a identidade mínima pública (`id`, `username`, `role`) e informa `passwordChangeRequired` separadamente. A sessão continua armazenando somente `userId` e metadados temporais; role, enabled e necessidade de troca são resolvidos do estado atual do usuário.

O login normal dos usuários secundários permanece adiado até as migrations de ownership de favoritos, histórico, playlists manuais e estado de reprodução.

## Remoção futura do fluxo legado

`HOME_MUSIC_USER` / `HOME_MUSIC_PASSWORD` só poderão ser removidos depois que:

1. login validar `password_hash` diretamente no SQLite para todas as contas;
2. sessão resolver usuário ativo de forma definitiva;
3. existir recuperação local segura de administrador;
4. smoke/E2E cobrirem login sem credenciais permanentes no `.env`.

Até lá, as credenciais devem permanecer configuradas no servidor.
