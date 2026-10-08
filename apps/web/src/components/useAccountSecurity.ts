import { useEffect, useState } from 'react';
import {
  changeOwnPassword,
  listOwnSessions,
  passwordChangeValidation,
  revokeOtherSessions,
  revokeOwnSession,
  type AccountSession
} from '../account-client';

/** Password form and mutation lifecycle stay local to the account screen. */
export function useAccountPassword(onSessionEnded: () => Promise<void>) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const validationError = passwordChangeValidation(currentPassword, newPassword, confirmation);

  async function confirmPassword() {
    if (changingPassword || validationError) return;
    setChangingPassword(true);
    try {
      // The server changes the password transactionally and revokes every session.
      await changeOwnPassword(currentPassword, newPassword);
      await onSessionEnded();
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setShowPasswords(false);
    } finally {
      setChangingPassword(false);
    }
  }

  return {
    currentPassword, setCurrentPassword, newPassword, setNewPassword,
    confirmation, setConfirmation, showPasswords, setShowPasswords,
    changingPassword, validationError, confirmPassword
  };
}

/** Fetching and session revocations own their local state, not a global store. */
export function useAccountSessions(visible: boolean) {
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsNotice, setSessionsNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setSessionsNotice(null);
      return;
    }
    let active = true;
    setLoadingSessions(true);
    setSessionsError(null);
    void listOwnSessions()
      .then(items => { if (active) setSessions(items); })
      .catch(error => {
        if (active) setSessionsError(
          error instanceof Error ? error.message : 'Não foi possível carregar sessões.'
        );
      })
      .finally(() => { if (active) setLoadingSessions(false); });
    return () => { active = false; };
  }, [visible]);

  async function revokeOneSession(id: string) {
    if (busySessionId || revokingSessions) return;
    setBusySessionId(id);
    try {
      await revokeOwnSession(id);
      setSessions(items => items.filter(item => item.id !== id));
      setSessionsNotice('Sessão encerrada.');
    } finally {
      setBusySessionId(null);
    }
  }

  async function revokeAllOtherSessions() {
    if (busySessionId || revokingSessions) return;
    setRevokingSessions(true);
    try {
      const revoked = await revokeOtherSessions();
      setSessions(items => items.filter(item => item.current));
      setSessionsNotice(revoked === 0
        ? 'Nenhuma outra sessão estava ativa.'
        : `${revoked} ${revoked === 1 ? 'sessão foi encerrada' : 'sessões foram encerradas'}.`);
    } finally {
      setRevokingSessions(false);
    }
  }

  return {
    sessions, loadingSessions, busySessionId, revokingSessions,
    sessionsError, sessionsNotice, clearSessionsNotice: () => setSessionsNotice(null),
    revokeOneSession, revokeAllOtherSessions
  };
}
