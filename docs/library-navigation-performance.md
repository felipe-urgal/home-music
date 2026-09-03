# Performance da navegação da biblioteca

Este documento registra a decisão de arquitetura e a evidência de performance da issue [#238](https://github.com/felipe-urgal/home-music/issues/238), implementada no PR [#250](https://github.com/felipe-urgal/home-music/pull/250).

## Objetivo

Reduzir recomputações O(n) repetidas em `useLibraryNavigation()` sem alterar semântica de busca, filtros, ordenação, playlists ou navegação por pastas e sem criar uma segunda fonte de verdade para a biblioteca.

## Arquitetura

A navegação mantém uma projeção **derivada e descartável** do snapshot canônico recebido do backend. A `libraryRevision` é a identidade primária dessa projeção; quando a revision muda, o índice inteiro é reconstruído. Quando não existe revision útil (`revision === 0`), a identidade do array de faixas é usada como fallback conservador.

O índice contém:

- `trackMap` por id;
- texto de busca normalizado uma única vez por faixa;
- visões e membership de pastas por caminho;
- formatos disponíveis por pasta;
- estatísticas estruturais para tornar o custo adicional observável.

A ordenação continua dinâmica. Não são mantidas seis cópias pré-ordenadas da biblioteca, porque isso multiplicaria referências em memória sem evidência que justificasse o custo.

## Segurança semântica

Os testes exigem:

- equivalência entre a projeção indexada e `buildFolderView()`;
- equivalência de busca, filtro e ordenação com e sem o texto pré-normalizado;
- invalidação quando `libraryRevision` muda;
- fallback por identidade do array quando revision não está disponível;
- limite estrutural de referências de pastas proporcional a `N × (D + 2)`, onde `N` é o número de faixas e `D` a profundidade máxima.

## Benchmark comparativo

O guard `apps/web/src/large-library.performance.test.tsx` compara o caminho legado e o indexado **no mesmo processo**, com os mesmos datasets e as mesmas interações. Cada medição faz uma execução de aquecimento e usa a mediana de cinco execuções. Antes de medir, o teste exige equivalência dos resultados.

O gate protege ganhos mínimos de:

- busca indexada `<= 90%` do tempo do caminho legado, ou pelo menos 10% de redução;
- navegação de pastas indexada `<= 25%` do tempo do caminho legado, ou pelo menos 75% de redução.

### Evidência do GitHub Actions

Workflow run: `33743828453`, reexecução final do job `100612290853`, em 2026-09-03.

| Dataset | Medição | Legado | Indexado | Redução observada |
| ---: | --- | ---: | ---: | ---: |
| 10.000 | busca repetida | 54,20 ms | 3,79 ms | ~93,0% |
| 10.000 | navegação de pastas | 6,59 ms | < 0,01 ms no relatório arredondado | > 99% na precisão exibida |
| 25.000 | busca repetida | 127,71 ms | 10,01 ms | ~92,2% |
| 25.000 | navegação de pastas | 16,45 ms | < 0,01 ms no relatório arredondado | > 99% na precisão exibida |

O valor de pastas aparece como `0,00 ms` no JSON porque o relatório arredonda para duas casas decimais. Ele **não deve ser interpretado como tempo matematicamente zero**.

### Custo inicial e memória

| Dataset | Construção do índice | `heapDeltaMb` observado | Referências de pasta | Profundidade máxima |
| ---: | ---: | ---: | ---: | ---: |
| 10.000 | 56,25 ms | 20,09 MB | 50.000 | 3 |
| 25.000 | 180,47 ms | 6,75 MB | 125.000 | 3 |

`heapDeltaMb` é observacional e sensível ao garbage collector; não é usado isoladamente como garantia estrutural. O bound verificável é o número de referências: no dataset medido, `D = 3`, portanto o teto `N × (D + 2)` é exatamente 50.000 para 10k e 125.000 para 25k.

O mesmo run manteve verdes os guardrails gerais do frontend. No cenário rápido de 10k, por exemplo, o processo observou máximo de 42,78 MB de heap e 413,11 MB de RSS, ambos muito abaixo dos budgets existentes.

## Validação integrada

No mesmo head do PR #250, o CI validou com sucesso:

- typecheck;
- regressões de segurança;
- suíte funcional completa;
- heavy-work memory guard;
- benchmark rápido de biblioteca grande, incluindo o comparativo 10k/25k acima;
- backup/restore e scripts operacionais;
- build de produção;
- benchmark Chromium real de 10k/25k;
- Critical Playwright E2E;
- production smoke test.

A primeira tentativa desse run teve uma única falha intermitente no teste assíncrono de importação por URL do backend, cuja janela de polling é curta. O mesmo teste havia passado no run completo anterior e passou na reexecução integral sem qualquer alteração no backend; por isso não foi feita uma mudança fora do escopo da #238 para mascarar um flake isolado.

## Critério de manutenção

Mudanças futuras na navegação devem preservar:

1. snapshot do backend como única fonte de verdade;
2. invalidação explícita do índice por revision;
3. equivalência semântica antes de comparar performance;
4. ganhos mínimos do benchmark comparativo 10k/25k;
5. bounds de memória e budgets do benchmark browser-real.

Qualquer relaxamento dos thresholds deve ser sustentado por medição equivalente e registrado em issue/PR; não aumente limites apenas para fazer o CI passar.
