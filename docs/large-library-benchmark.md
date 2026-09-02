# Benchmark de biblioteca grande

Este documento descreve os gates de performance para bibliotecas grandes. O objetivo é detectar **regressões graves e reproduzíveis** sem transformar o CI em um microbenchmark sensível a pequenas oscilações do runner.

Existem dois níveis complementares:

1. **gate rápido Node/SSR** — cobre scan, persistência/projeção pública e algoritmos/renderização isolada do frontend;
2. **cenário browser-real Chromium** — cobre o caminho percebido pelo usuário com build de produção, Fastify, HTTP, SQLite e React no navegador.

## Princípios

- os datasets são totalmente sintéticos e não usam dados reais do usuário;
- nenhum cenário depende de internet pública;
- os cenários exercitam código de produção, não cópias simplificadas dos algoritmos;
- tempos absolutos usam limites deliberadamente largos;
- correção funcional continua sendo responsabilidade das suítes normais;
- os benchmarks imprimem relatório JSON para comparação entre execuções;
- relaxar um limite exige evidência registrada em issue/PR; não aumente o teto apenas para fazer o CI passar.

## Como executar

Na raiz do repositório, o gate rápido continua disponível com:

```bash
npm run benchmark:large-library
```

O comando executa primeiro o benchmark do servidor e depois o guard do frontend.

Depois de instalar o Chromium do Playwright, execute o cenário browser-real com:

```bash
npm run benchmark:large-library:browser
```

Por padrão o runner browser-real executa sequencialmente bibliotecas de **10.000** e **25.000** faixas. Para diagnóstico local é possível controlar tamanhos e repetições:

```bash
HOME_MUSIC_BROWSER_BENCHMARK_TRACKS=10000 HOME_MUSIC_BROWSER_BENCHMARK_RUNS=3 npm run benchmark:large-library:browser
HOME_MUSIC_BROWSER_BENCHMARK_TRACKS=50000 npm run benchmark:large-library:browser
```

O perfil de 50k é suportado para investigação manual, mas não precisa fazer parte do gate padrão caso o custo do CI deixe de ser previsível.

## Gate rápido — servidor

O runner `apps/server/src/large-library.benchmark.ts` cria em diretório temporário:

- 2.000 arquivos WAV PCM válidos;
- 1 amostra de áudio por arquivo, suficiente para atravessar `music-metadata` sem depender de mídia externa;
- árvore determinística de gênero/artista/álbum;
- nenhum download, fixture binária versionada ou dado real.

O diretório é removido ao final, inclusive em caso de falha.

### Cenários do servidor

1. **Scan inicial** — percorre filesystem, valida caminhos, lê metadata e cria o índice completo.
2. **Scan incremental sem mudanças** — percorre a mesma árvore reutilizando o snapshot anterior; metadata não deve ser relida para arquivos com `size + mtime` idênticos.
3. **Scan incremental com uma mudança** — altera apenas o `mtime` de uma faixa e exige exatamente uma atualização.
4. **Payload público** — usa a mesma projeção pública do `LibraryService`, materializa e serializa a resposta equivalente da biblioteca sem os campos privados de filesystem.
5. **Memória** — registra heap e RSS observados durante os cenários.

### Limites de regressão grave do servidor

| Medição | Limite padrão |
| --- | ---: |
| scan inicial de 2.000 WAV | 30.000 ms |
| scan incremental sem mudanças | 5.000 ms |
| scan incremental com uma mudança | 6.000 ms |
| materialização/serialização do payload público | 2.000 ms |
| heap usado | 512 MiB |
| RSS | 1.024 MiB |

Esses tetos não representam uma meta de latência do produto. São guardrails para capturar mudanças de ordem de grandeza, loops acidentais, retenção de memória ou regressões equivalentes.

## Gate rápido — frontend Node/SSR

O runner `apps/web/src/large-library.performance.test.tsx` usa 10.000 objetos `Track` sintéticos e determinísticos, distribuídos entre formatos, artistas, álbuns, capas e caminhos de pasta.

A renderização usa `LIBRARY_PAGE_SIZE`, atualmente 100 itens, preservando o contrato real de paginação inicial da biblioteca.

### Cenários do frontend

1. **Decode do payload** — `JSON.parse` do snapshot de 10.000 faixas.
2. **Projeção de pastas** — executa `buildFolderView` sobre o conjunto completo.
3. **Busca/filtro/ordenação** — executa `applyTrackView` com busca normalizada, formato e ordenação reais.
4. **Renderização da primeira página** — usa `renderToStaticMarkup` sobre o componente real `LibraryTrackRows` com 100 faixas.
5. **Memória** — registra heap e RSS do processo do runner.

### Limites de regressão grave do frontend rápido

| Medição | Limite |
| --- | ---: |
| decode do payload | 1.500 ms |
| projeção de pastas | 1.500 ms |
| busca/filtro/ordenação | 1.500 ms |
| SSR da primeira página | 1.500 ms |
| heap usado | 768 MiB |
| RSS | 1.536 MiB |

## Cenário browser-real — Chromium

O runner `e2e/scripts/run-large-library-benchmark.mjs` executa uma configuração Playwright dedicada somente em desktop Chromium. O servidor é o build real de produção servido pelo Fastify em loopback.

Para manter o cenário grande rápido e determinístico, `e2e/scripts/start-server.mjs` cria o SQLite temporário e, quando o modo de benchmark está ativo, semeia o snapshot usando **`HomeMusicDatabase.syncTracks`**, a mesma API de persistência usada pela aplicação. Assim o teste mede carregamento do snapshot persistido, projeção pública, serialização HTTP e comportamento real do React/Chromium sem introduzir o custo variável de gerar e parsear dezenas de milhares de arquivos de áudio. O scanner físico continua protegido pelo gate rápido do servidor.

