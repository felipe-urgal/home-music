# Planejamento — Assistente da Biblioteca (Fase 15)

> **Status: BASE OPERACIONAL IMPLEMENTADA / #315 PARCIAL / CAPACIDADES RESTANTES PLANEJADAS.** As entregas #311–#314 e o follow-up operacional #356 estão concluídos. A #315 já possui resolução gerenciada, LRCLIB e revisão/aplicação, mas ainda precisa ligar a capability `lyrics` ao comando normal de análise. O comportamento real está nos contratos canônicos [`library-assistant.md`](library-assistant.md) e [`lyrics.md`](lyrics.md). Este documento preserva a direção e o backlog restante; quando houver divergência, código/testes, a doc canônica e a issue executada têm precedência. A priorização executiva vive na issue [#310](https://github.com/felipe-urgal/home-music/issues/310).

## Motivação

A Administração já permite corrigir metadados e capas de forma segura e reversível e revisar sugestões em lote. A base de lyrics via LRCLIB também existe sem substituir sidecars, mas o disparo operacional dessa capability ainda faz parte da #315. As demais capacidades concentram normalização assistida, autonomia controlada, coerência de lyrics em todas as superfícies e fallbacks opcionais para casos difíceis.

A Fase 15 pretende transformar esse trabalho repetitivo em um fluxo **assistido, explicável e progressivamente autônomo**, onde o sistema resolve casos fortes e apresenta somente exceções ao administrador.

O planejamento também incorpora um problema visual comprovado: quando uma faixa não possui capa, biblioteca, player e controles do sistema precisam apresentar a mesma identidade visual sem transformar a simples ausência de artwork em mutação automática de banco.

## Autoridades que não mudam

O Assistente não cria uma segunda biblioteca nem substitui os owners atuais:

- `MUSIC_DIR` + scanner continuam sendo a autoridade física;
- `LibraryService` continua sendo a autoridade do snapshot base/revision da biblioteca;
- a projeção administrativa existente compõe metadata override, normalização, cover override e suas revisions para o snapshot efetivo usado pelo Assistente;
- `tracks` continua representando metadata física indexada;
- `track_metadata_overrides` continua sendo a forma não destrutiva de corrigir metadata textual;
- `track_cover_overrides` continua sendo a forma não destrutiva de corrigir capa;
- `library_metadata_aliases` continua sendo a autoridade de normalização lógica;
- `ArtworkFallback`/política atual continua sendo a origem visual do caso sem capa;
- a resolução canônica de lyrics (`override gerenciado → sidecar → nenhuma letra`) continua única para os consumidores e não deve ser duplicada;
- Media Session/PWA continuam sendo projeções do playback atual, não outro player;
- jobs pesados reutilizam fila/backpressure/observabilidade existentes;
- nenhuma origem externa escreve diretamente em arquivos da biblioteca.

## Arquitetura do Assistente

```text
LibraryService / biblioteca efetiva
        ↓
LibraryAssistantService
        ↓
coleta de evidências
  ├─ metadata física/efetiva
  ├─ filename/pasta/contexto
  ├─ duração
  ├─ contexto de álbum
  ├─ MusicBrainz
  └─ fingerprint opcional
        ↓
candidatos + evidências + score versionado
        ↓
┌─────────────────┬──────────────────┬─────────────────┐
│ confiança alta  │ confiança média  │ confiança baixa │
│ auto-aplicável  │ revisão humana   │ nenhuma mutação │
└─────────────────┴──────────────────┴─────────────────┘
        ↓
autoridades existentes
  ├─ metadata override
  ├─ cover override
  ├─ normalização lógica
  └─ resolução canônica de lyrics
```

`LibraryAssistantService` é um **orquestrador de análise e sugestões**. Ele não se torna dono da metadata efetiva, artwork ou lyrics publicadas. A #311 já implementa o lifecycle, os contratos, a persistência auditável, stale protection, cache/provider gateway e API administrativa sem endpoint de aplicação.

## Confiança explicável

O Assistente não deve gravar apenas um percentual opaco. Cada candidato precisa carregar evidências tipadas e versionadas, por exemplo:

- título exato/normalizado/conflitante;
- artista exato/normalizado/conflitante;
- álbum e `albumArtist`;
- diferença de duração;
- filename/pasta como evidência auxiliar;
- consistência com outras faixas do mesmo álbum;
- IDs externos fortes;
- fingerprint quando habilitado;
- conflitos entre fontes;
- distância entre o primeiro e o segundo candidato.

Thresholds só devem ser definidos após fixtures/falsos positivos reais. Ambiguidade nunca vira mutação silenciosa.

