# Desenvolvimento

## Preparação

Requisitos principais:

- Node.js compatível com o package.json
- npm
- biblioteca de áudio local para fluxos de mídia

Instalação e execução:

    npm ci
    npm run dev

## Relação com o agent-workflow-browser

Quando uma mudança for coordenada pelo `agent-workflow-browser`, este documento continua sendo a fonte local para preparação, desenvolvimento e validação do projeto. Ele não substitui a task canônica nem define workflow, handoff ou autorizações.

## Fluxo de alteração

1. Localize o owner real da responsabilidade.
2. Defina critérios de aceite para mudanças não triviais.
3. Faça a menor alteração coerente.
4. Ajuste testes no nível adequado.
5. Execute o gate e revise o diff.

## Validação

Gate canônico:

    npm run check

Comandos úteis:

    npm run typecheck
    npm test
    npm run build
    npm run test:e2e
    npm run test:security
    npm run smoke:production

Use suites caras apenas quando o risco da mudança justificar.

## Benchmark da análise rítmica

O benchmark sintético existente mede agendamento/drenagem da fila; permite
dimensionar bibliotecas grandes sem executar DSP:

    HOME_MUSIC_BENCHMARK_RHYTHM_TRACKS=20000 npm run benchmark:rhythm-analysis

Para medir o analisador e o transcoder de produção com FFmpeg real:

    npm run benchmark:rhythm-analysis:ffmpeg

Requer Linux (`/proc/self/fd`), Node compatível com o projeto e FFmpeg com
lavfi, WAV, FLAC e encoder AAC. Não usa servidor, banco ou biblioteca pessoal.
Gera e remove fixtures temporárias: pulsos de 120 BPM em WAV/FLAC de 90 s,
silêncio FLAC de 90 s e WAV curto de 2 s. Verifica BPM/confiança, ausência de
ritmo no silêncio/áudio curto e saída de transcoding não vazia. FFmpeg ausente,
timeout, resultado inválido ou erro de processo fazem o comando falhar.
O cleanup aguarda as promises dos runners. Há uma limitação herdada do decoder:
em timeout ele envia SIGTERM e rejeita sem aguardar o fechamento do processo;
o benchmark não garante encerramento de um FFmpeg que ignore esse sinal.

Depois do aquecimento, executa três rodadas de análise isolada, transcoding
isolado e ambos simultâneos. Cada workload processa uma faixa por vez. A ordem
isolado/simultâneo alterna entre rodadas. Não há cache de transcoding; a saída
AAC usa o perfil `balanced` real. O benchmark chama os runners de produção,
sem simular a fila HTTP/HeavyWorkQueue, scanner ou persistência.

Configuração opcional:

    HOME_MUSIC_BENCHMARK_RHYTHM_ROUNDS=5 npm run benchmark:rhythm-analysis:ffmpeg
    HOME_MUSIC_BENCHMARK_RHYTHM_FFMPEG=/usr/bin/ffmpeg npm run benchmark:rhythm-analysis:ffmpeg

Rodadas aceitam inteiros de 1 a 10. O executável é passado diretamente, sem
shell; o valor não aceita argumentos adicionais. O relatório JSON contém
versões, CPU/arquitetura, tamanho das fixtures, todas as amostras, mediana e
razão `transcodeMedianRatio` (simultâneo / isolado; maior que 1 indica aumento
do tempo). Para salvar somente o JSON após compilar o shared:

    npm run build -w @home-music/shared
    node --import tsx apps/server/src/rhythm-analysis-ffmpeg.benchmark.ts > rhythm-benchmark.json

`nodeCpuMs` e `nodeSampledPeakRssMb` medem somente o Node, **não o FFmpeg**.
O RSS é amostrado a cada 10 ms e pode perder picos durante DSP síncrono.
`workloadOverlapMs` confirma sobreposição das chamadas, não paralelismo de CPU.
No Linux com GNU time instalado, obtenha também CPU user/system e max RSS da
execução com seus filhos:

    /usr/bin/time -v node --import tsx apps/server/src/rhythm-analysis-ffmpeg.benchmark.ts > rhythm-benchmark.json

Essa medição externa inclui aquecimento e geração das fixtures; max RSS não
é a soma da memória simultânea de todos os processos. Para comparar releases,
use a mesma máquina, versões, número de rodadas e carga externa, guardando
JSON e stderr do GNU time. Não há gate universal de slowdown: investigue
dispersão/medianas antes de concluir regressão.

Este ensaio usa **áudio sintético com processamento real**. Não substitui
biblioteca representativa, medição de startup/scan completos, consumo de
bateria, streaming HTTP concorrente ou escuta em browser/PWA/mobile. Esses
critérios continuam pendentes em #505; não habilite rollout amplo apenas
porque o benchmark passou.

## Segurança e operação

- Não commite credenciais, chaves ou tokens.
- Preserve isolamento entre usuários.
- Valide caminhos antes de operações de arquivo.
- Não exponha o serviço local diretamente à internet.
- Mudanças operacionais devem manter possibilidade clara de rollback.

## Política de documentação

Mantenha somente documentação viva. Planos concluídos, decisões pontuais e relatórios ficam no histórico Git, issues e PRs.
