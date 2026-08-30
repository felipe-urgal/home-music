# Minha conta

Este documento registra a superfície autenticada **atual** de autosserviço e preferências. Os contratos e invariantes do backend continuam em `phase-7.5-self-service-account.md` e nos documentos específicos de autenticação.

## Objetivo

`Minha conta` reúne em uma única navegação os fluxos pessoais do usuário autenticado:

- Perfil;
- Alterar senha;
- Outros dispositivos / sessões;
- Reprodução;
- Administração, somente para `admin`.

A tela não permite que um usuário comum altere `role` ou `enabled`. Gerenciamento de outras contas pertence a **Administração → Usuários**.

## Layout atual

Após o ciclo de redesign de 2026, as superfícies de Minha conta são **fluidas**: não usam mais uma coleção de `max-width` estreitos por tela.

Regra de composição:

- desktop: usa praticamente toda a área útil, com cerca de 24 px de respiro lateral;
- telas médias: cerca de 16 px de respiro;
- mobile: cerca de 10 px;
- nenhum card deve encostar na borda da viewport;
- conteúdo simples continua agrupado visualmente, mas sem limitar artificialmente a largura do container pai.

A escala tipográfica do ciclo atual evita textos auxiliares excessivamente pequenos; novos fluxos administrativos adotam piso visual de aproximadamente 13 px para labels/auxiliares.

## Perfil

Mostra somente informações existentes no modelo atual, como:

- nome de usuário;
- papel (`Administrador` ou `Usuário`);
- contexto da conta atual.

Não inventa campos de e-mail, avatar remoto ou dados pessoais que o backend não possui.

## Alterar senha

A interface envia:

```text
POST /api/auth/password
X-Home-Music-Request: 1
```

com `currentPassword` e `newPassword`.

A validação de UX cobre:

- senha atual obrigatória;
- nova senha com pelo menos 12 caracteres Unicode;
- nova senha não composta somente por whitespace;
- limite técnico de 1024 bytes UTF-8;
- nova senha diferente da atual;
- confirmação idêntica.

O backend continua sendo a autoridade final.

Depois de uma troca bem-sucedida, as sessões da conta são revogadas conforme a regra do servidor e o usuário volta ao login para autenticar com a nova senha.

As senhas existem apenas em estado transitório do frontend e não são persistidas pela aplicação.

## Outros dispositivos

A superfície de sessões permite revisar os acessos ativos da própria conta e encerrar sessões sem fornecer `userId` controlável pelo cliente.

A operação de revogar as outras sessões usa:

```text
POST /api/auth/sessions/revoke-others
X-Home-Music-Request: 1
```

A sessão atual é preservada nesse fluxo específico.

Quando a interface oferece encerramento de sessão individual, o backend valida que o alvo pertence ao usuário autenticado.

## Reprodução

Preferências por dispositivo incluem qualidade de streaming e normalização ReplayGain.

Qualidade atual:

- Por conexão;
- Automática;
- Original;
- Economia.

Normalização:

- Desativada;
- Por faixa;
- Por álbum.

Essas preferências não concedem acesso administrativo e não alteram o arquivo original.

## Administração

Somente `admin` vê a entrada **Administração**.

O cockpit administrativo atual dá acesso a:

- Gerenciar músicas;
- Importar mídia;
- Integridade da biblioteca;
- Usuários;
- Metadados;
- Lixeira;
- Histórico operacional e manutenção relacionada.

A autorização real continua no backend. Ocultar a entrada para `user` é apenas UX.

## Disponibilidade

Minha conta permanece acessível mesmo quando a biblioteca está vazia ou apresenta erro, porque segurança/identidade não devem depender do scanner musical.

O modo offline não oferece operações autenticadas de conta, já que não existe sessão confirmada com o servidor nesse estado.

## Segurança

- nenhuma senha é persistida pelo cliente;
- mutações usam `X-Home-Music-Request: 1`;
- `401` continua acionando o fluxo global de sessão expirada;
- role exibida no frontend não é fonte de autorização;
- APIs de autosserviço derivam o alvo da sessão autenticada;
- erros exibidos não devem incluir segredos.
