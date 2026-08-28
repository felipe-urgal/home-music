# Staging seguro de importação

A Fase 9 usa um staging temporário separado de `MUSIC_DIR` para impedir que bytes ainda não validados apareçam na biblioteca definitiva.

## Invariantes

- a raiz de staging deve ser um diretório real, sem symlink;
- staging e `MUSIC_DIR` precisam ser árvores disjuntas: nenhum pode conter o outro;
- cada job recebe um diretório aleatório `job-*`, independente de nome, URL, provider ou filename fornecido pelo usuário;
- diretórios de staging usam permissão `0700` e o payload `0600`;
- o arquivo recebido usa nome interno fixo `payload.bin`; nomes externos nunca controlam caminhos de staging;
- escrita interrompida e validação que falha removem o workspace daquele job;
- cancelamento pode remover explicitamente o workspace com `cleanupJob(jobId)`;
- a validação recebe um caminho para o descritor já aberto em `/proc/<pid>/fd/<fd>`, reduzindo risco de validar um caminho diferente do inode aberto;
- após a validação, SHA-256 e tamanho do payload ficam associados a um token único;
- antes da promoção, SHA-256 e tamanho são recalculados e precisam coincidir com o token de validação;
- promoção só aceita pasta já existente dentro de `MUSIC_DIR`, rejeita traversal, componentes ocultos, symlinks e colisões;
- o destino nunca é sobrescrito: a promoção usa hardlink exclusivo e valida a identidade do inode promovido;
- nesta etapa, staging e destino precisam estar no mesmo filesystem. Em `EXDEV`, a operação falha sem copiar bytes para `MUSIC_DIR`;
- em sucesso, o nome de staging é removido e o workspace é limpo.

## Configuração

Por padrão, o staging futuro usa `data/import-staging`. O caminho pode ser preparado por configuração com:

```env
HOME_MUSIC_IMPORT_STAGING_DIR=/caminho/fora/de/MUSIC_DIR
```

Para permitir a promoção segura sem cópia intermediária dentro da biblioteca, mantenha o staging no mesmo filesystem de `MUSIC_DIR`.

## Fluxo esperado para as próximas issues

1. criar o job na fila;
2. criar o workspace aleatório do job;
3. upload, URL ou provider grava somente no payload de staging;
4. FFmpeg/ffprobe e as demais validações operam sobre o arquivo de staging;
5. `validatePayload()` emite um token somente após a validação completa;
6. duplicatas, metadata, preview e destino são decididos antes da promoção;
7. `promote()` revalida hash/tamanho e torna o inode visível em `MUSIC_DIR` sem sobrescrever destino existente;
8. falha/cancelamento remove o staging; cleanup de resíduos após restart será ampliado na issue específica da Fase 9.

## Limites desta entrega

Esta issue não implementa ainda upload HTTP, importação por URL, providers externos, criação automática de pastas, escolha de nomes finais, conversão FFmpeg ou retry. Ela fornece a fronteira de filesystem que essas etapas deverão reutilizar.

## Testes

A suíte cobre:

- staging dentro/contendo `MUSIC_DIR`;
- raiz de staging por symlink;
- permissões de diretório e arquivo;
- nome aleatório por job e payload com nome controlado pelo servidor;
- limpeza em falha de stream, validação e cancelamento;
- token de validação não forjável por um valor diferente;
- alteração do payload após validação;
- promoção bem-sucedida;
- traversal, symlink no destino e colisão sem sobrescrita.
