# Administração — Usuários

Este documento registra a superfície **atual** de gerenciamento de contas. Os contratos e invariantes do backend continuam documentados em `phase-7.5-admin-users-api.md`, `phase-7.5-auth-policy.md` e `multi-user-auth.md`.

## Objetivo

Permitir que administradores gerenciem contas sem transformar o frontend em fronteira de autorização.

Não existe cadastro público. Usuários comuns não recebem acesso à superfície e chamadas manuais continuam sujeitas à política `admin` do servidor.

## Entrada

O fluxo fica em:

```text
Minha conta
  ↓
Administração
  ↓
Usuários
```

A interface usa `currentUser` vindo de `/api/auth/status` apenas para UX. Toda mutação continua autorizada no backend.

## Listagem atual

Após o redesign do PR #180, a listagem usa **tabela ampla + inspetor contextual**:

- busca por username;
- filtro por papel;
- papel e status visíveis na tabela;
- data de criação;
- usuário selecionado destacado;
- painel lateral com identidade, papel, status, datas e estado da senha;
- largura fluida dentro de Minha conta/Administração;
- abaixo de 940 px, o inspetor se reorganiza em uma única coluna.

A própria conta pode ser inspecionada, mas ações administrativas sobre ela não são oferecidas. Ajustes pessoais pertencem a **Minha conta**.

## Criar usuário

`Novo usuário` abre uma superfície focada, não um card pequeno dentro da tabela.

O administrador informa:

- nome de usuário;
- papel `user` ou `admin`.

A senha temporária é **sempre gerada automaticamente** pelo servidor. Não existe toggle configurável para essa regra.

Depois da criação, a credencial temporária é mostrada somente no estado da interface e deve ser copiada antes de ser descartada.

## Editar usuário

O fluxo de edição separa três áreas:

1. **Informações da conta** — username, papel e status;
2. **Segurança** — redefinir senha e revogar sessões;
3. **Zona de perigo** — remover usuário.

Alterações de papel/status continuam sujeitas às invariantes do backend, inclusive proteção contra remover/rebaixar o último administrador ativo e contra auto-lockout.

## Senha temporária

Criação e reset retornam uma senha temporária somente naquela resposta.

O frontend:

- mantém a credencial somente em estado React;
- não grava senha em `localStorage`, `sessionStorage`, Cache Storage ou IndexedDB;
- não coloca a senha em URL/log;
- permite cópia explícita para o clipboard;
- exige confirmação antes de navegar/trocar de usuário quando uma credencial ainda está visível e poderia ser perdida;
- permite dispensar a credencial conscientemente.

Se a senha for perdida, o fluxo correto é gerar outro reset.

## Ações rápidas do inspetor

Para outra conta administrável:

- editar usuário;
- redefinir senha;
- revogar sessões.

A remoção permanente da conta permanece dentro da tela de edição, em uma zona de perigo separada das ações comuns.

## Requests e segurança

As mutações reutilizam `apiFetch` e enviam:

```text
X-Home-Music-Request: 1
```

IDs de usuário entram no path codificados com `encodeURIComponent`.

O frontend não recebe `userId` arbitrário como autoridade e não pode substituir as regras do servidor. A própria conta e o último administrador continuam protegidos mesmo se alguém construir a request manualmente.

## Estados de erro e navegação

- erros HTTP exibem somente a mensagem pública da API;
- ações ficam desabilitadas enquanto outra mutação da conta está em andamento;
- fechar o inspetor realmente remove a seleção contextual;
- refresh atualiza a lista sem inventar estado local;
- credencial temporária pendente recebe proteção contra descarte silencioso.

## Escopo não alterado pelo redesign

O redesign não mudou:

- schema SQLite;
- hashing de senha;
- política de autorização;
- contratos das APIs administrativas;
- regra de último administrador;
- ownership de dados pessoais;
- fluxo de autosserviço de Minha conta.
