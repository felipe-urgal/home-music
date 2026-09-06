# Portabilidade de dados pessoais

O Home Music permite exportar o estado pessoal de uma conta sem copiar áudio, banco SQLite, credenciais ou estado administrativo.

## Exportação v1

Um usuário autenticado pode solicitar:

```http
GET /api/account/personal-data/export
```

A resposta é um JSON UTF-8 para download, com `Cache-Control: private, no-store` e o contrato versionado `home-music-personal-data` v1.

A identidade do bundle é sempre derivada da sessão autenticada. A API não aceita `userId` como autoridade e não oferece exportação de outra conta.

## Estrutura

O v1 contém somente estado pessoal persistido que existe hoje:

- favoritos;
- playlists manuais e sua ordem;
- definições de smart playlists;
- definições de views da biblioteca;
- até 500 eventos mais recentes do histórico de reprodução;
- estado persistido do player e filas.

Playlists Rekordbox compartilhadas não fazem parte do bundle pessoal. Smart playlists levam somente a regra; seus resultados são derivados da biblioteca atual e não são materializados. Views levam somente sua definição.

Preferências que existam apenas no navegador e não façam parte do estado pessoal persistido no servidor não são inventadas pelo formato.

## `PortableTrackReference` v1

Toda referência a faixa usa:

```json
{
  "relativePath": "Artista/Album/faixa.flac",
  "hints": {
    "title": "Faixa",
    "artist": "Artista",
    "album": "Album",
    "durationSeconds": 213.4
  }
}
```

### Autoridade

`relativePath` é relativo à raiz canônica de `MUSIC_DIR`, normalizado com `/`. O exportador nunca publica o path absoluto interno.

Os campos de `hints` são somente informações auxiliares para uma futura reconciliação. Eles **não são autoridade física**, não devem selecionar silenciosamente uma faixa ambígua e não substituem validação contra a biblioteca canônica.

IDs internos de faixa não fazem parte do contrato portátil.

## Privacidade e limites

O bundle não inclui:

- senha ou hash de senha;
- cookies, sessões ou tokens;
- chaves OpenSubsonic;
- `.env`;
- estado administrativo;
- dados de outra conta;
- arquivos de áudio;
- backup do SQLite;
- paths absolutos do filesystem.

O histórico exportado é limitado a 500 eventos por bundle v1 para manter uso de memória e tamanho previsíveis. Esse limite é parte explícita do contrato v1.

Uma conta sem dados pessoais continua recebendo um bundle válido, com coleções vazias e o estado padrão persistido do player.

## Compatibilidade

`format` identifica a família do artefato e `version` identifica seu schema. Consumidores futuros devem rejeitar versões que não entendam em vez de tentar interpretar campos desconhecidos como autoridade.

Mudanças incompatíveis exigem nova versão. Campos adicionais só podem ser tratados como compatíveis quando não alterarem a semântica dos campos existentes.

A importação/restauração de dados pessoais consome este mesmo contrato; ela não define um formato concorrente.

## Base de validação para importação

O importador trata o bundle como entrada não confiável antes de qualquer matching ou mutação. A validação v1 reutiliza exatamente o contrato acima e falha de forma explícita quando `format`/`version`, estrutura, tipos ou limites defensivos não são compatíveis.

Os limites de entrada vivem em `PERSONAL_DATA_IMPORT_LIMITS`, no pacote compartilhado. Eles cobrem tamanho total do payload, quantidades por coleção, filas, referências totais e comprimentos máximos de campos textuais. O limite do histórico permanece o mesmo `PERSONAL_DATA_HISTORY_LIMIT` de 500 eventos definido pelo formato v1.

`relativePath` precisa continuar sendo relativo e portátil: paths absolutos, drive letters, `\\`, segmentos vazios, `.` e `..` são rejeitados. Regras de smart playlists e definições de views são validadas pelas mesmas funções de normalização usadas pelos respectivos domínios, evitando um segundo conjunto de regras concorrente. Como o parser não reescreve silenciosamente o arquivo importado, valores que só seriam aceitos após coerção ou trim são rejeitados; timestamps também precisam estar no formato ISO canônico emitido pelo v1.

Esta camada é somente a fronteira de validação. Ela não resolve faixas, não altera estado pessoal, não cria mídia e não torna IDs externos autoridade. Preview, matching e aplicação permanecem etapas separadas do fluxo de importação.

## Matching conservador de faixas

A reconciliação usa somente faixas ativas projetadas pela `LibraryService`; itens desativados e qualquer referência fora da biblioteca atual não são candidatos.

A ordem de decisão é deliberadamente conservadora:

1. procurar o `relativePath` exato na biblioteca atual;
2. antes de aceitar esse path, conferir se os `hints` continuam compatíveis, evitando ligar um bundle antigo a outro conteúdo que passou a ocupar o mesmo caminho;
3. quando o path não existe mais, permitir reconciliação auxiliar apenas se título, artista, álbum e nome do arquivo coincidirem e as duas durações conhecidas divergirem no máximo 1 segundo;
4. aceitar a reconciliação auxiliar somente quando existir exatamente um candidato;
5. com múltiplos candidatos, retornar ambiguidade; com sinal insuficiente ou nenhum candidato, preferir ausência.

Matching por `hints` não é fuzzy search: não usa similaridade textual, ranking, escolha do “melhor” candidato nem cria faixas. O matcher retorna apenas IDs internos já existentes e informações de classificação; paths absolutos não fazem parte do resultado.

## Preview autenticado do import

Um usuário com identidade persistida pode validar e reconciliar um bundle sem aplicar nenhuma mudança:

