# AGENTS.md — contratos compartilhados (`packages/shared`)

Estas regras complementam o `AGENTS.md` da raiz para mudanças em `packages/shared`.

## Papel do pacote

`@home-music/shared` contém contratos e tipos que atravessam frontend/backend. Ele não é um depósito genérico para qualquer tipo reutilizável.

Coloque aqui apenas estruturas que representam contrato real entre camadas, por exemplo:

- requests/responses HTTP;
- modelos públicos consumidos pelos dois lados;
- enums/unions cujo significado precisa ser idêntico em cliente e servidor;
- constantes que fazem parte explícita do mesmo contrato de produto.

Tipos internos de React, Fastify, SQLite, filesystem ou implementação local permanecem no workspace responsável.

## Fonte de verdade

Quando um contrato estiver em `packages/shared`:

- frontend e backend importam o mesmo tipo em vez de manter cópias paralelas;
- o tipo compartilhado descreve o contrato público, não necessariamente o shape interno do banco/store;
- transformação entre modelo interno e resposta pública permanece na camada responsável;
- não exponha path físico, segredo ou detalhe interno apenas porque ele existe no modelo do servidor.

Evite tipos compartilhados excessivamente permissivos que escondam estados inválidos. Prefira unions discriminadas, campos opcionais somente quando o contrato realmente permitir ausência e nomes que expressem semântica de domínio.

## Mudanças de contrato

Toda alteração deve ser analisada nos consumidores dos dois lados:

```text
packages/shared
  -> apps/server
  -> apps/web
  -> e2e/integrações quando aplicável
```

Antes de remover/renomear campo ou alterar semântica:

- procure usos no servidor e frontend;
- confira persistência/compatibilidade quando o dado deriva de SQLite;
- confira clientes antigos/fluxos offline quando o formato puder sobreviver entre versões;
- atualize testes e documentação funcional que tratem o contrato.

Adicionar campo opcional não é automaticamente compatível se o consumidor assumir um estado diferente. Verifique comportamento real.

## Segurança

O pacote compartilhado não concede autoridade ao cliente.

- `userId`, role, paths, flags administrativas ou decisões de segurança enviados pelo frontend continuam sendo input não confiável;
- autenticação/autorização/ownership são resolvidos no servidor;
- não compartilhe tipos que incentivem o cliente a enviar segredo, path físico ou estado interno desnecessário;
- respostas públicas devem permanecer sanitizadas.

## Dependências e runtime

Mantenha `packages/shared` leve e independente de runtime específico.

- não introduza dependência React/Fastify/Node apenas para modelar contrato;
- não mova regra de negócio executável para cá só porque é usada pelos dois lados; compartilhe regra somente quando houver ownership realmente comum e sem acoplamento de runtime;
- preserve o build TypeScript simples do workspace.

## Validação

Para mudança de contrato, valide ao menos os consumidores afetados. O gate canônico da raiz continua:

```bash
npm run check
```

Em investigação focada, o workspace oferece:

```bash
npm run typecheck -w @home-music/shared
```

Como o pacote não possui suíte funcional própria, regressões comportamentais devem ser protegidas nos workspaces consumidores que dão significado ao contrato.
