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