## Decisão humana vence automação

Regras obrigatórias:

- override manual existente não é sobrescrito automaticamente;
- capa escolhida pelo administrador não é substituída silenciosamente;
- sidecar de lyrics já existente não é substituído automaticamente por provider externo;
- rejeição explícita deve impedir loop de sugestão sem nova evidência material;
- mudança entre análise e aplicação torna a sugestão `stale` e exige revalidação;
- restore/undo continua usando a autoridade de cada domínio;
- renderizar fallback visual nunca cria por si só um cover override.

## Providers e estratégia gratuita

### MusicBrainz

Fonte principal de identidade externa para recordings/artists/releases/release groups. A integração da #312 é server-side e usa User-Agent, rate limit, cache, timeout, cancelamento e respostas validadas. CI usa fixtures/fakes e não depende da internet pública.

### Cover Art Archive

Artwork é consultado a partir de releases já identificados. Imagens continuam passando pela validação de cover override existente: formato, bytes, MIME real, dimensões, egress/redirect e rollback.

### Lyrics

O provider externo implementado é o LRCLIB, tratado como fonte não confiável com plain/synced lyrics, proveniência, limites e política de conteúdo/licenciamento documentada. O conteúdo completo só é obtido no apply e o playback usa estado local aprovado.

### Chromaprint + AcoustID

Fallback opcional para arquivos difíceis. `fpcalc` roda localmente e AcoustID, quando configurado, fornece evidência adicional para o matcher existente. Não é requisito do happy path.

### Whisper/whisper.cpp

Fallback local opcional para:

1. transcrição de música sem letra conhecida — sempre tratada como conteúdo gerado que precisa de revisão;
2. alinhamento temporal de uma letra plain confiável — potencialmente mais confiável porque o texto já é conhecido.

Nenhum áudio precisa sair da máquina. Modelos não são versionados no repositório nem baixados silenciosamente no startup.

## Artwork — uma única identidade de fallback

A Fase 15 não deve criar uma regra de capa diferente por tela.

A decisão é separar **capa efetiva** de **fallback visual derivado**:

```text
capa efetiva?
  ├─ sim → cover override / capa física canônica
  └─ não → ArtworkFallbackIdentity derivada
             ├─ biblioteca/cards
             ├─ player Agora
             ├─ imagem estática para Media Session
             └─ opcional: materializar → cover override
```

O fallback visual **não é uma terceira capa persistida**.

### Identidade determinística

