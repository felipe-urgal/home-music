# Overrides de metadados administrativos

A edição de metadados da Fase 8 é **não destrutiva por padrão**. Título, artista, álbum e artista do álbum podem ser corrigidos na Administração sem alterar bytes, tags ou timestamps do arquivo de áudio original.

## Invariantes

- `tracks` continua representando exclusivamente a metadata física indexada pelo scanner.
- `track_metadata_overrides` armazena somente diferenças explícitas em relação ao arquivo.
- `NULL` em um campo de override significa “usar o valor físico”.
- se todos os campos voltarem ao valor físico, a linha de override é removida.
- um novo scan pode atualizar a metadata física, mas não sobrescreve um override existente.
- quando uma faixa deixa definitivamente a tabela `tracks`, a FK com `ON DELETE CASCADE` remove seu override.
- nenhuma rota desta feature escreve tags no arquivo de áudio.
- faixas na lixeira precisam ser restauradas antes de receber novas edições de metadados.

## Modelo de resolução

A metadata exposta ao usuário é calculada como:

```text
metadata efetiva = metadata física + campos não nulos do override
```

O scanner continua trabalhando apenas com a versão física. A resolução efetiva acontece na borda HTTP para a biblioteca e para a Administração. Isso evita que um re-scan reutilize metadata efetiva como se tivesse vindo do arquivo.

Para o snapshot público da biblioteca, a ordem canônica é explícita:

```text
metadata física
   ↓
override por faixa
   ↓
normalização lógica de artista/álbum
   ↓
override de capa
   ↓
serialização + ETag + compressão de /api/library
```

A projeção efetiva ocorre **antes** de `LibraryHttpSnapshotCache` transformar a resposta em `Buffer`. Assim, o mesmo objeto lógico alimenta biblioteca, player, fila, mini player e o cache HTTP; a camada de `preSerialization` permanece apenas como compatibilidade para composições que não usam a projeção explícita das rotas.

Salvar ou restaurar metadata/capa e alterar normalização incrementa a revisão administrativa composta usada por `/api/library/status` e pelo snapshot. O frontend consegue invalidar a representação sem executar scan, e o novo ETag é calculado sobre os valores efetivos realmente publicados.

## Persistência SQLite

A tabela `track_metadata_overrides` usa `track_id` como chave primária e FK para `tracks(id)`.

Campos suportados:

- `title`;
- `artist`;
- `album`;
- `album_artist`;
- `updated_at`.

Os quatro campos editáveis aceitam até 240 caracteres e não aceitam string vazia quando presentes.

A tabela é criada de forma idempotente pelo `TrackMetadataOverrideStore`, seguindo o mesmo padrão dos stores especializados de disponibilidade e quarentena. O store usa `PRAGMA foreign_keys = ON` e `busy_timeout` para coexistir com as demais conexões SQLite do processo.

## API administrativa

### Consultar

`GET /api/admin/tracks/:id/metadata`

Retorna três visões:

- `physical`: valores lidos do arquivo/indexados em `tracks`;
- `override`: diferenças persistidas, com `null` nos campos herdados do arquivo;
- `effective`: resultado exibido na biblioteca.

### Editar

`PATCH /api/admin/tracks/:id/metadata`

Aceita somente `title`, `artist`, `album` e `albumArtist`. Um campo pode receber:

- string não vazia: cria/atualiza o override;
- `null`: remove o override daquele campo.

Campos desconhecidos, strings vazias e valores fora do contrato retornam `400`.

### Restaurar o arquivo

`DELETE /api/admin/tracks/:id/metadata`

Remove todos os overrides da faixa e volta a expor imediatamente os valores físicos.

## Administração Web atual

A entrada **Administração → Metadados** é separada das ações de disponibilidade e lixeira para não misturar operações com semânticas diferentes.

Após o redesign do PR #177, a tela usa um workspace **lista + editor persistente**:

- no desktop, a lista de músicas permanece visível à esquerda;
- o editor da faixa selecionada fica à direita;
- em telas menores, o editor assume a área principal;
- valores efetivos aparecem nos inputs;
- valores físicos ficam visíveis como referência;
- o arquivo original continua explicitamente preservado;
- `Salvar override` e `Restaurar arquivo` mantêm semânticas separadas;
- capa e metadata textual são editadas no mesmo contexto da faixa.

Trocar de música, fechar o editor, usar `Esc` ou sair da tela não pode descartar silenciosamente alterações ainda não salvas. Respostas assíncronas de uma faixa anterior também não podem sobrescrever o editor da faixa atualmente selecionada.

Depois de salvar ou restaurar, a tela publica `home-music:library-changed`. A instância canônica de `useLibraryData()` refaz `/api/library`, substitui as faixas pelo snapshot efetivo e o `useAudioPlayer()` remapeia fila/faixa atual por `track.id`. Uma correção apenas textual atualiza imediatamente player, mini player, fila e biblioteca sem reiniciar o áudio, porque a identidade física da faixa permanece a mesma.

O cockpit da Administração escuta o mesmo evento e refaz `/api/admin/library/overview`. Quando Metadados foi aberto por um filtro de saúde, o frontend conserva somente a chave do problema e recebe do backend os novos `trackIds`; ele não reimplementa no cliente as regras de “sem título”, artista/álbum desconhecido ou capa ausente. Por isso, uma faixa corrigida deixa de aparecer no filtro e seu contador é reconciliado ainda com a tela aberta.

## Re-scan

O fluxo de scan permanece:

1. ler/reutilizar metadata física;
2. sincronizar `tracks`;
3. manter `track_metadata_overrides` independente;
4. resolver a camada efetiva apenas na resposta da API.

Por isso, um scan não promove overrides para `tracks` e não os apaga enquanto a faixa continuar existindo.

## Rollback e falhas

A atualização de uma linha de override é transacional. Se uma constraint SQLite falhar, a transação é revertida e o override anterior permanece válido.

Validações de payload acontecem antes da persistência para evitar alterações parciais. A remoção completa usa uma única operação `DELETE`, atômica no SQLite.

## Escrita de tags no arquivo

A escrita opcional de metadados de volta ao arquivo **não faz parte do comportamento atual**. Ela deve permanecer uma ação explícita e separada, porque exigiria requisitos adicionais de:

- suporte e limitações por formato;
- arquivo temporário + substituição segura;
- preservação de permissões e timestamps quando aplicável;
- tratamento de capa/ReplayGain e tags desconhecidas;
- rollback após falha de escrita;
- integração com o lock de operações de mídia;
- novo scan e invalidação de cache após sucesso.

Até existir uma operação dedicada com esses invariantes, overrides SQLite são a única forma de edição administrativa de metadata.

## Testes

A cobertura inclui:

- precedência de override sobre metadata física;
- persistência após reinicialização;
- sobrevivência a alteração física/re-scan;
- reset parcial e total;
- cascade após remoção da faixa;
- validação de payload e campos desconhecidos;
- API administrativa;
- garantia de que o payload físico original não é mutado pela camada efetiva;
- caminho HTTP real de `/api/library`, incluindo revisão composta, ETag, revalidação `304`, save e restore sem mutar o objeto físico;
- helper do frontend para derivação de patches;
- Playwright desktop cobrindo edição no workspace, atualização imediata do player persistente e do filtro/cockpit de saúde, sobrevivência a rescan e restauração da fixture.