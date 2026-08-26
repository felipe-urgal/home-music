export type AuthAccess = 'public' | 'authenticated' | 'admin';

export type AdministrativeOperation = {
  method: 'GET' | 'POST';
  path: string;
};

export const LEGACY_ADMIN_OPERATIONS: readonly AdministrativeOperation[] = [
  { method: 'GET', path: '/api/health' },
  { method: 'POST', path: '/api/library/scan' },
  { method: 'POST', path: '/api/integrations/rekordbox/preview' },
  { method: 'POST', path: '/api/integrations/rekordbox/import' }
];

function requestPath(url: string) {
  return url.split('?', 1)[0];
}

function normalizedMethod(method: string) {
  const upper = method.toUpperCase();
  return upper === 'HEAD' ? 'GET' : upper;
}

function isAdminNamespace(path: string) {
  return path === '/api/admin' || path.startsWith('/api/admin/');
}

function isLegacyAdminOperation(method: string, path: string) {
  const normalized = normalizedMethod(method);
  return LEGACY_ADMIN_OPERATIONS.some(operation => (
    operation.method === normalized && operation.path === path
  ));
}

export function resolveApiAccess(
  method: string,
  url: string,
  declaredAccess?: AuthAccess
): AuthAccess {
  const path = requestPath(url);

  // As operações administrativas históricas mantêm suas URLs por compatibilidade,
  // mas a política central as trata como admin mesmo sem config local no handler.
  if (isLegacyAdminOperation(method, path)) return 'admin';

  // Novas APIs administrativas devem preferir /api/admin/* e nunca podem nascer
  // apenas authenticated/public por um config de rota esquecido ou incorreto.
  if (isAdminNamespace(path)) return 'admin';

  return declaredAccess ?? 'authenticated';
}
