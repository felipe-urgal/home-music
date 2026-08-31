# Regressões de segurança

A Fase 11 mantém uma suíte dedicada de regressões negativas para as superfícies de maior risco de **Administração** e **Importação**.

O objetivo não é implementar uma segunda camada de hardening. Os controles continuam pertencendo às políticas, stores e managers já existentes; a suíte fixa esses comportamentos como contratos que não podem ser enfraquecidos silenciosamente.

## Gate dedicado

Na raiz do repositório:

```bash
npm run test:security
```

O comando executa os testes do servidor cujo nome contém `security` e é um step explícito do CI obrigatório. A mesma cobertura também continua incluída na suíte completa `npm test`.

## Invariantes cobertas

A regressão dedicada cobre, no mínimo:

- `/api/admin/*` continua exigindo role `admin` no backend;
- mutações autenticadas continuam exigindo `X-Home-Music-Request: 1`;
- upload rejeita nomes malformados, formatos/tamanhos inválidos e bytes além do declarado/configurado;
- URL direta continua fail-closed para SSRF, inclusive revalidando DNS/IP em redirects;
- destinos e paths de importação/administração continuam bloqueando traversal, symlink escape e overwrite silencioso;
- lixeira/quarentena preserva reversibilidade e delete permanente exige confirmação forte;
- saída, stderr e paths de providers são tratados como não confiáveis;
- timeout/cancelamento de provider limpa recursos temporários;
- o runner de processo encerra a árvore/grupo de processos ao abortar;
- auditoria de Integridade permanece read-only.

Testes específicos de cada feature continuam responsáveis pela matriz detalhada de edge cases, como ranges de IP, Content-Type, concorrência e rollback. Esta suíte é a camada transversal de proteção contra regressões arquiteturais.

## Isolamento das fixtures

Os testes de segurança devem permanecer determinísticos e seguros para CI:

- diretórios temporários próprios;
- SQLite descartável quando necessário;
- nenhuma leitura de `MUSIC_DIR` real;
- nenhuma dependência de internet pública;
- DNS/HTTP simulados para SSRF;
- providers fakes ou subprocessos locais controlados;
- nenhum segredo real.

## Processo

Mudança futura que tocar autorização, filesystem, upload, URL externa, provider/processo filho, lixeira ou Integridade deve avaliar se a suíte dedicada precisa de um novo caso negativo.

Não afrouxe uma asserção de segurança para fazer o CI passar. Quando um caso falhar, investigue se houve regressão real ou se o contrato documentado mudou conscientemente e com revisão de segurança.
