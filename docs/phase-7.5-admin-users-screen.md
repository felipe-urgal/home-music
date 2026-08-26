# Fase 7.5 — Tela administrativa de usuários

## Objetivo

Disponibilizar no frontend uma superfície simples para administradores gerenciarem contas usando exclusivamente as APIs administrativas já protegidas pelo backend.

Não existe cadastro público. Usuários comuns não recebem ponto de entrada para esta tela e chamadas manuais continuam sujeitas à política `admin` do servidor.

## Acesso

A tela usa `currentUser` vindo de `/api/auth/status` e só recebe navegação quando `role === 'admin'`.

Essa regra é apenas UX. Ela não substitui autorização: todo `/api/admin/*` continua validado no backend.

O acesso fica disponível na biblioteca autenticada. A tela é independente do carregamento dos dados da biblioteca, então uma falha de scan/listagem de músicas não impede operações administrativas de contas.

## Operações

A tela permite:

- listar contas;
- criar usuário com papel `user` ou `admin`;
- alterar papel de outra conta;
- ativar ou desativar outra conta;
- gerar nova senha temporária para outra conta;
- revogar sessões de outra conta.

A própria conta é apresentada como `você`, mas as ações administrativas sobre ela ficam indisponíveis. O backend continua aplicando a mesma restrição e também protege a invariável do último administrador ativo.

## Senha temporária

Criação e reset retornam uma senha temporária somente naquela resposta.

O frontend:

- mantém a senha somente em estado React;
- não grava a credencial em `localStorage`, `sessionStorage`, Cache Storage ou IndexedDB;
- não inclui a senha em URL;
- não registra a senha em logs;
- substitui a credencial exibida quando outra criação/reset é concluída;
- permite copiar explicitamente para o clipboard;
- permite dispensar imediatamente a credencial da tela.

Se a senha temporária for perdida, o fluxo correto é gerar outro reset.

## Confirmações e sessões

Mudanças sensíveis exigem confirmação visual antes da chamada:

- alteração de papel;
- ativação/desativação;
- reset de senha;
- revogação de sessões.

O texto deixa explícito quando a operação revoga sessões. A revogação efetiva continua sendo responsabilidade do backend.

## Requests

As mutações reutilizam `apiFetch` e enviam `X-Home-Music-Request: 1`.

IDs de usuário são codificados com `encodeURIComponent` antes de entrarem no path. Erros HTTP exibem somente a mensagem pública retornada pela API.

## Layout

A composição é responsiva:

- formulário compacto de criação no topo;
- lista em cards no mobile/tablet;
- duas colunas em desktop quando houver espaço;
- estado ativo/inativo e papel visíveis sem abrir detalhe;
- ações da conta atual substituídas por uma indicação de que o autosserviço ficará em `Minha conta`.

## Escopo

Esta atividade não altera:

- schema SQLite;
- hashing de senha;
- regras de último admin;
- política de autorização;
- contrato das APIs administrativas;
- fluxo de `Minha conta`, que permanece como próxima atividade separada.
