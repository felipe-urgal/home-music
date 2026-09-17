import { useEffect, useState } from 'react';
import {
  approveTvDeviceLogin,
  denyTvDeviceLogin,
  previewTvDeviceLogin
} from '../tv-device-login-client';

type TvDeviceApprovalScreenProps = {
  approvalToken: string;
  onDone: () => void;
};

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível carregar esta solicitação.';
}

export function TvDeviceApprovalScreen({ approvalToken, onDone }: TvDeviceApprovalScreenProps) {
  const [displayCode, setDisplayCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(null);
    void previewTvDeviceLogin(approvalToken)
      .then(preview => {
        if (!disposed) setDisplayCode(preview.displayCode);
      })
      .catch(error => {
        if (!disposed) setError(messageFromError(error));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => { disposed = true; };
  }, [approvalToken]);

  async function approve() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await approveTvDeviceLogin(approvalToken);
      setDisplayCode(result.displayCode);
      setMessage('TV autorizada. Você já pode continuar pela televisão.');
    } catch (error) {
      setError(messageFromError(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function deny() {
    setSubmitting(true);
    setError(null);
    try {
      await denyTvDeviceLogin(approvalToken);
      setMessage('Solicitação recusada.');
    } catch (error) {
      setError(messageFromError(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (message) {
    return (
      <main className="tv-device-approval-shell">
        <section className="tv-device-approval-card" aria-live="polite">
          <span className="tv-device-login__eyebrow">Home Music na TV</span>
          <h1>{message.startsWith('TV autorizada') ? 'TV autorizada' : 'Solicitação encerrada'}</h1>
          <p>{message}</p>
          <button className="login-submit" type="button" onClick={onDone}>Voltar ao Home Music</button>
        </section>
      </main>
    );
  }

  return (
    <main className="tv-device-approval-shell">
      <section className="tv-device-approval-card" aria-live="polite">
        <span className="tv-device-login__eyebrow">Home Music na TV</span>
        <h1>Entrar nesta TV?</h1>
        <p>Confirme se o código abaixo é o mesmo que aparece na televisão.</p>

        <div className="tv-device-approval__code">
          <span>Código da TV</span>
          <strong data-tv-display-code-phone>{loading ? '••••••' : displayCode ?? '------'}</strong>
        </div>

        {error && <p className="tv-device-login__error" role="alert">{error}</p>}

        <div className="tv-device-approval__actions">
          <button
            className="login-submit"
            type="button"
            disabled={loading || submitting || !displayCode || Boolean(error)}
            onClick={() => void approve()}
          >
            {submitting ? 'Autorizando…' : 'Autorizar'}
          </button>
          <button
            className="tv-device-login__secondary"
            type="button"
            disabled={loading || submitting || Boolean(error)}
            onClick={() => void deny()}
          >
            Não autorizar
          </button>
        </div>
      </section>
    </main>
  );
}