A [#321](https://github.com/felipe-urgal/home-music/issues/321) define uma identidade única e versionada para os casos sem capa, reutilizando `ArtworkFallback` em vez de substituí-lo por outra engine. A camada A derivada já está implementada; materialização persistente continua opcional/P2.

A decisão visual pode derivar de:

- artista;
- álbum;
- título quando apropriado;
- identidade lógica estável;
- initials/texto curto;
- seed/hash sem path físico;
- variante/tokens de composição;
- versão do algoritmo.

A mesma entrada + versão deve produzir a mesma decisão visual.

### Direção visual

A composição deve parecer parte do Home Music:

- vinil/disco como motivo musical principal;
- casa/identidade Home Music quando fizer sentido;
- fundo escuro/gradiente consistente com os tokens atuais;
- label/iniciais legíveis;
- bom resultado em thumbnail e artwork grande;
- assets próprios/licenciados;
- nenhuma tentativa de imitar interface/capa proprietária de outro produto.

### Renderer visual x renderer estático

Quando possível, separar:

1. descriptor/decisão pura e testável;
2. renderer React/CSS para a aplicação;
3. renderer estático somente quando uma superfície exigir bytes/URL de imagem.

Evitar:

- screenshot de componente React no backend;
- duplicar seed/cores/iniciais manualmente entre web e server;
- rasterizar BLOB para cada card da biblioteca;
- criar framework gráfico genérico sem necessidade.

## Artwork gerada e persistida

A #321 também preserva a evolução opcional de gerar uma capa local persistente.

Essa camada é diferente do fallback visual automático:

- geração local e determinística;
- sem IA generativa;
- ação explícita/aprovada;
- passa pela validação canônica do cover override;
- registra `generated`/`generatorVersion` quando o modelo suportar;
- muda `coverVersion`/revision pelos mecanismos existentes;
- restore remove o override e volta à capa física/fallback.

Não persistir uma capa apenas porque a faixa foi exibida sem artwork.

## Media Session e tela bloqueada

A [#325](https://github.com/felipe-urgal/home-music/issues/325) implementa a integração visual com controles do sistema. O código foi incorporado; validação física de lock screen permanece registrada como QA pós-merge.

### Com capa efetiva

Publicar no `navigator.mediaSession.metadata` a mesma artwork canônica da faixa, reutilizando endpoint/versionamento atuais em vez de criar outra API de capa.

### Sem capa efetiva

Publicar uma **imagem estática** derivada da identidade de fallback da #321.

Isso não cria `track_cover_overrides`.

### Limite assumido

O comportamento assume de forma conservadora que `MediaMetadata.artwork` é uma representação estática controlada pelo browser/SO.

Portanto:

- não prometer vinil girando na lock screen;
- não atualizar frames de artwork em loop;
- não depender de GIF/video/canvas animado como requisito de Media Session;
- ausência de suporte degrada sem quebrar playback;
- diferenças entre iOS/Android/browser precisam ser validadas e documentadas quando houver QA físico.

### Offline

Reprodução offline não consulta MusicBrainz, CAA ou qualquer provider externo. Artwork real/fallback usa recursos locais/caches derivados compatíveis com o manifesto offline existente e preserva isolamento por usuário.

## Player Agora — vinil animado

A [#326](https://github.com/felipe-urgal/home-music/issues/326) concentra a animação **dentro da aplicação**.

Direção planejada:

```text
playing → vinil gira
paused  → vinil para
resume  → continua visualmente sem reset grosseiro
track change → troca artwork sem frame stale
```

A artwork real ou fallback pode funcionar como label central do vinil ou composição equivalente validada por protótipo/screenshot.

### Performance

Preferir animação compositor-friendly:

- `transform`/CSS quando suficiente;
- sem canvas redraw contínuo se não houver necessidade;
- sem `setInterval` de alta frequência para controlar ângulo;
- sem filtros pesados por frame;
- nenhum trabalho contínuo quando componente/tela não estiver ativo.

### Acessibilidade

`prefers-reduced-motion` é obrigatório:

- com `reduce`, não existe rotação contínua;
- funcionalidade do player permanece integral;
- movimento nunca é o único indicador de estado.

O vinil é decorativo e não cria foco/controle adicional.

### Escopo inicial

Aplicar primeiro em **Agora / Tocando agora**.

Não espalhar rotação por biblioteca, listas, resultados de busca, lock screen ou ícone da PWA sem nova evidência de valor/performance.

## Lyrics — base parcial e evolução restante

O comportamento atual preserva uma única cadeia de resolução:

```text
lyrics gerenciada/override aprovada
        ↓
sidecar físico .lrc/.txt
        ↓
nenhuma letra
```

O Assistente não deve criar `.lrc` dentro de `MUSIC_DIR` automaticamente a partir de provider externo.

Depois de aplicada, a mesma letra efetiva alimenta a rota web e o OpenSubsonic. A #315 ainda precisa tornar o run `lyrics` iniciável pelo fluxo administrativo normal; depois disso, a #316 permanece responsável por concluir e validar a experiência coerente em todas as superfícies, especialmente offline:

- rota web atual;
- `LyricsPanel`;
- desktop/mobile;
- conteúdo offline quando preparado;
- OpenSubsonic.

Não deve existir um caminho de lyrics diferente por cliente.

## Autonomia progressiva

A autonomia só entra depois que análise/revisão manual provar qualidade suficiente.

```text
scan/import concluiu estado consistente
        ↓
analisar somente delta relevante
        ↓
policy high-confidence satisfeita?
   ├─ não → fila de revisão
   └─ sim → revalidar estado → aplicar autoridade existente
```

Requisitos:

- opt-in/desabilitável;
- não reanalisar a biblioteca inteira sem necessidade;
- coalescer trabalho obsoleto;
- não abrir rede dentro de transação SQLite longa;
- backpressure e rate limit;
- idempotência/retry;
- stale protection;
- resumo auditável de aplicado/revisão/sem resultado/stale/falha.

## Normalização

A normalização da #110 continua sendo a única autoridade de aliases.

O Assistente pode enriquecer candidatos com MusicBrainz e sugerir grafia canônica, mas deve preservar:

- artista global;
- álbum escopado por artista canônico;
- distinção entre edição/remaster/live quando semanticamente relevante;
- confirmação explícita inicial para alias global;
- undo existente.

Não criar override em centenas de faixas para resolver um problema que é corretamente um alias global.

## Segurança, privacidade e conteúdo

- `/api/admin/*` continua admin-only e mutações preservam anti-CSRF vigente;
- paths físicos nunca são enviados a providers;
- cookies/tokens/secrets/username não são enviados sem necessidade;
- payload externo possui limite/timeout/schema validation;
- imagens externas são conteúdo não confiável;
- processos locais usam executável + argumentos e `shell: false`;
- letras completas não entram em logs/telemetria;
- testes usam letras sintéticas, não letras comerciais completas;
- Home Music não vira proxy público/catálogo de letras;
- artwork gerado localmente não é anunciado como oficial;
- Media Session nunca recebe URL externa arbitrária de provider;
- fallback derivado não contém path físico/secret e não cria mutação automática;
- nenhuma API paga/cloud é requisito do happy path;
- uso comercial futuro exige nova revisão de termos/licenças dos providers.

## Backlog da Fase 15

### P0 — fundação e valor principal

- [x] [#311](https://github.com/felipe-urgal/home-music/issues/311) — fundação de contratos, evidências, stale, execução segura e API de lifecycle;
- [x] [#312](https://github.com/felipe-urgal/home-music/issues/312) — MusicBrainz + matching explicável;
- [x] [#313](https://github.com/felipe-urgal/home-music/issues/313) — revisão/aplicação segura na Administração;
- [x] [#356](https://github.com/felipe-urgal/home-music/issues/356) — revisão em lote, reset operacional e abas de monitoramento.

### P1 — enriquecimento, identidade visual e autonomia

- [x] [#314](https://github.com/felipe-urgal/home-music/issues/314) — Cover Art Archive + cover override;
- [~] [#315](https://github.com/felipe-urgal/home-music/issues/315) — resolução, LRCLIB e revisão/aplicação implementados; disparo operacional do run `lyrics` ainda pendente;
- [ ] [#316](https://github.com/felipe-urgal/home-music/issues/316) — lyrics sincronizadas no player/desktop/offline/OpenSubsonic;
- [ ] [#318](https://github.com/felipe-urgal/home-music/issues/318) — autonomia progressiva após scan/import;
- [ ] [#319](https://github.com/felipe-urgal/home-music/issues/319) — normalização assistida com evidência externa;
- [~] [#321](https://github.com/felipe-urgal/home-music/issues/321) — identidade/fallback canônico implementado; materialização persistente permanece opcional;
- [x] [#325](https://github.com/felipe-urgal/home-music/issues/325) — Media Session + fallback estático da tela bloqueada, com QA físico rastreado;
- [x] [#326](https://github.com/felipe-urgal/home-music/issues/326) — vinil animado no player Agora.

### P2 — casos difíceis e fallbacks locais pesados/opcionais

- [ ] [#320](https://github.com/felipe-urgal/home-music/issues/320) — Chromaprint + AcoustID opcional;
- [ ] [#322](https://github.com/felipe-urgal/home-music/issues/322) — Whisper local para transcrição/alinhamento;
- camada B da #321 — materialização de artwork local como cover override, sem bloquear o fallback visual.

## Ordem recomendada para o backlog restante

1. concluir o disparo operacional e os gates restantes da #315;
2. #316 e #319 conforme prioridade de experiência e qualidade da biblioteca;
3. #318 após evidência de qualidade do fluxo manual;
4. #320/#322 e camada B da #321 como fallbacks opcionais;
5. concluir o QA físico ainda rastreado pela #325 sem reabrir o contrato técnico já incorporado.

## Relação com a Fase 14

A Fase 14 foi reconciliada no fluxo próprio: #293 e #295 foram verificadas contra a implementação existente e encerradas. A Fase 15 não reabre nem absorve esse trabalho.

Antes de iniciar #312 ou qualquer trabalho que toque matching/`LibraryService`, conferir novamente `main` e PRs abertos para evitar abstrações concorrentes.

## Definition of Done por entrega

Cada issue segue `AGENTS.md`:

- investigar o fluxo fullstack real;
- ler `AGENTS.md` local aplicável;
- preservar autoridades existentes;
- implementar causa raiz sem mudança lateral;
- adicionar regressões focadas/negativas;
- executar gates proporcionais ao risco e `npm run check`;
- atualizar documentação viva afetada;
- revisar o diff completo no head final;
- repetir gates/review se o diff mudar;
- manter CI verde no head final;
- não fazer merge sem autorização explícita do usuário.

Para artwork/player, acrescentar:

- uma única identidade de fallback entre superfícies;
- fallback visual não cria cover override automaticamente;
- Media Session assume imagem estática e degrada por capability;
- `prefers-reduced-motion` para animação contínua;
- validação de lock screen/PWA em hardware real quando fizer parte do aceite/QA.

## Relação com roadmap/índice corrente

`docs/roadmap.md` e `docs/README.md` representam o ciclo corrente da `main`. A fundação implementada é documentada em [`library-assistant.md`](library-assistant.md); este arquivo permanece como planejamento das capacidades seguintes e não deve competir com o contrato executável.
