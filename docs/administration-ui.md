# Administração — interface atual

Este documento registra a composição corrente das áreas **Minha conta** e **Administração**. Regras de segurança e contratos de domínio permanecem nas docs específicas.

## Princípios de UX

- layout fluido e responsivo;
- listas amplas com detalhes em editor/inspetor quando necessário;
- ações em lote somente quando existe seleção;
- ações destrutivas isoladas e confirmadas;
- estados de loading, vazio, erro, stale e sucesso explícitos;
- respostas assíncronas antigas não podem sobrescrever seleção/estado mais novo;
- frontend reforça, mas nunca substitui, autorização e validação do backend.

## Cockpit

A entrada de Administração funciona como cockpit:

1. status geral;
2. ações rápidas;
3. indicadores essenciais;
4. atenção necessária quando houver problema;
5. atividade/manutenção em segundo plano.

`/api/admin/library/overview` permanece a fonte dos diagnósticos de biblioteca. Alterações de metadata/capa propagam atualização da biblioteca efetiva sem exigir rescan apenas para refletir override confirmado.

## Gerenciar músicas e Metadados

A listagem de músicas suporta busca, filtros, seleção múltipla e ações contextualizadas.

Metadados usa workspace de lista + editor persistente. O editor preserva:

- metadata física e efetiva;
- overrides textuais;
- capa/override de capa;
- restore explícito;
- proteção contra troca/fechamento com edição não salva;
- refresh do overview depois de mutações confirmadas.

Classificação de problemas como metadata/capa ausente continua vindo do backend; a UI não recria a regra de diagnóstico.

## Assistente da Biblioteca

**Administração → Assistente da Biblioteca** é o workspace de análise, revisão e operações assistidas concluído na Fase 15.

### Sugestões

A fila unificada pode conter:

- metadata identificada com MusicBrainz;
- artwork sugerida pelo Cover Art Archive;
- lyrics do LRCLIB;
- candidatos locais de transcrição/alinhamento quando Whisper estiver configurado;
- sugestões relacionadas a normalização/evidências do fluxo atual.

Aplicação continua explícita e revalidada no backend.

Regras:

- metadata/lyrics podem participar de lote conforme a política de revisão;
- itens de revisão exigem confirmação explícita quando incluídos em lote;
- artwork permanece aplicação individual;
- decisões humanas existentes e stale protection não são desativadas pela seleção em lote;
- sucesso parcial é exibido por outcome/mensagem;
- apply confirmado atualiza a biblioteca efetiva sem exigir rescan.

### Análise

`metadata` e `lyrics` são capabilities independentes. O fluxo normal pode iniciar os runs em paralelo e cancelar os runs ativos em conjunto.

**Analisar mudanças** é o caminho incremental. **Limpar e reanalisar tudo** é ação excepcional e invalida apenas sugestões abertas/revisáveis, preservando histórico e decisões já aplicadas/rejeitadas.

### Fila e Estatísticas

A área operacional expõe estado do run, pendências, retries, resultados, falhas, tempo, throughput, consultas externas, cache e rate limit a partir da observabilidade real do backend.

A UI não inventa métricas paralelas.

### Configurações e política de revisão

Preferências visuais não alteram o analyzer. A política persistida de revisão pode controlar o tratamento de tipos suportados sem permitir desligar invariantes como stale protection, autorização, confirmação de revisão ou aplicação individual de artwork.

### Autonomia

A autonomia progressiva é opt-in. Quando habilitada, eventos consistentes de biblioteca podem iniciar análise incremental pela mesma infraestrutura. Ela não cria um segundo Assistente e não elimina o fluxo manual.

### Lyrics local

Quando Whisper/whisper.cpp está configurado, a Administração pode oferecer ações explícitas por faixa para transcrever ou sincronizar lyrics localmente.

Esses jobs:

- mostram estado/progresso/cancelamento;
- não executam no playback;
- produzem candidatos que continuam sujeitos a revisão humana;
- não escrevem `.lrc` automaticamente em `MUSIC_DIR`.

Contrato completo: [`library-assistant.md`](library-assistant.md) e [`lyrics.md`](lyrics.md).

## Importação administrativa

A importação mantém o fluxo de preparação/revisão/promoção segura para `MUSIC_DIR`, independentemente da origem. Providers externos, upload e URL convergem para staging/scratch e validações do backend.

Docs específicas estão indexadas em [`README.md`](README.md).

## Integridade

Integridade é uma superfície diagnóstica/read-only. Verificação de integridade não deve ser confundida com scan normal nem ganhar correção destrutiva implícita.

## Usuários

A gestão de usuários preserva as invariantes de backend para papel, status, sessões, reset de senha, último administrador e proteção contra auto-lockout.

Modelo de autorização: [`multi-user-auth.md`](multi-user-auth.md).

## Minha conta

Minha conta é autosserviço do usuário autenticado e reúne, conforme as capacidades atuais:

- identidade;
- troca da própria senha;
- sessões próprias;
- credenciais OpenSubsonic;
- exportação/importação de dados pessoais;
- entrada manual no modo offline quando existe conteúdo salvo no dispositivo.

Portabilidade pessoal: [`personal-data-portability.md`](personal-data-portability.md).

## Lixeira e histórico

A Lixeira prioriza restauração e mantém exclusão permanente em zona de perigo. O Histórico operacional permanece superfície de diagnóstico para scans/importações e só oferece retry quando o backend indica que a operação é repetível.

Detalhes: [`admin-quarantine.md`](admin-quarantine.md) e [`admin-operation-history.md`](admin-operation-history.md).

## Segurança de UX

- renderizar uma tela não concede permissão;
- mutações administrativas continuam sujeitas às proteções do backend;
- filtros não devem esconder seleção destrutiva ativa;
- credenciais one-time não podem ser ressuscitadas por resposta assíncrona antiga;
- confirmação de lote não habilita aplicação irrestrita;
- o Assistente nunca aplica apenas porque uma sugestão tem confiança alta;
- dados externos, jobs locais e arquivos físicos continuam sujeitos às fronteiras de segurança do servidor.

A Fase 15 está encerrada. Novas capacidades administrativas devem atualizar este documento pela experiência efetivamente incorporada, sem usar checklists antigos de issue como estado corrente.
