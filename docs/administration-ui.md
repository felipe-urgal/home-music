# Administração — interface atual

Este documento registra a composição de UX atual das áreas **Minha conta** e **Administração** depois do ciclo de redesign de 2026. Regras de segurança/backend continuam nos documentos de cada domínio.

## Princípios do layout

- telas de Minha conta/Administração usam largura fluida;
- desktop mantém aproximadamente 24 px de respiro lateral;
- telas médias usam aproximadamente 16 px;
- mobile usa aproximadamente 10 px;
- evitar `max-width` arbitrário que transforme a aplicação em uma coluna estreita no desktop;
- detalhes densos devem ir para inspetor/workspace em vez de competir com a listagem;
- ações em lote aparecem somente quando existe seleção;
- ações destrutivas ficam isoladas visualmente;
- textos auxiliares novos não devem cair abaixo do piso visual adotado no redesign (~13 px).

## Cockpit da Administração

A entrada administrativa funciona como **cockpit**, não como relatório longo.

Hierarquia:

1. status geral;
2. ações rápidas;
3. indicadores essenciais;
4. `Atenção necessária` somente quando há problema;
5. atividade/manutenção em segundo plano.

O estado nunca deve aparecer saudável se a integridade ainda não foi verificada ou se o snapshot ficou desatualizado por falha de refresh.

`Atenção necessária` é derivada de `/api/admin/library/overview`. Alterações de metadata/capa publicam `home-music:library-changed`; enquanto a Administração está montada, esse evento dispara um novo overview em background. Assim, o total de **Metadados**, os chips de atenção e os `trackIds` usados para abrir cada problema acompanham o estado persistido sem exigir o botão **Atualizar** ou um rescan.

O botão **Atualizar** continua existindo como refresh manual de overview + cache operacional, mas não é requisito para refletir uma edição concluída em Metadados.

## Gerenciar músicas

Padrão atual:

- busca/filtros compactos;
- lista ampla;
- menu contextual por faixa para ações secundárias;
- seleção múltipla;
- barra de lote somente quando necessária.

Operações reais permanecem as mesmas: ativar/desativar, favoritos, playlists, organizar arquivo e lixeira.

## Metadados

Usa workspace **lista + editor persistente**.

- lista permanece visível no desktop;
- editor mostra metadata efetiva/física, overrides e capa;
- restore/salvar permanecem explícitos;
- trocar/fechar/sair protege alterações não salvas;
- respostas assíncronas antigas não podem sobrescrever a faixa atualmente selecionada.

Quando a tela é aberta por um chip de `Atenção necessária`, o filtro conserva a **chave canônica do problema** (`missingTitle`, `missingCover`, `unknownArtist`, `unknownAlbum` ou `missingDuration`) e os ids atualmente informados pelo backend. Depois de salvar/restaurar um override, o overview é recarregado e o filtro recebe os novos `trackIds`. Uma faixa corrigida sai da lista e do contador imediatamente; se a correção for restaurada e o problema voltar a existir, a faixa reaparece.

A regra de classificação não é duplicada no React. O frontend não tenta decidir sozinho se um título é ausente ou se uma capa/artista/álbum é desconhecido; `/api/admin/library/overview` permanece a fonte canônica desses diagnósticos.

O mesmo evento que atualiza o cockpit também faz `useLibraryData()` buscar o snapshot efetivo de `/api/library`, então o player persistente, o player principal, a fila e a biblioteca passam a exibir a edição pelo mesmo `track.id`, sem reiniciar o áudio apenas por uma mudança textual.

## Assistente da Biblioteca

A entrada **Administração → Assistente da Biblioteca** é um workspace de análise e revisão humana de metadata textual e capas sugeridas pelo Cover Art Archive, com quatro seções funcionais.

### Sugestões

Fluxo atual:

