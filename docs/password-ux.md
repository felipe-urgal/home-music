# UX segura de senhas

A interface de conta mantém as senhas ocultas por padrão, mas oferece controles explícitos sem persistir segredo no estado durável da aplicação.

## Alterar senha

Na tela `Minha conta → Alterar senha`, o botão `Mostrar senhas` alterna os três campos (`senha atual`, `nova senha` e `confirmação`) entre `password` e `text` ao mesmo tempo.

- o estado começa sempre oculto;
- ao voltar da tela ou concluir a troca, o estado volta para oculto;
- validação e regras de senha permanecem inalteradas;
- o controle usa `aria-pressed` e rótulo dinâmico `Mostrar/Ocultar senhas`.

## Login e PWA

O formulário continua usando os hints padrão `autocomplete="username"` e `autocomplete="current-password"` para integração com password managers.

Quando o navegador expõe `PasswordCredential` + `navigator.credentials.store`, o login também mostra a opção `Salvar senha neste dispositivo`. Se marcada, a credencial é oferecida ao gerenciador seguro do navegador somente depois que o servidor confirma um login válido.

A aplicação não grava senha em:

- `localStorage`;
- `sessionStorage`;
- IndexedDB;
- Cache Storage;
- SQLite do frontend.

Em navegadores sem suporte à API explícita, o checkbox não é exibido e permanece apenas o comportamento nativo de autofill/password manager fornecido pelos campos `autocomplete`.
