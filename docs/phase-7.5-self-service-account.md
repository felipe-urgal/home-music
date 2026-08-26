# Fase 7.5 — Autosserviço de senha e sessões

Este documento registra a atividade da Fase 7.5 que permite ao usuário autenticado trocar a própria senha e encerrar as próprias outras sessões. As invariantes gerais permanecem em `multi-user-auth.md`; o fluxo de primeiro acesso continua detalhado em `phase-7.5-required-password-change.md`.

## Objetivo

Dar à identidade autenticada duas operações de segurança sem depender da futura tela `Minha conta`:

- trocar a própria senha informando a senha atual;
- sair dos outros dispositivos sem encerrar a sessão atual.

A interface dedicada de `Minha conta` continua sendo uma atividade posterior. Nesta etapa, o contrato e a fronteira de segurança ficam prontos no backend.

## Troca da própria senha

`POST /api/auth/password`

Body:

```json
{
  "currentPassword": "senha atual",
  "newPassword": "nova senha"
}
```

A mesma rota atende dois estados:

- `password_must_change = 1`: conclui a troca obrigatória do primeiro acesso;
- `password_must_change = 0`: permite uma troca voluntária para uma conta autenticada.

Em ambos os casos:

- a conta precisa continuar ativa;
- a senha atual é verificada com o hash `scrypt` persistido no SQLite;
- a nova senha precisa obedecer à política mínima de 12 caracteres Unicode, não ser somente whitespace e respeitar o limite técnico de 1024 bytes UTF-8;
- a nova senha precisa ser diferente da atual;
- o update usa o hash e o valor anterior de `password_must_change` como condição, falhando fechado se a conta mudar enquanto a nova KDF é calculada;
- `password_changed_at` e `updated_at` são atualizados juntos;
- `password_must_change` termina em `0`.

### Por que a troca de senha encerra todas as sessões

Mudar a credencial é uma operação mais forte do que simplesmente sair de outro dispositivo. Depois de persistir o novo hash, todas as sessões do usuário são revogadas, incluindo a sessão usada na própria troca.

A resposta limpa o cookie atual. O usuário precisa autenticar novamente com a nova senha.

Isso garante que uma sessão antiga eventualmente comprometida não continue válida depois de uma rotação de credencial.

## Sair dos outros dispositivos

`POST /api/auth/sessions/revoke-others`

Não existe `userId` no body. A identidade alvo vem exclusivamente da sessão autenticada resolvida pelo backend.

O servidor:

1. lê o token da sessão atual do cookie;
2. confirma que esse token ainda existe e pertence ao mesmo `request.user.id`;
3. remove somente os demais tokens associados ao mesmo usuário;
4. preserva a sessão atual;
5. não toca em sessões de outros usuários.

Resposta:

```json
{
  "revoked": 2
}
```

O número informa quantas outras sessões foram efetivamente removidas. Repetir a operação sem outras sessões retorna `revoked: 0`.

Se o token atual já não for válido para aquela identidade, a operação falha em vez de usar um token arbitrário como exceção e revogar sessões incorretamente.

## Autorização e proteção de mutação

As duas rotas são autenticadas e exigem `X-Home-Music-Request: 1`, como as demais mutações da API.

Uma sessão com `password_must_change = 1` continua restrita a:

- `/api/auth/status`;
- `/api/auth/password`;
- `/api/auth/logout`.

Portanto `POST /api/auth/sessions/revoke-others` permanece bloqueado com `PASSWORD_CHANGE_REQUIRED` até a troca obrigatória ser concluída.

O fallback legado sem `userId` não pode executar autosserviço de sessões, pois não representa uma identidade persistida capaz de definir quais sessões pertencem à própria conta.

## Concorrência

A troca de senha mantém a proteção contra estado stale já usada no primeiro acesso:

- verifica a senha atual fora da transação para não segurar lock durante `scrypt`;
- deriva o novo hash de forma assíncrona;
- abre `BEGIN IMMEDIATE` somente para a escrita;
- condiciona o `UPDATE` ao hash e à flag observados antes da derivação;
- se reset, desativação ou outra troca ocorrer em paralelo, o update não casa e a operação retorna conflito sem revogar sessões.

A revogação de outras sessões é inteiramente em memória e valida novamente o token preservado antes de remover qualquer sessão.

## Escopo transitório

O login normal de usuários secundários com `password_must_change = 0` continua deliberadamente adiado até as migrations de ownership de favoritos, histórico, playlists manuais e estado de reprodução.

Assim, esta atividade prepara o autosserviço para qualquer identidade autenticada sem antecipar a exposição de dados pessoais ainda globais.

## Testes de regressão

A cobertura desta etapa inclui:

- troca obrigatória usando o mesmo serviço genérico de troca autenticada;
- troca voluntária com senha atual válida;
- rejeição de senha atual incorreta, senha fraca e senha idêntica;
- rejeição de conta inválida/desativada;
- conflito quando reset/troca concorrente modifica hash ou flag durante `scrypt`;
- revogação de todas as sessões após mudança de senha;
- revogação somente das outras sessões no fluxo `revoke-others`;
- preservação da sessão atual e das sessões de outros usuários;
- rejeição de token preservado que não pertence ao usuário alvo;
- bloqueio de `revoke-others` enquanto `password_must_change = 1`;
- exigência do header de proteção de mutação;
- indisponibilidade da operação para sessão legada sem identidade persistida.
