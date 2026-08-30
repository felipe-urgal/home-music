# Smart playlists

Smart playlists são playlists pessoais calculadas dinamicamente a partir da biblioteca, dos favoritos e do histórico do usuário.

Diferente de playlists manuais, elas **não materializam** a lista de faixas em `playlist_tracks`. O SQLite persiste somente nome, ownership, regra e timestamps; os `trackIds` são recalculados quando a playlist é consultada.

## Ownership

Toda smart playlist pertence a um usuário persistido.

- o backend deriva o owner de `request.user.id`;
- o cliente não envia `userId` como autoridade;
- listar, editar e excluir sempre aplicam o owner da sessão;
- um ID pertencente a outro usuário é tratado como não encontrado;
- favoritos e histórico usados na avaliação também são lidos somente no namespace do usuário autenticado.

## Regras

Uma regra possui os campos:

```ts
{
  artist: string | null;
  album: string | null;
  folderPath: string | null;
  favorite: boolean | null;
  history: 'any' | 'played' | 'never';
  periodDays: number | null;
  sort: 'most-played' | 'recently-played' | 'oldest-favorite' | 'title';
  limit: number;
}
```

Limites atuais:

- artista/álbum: até 160 caracteres;
- pasta: até 512 caracteres;
- período: `1..3650` dias ou sem limite;
- resultado: `1..500` faixas.

Filtros de artista e álbum usam comparação textual normalizada. Pasta inclui a pasta informada e suas subpastas.

### Histórico e período

`periodDays` limita a janela usada para contagem e ordenação do histórico.

A regra `history: 'never'` significa **nunca tocada pelo usuário**, independentemente da janela de período. Uma faixa tocada fora do período não volta a ser considerada “nunca tocada”.

### Favoritos

`favorite` aceita:

- `null` — qualquer faixa;
- `true` — somente favoritas;
- `false` — somente não favoritas.

`oldest-favorite` ordena pela data em que a faixa entrou nos favoritos do usuário.

## Disponibilidade da biblioteca

A avaliação considera somente faixas atualmente disponíveis para reprodução. Quando existe estado em `track_availability`, faixas administrativamente desativadas são excluídas do resultado.

O resultado continua derivado: reativar uma faixa pode fazê-la reaparecer sem editar a regra.

## API

Endpoints autenticados:

```text
GET    /api/smart-playlists
POST   /api/smart-playlists/preview
POST   /api/smart-playlists
PATCH  /api/smart-playlists/:id
DELETE /api/smart-playlists/:id
```

Todas as mutações usam a proteção global:

```text
X-Home-Music-Request: 1
```

### Preview

O preview recebe somente a regra e devolve os IDs calculados, sem persistir uma playlist:

```json
{
  "rule": {
    "artist": null,
    "album": null,
    "folderPath": null,
    "favorite": true,
    "history": "played",
    "periodDays": 30,
    "sort": "most-played",
    "limit": 100
  }
}
```

A UI exige um preview correspondente à versão atual da regra antes de habilitar o salvamento. Alterar qualquer campo da regra invalida o preview anterior.

## UI

Fluxo principal:

```text
Biblioteca
  ↓
Playlists
  ↓
Inteligente
  ↓
configurar regra
  ↓
gerar preview
  ↓
salvar
```

Na listagem, smart playlists aparecem junto de playlists manuais e Rekordbox, identificadas como **Inteligente**.

Em uma smart playlist:

- as faixas podem ser reproduzidas normalmente;
- as faixas não podem ser adicionadas/removidas manualmente;
- nome e regra podem ser editados;
- excluir remove apenas a definição da smart playlist, nunca a música da biblioteca.

Playlists manuais continuam editáveis como antes e playlists Rekordbox continuam somente leitura.

## Persistência

A tabela `smart_playlists` armazena:

```text
id
owner_user_id
name
rule_json
created_at
updated_at
```

Ela fica no mesmo SQLite principal e, portanto, é incluída no backup de estado existente. Não há cópia dos resultados em `playlist_tracks`.

## Testes e invariantes

A cobertura da feature deve provar pelo menos:

- validação estrita de regra e limites;
- combinação de filtros;
- período de histórico;
- “nunca tocada” considerando todo o histórico;
- ordenação por mais tocadas, recentes e favoritas antigas;
- ausência de materialização em `playlist_tracks`;
- isolamento de definições, favoritos e histórico por usuário;
- faixas desativadas fora do resultado;
- playlists manuais e Rekordbox sem regressão;
- preview antes de salvar na UI.

O gate geral continua sendo o definido em [`../AGENTS.md`](../AGENTS.md).
