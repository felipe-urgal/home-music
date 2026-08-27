import { useState } from 'react';
import type { AuthenticatedUser } from '@home-music/shared';
import {
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Users
} from 'lucide-react';
import { AdminUsersScreen } from './AdminUsersScreen';

type AdministrationView = 'overview' | 'users';

type AdministrationScreenProps = {
  currentUser: AuthenticatedUser;
  onBack: () => void;
};

export function AdministrationScreen({ currentUser, onBack }: AdministrationScreenProps) {
  const [view, setView] = useState<AdministrationView>('overview');

  if (currentUser.role !== 'admin') return null;

  if (view === 'users') {
    return <AdminUsersScreen currentUser={currentUser} onBack={() => setView('overview')} />;
  }

  return (
    <section className="my-account-screen administration-screen" aria-labelledby="administration-title">
      <header className="my-account-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="administration-title">Administração</strong>
          <small>Controles do Home Music</small>
        </div>
        <span className="my-account-header__spacer" />
      </header>

      <div className="my-account-overview">
        <section className="my-account-profile" aria-label="Acesso administrativo">
          <span className="my-account-profile__icon"><ShieldCheck /></span>
          <div>
            <strong>{currentUser.username}</strong>
            <small>Área restrita a administradores</small>
          </div>
          <span className="my-account-profile__badge"><ShieldCheck /> Administrador</span>
        </section>

        <section className="my-account-link-group" aria-labelledby="administration-group-access">
          <span className="my-account-link-group__label" id="administration-group-access">Acesso</span>
          <div className="my-account-links">
            <button type="button" onClick={() => setView('users')}>
              <span className="my-account-card__icon"><Users /></span>
              <span><strong>Usuários</strong><small>Crie contas e gerencie papéis, acesso e sessões.</small></span>
              <ChevronRight />
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
