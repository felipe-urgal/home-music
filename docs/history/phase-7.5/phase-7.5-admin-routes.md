# Fase 7.5 — Proteção das rotas administrativas existentes

Este documento registra a implementação da sétima atividade da Fase 7.5. As decisões gerais e invariantes continuam em `multi-user-auth.md`; o mecanismo central de autenticação/autorização está em `phase-7.5-auth-policy.md`.

## Objetivo

Aplicar a política `admin` às operações administrativas que já existiam antes do modelo multiusuário, sem alterar suas URLs e sem depender de esconder botões no frontend.

As operações classificadas nesta etapa são:

| Método | Rota | Motivo |
| --- | --- | --- |
| `GET` | `/api/health` | expõe diagnóstico operacional detalhado da instalação |
| `POST` | `/api/library/scan` | dispara operação global sobre a biblioteca compartilhada |
| `POST` | `/api/integrations/rekordbox/preview` | processa XML administrativo de importação/sincronização |
| `POST` | `/api/integrations/rekordbox/import` | altera playlists compartilhadas importadas do Rekordbox |

As playlists Rekordbox já importadas continuam legíveis para usuários autenticados; somente preview/reimportação/sincronização exigem `admin`.

## Classificação central

As rotas históricas mantêm seus caminhos atuais por compatibilidade, mas a política central reconhece método + path e força `admin` antes de executar o handler.

Isso significa que um config local acidentalmente permissivo não reduz a proteção dessas operações.

A classificação considera `HEAD` equivalente a `GET` para endpoints administrativos de leitura, evitando que `HEAD /api/health` fique menos protegido do que `GET /api/health`.

## Namespace administrativo futuro

Qualquer rota em:

```text
/api/admin
/api/admin/*
```

é tratada como `admin` automaticamente, mesmo que um handler futuro esqueça de declarar a role ou declare uma configuração mais permissiva.

Essa regra complementa o `deny by default` da API:

- rota comum sem configuração -> `authenticated`;
- rota `/api/admin/*` -> `admin`;
- operação histórica listada acima -> `admin`;
- `public` continua restrito aos endpoints explicitamente públicos que não pertençam ao namespace administrativo.

## Semântica esperada

Para essas operações:

- sem sessão válida -> `401`;
- sessão válida de `user` -> `403`;
- sessão legada temporária sem `userId` -> `403`;
- sessão de usuário ativo com role `admin` -> operação permitida.

A role continua sendo resolvida no SQLite em cada request protegido. Rebaixar um administrador para `user` retira o acesso na requisição seguinte.

## Frontend nesta etapa

Os controles de rescan e Rekordbox ainda podem aparecer na interface atual enquanto a adaptação visual por `currentUser.role` não for concluída.

Isso é uma limitação de UX transitória, não de segurança. O backend é a fronteira autoritativa: um `user` recebe `403` mesmo manipulando JavaScript, chamando `fetch` manualmente ou usando outro cliente HTTP.

A remoção/ocultação desses controles para `user` será feita na atividade de frontend role-aware já prevista no roadmap.

## O que permanece authenticated

Esta atividade não transforma operações pessoais ou de reprodução em administrativas. Continuam acessíveis a usuários autenticados, conforme ownership for sendo migrado nas próximas etapas:

- leitura/streaming da biblioteca;
- capas e letras;
- favoritos;
- histórico e estatísticas pessoais;
- playlists manuais pessoais;
- estado do player;
- leitura das playlists Rekordbox compartilhadas.

## Testes de regressão

A implementação cobre:

- classificação das quatro operações históricas como `admin`;
- query string sem alterar a classificação;
- `HEAD /api/health` herdando proteção de `GET`;
- `/api/admin/*` sempre exigindo admin, inclusive contra config permissivo;
- prefixos parecidos, como `/api/administrator`, não sendo confundidos com o namespace administrativo;
- `user` recebendo `403` em todas as operações listadas;
- `admin` recebendo sucesso nessas operações;
- requisição sem sessão recebendo `401`;
- rota comum da biblioteca permanecendo acessível a `user` autenticado.

## Próxima etapa

Com a fronteira administrativa existente protegida, a próxima atividade pode criar as APIs de gestão de usuários sob `/api/admin/*`, já herdando automaticamente a exigência de `admin`.
