# Compatibilidade OpenSubsonic (subset atual)

O Home Music implementa um subconjunto da API OpenSubsonic. Não anuncia compatibilidade integral com todos os clientes Subsonic.

## Formato de resposta

- `f=json`: resposta JSON com envelope `subsonic-response` (suportado).
- `f` ausente: resposta JSON por compatibilidade retroativa com o subset atual, **não** XML. O protocolo Subsonic normalmente espera XML como padrão; portanto clientes devem enviar `f=json` explicitamente.
- `f=xml`, `f=jsonp` ou outro valor: erro OpenSubsonic em JSON, código `0` (formato não suportado).
- Respostas binárias de mídia/capa, quando aplicáveis, usam o Content-Type da mídia, não o formato do envelope.

A escolha atual prioriza o subset JSON-only sem adicionar serialização XML parcial ou mudanças incompatíveis aos clientes existentes. O suporte geral a XML permanece pendente da matriz real de clientes da issue #662.

## Autenticação e segurança

Use uma chave OpenSubsonic dedicada por cliente, nunca a senha da conta web. A API preserva isolamento por usuário e valida autorização no servidor. Chaves revogadas não devem continuar autenticando. Não inclua tokens em logs, capturas de tela ou evidências de QA.

## Validação por cliente

Registre para cada cliente: nome/versão, sistema operacional, se envia `f=json`, método de autenticação e resultados de login, catálogo, busca, reprodução, capas, playlists, favoritos, lyrics e scrobble. Não classifique como compatível sem execução real.

O teste `open-subsonic-client-compat.test.ts` protege o contrato de resposta `f=json`, `f` ausente e formatos não suportados. Esses testes não substituem QA com clientes reais.

## Endpoints de descoberta

- `getRandomSongs`: implementado (limite 500, `musicFolderId` validado).
- `getGenres` e `getSongsByGenre`: implementados com resposta vazia, pois a biblioteca ainda não indexa gênero. Parâmetros e paginação são validados.
- `getNowPlaying`: não suportado; não há fonte de verdade segura de reprodução em andamento por usuário.
- `getAlbumInfo2`, `getArtistInfo2`, `getSimilarSongs2`, `getTopSongs`, `download` e play queue: fora do subset até que um cliente alvo dependa deles.
- Extensions anunciadas: somente `apiKeyAuthentication` e `songLyrics`; POST de formulário não é anunciado.
- Matriz de clientes reais e XML seguem pendentes e dependem de QA manual com clientes (ex.: Feishin).
