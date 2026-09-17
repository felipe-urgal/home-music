import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseTvLanQrText } from '@home-music/shared/tv-lan-remote';
import {
  TV_LAN_BRIDGE_REQUEST_TIMEOUT_MS,
  createTvLanBridgeId,
  createTvLanBridgeRequest,
  isExpectedTvLanBridgeEvent,
  isMatchingTvLanBridgeResponse,
  parseTvLanBridgeMessage,
} from './tv-lan-bridge-protocol';

type BarcodeResult = { rawValue?: string };
type BarcodeDetectorLike = { detect: (source: HTMLVideoElement) => Promise<BarcodeResult[]> };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

type TvLanQrScannerProps = {
  open: boolean;
  onDetected: (value: string) => void;
  onCancel: () => void;
};

function barcodeDetectorConstructor() {
  return (globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
}

function scannerErrorMessage(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Permita o uso da câmera para escanear o QR ou cole o conteúdo abaixo.';
  }
  return 'Não foi possível abrir a câmera. Cole o conteúdo do QR abaixo.';
}

export function TvLanQrScanner({ open, onDetected, onCancel }: TvLanQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const bridgeAbortRef = useRef<AbortController | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [bridgeMessage, setBridgeMessage] = useState<string | null>(null);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    if (!open) bridgeAbortRef.current?.abort();
    return () => bridgeAbortRef.current?.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setManualValue('');
    setCameraMessage(null);
    setBridgeMessage(null);

    const Detector = barcodeDetectorConstructor();
    if (!navigator.mediaDevices?.getUserMedia || !Detector || !window.isSecureContext) {
      setCameraMessage('Leitura automática de QR indisponível neste navegador. Cole o conteúdo do QR abaixo.');
      return;
    }

    let disposed = false;
    let stream: MediaStream | null = null;
    let interval: number | null = null;
    let detecting = false;

    const stop = () => {
      if (interval !== null) window.clearInterval(interval);
      interval = null;
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });
        if (disposed) {
          stop();
          return;
        }
        const video = videoRef.current;
        if (!video) {
          stop();
          return;
        }
        video.srcObject = stream;
        await video.play();
        const detector = new Detector({ formats: ['qr_code'] });
        interval = window.setInterval(() => {
          if (disposed || detecting || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
          detecting = true;
          void detector.detect(video)
            .then(results => {
              if (disposed) return;
              const value = results.find(result => result.rawValue?.trim())?.rawValue?.trim();
              if (!value) return;
              disposed = true;
              stop();
              onDetectedRef.current(value);
            })
            .catch(() => undefined)
            .finally(() => { detecting = false; });
        }, 250);
      } catch (error) {
        if (!disposed) setCameraMessage(scannerErrorMessage(error));
        stop();
      }
    };

    void start();
    return () => {
      disposed = true;
      stop();
    };
  }, [open]);

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = manualValue.trim();
    if (value) onDetectedRef.current(value);
  };

  const testIosBridge = () => {
    const pairing = parseTvLanQrText(manualValue.trim());
    if (!pairing) {
      setBridgeMessage('Cole um QR válido e ainda não expirado antes de testar o bridge.');
      return;
    }

    bridgeAbortRef.current?.abort();
    const controller = new AbortController();
    bridgeAbortRef.current = controller;

    const bridgeOrigin = `http://${pairing.host}:${pairing.port}`;
    let channelId: string;
    try {
      channelId = createTvLanBridgeId();
    } catch {
      bridgeAbortRef.current = null;
      setBridgeMessage('Não foi possível criar um canal seguro para o bridge.');
      return;
    }

    const bridgeUrl = `${bridgeOrigin}/bridge?origin=${encodeURIComponent(window.location.origin)}&channelId=${encodeURIComponent(channelId)}`;
    let bridgeWindow: Window | null = null;
    let readyTimeout: number | null = null;
    let requestTimeout: number | null = null;
    let closePoll: number | null = null;
    let requestId: string | null = null;
    let finished = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      controller.signal.removeEventListener('abort', onAbort);
      if (readyTimeout !== null) window.clearTimeout(readyTimeout);
      if (requestTimeout !== null) window.clearTimeout(requestTimeout);
      if (closePoll !== null) window.clearInterval(closePoll);
      if (bridgeAbortRef.current === controller) bridgeAbortRef.current = null;
      try {
        if (bridgeWindow && !bridgeWindow.closed) bridgeWindow.close();
      } catch {
        // best-effort: alguns navegadores podem impedir window.close()
      }
    };

    const finish = (message: string | null) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (message !== null && !controller.signal.aborted) setBridgeMessage(message);
    };

    const onAbort = () => finish(null);

    const sendProbe = () => {
      if (!bridgeWindow || requestId !== null || finished) return;
      let request;
      try {
        request = createTvLanBridgeRequest(channelId, 'probe', null);
      } catch {
        finish('Não foi possível criar uma request válida para o bridge.');
        return;
      }
      requestId = request.requestId;
      if (readyTimeout !== null) {
        window.clearTimeout(readyTimeout);
        readyTimeout = null;
      }
      requestTimeout = window.setTimeout(() => {
        finish('Bridge abriu, mas não respondeu ao probe dentro do tempo esperado.');
      }, TV_LAN_BRIDGE_REQUEST_TIMEOUT_MS);
      bridgeWindow.postMessage(request, bridgeOrigin);
      setBridgeMessage('Bridge abriu no iOS. Validando canal v1…');
    };

    const onMessage = (event: MessageEvent) => {
      if (!isExpectedTvLanBridgeEvent(event, bridgeOrigin, bridgeWindow)) return;
      const message = parseTvLanBridgeMessage(event.data);
      if (!message || message.channelId !== channelId) return;

      if (message.type === 'ready') {
        sendProbe();
        return;
      }
      if (!requestId || !isMatchingTvLanBridgeResponse(message, { channelId, requestId, operation: 'probe' })) return;
      if (!message.ok) {
        finish(`Bridge respondeu com erro de protocolo: ${message.error ?? 'unknown_error'}.`);
        return;
      }
      const payload = message.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || (payload as { pong?: unknown }).pong !== true) {
        finish('Bridge respondeu com payload inválido.');
        return;
      }
      finish('Bridge v1 respondeu ao probe. O canal seguro window.open + postMessage está funcionando.');
    };

    controller.signal.addEventListener('abort', onAbort, { once: true });
    window.addEventListener('message', onMessage);
    bridgeWindow = window.open(bridgeUrl, 'home-music-ios-lan-bridge');
    if (!bridgeWindow) {
      finish('O iOS bloqueou a abertura da página bridge.');
      return;
    }

    setBridgeMessage('Página bridge aberta. Aguardando canal v1…');
    readyTimeout = window.setTimeout(() => {
      finish('A página bridge abriu, mas não confirmou o canal v1 dentro do tempo esperado.');
    }, TV_LAN_BRIDGE_REQUEST_TIMEOUT_MS);
    closePoll = window.setInterval(() => {
      if (bridgeWindow?.closed) finish('A página bridge foi fechada antes de concluir o teste.');
    }, 250);
  };

  return (
    <div className="tv-lan-qr-overlay">
      <section className="tv-lan-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="tv-lan-qr-title">
        <div className="tv-lan-qr-dialog__header">
          <div>
            <strong id="tv-lan-qr-title">Conectar à TV por QR</strong>
            <small>Aponte a câmera para o QR exibido no BTV.</small>
          </div>
          <button className="secondary-action" type="button" onClick={onCancel}>Cancelar</button>
        </div>

        <div className="tv-lan-qr-dialog__camera">
          <video ref={videoRef} muted playsInline aria-label="Câmera para leitura do QR da TV" />
          {cameraMessage && <p role="status">{cameraMessage}</p>}
        </div>

        <form className="tv-lan-qr-dialog__fallback" onSubmit={submit}>
          <label htmlFor="tv-lan-qr-value">Ou cole o conteúdo do QR</label>
          <textarea
            id="tv-lan-qr-value"
            aria-label="Conteúdo do QR"
            value={manualValue}
            onChange={event => setManualValue(event.currentTarget.value)}
            autoComplete="off"
            spellCheck={false}
            rows={3}
          />
          <button className="primary-action" type="submit" disabled={!manualValue.trim()}>Conectar</button>
          <button className="secondary-action" type="button" disabled={!manualValue.trim()} onClick={testIosBridge}>
            Testar bridge iOS (spike)
          </button>
          {bridgeMessage && <p role="status">{bridgeMessage}</p>}
        </form>
      </section>
    </div>
  );
}
