# Code splitting das superfícies secundárias

Este documento registra a política de carregamento sob demanda do frontend entregue pela issue #236 e pelo PR #249.

## Objetivo

Manter o fluxo principal da biblioteca fora do custo de download e avaliação das superfícies secundárias que não são necessárias para a navegação normal.

O code splitting é uma otimização de entrega do frontend. Ele **não substitui autorização**: regras de sessão, papel e permissões continuam sendo validadas pelas rotas e pelo backend.

## Superfícies sob demanda

| Superfície | Quando é carregada | Chunk esperado |
| --- | --- | --- |
| Administração | ao entrar em `/admin` ou navegar para Administração com autorização existente | `AdministrationScreen-*` |
| Minha conta | ao entrar na superfície de conta | `MyAccountScreen-*` |
| Aplicação offline | quando `offlineMode` passa a ser a autoridade ativa da composição | `OfflineApp-*` |

As três superfícies usam `React.lazy` e `Suspense`, preservando as decisões de roteamento e composição já existentes.

## Estado de carregamento e recuperação

Enquanto um chunk secundário é carregado, a aplicação exibe um estado acessível com `role="status"` e `aria-live="polite"`.

Se o import dinâmico falhar, a superfície apresenta uma recuperação explícita por recarregamento da página. Esse fluxo cobre, entre outros casos, assets antigos removidos depois de um deploy enquanto uma aba ainda aponta para o bundle anterior.

O service worker não deve transformar esse fallback em uma falsa garantia de disponibilidade. Os testes que simulam chunk indisponível bloqueiam service workers para que a falha seja exercitada de forma determinística.

## Invariantes de segurança e navegação

- usuário comum não deve baixar o chunk administrativo durante o fluxo normal da biblioteca;
- navegar para Administração continua dependendo das mesmas regras de autorização existentes;
- abrir `/admin` diretamente continua funcionando quando a sessão tem permissão;
- o modo offline continua sendo decidido por `offlineMode`; o lazy loading apenas retira `OfflineApp` do grafo inicial;
- nenhum controle de acesso do backend foi movido para o frontend ou relaxado por esta otimização.

## Budget de bundle

`npm run build` executa `apps/client/scripts/check-bundle-budgets.ts`. O build falha se um chunk obrigatório desaparecer ou ultrapassar os guardrails versionados abaixo.

| Grupo | raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| entrypoint `index-*` | 1.750.000 B | 430.000 B | 340.000 B |
| Administração | 1.000.000 B | 245.000 B | 190.000 B |
| Minha conta | 300.000 B | 75.000 B | 60.000 B |
| Offline | 750.000 B | 160.000 B | 135.000 B |

Esses valores são **limites de regressão**, não medições históricas. O relatório do build calcula e imprime os tamanhos raw, gzip e Brotli dos artefatos produzidos naquele head.

## Cobertura automatizada

A entrega mantém as seguintes provas automatizadas:

- teste unitário do estado de loading e da recuperação após rejeição de um import lazy;
- E2E que confirma que `/library` não solicita `AdministrationScreen-*`;
- E2E que confirma o carregamento do chunk administrativo somente ao navegar para Administração;
- E2E de deep link direto em `/admin`;
- build com budget obrigatório dos chunks;
- suíte crítica, benchmark Chromium e smoke de produção como gates do CI.

Quando uma nova superfície secundária entrar no grafo principal, avalie primeiro se ela deve seguir esta mesma política. Evite subdividir componentes pequenos apenas para aumentar a quantidade de chunks: o objetivo é reduzir custo inicial sem criar overhead de requests sem benefício medido.
