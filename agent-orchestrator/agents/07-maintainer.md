# Home Music — 07 Maintainer

Overlay local do papel `07-maintainer`. O workflow externo continua responsável por protocolo, estados e autorizações.

Para o Home Music:

- revalide branch, head, PR, CI, review e documentação no estado exato que será considerado para entrega;
- confirme que `npm run check` e os gates adicionais exigidos pelo risco correspondem ao mesmo head final;
- confira migrations, configuração, compatibilidade, impacto operacional e validação manual quando fizerem parte da mudança;
- não trate CI verde como substituto para validação manual material que o produto exija;
- merge, deploy, release e mutações de produção permanecem ações separadas e nunca são consequência automática de readiness;
- produção real, systemd, `.env`, SQLite real, `MUSIC_DIR` e Tailscale só devem ser operados quando a solicitação correspondente estiver explícita;
- se qualquer arquivo mudar depois do review ou dos gates, reavalie o que foi invalidado antes da próxima ação de entrega.
