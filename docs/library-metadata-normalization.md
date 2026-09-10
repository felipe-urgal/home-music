# Normalização lógica de artistas e álbuns

A normalização lógica reduz fragmentação causada por pequenas variações de grafia sem alterar arquivos em `MUSIC_DIR`.

## Princípio

A metadata exibida pelo Home Music segue esta precedência:

```text
metadata física do arquivo
        ↓
override administrativo por faixa
        ↓
alias lógico global
        ↓
projeção canônica consumida pela biblioteca
```

O scanner continua sendo a fonte da metadata física. Overrides por faixa continuam sendo a correção explícita de uma faixa específica. A normalização lógica atua somente depois dessas duas camadas.

## O que é normalizado

A heurística atual é deliberadamente conservadora. Dois valores só entram no mesmo grupo provável quando diferem apenas por:

- acentos/diacríticos;
- caixa (`Maiúsculas`/`minúsculas`);
- espaços extras ou repetidos.

Exemplos candidatos:

```text
Beyonce  ↔ Beyoncé
AC DC    ↔ ac dc
João Gilberto ↔ JOAO   GILBERTO
```

Pontuação e artigos **não** são removidos automaticamente. Assim, valores como `AC/DC` e `AC DC`, ou `The Beatles` e `Beatles`, não são associados pela heurística atual e exigiriam uma decisão futura explícita de produto.

## Artistas

Aliases de artista são globais para a biblioteca lógica.

Quando `Beyonce → Beyoncé` é aprovado, a projeção canônica aplica `Beyoncé` tanto em `artist` quanto em `albumArtist`, sem escrever de volta no arquivo.

## Álbuns

Aliases de álbum são escopados pelo `albumArtist` já canônico.

Isso evita juntar discos homônimos de artistas diferentes. Por exemplo, uma associação de `Lemonade → Lémonade` em `Beyoncé` não afeta um álbum chamado `Lemonade` de outro artista.

## Evidência do Assistente da Biblioteca

A tela de Normalização reutiliza a evidência MusicBrainz que já foi produzida pelo Assistente da Biblioteca. Ela **não** executa uma segunda busca externa, não mantém outro matcher e não cria outra tabela de aliases.

O fluxo permanece:

```text
heurística local conservadora encontra o grupo
        ↓
review consulta evidência já persistida pelo Assistente
        ↓
MusicBrainz pode corroborar uma grafia existente
        ↓
administrador confirma a associação no store atual
```

Para artistas, um MBID consistente entre as variantes pode corroborar a grafia canônica devolvida pelo MusicBrainz. Para álbuns, `release-group` é preferido como identidade externa; `release` é usado apenas quando esse identificador mais estável não está disponível.

A evidência é somente auxiliar:

- o grupo continua sendo criado exclusivamente pela heurística local da normalização;
- a grafia externa só é pré-selecionada quando ela existe exatamente entre as variantes locais;
- IDs externos conflitantes removem a sugestão automática e deixam a decisão para revisão humana;
- ausência de dados do Assistente/MusicBrainz não remove nem altera os candidatos locais;
- pontuação, artigos e diferenças semânticas continuam fora da equivalência conservadora;
- nenhum alias é aplicado automaticamente.

Isso preserva a separação entre correção por faixa e alias global: o Assistente não cria overrides em massa para resolver uma variação global, e a Normalização não transforma uma sugestão de uma única faixa em alias para toda a biblioteca.

## Persistência

Aliases são persistidos na tabela SQLite:

```text
library_metadata_aliases
```

Cada linha registra:

- tipo (`artist` ou `album`);
- escopo de artista quando o tipo é álbum;
- valor de origem;
- valor canônico;
- timestamps de criação/atualização.

A combinação `(kind, scope, source_value)` é única. O backend bloqueia associações que criariam cadeias de aliases ou reutilizariam uma origem já associada.

Evidências externas **não** são copiadas para `library_metadata_aliases`. O review lê apenas os dados derivados já presentes nas sugestões do Assistente; a tabela de aliases continua sendo a única autoridade de normalização persistida.

## Revisão administrativa

A área **Administração → Normalização** apresenta:

- grupos prováveis encontrados na biblioteca efetiva;
- contagem de faixas por grafia;
- escolha explícita da grafia canônica;
- evidência MusicBrainz quando disponível;
- MBIDs relevantes e conflitos entre identidades externas;
- aliases ativos;
- ação `Desfazer` por alias.

Nenhuma associação é criada automaticamente. O administrador sempre confirma a grafia canônica antes da persistência, mesmo quando MusicBrainz fornece evidência consistente.

A interface deixa explícito que arquivos físicos e tags embutidas não são alterados.

## API

Todas as rotas abaixo pertencem ao namespace administrativo e exigem sessão `admin`:

```text
GET    /api/admin/library/normalization
POST   /api/admin/library/normalization/aliases
DELETE /api/admin/library/normalization/aliases/:id
```

Mutações também exigem:

```text
X-Home-Music-Request: 1
```

`GET` retorna candidatos, aliases e contagens. Quando existe evidência MusicBrainz reaproveitável, cada candidato pode carregar dados auxiliares de canônico provável, IDs externos e conflito. `POST` continua validando novamente a equivalência e a presença das grafias na biblioteca atual antes de persistir. `DELETE` desfaz uma associação sem tocar no arquivo físico.

## Navegação e filtros

`GET /api/library` publica a projeção canônica. Portanto, agrupamentos e filtros do frontend usam naturalmente os nomes normalizados sem manter uma segunda tabela de transformação no navegador.

A identidade estável da faixa (`track.id`) não muda.

## Smart playlists

A avaliação das smart playlists usa a mesma projeção canônica da biblioteca:

```text
track físico
  → override por faixa
  → alias lógico
  → regra da smart playlist
```

Isso vale para filtros de artista/álbum e para ordenação por título. Favoritos, histórico, disponibilidade e pasta continuam com suas responsabilidades atuais.

Após criar/desfazer um alias, o frontend solicita novamente biblioteca e playlists para reconciliar o estado com o backend.

## Estatísticas

A antiga superfície `/api/statistics` não faz parte da API ativa e continua ausente.

Se estatísticas forem reintroduzidas em uma evolução futura, elas devem consumir a mesma projeção canônica desta feature em vez de agrupar diretamente `tracks.artist`/`tracks.album`. Não deve existir uma segunda lógica de normalização específica para estatísticas.

## Segurança e invariantes

A normalização lógica:

- não lê nem escreve arquivos para aplicar um alias;
- não renomeia diretórios;
- não altera tags embutidas;
- não muda `track.id`;
- não contorna overrides administrativos por faixa;
- não pode ser administrada por usuário com role `user`;
- é reversível pela remoção do alias;
- mantém álbuns confinados ao artista canônico correspondente;
- não faz egress externo durante o review de Normalização;
- não auto-aplica alias global com base em evidência externa.

## Testes relevantes

A feature cobre:

- acentos;
- caixa;
- espaços;
- falsos positivos por pontuação/artigos;
- persistência após reabertura do SQLite;
- undo;
- escopo de álbum;
- precedência de override por faixa;
- consumo por smart playlists;
- evidência MusicBrainz consistente entre variantes;
- conflito entre MBIDs sem perda do candidato local;
- fallback para review local quando não existe evidência externa;
- 403 para usuário comum;
- exigência do header de mutação;
- fluxo Playwright de revisão, aplicação e undo.
