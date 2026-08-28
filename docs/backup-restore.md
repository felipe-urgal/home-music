# Backup e restore consistentes

A issue #91 adiciona um fluxo operacional seguro para criar, verificar e restaurar backups do Home Music sem copiar manualmente um SQLite em WAL.

## Objetivos

- criar snapshot consistente do SQLite mesmo com o serviço em execução;
- validar o artefato antes de considerá-lo pronto;
- incluir somente configuração operacional não secreta;
- impedir restore do serviço systemd enquanto ele estiver ativo;
- nunca substituir o banco atual antes de validar o backup e preparar rollback;
- testar automaticamente backup → alteração → restore → validação.

## Formato do artefato

Por padrão, `npm run backup:create` cria um diretório em `backups/` com sufixo `.backup`:

```text
backups/
└── home-music-20260828T184000Z-12345678-aaaa-bbbb-cccc-dddddddddddd.backup/
    ├── home-music.db
    └── manifest.json
```

O diretório `backups/` é ignorado pelo Git.

### `home-music.db`

É criado pela Online Backup API do `node:sqlite`, não por cópia bruta do arquivo principal. Isso permite obter um snapshot SQLite consistente enquanto outra conexão continua usando o banco em WAL.

Depois da criação o snapshot passa por `PRAGMA integrity_check`.

### `manifest.json`

O manifesto registra:

- versão do formato do backup;
- data de criação;
- nome fixo do SQLite;
- tamanho em bytes;
- SHA-256;
- `PRAGMA user_version`;
- snapshot allowlisted da configuração operacional.

As únicas chaves de configuração aceitas no manifesto são:

- `MUSIC_DIR`;
- `HOME_MUSIC_RESCAN_INTERVAL_SECONDS`;
- `HOME_MUSIC_FFMPEG_PATH`;
- `HOME_MUSIC_TRANSCODE_CACHE_MB`;
- `HOME_MUSIC_COOKIE_SECURE`;
- `HOME_MUSIC_TRUST_TAILSCALE_PROXY`;
- `PORT`;
- `HOST`;
- `PRODUCTION_HOST`.

`HOME_MUSIC_USER`, `HOME_MUSIC_PASSWORD`, tokens, secrets e qualquer chave fora dessa allowlist não entram no artefato.

O `.env` nunca é sobrescrito automaticamente no restore. O manifesto existe para reconstrução/revisão operacional consciente em outra máquina.

## Criar backup

O backup pode ser criado com o serviço ativo:

```bash
npm run backup:create
```

Diretório de saída customizado:

```bash
npm run backup:create -- --output /mnt/backup/home-music
```

O comando só termina com sucesso depois de:

1. criar o snapshot online;
2. validar `PRAGMA integrity_check`;
3. calcular SHA-256 e tamanho;
4. gravar o manifesto;
5. verificar novamente o artefato completo;
6. renomear o diretório `.partial` para o nome final `.backup`.

Uma falha antes da etapa final remove somente o diretório parcial criado por aquela tentativa. Uma colisão de nome não apaga artefatos ou diretórios preexistentes.

## Verificar backup

Antes de copiar, arquivar ou restaurar um backup, é possível revalidá-lo:

```bash
npm run backup:verify -- --artifact backups/home-music-....backup
```

A verificação exige:

- diretório real, sem symlink;
- `manifest.json` e `home-music.db` como arquivos regulares, sem symlink;
- manifesto dentro do limite operacional de tamanho;
- formato do manifesto suportado;
- nenhuma configuração fora da allowlist;
- tamanho exato do SQLite;
- SHA-256 exato;
- `PRAGMA integrity_check = ok`;
- `user_version` idêntico ao manifesto;
- schema não mais novo do que o suportado pela versão atual do Home Music.

## Restore

O restore é uma operação offline. Para a instalação padrão por systemd:

```bash
sudo systemctl stop home-music
npm run backup:restore -- --artifact /caminho/home-music-....backup --confirm-service-stopped
sudo systemctl start home-music
npm run service:status
curl -i http://127.0.0.1:8787/ready
```

O CLI verifica `home-music.service` e recusa a operação se o serviço ainda estiver ativo.

Em desenvolvimento, pare também qualquer `npm run dev`/`npm start` que esteja usando o mesmo banco antes de fornecer `--confirm-service-stopped`. No Linux, o CLI procura outro processo com `home-music.db`, `-wal` ou `-shm` aberto e recusa o restore se encontrar um consumidor ativo.

A guarda de serviço/processos é executada novamente imediatamente antes da troca do SQLite, depois que a cópia de instalação foi validada e o snapshot de rollback já está pronto. Isso reduz a janela entre a confirmação inicial de estado offline e a etapa destrutiva.

## Ordem segura do restore

O restore segue esta sequência:

1. valida o artefato completo sem tocar no banco atual;
2. copia o SQLite do backup de forma exclusiva para um arquivo temporário no diretório `data/`;
3. valida novamente essa cópia;
4. cria um snapshot SQLite consistente do banco atual para rollback;
5. repete a guarda de serviço/processos;
6. remove sidecars WAL/SHM antigos somente depois do rollback estar pronto;
7. troca o banco pelo snapshot validado;
8. valida o banco instalado;
9. somente após sucesso remove o snapshot temporário de rollback.

Se qualquer etapa falhar depois que a troca começou, o fluxo tenta restaurar automaticamente o snapshot do estado anterior e valida esse rollback antes de devolver o erro.

Se o próprio rollback falhar, o CLI falha fechado, imprime orientação explícita e não recomenda iniciar o serviço antes de preservar e inspecionar `data/`.

## O que o backup não contém

O artefato não copia:

- arquivos de áudio de `MUSIC_DIR`;
- cache de transcoding, que é derivado e recriável;
- `.env` completo;
- credenciais em claro;
- sessões em memória;
- binários/build do aplicativo.

Para recuperação completa de máquina, mantenha também uma cópia independente da biblioteca de áudio. O backup da #91 protege o estado SQLite e registra a configuração operacional necessária para reconstruir o serviço.

## Smoke test automatizado

O CI executa:

```bash
npm run smoke:backup-restore
```

O smoke cria um SQLite temporário, gera e verifica o backup, altera o estado original, restaura o artefato e confirma que o conteúdo voltou ao snapshot esperado.

A suíte unitária também cobre:

- snapshot consistente com WAL ativo;
- exclusão de credenciais/configurações fora da allowlist;
- corrupção/tampering detectados antes do restore;
- restore bem-sucedido sem alterar o artefato;
- artefato inválido sem tocar no banco atual;
- guarda imediatamente anterior à troca sem tocar no estado válido quando ela bloqueia;
- rollback automático quando ocorre falha simulada depois da troca.

## Compatibilidade

Um backup com `user_version` mais antigo pode ser restaurado e será migrado normalmente pelo Home Music no próximo start.

Um backup com schema mais novo que a versão instalada é recusado. Atualize primeiro o Home Music para uma versão compatível e repita a verificação/restore.
