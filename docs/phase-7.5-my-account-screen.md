# Fase 7.5 — Tela Minha conta

Este documento registra a interface de autosserviço da conta autenticada. Os contratos e invariantes do backend permanecem em `phase-7.5-self-service-account.md`.

## Objetivo

Dar a qualquer identidade autenticada um ponto simples para:

- visualizar a própria identidade e papel atual;
- alterar a própria senha informando a senha atual;
- encerrar as próprias outras sessões sem perder a sessão deste dispositivo.

A tela não permite editar `username`, `role` ou `enabled`. Essas propriedades continuam sob as regras administrativas do servidor.

## Entrada e disponibilidade

`Minha conta` é uma superfície autenticada para `admin` e `user`.

O acesso fica junto da experiência de biblioteca e também permanece disponível quando a biblioteca está vazia ou em erro. A tela é renderizada antes dos estados da biblioteca, portanto um problema no scanner ou nos dados musicais não impede operações de segurança da conta.

O modo offline não oferece a tela porque não existe sessão autenticada com o servidor nesse estado.

## Alteração de senha

A interface envia:

```text
POST /api/auth/password
X-Home-Music-Request: 1
```

com `currentPassword` e `newPassword`.

A validação local replica apenas os requisitos úteis de UX:

- senha atual obrigatória;
- nova senha com pelo menos 12 caracteres Unicode;
- nova senha não composta somente por whitespace;
- limite técnico de 1024 bytes UTF-8;
- nova senha diferente da atual;
- confirmação idêntica.

O backend continua sendo a autoridade final para verificação da senha atual, política, concorrência e estado da conta.

Antes de enviar, a interface deixa explícito que trocar a senha revoga todas as sessões, inclusive a atual. Depois de sucesso, o frontend relê `/api/auth/status`; como o servidor já limpou o cookie e revogou as sessões, a aplicação retorna para o login e exige a nova senha.

As senhas existem apenas em estado React durante o preenchimento. Não são gravadas em `localStorage`, `sessionStorage`, Cache Storage, IndexedDB, URL ou logs.

## Sair dos outros dispositivos

A interface envia:

```text
POST /api/auth/sessions/revoke-others
X-Home-Music-Request: 1
```

Sem `userId` no body ou na URL. O alvo é derivado exclusivamente da sessão autenticada pelo backend.

A resposta informa quantas outras sessões foram encerradas. A sessão atual permanece válida, conforme o contrato do servidor.

## Erros e fail-closed

As chamadas passam pelo cliente autenticado comum. `401` continua acionando o evento global de sessão expirada.

A interface mostra a mensagem retornada pelo servidor, sem tentar reinterpretar conflitos de credencial ou autorização. Nenhuma decisão de segurança depende de estado ou role controlados pelo frontend.

## Review de segurança

A implementação preserva as seguintes fronteiras:

- nenhuma senha é persistida pelo cliente;
- troca de senha não tenta preservar artificialmente a sessão atual;
- revogação de outras sessões não recebe `userId` controlável pelo cliente;
- `X-Home-Music-Request: 1` é enviado nas duas mutações;
- a tela é disponível para `admin` e `user`, mas não no modo offline;
- autorização, sessão e concorrência permanecem integralmente no backend.