```http
POST /api/account/personal-data/import/preview
Content-Type: application/json
```

O corpo é o próprio `PersonalDataBundleV1`. A rota aceita até 5 MiB e responde com `Cache-Control: private, no-store`.

A validação continua fail-closed. Bundle, versão, referência ou valor inválido não produz um preview parcial: a API devolve erro HTTP estável antes de executar matching ou qualquer mutação. JSON malformado e payload acima do limite também possuem erros próprios.

Quando a entrada é válida, o preview resume referências por domínio nas classificações `found`, `missing`, `ambiguous` e `conflict`. `conflict` representa um `relativePath` que existe, mas cujos hints indicam que o conteúdo atual não corresponde com segurança ao item exportado.

Os detalhes de referências não resolvidas usam somente informações portáteis do próprio bundle, como `relativePath`, domínio, campo e motivo seguro. IDs internos de faixa, IDs de candidatos e paths absolutos permanecem no plano server-side e não são serializados. A lista de detalhes é limitada por `PERSONAL_DATA_IMPORT_LIMITS.maxPreviewIssues`; as contagens totais continuam exatas e `issuesTruncated` informa quando houve truncamento.

O preview também devolve um `confirmationToken`. Ele é derivado do bundle validado, dos resultados de matching e da identidade autenticada. O token não é uma credencial; ele vincula a confirmação ao plano que o usuário revisou.

## Confirmação e aplicação

A aplicação usa uma rota separada:

```http
POST /api/account/personal-data/import/apply
Content-Type: application/json
```

O corpo contém `bundle`, `confirmationToken` e `confirmed: true`. O destino continua sendo exclusivamente `request.user.id`; `userId` vindo do cliente não escolhe conta de destino.

Antes de mutar, o servidor gera novamente o plano com o mesmo `PersonalDataImportPlanner` e compara seu token com o preview confirmado. Se o bundle, a biblioteca, o resultado de matching ou o usuário tiver mudado, a aplicação responde com `preview-changed` e exige um novo preview. O serviço de aplicação recebe o `PersonalDataImportPlan` confirmado e não possui parser ou matcher concorrente.

A aplicação inteira ocorre em uma única transação SQLite. Qualquer erro antes do `COMMIT` executa rollback do conjunto; não há compensação manual distribuída entre favoritos, playlists, views ou histórico.

### Estratégia de merge v1

- **Favoritos:** união. Somente faixas `found` são inseridas; favorito já existente é ignorado.
- **Playlists manuais:** somente referências `found` entram, na mesma ordem relativa do bundle. Se já existir uma playlist manual com o mesmo nome e a mesma sequência resolvida, ela é ignorada; caso contrário uma nova playlist é criada. Playlist sem faixa resolvida continua podendo ser restaurada vazia.
- **Smart playlists:** são importadas como nome + regra dinâmica. Uma definição semanticamente idêntica já existente é ignorada.
- **Views:** são importadas como nome + definição. Uma view semanticamente idêntica já existente é ignorada.
- **Histórico:** somente eventos `found` são inseridos. O par `(trackId, playedAt)` é deduplicado e o histórico continua limitado aos 2.000 eventos mais recentes da conta.
- **Playback e filas:** o estado é substituído pelos valores portáveis do bundle usando somente IDs `found`. Filas preservam ordem, removem duplicatas e mantêm a faixa atual no início caso ela não estivesse mais presente depois da reconciliação.
- **Missing, ambiguous e conflict:** nunca são aplicados; permanecem contabilizados no resumo final.

Reexecutar o mesmo bundle sobre o mesmo estado não cria duplicação: favoritos e histórico são deduplicados, coleções semanticamente iguais são ignoradas e playback idêntico não é regravado.

## Fluxo na Minha Conta

A interface para usuários fica em **Minha Conta → Dados → Importar dados pessoais**. O navegador lê somente o arquivo JSON selecionado e aplica o mesmo limite de 5 MiB como validação de UX; formato, versão, schema, matching e política de merge continuam sendo autoridade exclusiva do backend.

O fluxo visível é deliberadamente separado em etapas:

1. selecionar um arquivo `.json` exportado pelo Home Music;
2. aguardar o preview autenticado;
3. revisar as contagens de referências encontradas, ausentes, ambíguas e conflitantes e, quando existirem, os detalhes portáteis das pendências;
4. marcar explicitamente a confirmação de que somente os dados resolvidos com segurança devem ser aplicados;
5. executar a aplicação usando exatamente o `confirmationToken` devolvido pelo preview;
6. revisar o resumo final de itens aplicados, já existentes, ausentes, ambíguos, conflitantes e falhos.

A ação de importar permanece desabilitada até a confirmação explícita. Se o backend responder `preview-changed`, a interface invalida o preview anterior e exige nova análise; ela não tenta atualizar o token nem repetir a aplicação silenciosamente.

A UI não recebe nem calcula IDs internos de candidatos e não implementa matching, ranking ou merge no frontend. Mensagens de erro são acionáveis, mas não expõem detalhes internos do servidor. O mesmo fluxo é usado nas superfícies mobile, tablet e desktop de Minha Conta.

## Invariantes operacionais

Exportação e preview são read-only; a aplicação altera somente estado pessoal SQLite da conta autenticada:

- não modifica `MUSIC_DIR`;
- não cria nem altera faixas;
- não cria, move ou apaga mídia;
- não dispara scanner;
- não cria segunda biblioteca;
- não concede acesso entre usuários;
- não trata IDs do bundle como autoridade.