1. **Analisar biblioteca** inicia o primeiro run; depois **Analisar mudanças** é o caminho cotidiano e incremental;
2. o resumo mostra sugestões, seguras, revisão necessária e falhas;
3. filtros separam abertas, seguras, revisão, aplicadas, rejeitadas, falhas e todas;
4. cada linha mostra identidade da faixa, detalhe da alteração/capa, status de confiança/revisão e ações individuais;
5. **Selecionar seguras** continua restrito a sugestões de metadata elegíveis pela regra compartilhada;
6. **Selecionar visíveis** permite seleção manual de sugestões abertas de metadata exibidas, inclusive `Revisão`; sugestões de capa permanecem fora do lote;
7. quando o lote de metadata contém `Revisão`, um diálogo exige confirmação explícita antes da aplicação;
8. a Web envia blocos reais de até 100 decisões por request e preserva sucesso parcial;
9. o feedback separa aplicadas, já resolvidas, stale, não encontradas, não suportadas e falhas, com detalhes das mensagens retornadas pelo servidor;
10. capas externas são baixadas e persistidas somente no apply individual, reutilizando `TrackCoverOverrideStore` e as proteções definidas para Cover Art Archive;
11. depois de apply confirmado, `home-music:library-changed` atualiza biblioteca/player sem rescan.

Sugestão de alta confiança não equivale a autorização automática. Itens de metadata com `human-override`, ambiguidade ou conflito não entram na seleção segura automática. Selecionar manualmente um item de `Revisão` também não o torna seguro: é necessária confirmação e o backend revalida status, premissa, valor atual e revisão humana do mesmo campo. A confirmação de lote não libera artwork; capa continua decisão individual para evitar download/persistência externa implícita em massa.

### Fila

A aba **Fila** apresenta o estado operacional da análise mais recente: Processando, Pendentes, Em retry, Encontradas, Sem resultado e Falhas. Enquanto o run está ativo, **Cancelar análise** permanece disponível. Em estado terminal, **Analisar mudanças** replaneja alterações e trabalho sem resultado incremental reutilizável; quando existem falhas, a ação recebe o rótulo **Tentar falhas novamente**.

### Estatísticas

A aba **Estatísticas** usa somente observabilidade já produzida pelo backend: tempo decorrido, faixas por segundo, consultas externas, cache, retries e espera por rate limit. Também mostra um histórico compacto dos runs recentes de metadata. A UI não cria métricas paralelas nem estima dados que o backend não observou.

### Configurações

A aba **Configurações** permanece pequena. Ela controla quais campos de metadata (`Título`, `Artista`, `Álbum`, `Artista do álbum`) aparecem na listagem de sugestões, persistindo a preferência localmente. Pelo menos um campo fica visível; sugestões de capa não são ocultadas por essa preferência.

Essa configuração é **somente de apresentação**: o analyzer continua verificando todos os campos suportados. Não existe opção de UI para desligar stale protection, confirmação de revisão, proteção de override humano ou a exigência de apply individual para capa.

### Limpar e reanalisar tudo

A ação forte **Limpar e reanalisar tudo** possui diálogo próprio. Ela invalida apenas sugestões abertas (`pending/review`) dos runs revisáveis de metadata/artwork e inicia uma nova análise completa. Aplicadas, Rejeitadas e o histórico de runs são preservados. Isso inclui sugestões de artwork emitidas dentro de um run de metadata, evitando que uma reanálise completa deixe capas antigas abertas na fila. O backend recusa o reset enquanto existe uma análise revisável ativa.

O componente protege contra respostas assíncronas antigas com versões de request/análise. Carregamento, análise, vazio, erro, cancelamento, mutação, stale e sucesso são estados visíveis. Feedback relevante usa `role="status"`/`role="alert"`, a lista usa região `aria-live` e os diálogos de confirmação usam `role="dialog"` + `aria-modal="true"`, recebem foco inicial e podem ser fechados com `Escape`.

Aplicações já confirmadas nunca são revertidas silenciosamente.

Contrato completo e regras de backend: [`library-assistant.md`](library-assistant.md).

## Importação administrativa

Usa workbench em quatro etapas:

```text
Origem → Preparar → Revisar → Biblioteca
```

A fonte fica clara e o painel de estado mostra a próxima ação. Validação técnica necessária não fica escondida em detalhes avançados.

Origens atuais:

