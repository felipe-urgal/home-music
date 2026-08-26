import type { AuthenticatedUser } from '@home-music/shared';

export function canUseAdminLibraryActions(user: Pick<AuthenticatedUser, 'role'> | null | undefined) {
  return user?.role === 'admin';
}
