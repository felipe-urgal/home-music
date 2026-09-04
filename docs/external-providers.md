# Arquitetura de providers externos

A Fase 9 separa aquisição externa do pipeline principal de importação. O contrato genérico foi criado na #96 e hoje possui providers concretos para **yt-dlp** (#104) e **Jamendo** (#262), além do fluxo de lotes/playlists (#154).

A decisão arquitetural original continua válida: o Home Music não acopla o domínio principal a um site específico e não permite que uma engine externa escreva diretamente em `MUSIC_DIR`.

## Responsabilidades

A arquitetura separa cinco fronteiras:

1. **provider** reconhece a entrada e prepara uma mídia candidata;
2. **scratch do provider** é a única área de filesystem entregue à engine/adaptador externo;
3. **core do Home Music** reabre a saída como arquivo regular seguro;
4. **ImportStagingManager** recebe os bytes copiados pelo core;
5. validação técnica, metadata, duplicatas, destino, promoção e indexação continuam no pipeline comum.

Nenhum provider recebe caminho de `MUSIC_DIR` e nenhum provider escreve diretamente no payload final gerenciado pelo staging.

## Fluxo atual

```text
URL/identificador público
   ↓
ExternalProvider.validate()
   ↓
ImportJob: processing
   ↓
provider scratch privado
   ↓
engine externa / adapter
   ↓
arquivo candidato + metadata sugerida
   ↓
core reabre/valida arquivo regular
   ↓
stream controlado → ImportStagingManager
   ↓
ImportJob: pending
   ↓
FFprobe/FFmpeg
   ↓
metadata
   ↓
duplicatas
   ↓
destino seguro
   ↓
promoção
   ↓
indexação incremental
```

`pending` após a aquisição significa apenas que o payload passou para o staging controlado e aguarda a próxima ação do pipeline; não significa que a faixa já entrou na biblioteca.

## Contrato `ExternalProvider`

Cada provider declara:

- `id` estável;
- `label`;
- `capabilities` (`audio`, `metadata`, `thumbnail`, `playlists`);
- configurações obrigatórias quando houver;
- `validate(request)` para reconhecer/rejeitar a entrada;
- `prepare(request, context)` para produzir saída no scratch e metadata sugerida.

O contexto entregue ao provider é restrito. Ele não recebe banco, sessão HTTP, fila como autoridade nem `MUSIC_DIR`.

### Regra para `validate`

A validação inicial deve ser local e barata. Ela não substitui a política de egress da engine real: um provider pode descobrir redirects, manifests, APIs e CDNs depois da URL inicial.

## Registro e capabilities

`ExternalProviderImportManager` recebe providers na composição da aplicação e rejeita IDs duplicados. A listagem pública administrativa devolve apenas dados necessários à UI, como:

- ID;
- label;
- capabilities;
- estado de configuração/disponibilidade.

Segredos/valores de configuração nunca são retornados ao navegador.

O core continua funcional quando um provider opcional está indisponível. Upload e URL direta não dependem de yt-dlp nem de Jamendo.

## Entrada e privacidade

Antes de criar um job, o manager exige uma URL válida para a capability declarada e aplica limites defensivos.

A URL completa é transitória. O histórico/job não deve persistir query string ou credenciais por conveniência. Erros públicos também não devem ecoar `stderr`, stack trace ou paths internos do provider.

Providers que precisam de uma URL temporária/assinada para adquirir bytes devem mantê-la apenas server-side e pelo menor tempo possível. Quando existir uma origem pública canônica, ela deve ser preferida como identificador administrativo/auditável.

## Scratch do provider

O scratch é privado, separado de `MUSIC_DIR` e descartável por job.

Regras:

- raiz real separada da biblioteca;
- workspace com permissão restrita;
- saída relativa sem traversal;
- arquivo final precisa ser regular e continuar confinado ao workspace;
- symlinks não são aceitos como atalho para fora do scratch;
- o core reabre a saída com as proteções existentes antes de copiar;
- scratch é limpo depois da transferência, falha ou cancelamento.

## Transferência para staging

O arquivo retornado pelo provider nunca é promovido diretamente.

O core:

1. abre a saída segura;
2. verifica tamanho/identidade;
3. lê o descritor validado;
4. aplica limite de bytes durante o stream;
5. entrega chunks ao `ImportStagingManager`;
6. confirma que a origem não mudou de forma inesperada durante a cópia;
7. remove o scratch.

Depois disso, apenas o payload do staging participa das etapas seguintes.

## Metadata

Metadata de provider é sugestão não confiável. Strings são normalizadas/limitadas antes de chegar ao preview.

Além dos campos musicais sugeridos, integrações que possuem obrigações de origem/licença podem manter metadata administrativa segura e pública — por exemplo `sourceId`, origem canônica, licença e atribuição — desde que isso não inclua tokens, query strings assinadas ou credenciais temporárias.

