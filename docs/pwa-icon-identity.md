# Identidade visual da PWA

Status: canônico.

Issue: #176.

Este documento define os assets de instalação e a identidade compacta do Home Music em launcher, favicon e superfícies de sistema.

## Direção escolhida

Foram comparados três conceitos em [`assets/pwa-icon-concepts.svg`](assets/pwa-icon-concepts.svg):

1. **Casa + vinil** — selecionado. Une `Home` + `Music` sem depender de texto e conserva leitura em tamanhos pequenos;
2. **Vinil + play** — musical e simples, porém genérico para players;
3. **Casa + equalizador** — comunica áudio, mas as barras perdem definição mais cedo em tamanhos pequenos.

A marca final usa fundo azul-marinho escuro, azul principal `#1e8be8`, disco claro e detalhes mínimos. Não há lettering dentro do ícone.

## Matriz de assets

O favicon permanece vetorial em `/favicon.svg`.

O manifest declara PNGs dedicados:

- `/icons/app-icon-192.png` — `192x192`, `purpose: any`;
- `/icons/app-icon-512.png` — `512x512`, `purpose: any`;
- `/icons/app-icon-maskable-192.png` — `192x192`, `purpose: maskable`;
- `/icons/app-icon-maskable-512.png` — `512x512`, `purpose: maskable`.

O shell HTML também expõe:

- `/icons/apple-touch-icon.png` — `180x180`, fundo opaco para instalação no iOS;
- `/safari-pinned-tab.svg` — variante monocromática para pinned tabs do Safari.

As versões `maskable` usam fundo full-bleed. O símbolo principal fica concentrado no miolo do canvas, dentro da safe zone central, para tolerar círculos, squircle e demais máscaras de launcher sem cortar casa ou disco.

## Geração determinística

Os PNGs não são blobs manuais versionados. `apps/web/scripts/generate-pwa-icons.mjs` usa somente APIs nativas do Node para desenhar a geometria e escrever PNG RGBA determinístico.

Os lifecycle scripts `predev`, `prebuild` e `pretest` geram a matriz antes de desenvolvimento, build e regressões. Os arquivos resultantes em `apps/web/public/icons/*.png` ficam ignorados pelo Git porque são artefatos derivados.

Essa decisão mantém a fonte visual auditável em texto, evita dependência de rasterização externa e garante que CI/produção produzam exatamente os tamanhos declarados no manifest.

## Cache e offline

A #176 não altera o protocolo nem o namespace de áudio offline. O service worker continua com `home-music-offline-audio-v2-<userId>` e com a capability versão 3.

`manifest.webmanifest` e `favicon.svg` continuam na revalidação estática existente. Os PNGs de instalação são recursos públicos gerados no build e não entram no pipeline de download de músicas.

## Regressão

`apps/web/src/pwa-identity.test.ts` verifica:

- entradas `any` e `maskable` do manifest;
- assinatura PNG e dimensões reais de todos os rasters gerados;
- `apple-touch-icon`, pinned tab e título de instalação no HTML;
- preservação explícita do namespace de áudio offline e da revalidação de manifest/favicon.

Build, Playwright crítico e smoke de produção continuam sendo o gate final para confirmar que os assets derivados entram corretamente no artefato servido.
