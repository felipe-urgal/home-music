# Preview de metadata da importação

A etapa de preview fica entre a validação técnica da mídia e a futura promoção para a biblioteca. Ela existe para que o administrador veja e ajuste o que será usado antes de qualquer arquivo entrar em `MUSIC_DIR`.

## Ordem do pipeline

1. upload, URL ou provider grava somente no staging privado;
2. antes de eventual remux/transcode, o servidor captura um snapshot da metadata embutida e da capa segura;
3. a validação técnica da mídia da Fase 9 confirma codec, duração e formato de saída;
4. o administrador solicita o preview de metadata;
5. o servidor combina leitura embutida, sugestões do provider e ajustes do administrador sem alterar o arquivo;
6. a promoção definitiva continua reservada para uma etapa posterior.

O snapshot antes da transformação é importante porque o processamento técnico pode remover tags e imagens embutidas deliberadamente. Assim, a saída técnica continua limpa sem perder a informação confiável existente no arquivo de origem.

## Regra de confiança

A metadata embutida no arquivo é a fonte primária do preview. Valores externos nunca substituem silenciosamente um valor local.

Cada campo recebe um estado:

- `trusted`: valor lido do arquivo, sem conflito externo;
- `suggested`: o arquivo não trouxe o campo e um provider sugeriu um valor;
- `conflict`: arquivo e provider divergem; o valor local continua efetivo;
- `fallback`: valor derivado de forma previsível, como o nome do arquivo para título ou o artista para artista do álbum;
- `missing`: nenhuma fonte confiável/sugerida trouxe o valor;
- `edited`: o administrador ajustou o campo no preview.

Sugestões e conflitos ficam visíveis na interface para revisão humana. A etapa não transforma uma sugestão externa em metadata confiável automaticamente.

## Campos

O preview trabalha com:

- título;
- artista;
- álbum;
- artista do álbum;
- duração validada tecnicamente;
- capa embutida quando JPEG, PNG ou WebP e dentro do limite seguro.

Textos são normalizados, caracteres de controle são removidos das leituras e os ajustes administrativos reutilizam a regra de metadata override: `trim`, valor não vazio e no máximo 240 caracteres.

## Capa

A capa não é serializada dentro do job. Bytes seguros ficam em um cache limitado em memória e são servidos apenas pelo endpoint administrativo autenticado:

```text
GET /api/admin/imports/:id/cover
```

O cache aceita somente JPEG, PNG e WebP, até 8 MB por imagem, com limite global de 16 MB e até 64 entradas. Thumbnail externa de provider não é baixada nesta etapa.

## Ajustes não destrutivos

Os ajustes são mantidos no `metadataPreview` do job. Eles não:

- escrevem tags no arquivo do staging;
- criam `track_metadata_overrides` no SQLite;
- alteram a biblioteca existente;
- promovem a mídia para `MUSIC_DIR`.

Restaurar um campo remove apenas o ajuste do preview e recalcula o valor a partir das fontes já capturadas.

## API

```text
POST  /api/admin/imports/:id/metadata-preview
PATCH /api/admin/imports/:id/metadata-preview
GET   /api/admin/imports/:id/cover
```

`POST` exige que a validação técnica da mídia já esteja concluída. `PATCH` aceita somente `title`, `artist`, `album` e `albumArtist`, seguindo as mesmas regras de validação usadas pelos overrides de metadata das faixas existentes.

Todas as mutações continuam protegidas pela política administrativa e pelo header `X-Home-Music-Request`. O endpoint de capa é somente leitura, mas continua exigindo sessão administrativa.

## Gate da Fase 9

A etapa está pronta quando metadata parcial e conflitante são tratadas sem confiar automaticamente em fontes externas, o preview é editável e responsivo, nenhuma escrita ocorre na biblioteca e o CI completo permanece verde.