Valores externos nunca são usados diretamente como:

- path de destino;
- argumento arbitrário de processo;
- autorização de rede;
- metadata confiável que substitui silenciosamente o arquivo.

O preview administrativo continua responsável pela revisão humana quando houver sugestão/conflito.

## yt-dlp atual

O adapter yt-dlp usa processo externo, sem shell e sem flags arbitrárias vindas da UI.

O adapter atual:

- usa scratch isolado;
- não entrega `MUSIC_DIR` ao processo;
- ignora configurações/plugins do usuário quando necessário para manter comportamento controlado;
- usa ambiente reduzido;
- normaliza saída estruturada;
- controla timeout/cancelamento e encerra a árvore/grupo de processos;
- preserva a melhor fonte de áudio disponível sem reencode artificial quando possível;
- usa isolamento de egress próprio para impedir acesso a destinos internos proibidos.

Detalhes específicos: [yt-dlp-provider.md](yt-dlp-provider.md).

A avaliação que levou a essa escolha permanece registrada em [external-provider-engine-decision.md](external-provider-engine-decision.md).

## Jamendo atual

O adapter Jamendo não entrega a URL de download ao browser. O navegador trabalha com busca normalizada, licença/atribuição e o `sourceId`; ao iniciar uma importação usa somente a URL pública canônica `https://www.jamendo.com/track/<sourceId>`.

No servidor, o provider reconsulta a API Jamendo, reaplica a política fail-closed de licença/download e mantém `audiodownload` apenas como dado transitório. A transferência acontece dentro do scratch privado.

Para não duplicar a política de SSRF, o download físico reutiliza o `ImportUrlManager` em um staging temporário inteiramente contido no scratch. Portanto o Jamendo herda a mesma validação de DNS/IP, conexão pinada, redirects, Content-Type, limite de bytes, timeout e reconhecimento de áudio da importação por URL. O resultado temporário ainda precisa passar pela fronteira normal do `ExternalProviderImportManager`, que reabre o arquivo regular e copia os bytes para o staging real.

Depois dessa cópia, Jamendo e yt-dlp convergem no mesmo pipeline de FFprobe/FFmpeg, metadata, duplicatas, destino seguro, promoção e indexação.

Detalhes específicos: [jamendo.md](jamendo.md).

## Isolamento de egress / SSRF

Providers externos são uma fronteira diferente da URL direta. Validar apenas a URL inicial não é suficiente porque a engine pode realizar requests secundários.

O adapter yt-dlp atual executa atrás de um proxy local controlado pelo Home Music, que valida DNS/IP antes de abrir conexões e bloqueia destinos internos/reservados relevantes. O processo recebe a configuração de proxy de forma explícita e não herda livremente o ambiente do servidor.

O adapter Jamendo não executa uma engine arbitrária: a API de descoberta usa endpoint fixo e o download físico reutiliza a implementação SSRF-safe de importação por URL dentro do scratch, incluindo revalidação de redirects.

Qualquer provider futuro precisa oferecer proteção equivalente ou mais forte. Não registrar uma nova engine real sem conseguir provar que processo e auxiliares não podem contornar a política de egress.

## Playlists e lotes

O suporte a playlists/lotes de provider não cria um único job gigante. O agrupador coordena itens independentes, cada um com staging e pipeline próprios.

Isso preserva:

- falha parcial por item;
- duplicata sem cancelar todo o lote;
- limites de quantidade/tamanho/duração;
- destino seguro por item;
- cancelamento sem corromper jobs já concluídos.

Detalhes: [external-provider-batches.md](external-provider-batches.md).

## Estados

- `processing`: provider está preparando/transferindo a saída;
- `pending`: payload já está sob controle do staging e aguarda próxima etapa;
- `failed`: setup, timeout, egress, saída insegura/inválida, limite ou falha do adapter;
- `cancelled`: cancelamento e cleanup dos temporários;
- `completed`: somente depois do pipeline comum promover/indexar com sucesso.

## Testes

A cobertura usa providers/downloaders fakes e testes dedicados de egress sem depender de internet pública no CI.

Casos relevantes incluem:

- registry/capabilities;
- configuração obrigatória sem vazamento de segredo;
- ausência da URL original/assinada no estado público quando não é necessária;
- scratch separado de `MUSIC_DIR`;
- traversal/symlink;
- limite de bytes;
- timeout/cancelamento;
- canonicalização de erros;
- bloqueio de destinos privados/reservados no egress;
- seleção de formato/metadata do yt-dlp;
- aquisição Jamendo `scratch → staging` com downloader fake;
- licença/atribuição Jamendo e ausência da URL assinada nas respostas administrativas;
- lotes com falha parcial.