- YouTube/YouTube Music via provider;
- arquivo local;
- URL direta.

O redesign não altera o pipeline seguro de staging, validação, metadata, duplicatas, destino e promoção.

## Integridade

Usa cockpit diagnóstico:

- estado geral;
- última verificação;
- `Verificar agora`;
- indicadores por categoria;
- inconsistências somente quando existem.

`Verificar agora` executa auditoria **read-only**. Não confundir com o scan normal da biblioteca.

## Usuários

Listagem usa **tabela + inspetor lateral**.

- selecionar usuário abre contexto sem perder a lista;
- a própria conta pode ser inspecionada, mas não administrada ali;
- Novo usuário e Editar usuário são fluxos focados;
- senha temporária é gerada automaticamente e mostrada somente no momento apropriado;
- reset de senha, sessões, papel/status e remoção obedecem às invariantes do backend;
- segurança e zona de perigo ficam separadas;
- o frontend não tenta contornar proteções como último administrador ativo ou auto-lockout.

Modelo de autorização, sessão e contas: [`multi-user-auth.md`](multi-user-auth.md).

## Minha conta

É a superfície de autosserviço do usuário autenticado e não depende de acesso administrativo.

Ela reúne, conforme as capacidades disponíveis:

- identidade da conta;
- troca da própria senha;
- sessões próprias e revogação das demais sessões;
- credenciais OpenSubsonic;
- exportação e importação de dados pessoais.

A importação de dados pessoais é deliberadamente separada da importação administrativa de mídia: ela restaura/mescla estado pertencente à conta autenticada e deve preservar isolamento de ownership. Contrato e formato: [`personal-data-portability.md`](personal-data-portability.md).

## Lixeira

No PR #181, a Lixeira adota **lista ampla + inspetor lateral**:

- busca e seleção na área principal;
- nenhuma exclusão permanente exposta em toda linha;
- inspetor mostra caminho/data/última falha;
- Restaurar recebe prioridade;
- Exclusão permanente fica em zona de perigo;
- lote aparece somente com seleção;
- mudar a busca limpa seleção para não manter item destrutivo invisível.

Detalhes: [`admin-quarantine.md`](admin-quarantine.md).

## Credenciais OpenSubsonic em Minha conta

A listagem/criação/revogação de API keys é uma superfície de credencial e precisa preservar causalidade entre respostas assíncronas:

- uma resposta de listagem iniciada antes de uma criação ou revogação não pode sobrescrever o estado mais novo;
- criar e revogar atualizam o snapshot visível a partir da mutação confirmada pelo servidor;
- a chave em claro continua sendo exibida somente após a criação;
- se a chave recém-criada for revogada enquanto o segredo one-time ainda estiver visível, esse segredo é removido imediatamente da tela;
- erros de refresh não podem ressuscitar visualmente uma credencial já revogada.

A autoridade continua sendo o backend. Essas regras evitam apenas que uma resposta HTTP antiga faça a UI representar um estado que já deixou de ser verdadeiro.

## Histórico operacional

Permanece como superfície de diagnóstico/observabilidade para scans e importações. Retry aparece somente quando o servidor informa `canRetry=true`.

Detalhes: [`admin-operation-history.md`](admin-operation-history.md).

## Segurança de UX

O frontend deve reforçar — nunca substituir — as invariantes do backend:

- `user` não ganha acesso só porque um componente foi renderizado;
- mutações administrativas usam sessão + `X-Home-Music-Request: 1`;
- confirmações destrutivas continuam obrigatórias;
- Integridade não ganha botão de correção automática implícita;
- credenciais temporárias recebem proteção contra perda silenciosa;
- filtros não devem deixar seleção destrutiva invisível;
- o Assistente não aplica sugestões apenas por confiança; toda mutação continua explícita e revalidada no servidor;
- confirmar um lote de revisão autoriza somente metadata selecionada naquele envio, não desliga stale protection e não habilita aplicação em lote de artwork.

Documentos `phase-7.5-*` foram movidos para [`history/phase-7.5/`](history/phase-7.5/) e permanecem apenas como histórico de implementação.
