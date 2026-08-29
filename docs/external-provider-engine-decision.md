# Decisão de engine para providers externos

**Status:** aceita para orientar a Fase 9  
**Data da avaliação:** 2026-08-29  
**Issue:** #95

## Resumo executivo

A recomendação é usar **yt-dlp como engine principal de aquisição de mídia externa**, executado como **processo externo isolado por uma interface de provider do Home Music**.

Não devemos importar `yt_dlp` dentro do processo Node/Fastify nem acoplar o pipeline principal à API Python. O contrato do Home Music deve falar com um adapter próprio, que executa a CLI sem shell, consome saída estruturada, grava somente no staging e normaliza metadata/erros.

A segunda opção é **YouTube.js (`youtubei.js`)** caso no futuro exista necessidade específica de uma integração Node nativa e exclusiva para YouTube. **Streamlink** é uma boa ferramenta, mas é orientada principalmente a live streams e tem suporte VOD deliberadamente limitado. **pytubefix** é ativo, porém restrito ao YouTube e com superfície menor. O `youtube-dl` original fica fora da shortlist operacional por não ter release desde 2021.

## Critérios da avaliação

A engine precisa maximizar:

1. cobertura real de fontes sem espalhar código específico de sites no Home Music;
2. manutenção ativa diante de mudanças frequentes nos sites;
3. seleção de áudio de melhor qualidade disponível;
4. metadata estruturada suficiente para o pipeline posterior;
5. possibilidade de execução isolada e cancelável;
6. licença compatível e dependências operacionalmente compreensíveis;
7. separação clara entre aquisição remota, validação e promoção para `MUSIC_DIR`;
8. capacidade de evoluir ou trocar de engine sem reescrever o pipeline de importação.

## Shortlist

| Projeto | Escopo | Integração | Manutenção observada | Licença | Adequação ao Home Music |
| --- | --- | --- | --- | --- | --- |
| **yt-dlp** | Muitos sites/extractors; áudio e vídeo | CLI + API Python | Muito alta; release `2026.08.19` e desenvolvimento contínuo | Repositório: Unlicense; binários empacotados podem agregar outras licenças | **Melhor opção geral** |
| **YouTube.js / youtubei.js** | YouTube/YouTube Music | Biblioteca TypeScript/Node | Alta; release `17.2.0` em 2026-06 | MIT | Excelente opção Node, mas específica de YouTube |
| **Streamlink** | Muitos serviços, foco em streams/live | CLI + API Python | Alta; release `8.5.0` em 2026-08 | BSD-2-Clause / Simplified BSD | Boa engine de streaming; fraca como engine geral de VOD/importação |
| **pytubefix** | YouTube | Biblioteca Python | Ativa; release `10.11.0` em 2026-07 | MIT | Simples, mas restrita a YouTube |
| **youtube-dl** | Muitos sites | CLI + API Python | Baixa para nosso critério: última release `2021.12.17` | Unlicense | Não recomendado para nova integração |

## 1. yt-dlp — recomendado

### Pontos fortes

- Projeto com atividade muito alta e releases frequentes. Em 2026-08-29, a release estável mais recente é `2026.08.19`.
- Lista extensa de extractors. A própria documentação alerta que sites mudam constantemente e que a disponibilidade real precisa ser testada, o que é exatamente o tipo de manutenção que não queremos reproduzir no Home Music.
- Suporta seleção de formatos de áudio e exemplos oficiais usam `m4a/bestaudio/best`.
- Fornece metadata estruturada e possui mecanismos de saída JSON/`--print` próprios para integração. A documentação recomenda explicitamente não parsear o stdout humano comum.
- Permite CLI e API Python. Para nosso caso, a CLI cria uma fronteira de processo útil para timeout, kill, atualização independente e isolamento.
- Ecossistema grande e maturidade operacional muito superior às alternativas avaliadas.
- O Home Music já possui FFmpeg no desenho da aplicação, então pós-processamento futuro não introduziria um conceito completamente novo no deploy.

### Pontos de atenção

