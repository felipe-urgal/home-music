# Administração — ownership e estados (#659)

## Fluxo ativo e legado

`AdministrationScreen` é o cockpit e roteia as subviews em estado local. A navegação volta ao cockpit, sem criar um roteador paralelo. `AdminLibraryAssistantScreen` era uma implementação legada sem import de produção e foi removida com seus estilos/testes exclusivos; não se aplica documentar dois owners ativos.

A entrada ativa permanece `AdminLibraryAssistantWithLocalLyricsScreen` → `AdminLibraryAssistantTabbedScreen`. O wrapper mantém aberta a experiência local de lyrics, e uma atualização por `refreshRevision` revalida os dados após concluir o job, **sem desmontar o Assistente e perder aba, filtro, busca ou seleção**.

## Responsabilidades reais

| Responsabilidade | Owner | Regra |
| --- | --- | --- |
| Execução, progresso e cancelamento por capability | `AdminLibraryAssistantTabbedScreen` + APIs de runs | Uma execução por capability; não confundir os três estados |
| Revisão e decisões de sugestões | `AdminLibraryAssistantTabbedScreen`, serviço de revisão no servidor | `runId`, revisão e valores esperados acompanham cada decisão; `notifyLibraryChanged()` após aplicação |
| Política/autonomia | `AdminLibraryAssistantSettingsPanel` (UI), serviço de policy/autonomia no servidor | O servidor decide o que é aplicável; a UI oferece controles, não um segundo motor de policy |
| Fingerprint de sugestões | `AdminLibraryAssistantTabbedScreen` + endpoint fingerprint | Confirmação de uma sugestão específica, guard contra request stale; a API preserva o limite de autoridade |
| Lyrics local | `AdminLocalLyricsPanel` + `AdminLibraryAssistantWithLocalLyricsScreen` | Job local resulta em sugestão revisável, não em escrita direta; recarrega a revisão mantendo o contexto |

A análise, a revisão e a identificação de uma sugestão compartilham `runId`, mapa de faixas e estado de revisão: separá-las em hooks independentes com cópias desse estado criaria ownership concorrente. Não extrair por contagem de linhas. Contratos públicos continuam em `@home-music/shared`; o frontend não autoriza operações de filesystem, usuários ou aplicação de sugestões.

## Estados e concorrência

- Importação: `AdminImportMediaScreen` é o **único owner de jobs**. O provider recebe snapshots e reporta mutações, não mantém polling próprio de jobs. Poll é single-flight e cada mutação/atualização explícita invalida o snapshot anterior por geração/AbortController; unmount aborta.
- Histórico: `AdminOperationHistoryScreen` impede resultados fora de ordem por sequência; nova tentativa explícita exige nova URL ou arquivo quando suportado, e oferece retorno à importação.
- Assistente: atualizações de runs, settings e fingerprint usam gerações independentes. Troca de capability/filtro não reinicia a busca ou faz o snapshot de outra execução dominar a aba atual.
- Cockpit: loading/erro/retry ficam visíveis, com feedback terminal de scan. Refresh de dados da subview mantém a subview; o botão Voltar retorna ao cockpit. Filtro de saúde passado aos metadados é preservado enquanto a subview está ativa.
- Ações desabilitadas não animam um ícone de submit somente porque existe outro job em andamento; o progresso do job aparece em seu próprio status.

## Gates e testes

`npm run check`, `npm run test:security`, E2E da importação, histórico/retry, navegação, polling stale/unmount, descarte de senha, ownership multiusuário, movimentação/quarentena e revisão/lyrics do Assistente fazem parte do gate CI. As validações server-side de last-admin/auto-lockout e de filesystem não são duplicadas como autoridade visual.
