type PasswordCredentialConstructor = new (data: {
  id: string;
  name?: string;
  password: string;
}) => Credential;

type PasswordCredentialWindow = Window & {
  PasswordCredential?: PasswordCredentialConstructor;
};

export function canStorePasswordCredential() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const PasswordCredentialApi = (window as PasswordCredentialWindow).PasswordCredential;
  return typeof PasswordCredentialApi === 'function'
    && Boolean(navigator.credentials)
    && typeof navigator.credentials.store === 'function';
}

export async function storePasswordCredential(username: string, password: string) {
  if (!canStorePasswordCredential()) return false;

  const PasswordCredentialApi = (window as PasswordCredentialWindow).PasswordCredential;
  if (!PasswordCredentialApi) return false;

  try {
    const credential = new PasswordCredentialApi({
      id: username,
      name: username,
      password
    });
    await navigator.credentials.store(credential);
    return true;
  } catch {
    return false;
  }
}
