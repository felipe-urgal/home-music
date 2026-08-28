# Histórico operacional da Administração

A issue #90 adiciona um histórico persistente de scans e jobs de importação para que o administrador consiga entender o que aconteceu, quanto tempo levou e o que fazer quando uma operação falhar.

## Escopo da entrega

O histórico registra:

- scans manuais iniciados por `POST /api/library/scan`;
- scans automáticos iniciados pelo scheduler de rescan;
- snapshots da fila de importação a cada criação ou transição de estado.

O scan de bootstrap usado somente para inicializar a biblioteca ao subir o serviço não entra no histórico. O objetivo desta entrega é registrar as operações manuais e automáticas explícitas da biblioteca.

## Persistência

O histórico usa a tabela `admin_operation_history` no mesmo arquivo SQLite do Home Music.

Ela é criada pelo store administrativo, seguindo o mesmo padrão de outras tabelas administrativas auxiliares. A tabela não altera o `PRAGMA user_version` do schema principal.

Os registros terminais mais recentes são retidos até o limite padrão de 500 operações. Operações ainda `pending` ou `running` não são podadas pela retenção durante a execução normal.

Ao iniciar o serviço, qualquer registro antigo que ainda esteja `pending` ou `running` é encerrado como `cancelled`, com horário de fim e mensagem informando que a operação foi interrompida pelo restart. Isso evita deixar operações eternamente “Em andamento” depois de crash/reinício e reflete que a fila em memória não é restaurada automaticamente.

Como o histórico está no mesmo arquivo SQLite, ele também ficará dentro do escopo natural do backup consistente planejado na #91.

## Scans

Existe somente uma `scanPromise` ativa por vez no runtime. Quando um scan manual ou automático realmente inicia, o histórico cria um único registro com:

- origem `manual` ou `automatic`;
- início e fim;
- duração calculada;
- status final;
- quantidade total de faixas;
- adicionadas;
- atualizadas;
- removidas;
- inalteradas.

Se outra chamada chegar enquanto esse mesmo scan estiver em andamento, ela reutiliza a `scanPromise` existente e não cria um histórico duplicado.

Falhas ao gravar o histórico são tratadas como observabilidade best-effort: são registradas no log do servidor, mas não impedem nem alteram o resultado da operação de scan principal.

## Importações

A fila da Fase 9 continua sendo a autoridade da máquina de estados em memória. O `ImportJobQueue` publica um snapshot defensivo em cada `enqueue` e `transition`, e o runtime persiste esse snapshot no histórico.

Os estados são normalizados para a UI administrativa:

- `pending` → `pending`;
- `processing` → `running`;
- `completed` → `completed`;
- `failed` → `failed`;
- `cancelled` → `cancelled`.

Isso faz o histórico sobreviver à retenção e ao ciclo de vida da fila em memória e também ao restart do processo. Se o serviço reiniciar antes de um job chegar a estado terminal, o snapshot persistido é encerrado como `cancelled` porque a fila em memória correspondente deixou de existir.

Nesta etapa, os importadores reais de upload, URL e providers ainda não foram implementados. Por isso, contagens de itens processados para importação permanecem `null` até que as etapas da Fase 9 passem a publicar resultados concretos. A #90 não inventa esses números.

## Nova tentativa

O contrato já expõe `canRetry`, mas ele permanece `false` nesta entrega.

A execução de nova tentativa só deve ser habilitada quando a operação correspondente tiver semântica de reexecução segura e explícita. Isso evita apresentar um botão que não consiga reconstruir de forma confiável a origem da operação.

## Erros acionáveis e sanitização

O histórico não persiste stack trace nem dados brutos de requisição. Antes de armazenar uma falha, o servidor sanitiza a mensagem e gera uma orientação curta de próxima ação.

A sanitização remove ou substitui, entre outros:

- URLs completas;
- caminhos absolutos Unix, Windows e `~/...`;
- valores associados a `authorization`, `cookie`, `password`, `passwd`, `token`, `secret` e `api-key`;
- credenciais `Bearer`.

Erros conhecidos recebem mensagens de domínio mais úteis, por exemplo:

- origem não encontrada → verificar disponibilidade da biblioteca/fonte;
- permissão negada → revisar permissões do serviço;
- SQLite ocupado → aguardar a operação concorrente;
- timeout/rede → verificar conectividade e disponibilidade da fonte;
- FFmpeg/codec/formato → validar a mídia e a disponibilidade do FFmpeg.

O fallback mantém somente uma mensagem redigida e orienta a consultar os logs do serviço no servidor se o problema persistir.

Rótulos de importação também são sanitizados antes da persistência. Uma URL usada como rótulo, por exemplo, vira `Importação por URL` em vez de ser guardada no histórico.

## API

### `GET /api/admin/operations`

A rota é exclusiva de `admin` pela política central de `/api/admin/*` e retorna `Cache-Control: private, no-store`.

Filtros opcionais:

- `kind=scan|import`;
- `status=pending|running|completed|failed|cancelled`;
- `limit=1..500` — padrão 200.

Filtros inválidos retornam `400`.

## Interface

Em **Administração → Histórico operacional**, o administrador pode:

- filtrar por tipo;
- filtrar por status;
- atualizar a lista;
- selecionar uma operação;
- ver início, fim e duração;
- ver contagens de um scan;
- ver a mensagem sanitizada de falha/interrupção;
- ver a orientação `O que fazer`.

A tela mostra `Nova tentativa: Não disponível` enquanto `canRetry` for falso, deixando explícito que a funcionalidade ainda não está habilitada.

## Invariantes

- histórico não é fonte de verdade da operação principal;
- falha de persistência do histórico não derruba scan/importação;
- um scan real gera no máximo um registro, mesmo com chamadas concorrentes;
- operações não terminais antigas são encerradas na inicialização em vez de permanecerem falsas como ativas;
- nenhuma stack trace é persistida;
- caminhos completos, URLs e segredos conhecidos são redigidos;
- importações não exibem contagens inexistentes;
- nova tentativa não é anunciada como disponível antes de existir uma implementação segura;
- somente administradores consultam o histórico.

## Testes

A cobertura inclui:

- persistência após reabrir o store;
- recuperação de operações interrompidas por restart;
- duração e contagens de scan;
- filtros por tipo/status;
- upsert da fila de importação;
- observer com snapshots defensivos;
- retenção sem podar operações pendentes durante runtime normal;
- sanitização de caminho, URL, token e `Bearer`;
- classificação de falha por permissão;
- wrapper best-effort de scan;
- autorização `user` versus `admin`;
- validação dos filtros HTTP;
- Playwright da navegação, filtros, detalhes e erro acionável com API interceptada de forma determinística.
