# Lyrics no player e offline

A resolução de lyrics continua sendo responsabilidade do endpoint canônico `GET /api/tracks/:id/lyrics`, compartilhado com as integrações do servidor.

Ao preparar uma faixa para uso offline, o cliente captura a resposta canônica de lyrics no mesmo fluxo do download de áudio e grava um snapshot derivado, isolado pelo usuário offline. O snapshot preserva `plain`/`synced`, inclui uma revisão curta calculada a partir do conteúdo efetivo e pode ser reconstruído a qualquer momento.

Durante reprodução offline o player consulta somente esse snapshot local; nenhuma chamada ao servidor ou provider externo é tentada. Em modo online, o player continua consultando o endpoint canônico e não faz requisições ligadas ao `currentTime`.

O painel de letras pode ser exibido em layouts mobile e desktop. Letras sincronizadas recalculam a linha ativa após seek/troca de faixa, não usam `aria-live` por linha e permitem suspender o acompanhamento automático quando o usuário faz scroll, com ação explícita para retomá-lo.
