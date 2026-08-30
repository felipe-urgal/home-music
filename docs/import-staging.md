# Staging seguro de importação

A Fase 9 usa um staging temporário separado de `MUSIC_DIR` para impedir que bytes ainda não validados apareçam na biblioteca definitiva.

O staging é compartilhado pelas origens atuais — upload local, URL direta e providers externos — e permanece a fronteira entre **aquisição** e **promoção**.

## Invariantes

- a raiz de staging deve ser um diretório real, sem symlink;
- staging e `MUSIC_DIR` precisam ser árvores disjuntas: nenhum pode conter o outro;
- cada job recebe um diretório aleatório `job-*`, independente de nome, URL, provider ou filename fornecido pelo usuário;
- diretórios de staging usam permissão `0700` e o payload `0600`;
- o arquivo recebido usa nome interno controlado pelo servidor; nomes externos nunca controlam caminhos de staging;
- escrita interrompida e validação que falha removem o workspace quando a operação ainda não foi commitada;
- cancelamento pode remover explicitamente o workspace com `cleanupJob(jobId)`;
- a validação opera sobre arquivo regular já aberto de forma segura e reduz o risco de validar um caminho diferente do inode esperado;
- após a validação, SHA-256 e tamanho do payload ficam associados a um token não forjável;
- antes da promoção, SHA-256 e tamanho são recalculados e precisam coincidir com o token de validação;
- promoção aceita apenas destino relativo seguro dentro de `MUSIC_DIR`, rejeitando traversal, symlink e colisões;
- o destino nunca é sobrescrito;
- staging e destino precisam permanecer no mesmo filesystem para a promoção atômica/no-clobber suportada; `EXDEV` falha fechado;
- em sucesso, o payload é promovido e o workspace temporário é limpo.

## Configuração

Por padrão, o staging usa `data/import-staging`. O caminho pode ser configurado com:

```env
HOME_MUSIC_IMPORT_STAGING_DIR=/caminho/fora/de/MUSIC_DIR
```

Para permitir a promoção segura sem cópia intermediária dentro da biblioteca, mantenha o staging no mesmo filesystem de `MUSIC_DIR`.

O upload local usa essa infraestrutura diretamente. URL direta baixa para o mesmo staging depois das validações de SSRF/rede. Providers externos escrevem primeiro em scratch próprio e o core copia a saída validada para o staging; o provider nunca recebe `MUSIC_DIR`.

## Fluxo atual

```text
origem
  ↓
staging / scratch controlado
  ↓
validação técnica FFprobe/FFmpeg
  ↓
preview e revisão de metadata
  ↓
detecção de duplicatas
  ↓
planejamento de destino
  ↓
promoção segura para MUSIC_DIR
  ↓
indexação incremental da biblioteca
  ↓
cleanup do workspace
```

A interface atual organiza esse pipeline como:

```text
Origem → Preparar → Revisar → Biblioteca
```

A aquisição concluída pode deixar o job em `pending` enquanto aguarda uma ação explícita da etapa seguinte; isso não significa que o arquivo já entrou na biblioteca.

## Cleanup após falha/restart

Além do cleanup normal em sucesso, falha e cancelamento, existe varredura defensiva de workspaces órfãos após restart e por intervalo, com TTL configurável. O cleanup não segue symlinks, ignora entradas fora do padrão esperado e preserva workspaces ativos do processo atual.

Detalhes: [import-staging-cleanup.md](import-staging-cleanup.md).

## Testes

A cobertura do staging/pipeline inclui:

- staging dentro/contendo `MUSIC_DIR`;
- raiz por symlink;
- permissões de diretório e arquivo;
- nome aleatório por job e payload controlado pelo servidor;
- limpeza em falha de stream, validação, cancelamento e restart;
- token de validação não forjável;
- alteração do payload após validação;
- promoção bem-sucedida;
- traversal, symlink e colisão sem sobrescrita;
- upload, URL e provider sem escrita direta em `MUSIC_DIR`;
- indexação incremental depois da promoção.
