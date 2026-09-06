# Planejamento — Assistente da Biblioteca (Fase 15)

> **Status: PLANEJADO / NÃO IMPLEMENTADO.** Este documento registra a direção aprovada e o backlog da Fase 15. Ele **não descreve comportamento disponível na `main`**. O estado executável continua sendo definido por código/testes e a priorização executiva vive na issue [#310](https://github.com/felipe-urgal/home-music/issues/310).

## Motivação

A Administração atual já permite corrigir metadados e capas de forma segura e reversível, mas a manutenção ainda exige trabalho faixa a faixa. Letras também já existem por sidecars `.lrc`/`.txt`, com suporte a timestamps sincronizados no player, porém não existe preenchimento assistido da biblioteca.

A Fase 15 pretende transformar esse trabalho repetitivo em um fluxo **assistido, explicável e progressivamente autônomo**, onde o sistema resolve casos fortes e apresenta somente exceções ao administrador.

## Autoridades que não mudam

O Assistente não cria uma segunda biblioteca nem substitui os owners atuais:

- `MUSIC_DIR` + scanner continuam sendo a autoridade física;
- `LibraryService` continua sendo a autoridade do snapshot/revision da biblioteca;
- `tracks` continua representando metadata física indexada;
- `track_metadata_overrides` continua sendo a forma não destrutiva de corrigir metadata textual;
- `track_cover_overrides` continua sendo a forma não destrutiva de corrigir capa;
- `library_metadata_aliases` continua sendo a autoridade de normalização lógica;
- o pipeline atual de lyrics (`lyrics.ts` → `LyricsResponse` → consumidores web/OpenSubsonic) deve ser evoluído, não duplicado;
- jobs pesados reutilizam fila/backpressure/observabilidade existentes;
- nenhuma origem externa escreve diretamente em arquivos da biblioteca.

## Arquitetura planejada

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

`LibraryAssistantService` é um **orquestrador de análise e sugestões**. Ele não se torna dono da metadata efetiva, artwork ou lyrics publicadas.

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
- restore/undo continua usando a autoridade de cada domínio.

## Providers e estratégia gratuita

### MusicBrainz

Fonte principal de identidade externa para recordings/artists/releases/release groups. O cliente será server-side, com política vigente de User-Agent, rate limit, cache, timeout e respostas validadas. CI usa fixtures/fakes e não depende da internet pública.

### Cover Art Archive

Artwork será consultado a partir de releases já identificados. Imagens continuam passando pela validação de cover override já existente: formato, bytes, MIME real, dimensões, egress/redirect e rollback.

### Lyrics

A primeira opção externa planejada é LRCLIB ou alternativa equivalente que satisfaça os requisitos no momento da implementação. O provider deve ser tratado como fonte externa não confiável, com plain/synced lyrics, proveniência e política de conteúdo/licenciamento documentada.

### Chromaprint + AcoustID

Fallback opcional para arquivos difíceis. `fpcalc` roda localmente e AcoustID, quando configurado, fornece evidência adicional para o matcher existente. Não é requisito do happy path.

### Whisper/whisper.cpp

Fallback local opcional para:

1. transcrição de música sem letra conhecida — sempre tratada como conteúdo gerado que precisa de revisão;
2. alinhamento temporal de uma letra plain confiável — potencialmente mais confiável porque o texto já é conhecido.

Nenhum áudio precisa sair da máquina. Modelos não são versionados no repositório nem baixados silenciosamente no startup.

## Capas geradas pelo Home Music

Quando não existir artwork oficial/externo seguro, uma evolução P2 pode gerar capa **determinística e local**, sem IA generativa, a partir de artista/álbum/título e da linguagem visual do Home Music.

A imagem deve ser marcada como `generated` / `Gerada pelo Home Music` e nunca apresentada como capa oficial. Persistência continua usando cover override.

## Lyrics — resolução planejada

O comportamento atual lê sidecars físicos `.lrc`/`.txt`. A evolução da Fase 15 deve preservar uma única cadeia de resolução.

Direção preferida a validar na implementação:

```text
lyrics gerenciada/override aprovada
        ↓
sidecar físico .lrc/.txt
        ↓
nenhuma letra
```

O Assistente não deve criar `.lrc` dentro de `MUSIC_DIR` automaticamente a partir de provider externo.

Depois de aplicada, a mesma letra efetiva precisa alimentar:

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
- nenhuma API paga/cloud é requisito do happy path;
- uso comercial futuro exige nova revisão de termos/licenças dos providers.

## Backlog da Fase 15

### P0 — fundação e valor principal

- [#311](https://github.com/felipe-urgal/home-music/issues/311) — fundar o Assistente com contratos, evidências e execução segura;
- [#312](https://github.com/felipe-urgal/home-music/issues/312) — MusicBrainz + matching explicável;
- [#313](https://github.com/felipe-urgal/home-music/issues/313) — revisão/aplicação segura na Administração.

### P1 — enriquecimento e autonomia

- [#314](https://github.com/felipe-urgal/home-music/issues/314) — Cover Art Archive + cover override;
- [#315](https://github.com/felipe-urgal/home-music/issues/315) — lyrics externas reutilizando pipeline atual;
- [#316](https://github.com/felipe-urgal/home-music/issues/316) — lyrics sincronizadas no player/desktop/offline/OpenSubsonic;
- [#318](https://github.com/felipe-urgal/home-music/issues/318) — autonomia progressiva após scan/import;
- [#319](https://github.com/felipe-urgal/home-music/issues/319) — normalização assistida com evidência externa.

### P2 — casos difíceis e fallbacks locais

- [#320](https://github.com/felipe-urgal/home-music/issues/320) — Chromaprint + AcoustID opcional;
- [#321](https://github.com/felipe-urgal/home-music/issues/321) — artwork determinístico local;
- [#322](https://github.com/felipe-urgal/home-music/issues/322) — Whisper local para transcrição/alinhamento.

## Ordem recomendada

1. #311;
2. #312;
3. #313;
4. #314 + #315 + #319 em paralelo onde não houver conflito;
5. #316;
6. #318 após evidência de qualidade do fluxo manual;
7. #320/#321/#322 como fallbacks opcionais.

## Concorrência com a Fase 14

Em 2026-09-06 existe trabalho ativo da Fase 14 no PR #317, relacionado à aplicação transacional da importação pessoal. Antes de iniciar #311/#312, conferir novamente `main`, #293/#295 e PRs abertos para não introduzir matcher/serviço concorrente.

A Fase 15 não deve ser implementada dentro do PR #317 nem alterar o escopo dele.

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

## Relação com roadmap/índice corrente

Enquanto a Fase 14 estiver ativa, `docs/roadmap.md` e `docs/README.md` continuam representando o ciclo corrente. A #310 e este documento registram a próxima fase sem declarar capacidades não implementadas como estado da `main`.

Quando a Fase 15 for priorizada para implementação — ou quando o estado corrente da Fase 14 for reconciliado após o PR ativo — `docs/roadmap.md` e `docs/README.md` devem ser atualizados no mesmo fluxo, sem reescrever histórico para aparentar conclusão.