- É Python e alguns formatos de distribuição carregam dependências/licenças adicionais. O repositório e os pacotes Python são Unlicense, mas os binários PyInstaller incluem componentes GPLv3+; a forma de distribuição precisa ser escolhida conscientemente.
- Sites externos quebram com frequência. O próprio projeto mantém canais `stable`, `nightly` e `master` e observa que até releases estáveis podem ficar defasadas rapidamente.
- É uma ferramenta extremamente poderosa. Opções como execução de comandos, carregamento de configurações do host, cookies, plugins e pós-processadores não devem ficar acessíveis ao usuário do Home Music.
- O generic extractor e as requisições secundárias feitas pelos extractors significam que **a validação SSRF da importação URL (#94) não é suficiente para proteger um processo yt-dlp arbitrário**.

### Decisão de uso

Usar yt-dlp como **dependência externa substituível**, não como parte do domínio do servidor:

```text
Admin UI
  -> Import API
     -> ExternalProvider interface
        -> YtDlpProvider adapter
           -> processo yt-dlp isolado
              -> staging do job
        -> metadata normalizada
     -> pipeline comum de validação/promoção
```

O servidor Node controla o ciclo de vida; yt-dlp somente resolve/adquire a mídia dentro da fronteira de provider.

## 2. YouTube.js — alternativa Node específica

### Pontos fortes

- Implementação JavaScript/TypeScript que roda em Node, Deno e outros runtimes.
- Licença MIT.
- Integração direta com o ecossistema atual do Home Music, sem runtime Python.
- Projeto ativo: release `17.2.0` em junho de 2026.
- API estruturada baseada no InnerTube do YouTube.

### Limitações

- Restrita ao ecossistema YouTube/YouTube Music; não resolve o objetivo de múltiplos sites.
- Usa API interna/não oficial, portanto continua sujeito a quebras quando o YouTube muda protocolos.
- Integrar como biblioteca dentro do Fastify reduziria a fronteira de isolamento entre conteúdo externo não confiável e o processo principal.

### Uso recomendado

Não usar como engine principal. Manter como opção futura de provider específico se houver requisito que justifique uma experiência YouTube mais profunda do que o adapter yt-dlp oferece.

## 3. Streamlink — forte para live, não para nossa prioridade

### Pontos fortes

- Projeto maduro, CLI e API Python.
- Plugin system com suporte a diversos serviços.
- Release `8.5.0` em agosto de 2026.
- Licença BSD simplificada.
- Suporta seleção `audio_only` em alguns serviços e possui boa infraestrutura para HLS/DASH.

### Limitações

A documentação do próprio projeto declara que o foco principal é **live streaming** e que suporte a VOD é limitado. O caso principal do Home Music é importar uma mídia persistente para staging e, depois, biblioteca. Portanto, Streamlink não maximiza cobertura para esse objetivo.

Também é relevante observar que a release 8.4.0 corrigiu uma vulnerabilidade de leitura arbitrária de arquivo local envolvendo URIs `file://`. Isso reforça que engines de mídia externas precisam ficar isoladas mesmo quando maduras.

### Uso recomendado

Não usar como engine principal de importação. Pode ser reavaliado no futuro caso o Home Music adicione um produto explícito de captura/live stream.

## 4. pytubefix — ativo, porém estreito

### Pontos fortes

- Biblioteca Python simples e focada em YouTube.
- Licença MIT.
- Ativamente mantida: release `10.11.0` em julho de 2026.
- API direta para selecionar stream somente de áudio e callbacks de progresso.

### Limitações

- YouTube apenas.
- Menor comunidade/superfície de extractors que yt-dlp.
- O histórico recente de releases mostra correções recorrentes para mudanças de cipher/player do YouTube; isso confirma que a manutenção do site é um custo contínuo.
- Não elimina o runtime Python se comparado ao yt-dlp, mas entrega muito menos cobertura.

### Uso recomendado

Não integrar. Pode servir como referência/fallback de pesquisa para problemas exclusivamente relacionados ao YouTube.

## 5. youtube-dl — referência histórica, não candidato

O projeto original continua relevante como ancestral técnico, mas a página oficial de releases ainda mostra `2021.12.17` como última versão. Para uma integração nova cuja principal dificuldade é acompanhar mudanças externas, isso é um sinal suficiente para preferir yt-dlp.

## Decisão de arquitetura para a #96

A próxima issue deve implementar uma interface desacoplada. Esta decisão recomenda o seguinte contrato conceitual:

```ts
type ExternalProviderCapabilities = {
  audio: boolean;
  metadata: boolean;
  thumbnail: boolean;
  playlists: boolean;
};

type ExternalProviderRequest = {
  url: string;
  stagingJobId: string;
};

type ExternalProviderResult = {
  provider: string;
  extractor: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  thumbnailUrl: string | null;
  originalUrl: string;
  payload: {
    sizeBytes: number;
    contentType: string | null;
  };
};
```

Esse exemplo é apenas direção de contrato; a #96 deve definir os tipos definitivos e testes com provider fake.

### Regras obrigatórias do adapter yt-dlp

1. **Executar sem shell** (`spawn`/equivalente com array de argumentos).
2. Não aceitar flags arbitrárias da UI/API.
3. Ignorar configurações globais/do usuário da engine; o comportamento deve vir somente do adapter.
4. Não habilitar execução de comandos, plugins externos ou pós-processadores arbitrários.
5. Trabalhar em diretório de staging exclusivo do job.
6. Nunca receber caminho de destino em `MUSIC_DIR`.
7. Aplicar timeout global e encerramento da árvore de processos em cancelamento.
8. Aplicar limite de tamanho no resultado, além dos limites oferecidos pela própria engine.
9. Consumir somente saída estruturada documentada; não interpretar texto humano da CLI.
10. Limitar playlists por padrão; uma URL não deve disparar aquisição não limitada de vários itens.
11. Normalizar erros para a fila (`failed/cancelled`) sem devolver stderr bruto ao navegador.
12. Não passar cookies/credenciais por padrão. Qualquer suporte futuro a autenticação deve ter design e storage próprios.
13. Não permitir auto-update disparado pela aplicação. A versão da engine deve ser detectável/observável, mas atualização é operação explícita de deploy/admin.
14. Validar a URL inicial por provider e restringir capabilities. Não usar o generic extractor como um proxy universal de URLs arbitrárias.
15. Tratar SSRF como fronteira própria do provider. O subprocesso pode realizar redirects, manifests e requests secundários que o `ImportUrlManager` da #94 não observa.

## Estratégia de distribuição

A preferência é **não empacotar o runtime Python dentro do bundle Node nesta etapa**.

Ordem sugerida:

1. adapter recebe um caminho configurável para o executável `yt-dlp`;
2. health/status informa `available`, versão detectada e erro de configuração;
3. instalação operacional documenta uma forma suportada de instalar/atualizar a engine;
4. o servidor funciona normalmente quando o provider não está instalado — apenas aquela capability fica indisponível;
5. se no futuro houver distribuição empacotada, revisar novamente as licenças dos artefatos escolhidos.

Isso mantém o core do Home Music independente do ritmo de releases do yt-dlp.

## Seleção de mídia

A intenção do provider é obter a **melhor faixa de áudio disponível**, preferindo fluxo já somente de áudio quando existir. Conversão/reencode não deve ser automática apenas para uniformizar extensão: preservar o original reduz custo e perda de qualidade. Normalização de formato, caso necessária, pertence a uma etapa explícita do pipeline.

FFmpeg pode ser usado quando tecnicamente necessário para merge/post-processamento suportado, mas o provider não deve criar uma segunda lógica de biblioteca.

## Metadata e capa

O adapter pode aproveitar metadata retornada pela engine como **metadata sugerida**, nunca como verdade confiável para paths ou comandos. Strings externas devem ser normalizadas e limitadas antes de persistência/uso na UI.

Thumbnail/capa remota deve continuar sujeita aos limites de tipo/tamanho do pipeline do Home Music; URL de thumbnail não autoriza acesso irrestrito à rede local.

## Segurança e conteúdo permitido

Integrar uma engine não concede ao usuário direito de copiar conteúdo. O produto deve deixar claro que importação externa é destinada somente a conteúdo que o usuário tenha autorização para baixar e armazenar.

Não faz parte desta decisão oferecer bypass de DRM, contornar paywalls, fornecer cookies de terceiros automaticamente ou esconder restrições impostas por serviços externos.

## Manutenção operacional

Sites suportados mudam independentemente do Home Music. Por isso:

- versão da engine deve aparecer em diagnóstico/status;
- falha de extractor deve ser distinguível de falha do core do Home Music;
- atualização da engine não deve exigir alteração do contrato do pipeline;
- testes do core usam provider fake e não dependem da internet;
- testes de integração real com yt-dlp devem ser opcionais/controlados para não tornar o CI dependente de sites externos.

## Conclusão

**Escolha:** `yt-dlp` via adapter de subprocesso isolado.

**Não escolher:** integração Python embutida, wrapper Node que apenas esconda a mesma CLI, Streamlink como engine geral, pytubefix/YouTube.js como engine universal ou youtube-dl original.

A #96 deve construir primeiro o contrato `ExternalProvider` + runner isolado + provider fake. A integração concreta de yt-dlp deve vir somente depois que essa fronteira estiver testada.

## Fontes consultadas

- yt-dlp repository: https://github.com/yt-dlp/yt-dlp
- yt-dlp releases: https://github.com/yt-dlp/yt-dlp/releases
- yt-dlp supported sites: https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md
- yt-dlp README / embedding / licensing: https://github.com/yt-dlp/yt-dlp/blob/master/README.md
- Streamlink docs: https://streamlink.github.io/
- Streamlink plugins: https://streamlink.github.io/latest/plugins.html
- Streamlink changelog: https://streamlink.github.io/latest/changelog.html
- YouTube.js repository: https://github.com/LuanRT/YouTube.js
- YouTube.js releases: https://github.com/LuanRT/YouTube.js/releases
- pytubefix repository: https://github.com/JuanBindez/pytubefix
- pytubefix releases: https://github.com/JuanBindez/pytubefix/releases
- youtube-dl releases: https://github.com/ytdl-org/youtube-dl/releases
