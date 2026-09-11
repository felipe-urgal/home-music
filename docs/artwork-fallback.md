# Política de fallback de artwork

Status: **canônico**.

Este documento define como o Home Music representa músicas que não possuem uma capa efetiva e como a mesma identidade é reutilizada entre biblioteca, player e Media Session.

## Precedência

A decisão de capa continua sendo:

1. override administrativo salvo no SQLite;
2. capa física embutida no arquivo de áudio;
3. fallback visual derivado.

O fallback não altera `hasCover`, `coverVersion`, scanner, arquivo físico ou estado de overrides.

## Identidade canônica

A identidade de fallback é determinística e versionada. A mesma metadata e a mesma versão produzem o mesmo descriptor visual.

A derivação usa somente metadata já exibida pela aplicação, priorizando contexto de álbum/artista e usando título quando necessário. Path físico nunca participa da identidade.

`Artwork` e `ArtworkFallback` consomem essa decisão no React; o renderer estático usa a mesma identidade para superfícies que precisam de bytes/URL de imagem.

Não criar placeholders independentes por tela.

## Capa efetiva

Quando `hasCover` é verdadeiro, o frontend usa o endpoint canônico de capa e inclui `coverVersion` para invalidação previsível quando aplicável.

Falha de carregamento no navegador degrada visualmente para o fallback sem mutar o objeto da faixa nem reescrever o estado persistido.

## Media Session

A projeção de artwork para Media Session segue a mesma política:

- capa efetiva disponível → endpoint canônico da faixa;
- sem capa efetiva → representação estática derivada da identidade de fallback;
- modo offline → recurso local/fallback sem depender de provider externo.

A publicação de metadata é best-effort. Se a plataforma rejeitar artwork, o Home Music pode degradar para título/artista/álbum sem interromper playback.

A lock screen recebe uma representação estática. O produto não promete vinil girando, vídeo ou atualização contínua de frames no sistema operacional.

## Player Agora

A tela **Agora / Tocando agora** usa `NowPlayingVinyl` como camada visual e reutiliza `Artwork` no centro do disco.

O componente não decide novamente qual é a capa e não cria fonte paralela de estado. A rotação deriva do estado canônico de reprodução e a troca de faixa atualiza a mesma artwork resolvida pelo fluxo normal.

A animação deve continuar leve e compositor-friendly, sem timers de alta frequência ou redraw contínuo desnecessário.

## Materialização persistente

A #321 também incorporou a possibilidade de materializar o fallback de forma explícita/reversível pelo pipeline canônico de cover override.

Materialização não acontece só porque uma faixa foi exibida sem capa. Quando usada, ela passa a ser uma capa efetiva normal e participa da precedência existente.

## Superfícies cobertas

A política deve permanecer consistente em:

- biblioteca mobile/desktop;
- player principal e mini player;
- Administração;
- Media Session/lock screen quando a plataforma aceitar artwork;
- futuras superfícies que exibam capa de faixa.

## Estado da integração de sistema

A implementação relacionada à #325 foi incorporada e a issue foi encerrada. A validação física residual de lock screen foi dispensada como gate por decisão do projeto e aceita como risco de plataforma; não deve ser descrita como teste em hardware executado.

Mudanças futuras em formato/tamanho/compatibilidade de artwork no sistema operacional devem abrir nova investigação quando houver evidência concreta de plataforma.

## Regressões obrigatórias

Mudanças nesta política devem preservar:

- precedência `override → capa física → fallback`;
- semântica de `hasCover` e `coverVersion`;
- identidade determinística/versionada;
- uma única decisão visual para React, renderer estático e Media Session;
- ausência de provider externo durante playback;
- ausência de path físico na identidade;
- playback intacto quando Media Session/artwork falhar;
- fallback de carregamento sem mutação de `Track`;
- nenhuma persistência automática apenas pela ausência de capa.

Cobertura relevante fica nos testes de artwork, Media Session e `NowPlayingVinyl` do workspace Web.
