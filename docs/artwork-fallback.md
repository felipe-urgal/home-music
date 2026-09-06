# Política de fallback de artwork

Status: canônico.

Este documento define como o Home Music representa visualmente músicas que não possuem uma capa efetiva disponível.

## Regra funcional

A precedência de capa continua sendo:

1. override administrativo salvo no SQLite;
2. capa física embutida no arquivo de áudio;
3. fallback visual derivado.

O fallback é apenas apresentação. Ele **não** altera `hasCover`, `coverVersion`, o scanner, o arquivo físico nem o estado de overrides.

Se `hasCover` for `true`, o frontend tenta carregar `/api/tracks/:id/cover`, preservando `coverVersion` na URL quando presente. Se a imagem falhar no navegador, o componente mostra o fallback localmente sem reescrever o contrato da música.

## Identidade canônica v1

A decisão visual do fallback vive em `apps/web/src/artwork-utils.ts` e possui versão explícita (`ARTWORK_FALLBACK_VERSION = 1`). A mesma metadata e a mesma versão produzem o mesmo descriptor, composto por:

- label curta;
- índice de tom;
- palette usada pelos renderers.

A identidade usa somente metadata já exibida pela aplicação e nunca usa path físico como seed:

- usa primeiro o álbum quando ele é conhecido;
- caso contrário usa artista do álbum/artista;
- por fim usa o título;
- faixas do mesmo álbum mantêm a mesma identidade visual;
- texto longo, Unicode e acentos são reduzidos para uma label curta de forma determinística.

A versão faz parte do descriptor para que mudanças futuras de linguagem visual não alterem silenciosamente caches ou representações persistidas. Uma nova versão de algoritmo deve ser deliberada e testada.

## Direção visual escolhida

Para a #175 foram comparadas três direções simples:

1. ícone musical central sobre fundo neutro;
2. iniciais sobre gradiente;
3. iniciais + detalhe de disco sobre um tom estável por identidade musical.

A direção 3 é a política adotada. Ela mantém a interface leve, evita aparência de imagem quebrada e oferece identidade visual suficiente sem ser confundida com uma capa real.

## Renderers

`apps/web/src/components/Artwork.tsx` é a implementação React central.

- `Artwork` decide entre capa efetiva e fallback e trata falha de carregamento da imagem;
- `ArtworkFallback` consome o descriptor canônico e renderiza sua palette por variáveis CSS;
- `artworkFallbackSvg()` produz uma representação quadrada estática a partir **do mesmo descriptor** para superfícies que não renderizam React, sem provider externo, browser headless ou persistência em `track_cover_overrides`;
- `artworkFallbackDataUrl()` empacota esse SVG como recurso local derivado;
- `apps/web/src/artwork.css` concentra layout e escala, mas não mantém uma segunda tabela de cores/tom.

O renderer estático limita dimensões, escapa texto antes de serializar XML e carrega a versão do descriptor. Ele é arte derivada, não uma capa efetiva e não altera a precedência canônica.

Não criar placeholders paralelos por tela. Novas superfícies que exibirem artwork devem reutilizar o descriptor e um desses renderers em vez de recalcular seed, iniciais ou palette.

## Superfícies cobertas

A política deve permanecer consistente em:

- biblioteca mobile;
- tabela/biblioteca desktop;
- player principal;
- mini player;
- Administração → Metadados → preview de capa;
- Media Session quando a superfície consumir a representação estática;
- outras superfícies futuras que exibirem a capa de uma música.

O editor administrativo pode continuar exibindo um preview local real quando o usuário selecionar uma nova imagem. Quando não existir preview, override ou capa física, deve voltar ao `ArtworkFallback` central.

## Camada persistente

Renderizar fallback não cria uma capa persistida. A eventual materialização de uma imagem gerada pelo Home Music é uma capacidade separada e explícita da #321: deve passar pelo pipeline canônico de cover override, registrar proveniência quando o modelo suportar e permitir restore. A Camada A descrita neste documento não escreve banco, mídia ou override.

## Acessibilidade e estados de erro

O artwork é decorativo porque título, artista e contexto já são apresentados como texto nas superfícies que o utilizam. Por isso o wrapper permanece com `aria-hidden="true"` e imagens de artwork usadas no componente central têm `alt=""`.

A ausência ou falha da imagem não depende de animação, cor isolada ou mensagem técnica: a UI troca imediatamente para o fallback estático. Estados de loading e erro das telas continuam sendo comunicados pelos componentes funcionais correspondentes.

## Regressões obrigatórias

Mudanças nesta política devem preservar:

- precedência `override → capa física → fallback`;
- semântica de `hasCover` e `coverVersion`;
- identidade determinística e versionada do fallback;
- uma única decisão de label/tom/palette para React e render estático;
- nenhuma dependência de rede externa para fallback;
- nenhuma leitura de path físico para formar a identidade;
- legibilidade no tema escuro;
- comportamento em thumbnail e artwork grande;
- consistência entre biblioteca, player e administração;
- fallback em falha de carregamento de imagem sem mutar o objeto `Track`.

A cobertura automatizada fica em `apps/web/src/artwork-utils.test.ts` e `apps/web/src/Artwork.test.tsx`.
