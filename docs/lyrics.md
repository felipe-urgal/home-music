# Lyrics

O Home Music possui uma única cadeia efetiva de letras para o player, API HTTP e OpenSubsonic. O enriquecimento externo do Assistente da Biblioteca amplia essa cadeia sem criar um segundo endpoint, parser ou catálogo público de letras.

## Resolução canônica

A ordem de resolução é:

1. letra gerenciada e aprovada em `track_lyrics_overrides`;
2. sidecar físico local `.lrc` ou `.txt` ao lado do áudio;
3. nenhuma letra.

O parser existente de `apps/server/src/lyrics.ts` continua sendo a fonte de verdade para conteúdo plain e LRC sincronizado, incluindo timestamps e `offset`. A rota `/api/tracks/:id/lyrics`, o player e `getLyricsBySongId` do OpenSubsonic chegam à mesma resolução por `TrackMediaInfrastructure.lyrics()`.

A reprodução nunca consulta um provider externo. Depois da aprovação, o conteúdo necessário para playback está no SQLite local; se o provider estiver offline, lento ou limitar requisições, a reprodução e a leitura de letras já aprovadas continuam funcionando normalmente.

## Persistência gerenciada

Letras aprovadas pelo Assistente ficam na tabela SQLite `track_lyrics_overrides`, fora do arquivo de áudio e fora de `MUSIC_DIR`.

Cada registro contém:

- `track_id` com `ON DELETE CASCADE`;
- modo `plain` ou `synced`;
- conteúdo normalizado, limitado a 48 KiB em UTF-8;
- origem `external`, `manual` ou `generated`;
- provider e identificador externo quando existirem;
- idioma quando conhecido;
- `updated_at`.

Como o override faz parte do banco principal, ele segue a estratégia normal de backup/restore da aplicação. Remover a letra gerenciada não altera o áudio nem o sidecar: a resolução volta automaticamente ao `.lrc`/`.txt` local quando ele existir.

## LRCLIB

A fonte externa inicial é o LRCLIB. A integração ocorre somente no servidor e passa pelo `LibraryAssistantProviderGateway`, reutilizando timeout, rate limit, cache, deduplicação de chamadas e cancelamento da infraestrutura do Assistente.

A análise usa título, artista e álbum, além de duração como evidência de matching quando disponível. Título e artista incompatíveis bloqueiam o vínculo; duração muito divergente também bloqueia. Uma sugestão só é classificada como alta confiança quando a identidade é forte, a duração está próxima e não há candidato concorrente equivalente. Resultados ambíguos permanecem em revisão.

A sugestão persistida não contém a letra completa. Ela guarda o identificador do candidato, sincronização, proveniência e um preview curto. O conteúdo completo é buscado novamente por ID no momento do `apply`, validado e limitado antes de ser salvo. Se um sidecar local surgir entre análise e aplicação, a sugestão fica stale e não substitui o arquivo local.

O Home Music identifica suas requisições com `User-Agent` próprio, trata `404` como ausência normal e respeita respostas de limitação/indisponibilidade pelo gateway. A política e disponibilidade do LRCLIB podem mudar; a integração deve degradar com segurança em vez de assumir disponibilidade eterna.

Referência vigente do provider: <https://lrclib.net/docs>.

## Plain e sincronizada

Quando o provider oferece LRC válido, a representação sincronizada é preservada e passa pelo parser já existente. Se não houver LRC válido, uma letra plain válida pode ser usada. Não existe formato proprietário de timestamps.

## Revisão administrativa e rollback

O Assistente mostra:

- fonte `LRCLIB`;
- estado sincronizada/não sincronizada;
- evidências de identidade;
- preview limitado;
- ações Aprovar/Rejeitar.

Lote é permitido somente pelo fluxo seguro do Assistente. Itens que não atendem à política de auto-aplicação exigem confirmação explícita. Capas continuam com seu fluxo individual próprio.

Uma letra aplicada pode ser removida pela ação **Voltar ao sidecar**, que limpa somente o override gerenciado. O histórico da sugestão continua representando a decisão que ocorreu; a fonte efetiva volta a ser calculada pela cadeia canônica.

## Privacidade, conteúdo e licenciamento

Letras permanecem sujeitas aos direitos de seus autores e titulares. O uso previsto do Home Music é pessoal/self-hosted; a aplicação não expõe uma busca pública irrestrita nem funciona como proxy de catálogo do provider.

Regras de implementação:

- não registrar conteúdo integral de letras em logs;
- não persistir resposta HTTP bruta ou HTML do provider;
- não criar automaticamente `.lrc` dentro de `MUSIC_DIR` a partir do provider;
- não usar scraping, bypass de login/paywall ou fontes sem permissão adequada;
- fixtures de teste usam somente conteúdo sintético e curto;
- testes do provider não dependem da internet pública;
- uso comercial futuro exige nova revisão de termos/licenciamento.

## Testes de regressão

A cobertura deve preservar:

- sidecar LRC/TXT e segurança de caminhos;
- prioridade do override gerenciado e fallback após remoção;
- plain e synced externos;
- matching forte, duração divergente e candidatos ambíguos;
- provider sem resultado, malformed/oversized, timeout/rate limit por infraestrutura compartilhada;
- stale entre análise e aplicação;
- reopen/cascade/limite do store SQLite;
- mesma resolução para rota pública/player e OpenSubsonic.
