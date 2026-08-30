# Preview de metadata da importação

A etapa de preview fica entre a validação técnica da mídia e a promoção para a biblioteca. Ela existe para que o administrador veja e ajuste o que será usado antes de qualquer arquivo entrar em `MUSIC_DIR`.

## Ordem do pipeline

1. upload, URL ou provider grava somente em staging/scratch controlado;
2. antes de eventual remux/transcode, o servidor captura um snapshot seguro da metadata embutida e da capa;
3. a validação técnica confirma codec, duração, streams e formato de saída;
4. o administrador gera/revisa o preview de metadata;
5. o servidor combina leitura embutida, sugestões do provider e ajustes do administrador sem alterar o arquivo original;
6. a etapa de duplicatas usa a metadata efetiva revisada;
7. o destino é planejado e a promoção segura só acontece depois dos gates necessários;
8. a biblioteca é atualizada incrementalmente depois da promoção.

O snapshot antes da transformação é importante porque o processamento técnico pode remover tags e imagens embutidas deliberadamente. Assim, a saída técnica continua limpa sem perder a informação confiável existente no arquivo de origem.

## Regra de confiança

A metadata embutida no arquivo é a fonte primária do preview. Valores externos nunca substituem silenciosamente um valor local e, quando são a única fonte para um campo, permanecem fora do valor efetivo até aceite explícito do administrador.

Cada campo recebe um estado:

- `trusted`: valor lido do arquivo, sem conflito externo;
- `suggested`: o arquivo não trouxe o campo e um provider sugeriu um valor, mas ele ainda não é efetivo;
- `conflict`: arquivo ou fallback local e provider divergem; o valor local continua efetivo;
- `fallback`: valor derivado de forma previsível, como o nome do arquivo para título ou o artista para artista do álbum;
- `missing`: nenhuma fonte confiável/sugerida trouxe o valor;
- `edited`: o administrador ajustou o campo no preview.

Sugestões e conflitos ficam visíveis para revisão humana. **Usar sugestão** apenas coloca o valor externo no formulário; ele só se torna `edited`/efetivo depois de **Salvar ajustes**.

## Campos

O preview trabalha com:

- título;
- artista;
- álbum;
- artista do álbum;
- duração validada tecnicamente;
- capa embutida quando JPEG, PNG ou WebP e dentro do limite seguro.

Textos são normalizados, caracteres de controle são removidos das leituras e os ajustes administrativos reutilizam as regras de metadata do Home Music: `trim`, valor não vazio e no máximo 240 caracteres.

## Capa

A capa não é serializada dentro do job. Bytes seguros ficam em cache limitado em memória e são servidos apenas pelo endpoint administrativo autenticado:

```text
GET /api/admin/imports/:id/cover
```

O cache aceita somente JPEG, PNG e WebP, até 8 MB por imagem, com limite global defensivo. Thumbnail externa de provider continua sendo dado não confiável e não é tratada como autorização para acesso irrestrito à rede.

## Ajustes não destrutivos

Os ajustes são mantidos no `metadataPreview` do job. Antes da promoção eles não:

- escrevem tags no arquivo do staging;
- criam `track_metadata_overrides` na biblioteca existente;
- alteram músicas já indexadas;
- tornam o arquivo visível em `MUSIC_DIR`.

Restaurar um campo remove apenas o ajuste do preview e recalcula o valor a partir das fontes capturadas.

## API

```text
POST  /api/admin/imports/:id/metadata-preview
PATCH /api/admin/imports/:id/metadata-preview
GET   /api/admin/imports/:id/cover
```

`POST` exige que a validação técnica já esteja concluída. `PATCH` aceita somente `title`, `artist`, `album` e `albumArtist` seguindo as regras compartilhadas de validação.

Todas as mutações continuam protegidas pela política administrativa e pelo header `X-Home-Music-Request: 1`. O endpoint de capa é somente leitura, mas exige sessão administrativa.

## UX atual

No workbench **Origem → Preparar → Revisar → Biblioteca**, o preview fica na etapa **Revisar**. O usuário vê metadata, sugestões/conflitos e duplicatas no mesmo fluxo de decisão, sem confundir revisão com promoção física.

Alterar/regenerar a metadata invalida um check de duplicatas anterior quando o resultado depender desses campos; o pipeline exige nova verificação antes da promoção quando necessário.

## Gate atual

A etapa deve continuar garantindo:

- metadata parcial e conflitante tratada sem confiar automaticamente em fonte externa;
- preview editável e responsivo;
- nenhuma escrita prematura na biblioteca;
- invalidação coerente do check de duplicatas após edição;
- erros públicos sanitizados;
- testes e CI preservando essas invariantes.
