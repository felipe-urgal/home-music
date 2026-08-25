# Least privilege no Tailscale

Este runbook fecha o hardening do Home Music no **tailnet real** sem mexer na porta pública do Funnel nem abrir o backend local.

O objetivo é simples:

- identificar o Ubuntu como `tag:home-music`;
- permitir que somente esse servidor tenha a capacidade de usar Funnel;
- no acesso privado do tailnet, permitir somente `tcp:443` para o Home Music;
- remover regras amplas do tipo allow-all que anulam o least privilege;
- manter o Fastify em `127.0.0.1:8787`.

> Funnel continua sendo público para a internet. Grants controlam o tráfego **dentro do tailnet**; eles não transformam Funnel em um endpoint privado. A proteção do perfil público continua sendo HTTPS + autenticação do Home Music.

## Por que aplicar em duas fases

Tags mudam a identidade Tailscale de um dispositivo. Além disso, grants e ACLs são aditivos: adicionar uma regra estreita não restringe uma regra ampla já existente.

Por isso, não remova o allow-all antes de o servidor estar tagueado e a regra nova existir. O fluxo abaixo evita lockout desnecessário.

## Policy de referência

O arquivo [`tailscale-policy.example.hujson`](tailscale-policy.example.hujson) contém a policy mínima de referência:

```jsonc
{
  "tagOwners": {
    "tag:home-music": ["autogroup:admin"]
  },
  "nodeAttrs": [
    {
      "target": ["tag:home-music"],
      "attr": ["funnel"]
    }
  ],
  "grants": [
    {
      "src": ["autogroup:member"],
      "dst": ["tag:home-music"],
      "ip": ["tcp:443"]
    }
  ]
}
```

Em um tailnet individual, `autogroup:member` mantém o acesso do dono e dos seus dispositivos ao Home Music em HTTPS, mas não libera outras portas do servidor.

Não substitua cegamente uma policy existente se você usa outras funcionalidades do Tailscale. Preserve regras realmente necessárias e remova somente regras amplas que não façam mais sentido.

## Fase 1 — preparar sem restringir ainda

1. No Admin Console do Tailscale, abra **Access controls** e salve uma cópia da policy atual para rollback.
2. Adicione `tagOwners` para `tag:home-music`.
3. Adicione o `nodeAttrs` que concede `funnel` para `tag:home-music`.
4. Adicione o grant `autogroup:member -> tag:home-music` em `tcp:443`.
5. **Ainda não remova** o allow-all atual nem o `nodeAttrs` amplo de Funnel.
6. Salve a policy e confirme que o painel não reporta erro de sintaxe.

Se a policy já possui `tagOwners`, `nodeAttrs` ou `grants`, mescle as entradas dentro das seções existentes em vez de duplicar as chaves de topo.

## Fase 2 — aplicar a tag ao Ubuntu

No Admin Console, abra **Machines**, selecione o servidor `home-music` e aplique a ACL tag:

```text
tag:home-music
```

Prefira aplicar a tag pelo painel em uma máquina já autenticada. Não é necessário recriar auth key nem automatizar uma reautenticação só para este servidor pessoal.

Depois, no Ubuntu:

```bash
npm run tailscale:hardening:status
```

Esperado:

```text
BackendState:     Running
Tag esperada:     tag:home-music
Tag aplicada:     sim
```

O comando verifica o estado local e a tag. Ele **não afirma validar os grants do control plane**, porque a policy efetiva não é exposta de forma confiável pelo CLI local; essa parte deve ser conferida no Admin Console.

Também confirme que o perfil público continua saudável:

```bash
npm run tailscale:public:status
curl -fsS https://home-music.SEUTAILNET.ts.net/ready
```

Use a URL exata impressa pelo comando de status.

## Fase 3 — remover permissões amplas

Só depois da Fase 2:

1. volte a **Access controls**;
2. abra **Preview rules** e confirme que seu usuário alcança `tag:home-music` em `tcp:443`;
3. remova o `nodeAttrs` amplo criado originalmente pelo Funnel, por exemplo `target: ["autogroup:member"]` com `attr: ["funnel"]`, deixando apenas o target `tag:home-music`;
4. remova grants/ACLs allow-all que concedam acesso irrestrito a todos os dispositivos;
5. preserve quaisquer regras específicas que você realmente use para outros serviços;
6. salve e valide novamente o preview.

Exemplos de regras amplas que devem ser revisadas/removidas quando existirem:

```jsonc
{
  "src": ["*"],
  "dst": ["*"],
  "ip": ["*"]
}
```

ou, em ACL legado:

```jsonc
{
  "action": "accept",
  "src": ["*"],
  "dst": ["*:*"]
}
```

Uma regra estreita **não sobrescreve** essas regras; enquanto um allow-all permanecer, o acesso amplo continua existindo.

## Validação final

No Ubuntu:

```bash
npm run tailscale:hardening:status
npm run tailscale:public:status
tailscale funnel status
curl -fsS https://home-music.SEUTAILNET.ts.net/ready
```

Critérios de aceite:

- `tag:home-music` aplicada ao Ubuntu;
- capacidade `funnel` direcionada somente a `tag:home-music` na policy;
- nenhum allow-all genérico cobrindo o servidor;
- grant privado limitado a `tcp:443` para `tag:home-music`;
- Funnel continua em HTTPS/443 para `127.0.0.1:8787`;
- `/ready` continua retornando `{"ready":true}`;
- `8787` continua somente em loopback.

## Rollback

Se algo bloquear acesso:

1. restaure a cópia da policy salva antes da Fase 1;
2. confirme no Admin Console que a policy foi aceita;
3. no Ubuntu, confira:

```bash
npm run tailscale:public:status
tailscale funnel status
```

Se o Funnel tiver sido desativado durante a correção:

```bash
npm run tailscale:public:enable
```

Não abra `8787` na LAN ou no roteador como forma de contornar uma policy incorreta.