As faixas sintéticas possuem ids, títulos, artistas, álbuns, formatos, duração e tamanhos determinísticos. Elas não apontam para mídia real e não são reproduzidas pelo cenário.

### O que é medido

Para cada tamanho configurado, o teste registra:

- **tempo até biblioteca utilizável** após reload autenticado, incluindo bootstrap da aplicação, `/api/library`, processamento React e primeira página de 100 faixas;
- **Resource Timing de `/api/library`**: duração, bytes transferidos, body codificado e body decodificado;
- **bundle inicial**: soma de recursos de `/assets/` observados no primeiro carregamento frio do contexto Chromium;
- **long tasks**: quantidade, duração acumulada e maior bloqueio do main thread quando a Long Tasks API está disponível;
- **busca** por uma faixa única;
- **filtro** real por formato;
- **ordenação** real por título;
- **crescimento da lista** de 100 para 200 linhas usando `Mostrar mais`;
- **memória do Fastify**: heap e RSS correntes/máximos por uma sonda carregada somente no processo E2E;
- **heap JS do Chromium**, quando `performance.memory` estiver disponível, como dado observacional.

O browser heap não é usado como gate rígido enquanto a estabilidade dessa API não estiver comprovada entre versões/runners. Payload, bundle, bloqueio, interações e memória do servidor possuem guardrails explícitos.

### Tamanhos e budgets

O gate padrão usa 10k e 25k. Os budgets ficam no próprio `e2e/benchmarks/large-library.spec.ts` e devem ser derivados de amostragem repetida no mesmo tipo de runner, com margem suficiente para ruído normal do GitHub Actions. A intenção é falhar mudanças de ordem de grandeza, não variações pequenas entre máquinas.

No PR que introduz ou recalibra o cenário:

1. rode o benchmark em mais de uma execução equivalente;
2. registre a faixa observada neste documento;
3. mantenha margem sobre o pior caso saudável;
4. investigue regressões antes de relaxar um teto;
5. repita o CI completo no head final depois de qualquer ajuste.

## Baseline inicial — gate rápido

A baseline original de aceitação foi estabelecida em **2026-09-01** no PR #204, usando GitHub Actions `ubuntu-latest` e Node.js 22.

Referência validada do código do benchmark:

- workflow run: [33497407869](https://github.com/felipe-urgal/home-music/actions/runs/33497407869);
- commit validado: `f357a2dc8776e1fa0d305fec0893191cfba4af7b`;
- etapa `Large library performance guard`: **PASS**;
- typecheck, regressões de segurança, testes funcionais, backup/restore smoke, build, Playwright crítico e smoke de produção no mesmo commit: **PASS**.

| Guardrail | Dataset de referência | Resultado no run 33497407869 |
| --- | --- | --- |
| scan inicial | 2.000 WAV sintéticos | PASS (`<= 30.000 ms`) |
| incremental sem mudanças | 2.000 WAV sintéticos | PASS (`<= 5.000 ms`) |
| incremental com uma mudança | 2.000 WAV sintéticos | PASS (`<= 6.000 ms`) |
| payload público | 2.000 faixas | PASS (`<= 2.000 ms`) |
| memória do servidor | mesmo processo do benchmark | PASS (`heap <= 512 MiB`, `RSS <= 1.024 MiB`) |
| decode do frontend | 10.000 faixas | PASS (`<= 1.500 ms`) |
| projeção de pastas | 10.000 faixas | PASS (`<= 1.500 ms`) |
| busca/filtro/ordenação | 10.000 faixas | PASS (`<= 1.500 ms`) |
| SSR da primeira página | 100 de 10.000 faixas | PASS (`<= 1.500 ms`) |
| memória do frontend | mesmo processo do runner | PASS (`heap <= 768 MiB`, `RSS <= 1.536 MiB`) |

## Baseline browser-real — issue #237

A baseline do Chromium deve ser registrada a partir de execuções verdes do PR #244 no GitHub Actions `ubuntu-latest`, Node.js 22 e Chromium fixado pelo `e2e/package-lock.json`. Enquanto essa amostragem não estiver concluída, os budgets introduzidos no primeiro commit da PR são apenas tetos de coleta e **não constituem a baseline final**.

A tabela final deve registrar, para 10k e 25k, pelo menos a faixa observada de:

- tempo até utilizável;
- payload decodificado/transferido;
- bundle inicial;
- long tasks total/máxima;
- busca, filtro, ordenação e crescimento;
- heap/RSS máximos do servidor.

## Leitura dos resultados

Os runners escrevem JSON no log com tamanho do dataset, duração por cenário, memória, payload/markup quando relevante e limites aplicados.

Ao investigar uma regressão, compare primeiro execuções no mesmo tipo de runner e observe a direção da mudança em mais de uma execução. Pequenas variações isoladas abaixo do teto não justificam otimização.

## Quando mudar o benchmark

Atualize este documento, a issue correspondente e `docs/roadmap.md` quando houver mudança material em:

- tamanho ou formato do dataset;
- caminho de produção exercitado;
- paginação da biblioteca;
- limites do gate;
- interpretação dos resultados.

Se uma alteração legítima de arquitetura tornar um cenário obsoleto, substitua-o por outro que preserve a cobertura do risco em vez de simplesmente remover o gate.