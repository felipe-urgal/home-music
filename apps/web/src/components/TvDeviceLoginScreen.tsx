import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cancelTvDeviceLogin,
  consumeTvDeviceLogin,
  getTvDeviceLoginStatus,
  startTvDeviceLogin,
  type TvDeviceLoginStart
} from '../tv-device-login-client';
import { tvDeviceApprovalUrl } from '../tv-device-login-intent';
import { qrMatrixForValue } from '../tv-device-login-qr';

type TvDeviceLoginScreenProps = {
  onAuthenticated: () => Promise<void>;
  onUsePassword: () => void;
};

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível iniciar o login da TV.';
}

function TvApprovalQr({ value }: { value: string }) {
  const matrix = useMemo(() => qrMatrixForValue(value), [value]);
  const quietZone = 4;
  const viewBoxSize = matrix.size + quietZone * 2;

  return (
    <div className="tv-device-login__qr" data-tv-approval-url={value}>
      <svg
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        role="img"
        aria-label="QR code para entrar na TV com o celular"
      >
        <rect width={viewBoxSize} height={viewBoxSize} fill="white" />
        {matrix.cells.flatMap((row, rowIndex) => row.map((dark, columnIndex) => dark ? (
          <rect
            key={`${rowIndex}-${columnIndex}`}
            x={columnIndex + quietZone}
            y={rowIndex + quietZone}
            width="1"
            height="1"
            fill="black"
          />
        ) : null))}
      </svg>
    </div>
  );
}

export function TvDeviceLoginScreen({ onAuthenticated, onUsePassword }: TvDeviceLoginScreenProps) {
  const [request, setRequest] = useState<TvDeviceLoginStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  const startRequest = useCallback(async (previous?: TvDeviceLoginStart | null) => {
    setStarting(true);
    setError(null);
    if (previous) {
      await cancelTvDeviceLogin(previous.requestId, previous.deviceToken).catch(() => undefined);
    }
    try {
      const started = await startTvDeviceLogin();
      setRequest(started);
    } catch (error) {
      setRequest(null);
      setError(messageFromError(error));
    } finally {
      setStarting(false);
    }
  }, []);

  useEffect(() => {
    void startRequest();
  }, [startRequest]);

  useEffect(() => {
    if (!request) return;
    let disposed = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const status = await getTvDeviceLoginStatus(request.requestId, request.deviceToken);
        if (disposed) return;
        if (status.state === 'pending') {
          timer = window.setTimeout(() => void poll(), 750);
          return;
        }
        if (status.state === 'approved') {
          await consumeTvDeviceLogin(request.requestId, request.deviceToken);
          if (!disposed) await onAuthenticated();
          return;
        }
        setError('Este código não está mais disponível. Gere um novo código para continuar.');
      } catch (error) {
        if (!disposed) setError(messageFromError(error));
      }
    };

    timer = window.setTimeout(() => void poll(), 500);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [onAuthenticated, request]);

  const approvalUrl = request
    ? tvDeviceApprovalUrl(window.location.origin, request.approvalToken)
    : null;

  async function usePassword() {
    if (request) {
      await cancelTvDeviceLogin(request.requestId, request.deviceToken).catch(() => undefined);
    }
    onUsePassword();
  }

  return (
    <main className="tv-device-login-shell">
      <section className="tv-device-login-card" aria-live="polite">
        <div className="tv-device-login__copy">
          <span className="tv-device-login__eyebrow">Home Music na TV</span>
          <h1>Entrar no Home Music</h1>
          <p>Escaneie o QR code com o celular que já usa o Home Music e autorize esta TV.</p>

          {request && (
            <div className="tv-device-login__code-block">
              <span>Ou confirme pelo código</span>
              <strong data-tv-display-code>{request.displayCode}</strong>
            </div>
          )}

          {error && <p className="tv-device-login__error" role="alert">{error}</p>}

          <div className="tv-device-login__actions">
            <button
              className="login-submit"
              type="button"
              disabled={starting}
              onClick={() => void startRequest(request)}
            >
              {starting ? 'Gerando código…' : 'Gerar novo código'}
            </button>
            <button
              className="tv-device-login__secondary"
              type="button"
              onClick={() => void usePassword()}
            >
              Entrar com usuário e senha
            </button>
          </div>
        </div>

        <div className="tv-device-login__visual">
          {approvalUrl ? (
            <TvApprovalQr value={approvalUrl} />
          ) : (
            <div className="tv-device-login__qr-placeholder" aria-hidden="true" />
          )}
          <p>Abra a câmera do celular e aponte para o código.</p>
        </div>
      </section>
    </main>
  );
}
