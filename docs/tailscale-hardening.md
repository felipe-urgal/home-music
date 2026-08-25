# Least privilege no Tailscale

Este runbook fecha o hardening do Home Music no **tailnet real** sem mexer na porta pública do Funnel nem abrir o backend local.

O objetivo é simples:

- identificar o Ubuntu como `tag:home-music`;
- permitir que somente esse servidor tenha a capacidade de usar Funnel;
- no acesso privado do tailnet, permitir somente `tcp:443` para o Home Music;
- preservar a conectividade normal entre dispositivos pessoais do mesmo usuário;
- remover regras amplas do tipo allow-all que anulam o least privilege;
- manter o Fastify em `127.0.0.1:8787`.

> Funnel continua sendo público para a internet. Grants controlam o tráfego **dentro do tailnet**; eles não transformam Funnel em um endpoint privado. A proteção do perfil público continua sendo HTTPS + autenticação do Home Music.

## Por que aplicar em duas fases

Tags mudam a identidade Tailscale de um dispositivo: um dispositivo tagueado deixa de pertencer a um usuário e, por isso, deixa de fazer parte de `autogroup:self`. Além disso, grants e ACLs são aditivos: adicionar uma regra estreita não restringe uma regra ampla já existente.

Por isso, não remova o allow-all antes de o servidor estar tagueado e a regra nova existir. O fluxo abaixo evita lockout desnecessário.

## Policy de referência

O arquivo [`tailscale-policy.example.hujson`](tailscale-policy.example.hujson) contém a policy final de referência:

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
      "dst": ["autogroup:self"],
      "ip": ["*"]
    },
    {
      "src": ["autogroup:member"],
      "dst": ["tag:home-music"],
      "ip": ["tcp:443"]
    }
  ]
}
```

O primeiro grant preserva a conectividade entre dispositivos pessoais do mesmo usuário. O segundo isola o servidor Home Music: depois da tag, ele deixa de ser `autogroup:self`, portanto nenhuma outra porta é reaberta por essa regra.

Não substitua cegamente uma policy existente se você usa outras funcionalidades do Tailscale. Preserve regras realmente necessárias e remova somente regras amplas que não façam mais sentido.

## Fase 1 — preparar sem restringir ainda

Na policy padrão que libera tudo, faça primeiro uma alteração **aditiva**:

1. salve uma cópia da policy atual para rollback;
2. adicione `tagOwners` para `tag:home-music`;
3. adicione um segundo `nodeAttrs` que conceda `funnel` para `tag:home-music`, mantendo temporariamente o `nodeAttrs` atual de `autogroup:member`;
4. mantenha temporariamente o grant allow-all atual;
5. adicione o grant `autogroup:member -> tag:home-music` em `tcp:443`;
6. salve e confirme que o painel não reporta erro de sintaxe.

O grant `autogroup:member -> autogroup:self` só precisa substituir o allow-all na Fase 3. Antes da tag, o allow-all preserva todo o comportamento atual.

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

### Tailscale SSH

A policy padrão permite Tailscale SSH somente para `autogroup:self`. Como um servidor tagueado deixa de ser `self`, **Tailscale SSH para o Ubuntu será bloqueado após a tag** se nenhuma regra específica for criada.

Isso é intencional nesta policy: o Home Music fica acessível pelo tailnet somente em HTTPS/443. Se você administra esse Ubuntu via Tailscale SSH, não aplique a tag antes de criar uma regra explícita de administração para `tcp:22` e uma regra `ssh` correspondente.

## Fase 3 — remover permissões amplas

Só depois da Fase 2:

1. volte a **Access controls**;
2. abra **Preview rules** e confirme que seu usuário alcança `tag:home-music` em `tcp:443`;
3. remova o `nodeAttrs` amplo `target: ["autogroup:member"]` com `attr: ["funnel"]`, deixando apenas `tag:home-music`;
4. substitua o grant allow-all por `autogroup:member -> autogroup:self` com `ip: ["*"]`;
5. mantenha o grant `autogroup:member -> tag:home-music` somente em `tcp:443`;
6. preserve quaisquer regras específicas que você realmente use para outros serviços;
7. salve e valide novamente o preview.

O ponto crítico é que uma regra estreita **não sobrescreve** o allow-all. Enquanto esta regra existir, o servidor continua alcançável em qualquer porta:

```jsonc
{
  "src": ["*"],
  "dst": ["*"],
  "ip": ["*"]
}
```

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
- dispositivos pessoais continuam podendo acessar seus próprios dispositivos pelo tailnet;
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
