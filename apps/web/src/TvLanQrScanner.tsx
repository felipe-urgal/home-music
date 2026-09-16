import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseTvLanQrText } from '@home-music/shared/tv-lan-remote';

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

function bridgeNonce() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function TvLanQrScanner({ open, onDetected, onCancel }: TvLanQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const [manualValue, setManualValue] = useState('');
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [bridgeMessage, setBridgeMessage] = useState<string | null>(null);
  onDetectedRef.current = onDetected;

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

    const bridgeOrigin = `http://${pairing.host}:${pairing.port}`;
    const nonce = bridgeNonce();
    let bridgeWindow: Window | null = null;
    let timeout: number | null = null;
    let finished = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      if (timeout !== null) window.clearTimeout(timeout);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== bridgeWindow || event.origin !== bridgeOrigin) return;
      const data = event.data as { type?: unknown; nonce?: unknown } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'home-music-lan-bridge-ready') {
        setBridgeMessage('Bridge abriu no iOS. Enviando PING…');
        bridgeWindow?.postMessage({ type: 'home-music-lan-bridge-ping', nonce }, bridgeOrigin);
        return;
      }
      if (data.type === 'home-music-lan-bridge-pong' && data.nonce === nonce) {
        finished = true;
        cleanup();
        setBridgeMessage('PONG recebido. window.open + postMessage funciona neste iPhone.');
      }
    };

    window.addEventListener('message', onMessage);
    bridgeWindow = window.open(`${bridgeOrigin}/bridge`, 'home-music-ios-lan-bridge');
    if (!bridgeWindow) {
      cleanup();
      setBridgeMessage('O iOS bloqueou a abertura da página bridge.');
      return;
    }

    setBridgeMessage('Página bridge aberta. Aguardando resposta…');
    timeout = window.setTimeout(() => {
      if (finished) return;
      cleanup();
      setBridgeMessage('Sem PONG. A página abriu, mas o canal window.opener/postMessage não voltou ao Home Music.');
    }, 12_000);
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
