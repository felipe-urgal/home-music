# Administração — interface atual

Este documento registra a composição de UX atual da área **Minha conta → Administração** depois do ciclo de redesign de 2026. Regras de segurança/backend continuam nos documentos de cada domínio.

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

## Importação

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
- senha temporária é gerada automaticamente;
- segurança e zona de perigo ficam separadas.

Detalhes: [phase-7.5-admin-users-screen.md](phase-7.5-admin-users-screen.md).

## Lixeira

No PR #181, a Lixeira adota **lista ampla + inspetor lateral**:

- busca e seleção na área principal;
- nenhuma exclusão permanente exposta em toda linha;
- inspetor mostra caminho/data/última falha;
- Restaurar recebe prioridade;
- Exclusão permanente fica em zona de perigo;
- lote aparece somente com seleção;
- mudar a busca limpa seleção para não manter item destrutivo invisível.

Detalhes: [admin-quarantine.md](admin-quarantine.md).

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

Detalhes: [admin-operation-history.md](admin-operation-history.md).

## Segurança de UX

O frontend deve reforçar — nunca substituir — as invariantes do backend:

- `user` não ganha acesso só porque um componente foi renderizado;
- mutações administrativas usam sessão + `X-Home-Music-Request: 1`;
- confirmações destrutivas continuam obrigatórias;
- Integridade não ganha botão de correção automática implícita;
- credenciais temporárias recebem proteção contra perda silenciosa;
- filtros não devem deixar seleção destrutiva invisível.