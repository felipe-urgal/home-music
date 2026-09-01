# Política de fallback de artwork

Status: canônico.

Este documento define como o Home Music representa visualmente músicas que não possuem uma capa efetiva disponível.

## Regra funcional

A precedência de capa continua sendo:

1. override administrativo salvo no SQLite;
2. capa física embutida no arquivo de áudio;
3. fallback visual do frontend.

O fallback é apenas apresentação. Ele **não** altera `hasCover`, `coverVersion`, o scanner, o arquivo físico nem o estado de overrides.

Se `hasCover` for `true`, o frontend tenta carregar `/api/tracks/:id/cover`, preservando `coverVersion` na URL quando presente. Se a imagem falhar no navegador, o componente mostra o fallback localmente sem reescrever o contrato da música.

## Direção visual escolhida

Para a #175 foram comparadas três direções simples:

1. ícone musical central sobre fundo neutro;
2. iniciais sobre gradiente;
3. iniciais + detalhe de disco sobre um tom estável por identidade musical.

A direção 3 é a política adotada. Ela mantém a interface leve, evita aparência de imagem quebrada e oferece identidade visual suficiente sem ser confundida com uma capa real.

A identidade é determinística:

- usa primeiro o álbum quando ele é conhecido;
- caso contrário usa artista do álbum/artista;
- por fim usa o título;
- o mesmo valor de identidade produz as mesmas iniciais e o mesmo tom.

## Componentes

`apps/web/src/components/Artwork.tsx` é a implementação central.

- `Artwork` decide entre capa efetiva e fallback e trata falha de carregamento da imagem;
- `ArtworkFallback` renderiza somente a representação visual reutilizável quando a própria superfície já sabe que não existe capa disponível;
- `apps/web/src/artwork-utils.ts` concentra a identidade determinística do fallback;
- `apps/web/src/artwork.css` concentra a apresentação visual e as variações de tamanho/superfície.

Não criar placeholders paralelos por tela. Novas superfícies que exibirem artwork devem reutilizar esses componentes e utilitários.

## Superfícies cobertas

A política deve permanecer consistente em:

- biblioteca mobile;
- tabela/biblioteca desktop;
- player principal;
- mini player;
- Administração → Metadados → preview de capa;
- outras superfícies futuras que exibirem a capa de uma música.

O editor administrativo pode continuar exibindo um preview local real quando o usuário selecionar uma nova imagem. Quando não existir preview, override ou capa física, deve voltar ao `ArtworkFallback` central.

## Acessibilidade e estados de erro

O artwork é decorativo porque título, artista e contexto já são apresentados como texto nas superfícies que o utilizam. Por isso o wrapper permanece com `aria-hidden="true"` e imagens de artwork usadas no componente central têm `alt=""`.

A ausência ou falha da imagem não depende de animação, cor isolada ou mensagem técnica: a UI troca imediatamente para o fallback estático. Estados de loading e erro das telas continuam sendo comunicados pelos componentes funcionais correspondentes.

## Regressões obrigatórias

Mudanças nesta política devem preservar:

- precedência `override → capa física → fallback`;
- semântica de `hasCover` e `coverVersion`;
- identidade determinística do fallback;
- legibilidade no tema escuro;
- comportamento em thumbnail e artwork grande;
- consistência entre biblioteca, player e administração;
- fallback em falha de carregamento de imagem sem mutar o objeto `Track`.

A cobertura automatizada fica em `apps/web/src/artwork-utils.test.ts` e `apps/web/src/Artwork.test.tsx`.
