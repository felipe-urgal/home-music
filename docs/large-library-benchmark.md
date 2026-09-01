# Benchmark de biblioteca grande

Este documento descreve o gate de performance da issue #119. O objetivo é detectar **regressões graves e reproduzíveis** nos caminhos críticos de uma biblioteca grande sem transformar o CI em um microbenchmark sensível a pequenas oscilações do runner.

## Princípios

- o dataset é totalmente sintético e não usa dados reais do usuário;
- os cenários exercitam código de produção, não cópias simplificadas dos algoritmos;
- tempos absolutos usam limites deliberadamente largos;
- correção funcional continua sendo responsabilidade das suítes normais;
- o benchmark roda em uma etapa própria do CI e imprime um relatório JSON para comparação entre execuções;
- relaxar um limite exige evidência registrada em issue/PR; não aumente o teto apenas para fazer o CI passar.

## Como executar

Na raiz do repositório:

```bash
npm run benchmark:large-library
```

O comando executa primeiro o benchmark do servidor e depois o guard do frontend.

Para exploração local do scanner é possível alterar somente a quantidade de arquivos sintéticos:

```bash
HOME_MUSIC_BENCHMARK_TRACKS=4000 npm run benchmark:large-library -w @home-music/server
```

Os limites do servidor escalam linearmente acima do dataset padrão. O gate oficial do CI usa os valores padrão abaixo.

## Dataset do servidor

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
4. **Payload público** — materializa e serializa a resposta equivalente da biblioteca sem os campos privados de filesystem.
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

## Dataset do frontend

O runner `apps/web/src/large-library.performance.test.tsx` usa 10.000 objetos `Track` sintéticos e determinísticos, distribuídos entre formatos, artistas, álbuns, capas e caminhos de pasta.

A renderização usa `LIBRARY_PAGE_SIZE`, atualmente 100 itens, preservando o contrato real de paginação inicial da biblioteca.

### Cenários do frontend

1. **Decode do payload** — `JSON.parse` do snapshot de 10.000 faixas.
2. **Projeção de pastas** — executa `buildFolderView` sobre o conjunto completo.
3. **Busca/filtro/ordenação** — executa `applyTrackView` com busca normalizada, formato e ordenação reais.
4. **Renderização da primeira página** — usa `renderToStaticMarkup` sobre o componente real `LibraryTrackRows` com 100 faixas.
5. **Memória** — registra heap e RSS do processo do runner.

### Limites de regressão grave do frontend

| Medição | Limite |
| --- | ---: |
| decode do payload | 1.500 ms |
| projeção de pastas | 1.500 ms |
| busca/filtro/ordenação | 1.500 ms |
| SSR da primeira página | 1.500 ms |
| heap usado | 768 MiB |
| RSS | 1.536 MiB |

Assim como no servidor, os limites são intencionalmente muito superiores ao tempo esperado. O objetivo do gate é estabilidade entre ambientes de CI, não competição de microsegundos.

## Leitura dos resultados

Os dois runners escrevem JSON no log com:

- tamanho do dataset;
- duração por cenário;
- delta de heap por cenário;
- máximos de heap/RSS;
- tamanho do payload/markup quando relevante;
- limites aplicados.

Ao investigar uma regressão, compare primeiro execuções no mesmo tipo de runner e observe a direção da mudança em mais de uma execução. Pequenas variações isoladas abaixo do teto não justificam otimização.

## Quando mudar o benchmark

Atualize este documento, a issue correspondente e `docs/roadmap.md` quando houver mudança material em:

- tamanho ou formato do dataset;
- caminho de produção exercitado;
- paginação da biblioteca;
- limites do gate;
- interpretação dos resultados.

Se uma alteração legítima de arquitetura tornar um cenário obsoleto, substitua-o por outro que preserve a cobertura do risco em vez de simplesmente remover o gate.
