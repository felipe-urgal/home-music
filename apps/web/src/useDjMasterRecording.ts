import { useCallback, useRef, useState } from 'react';
import {
  createDjMasterRecordingOutput,
  type DjEqAudioGraph,
  type DjMasterRecordingOutput
} from './dj-eq-audio-graph';
import {
  djRecordingFilename,
  selectDjRecordingMimeType,
  type DjRecordingResult,
  type DjRecordingState
} from './dj-recording';

type DjMasterRecordingOptions = {
  active: () => boolean;
  ensureGraph: () => DjEqAudioGraph | null;
};

export function useDjMasterRecording({ active, ensureGraph }: DjMasterRecordingOptions) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const outputRef = useRef<DjMasterRecordingOutput | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef('');
  const stopRef = useRef<{
    resolve: (result: DjRecordingResult | null) => void;
    exportResult: boolean;
  } | null>(null);
  const [state, setState] = useState<DjRecordingState>(() => ({
    supported: typeof MediaRecorder !== 'undefined',
    active: false,
    startedAt: null,
    error: null
  }));

  const cleanupOutput = useCallback(() => {
    outputRef.current?.dispose();
    outputRef.current = null;
  }, []);

  const finish = useCallback((recorder: MediaRecorder) => {
    const pending = stopRef.current;
    stopRef.current = null;
    const mimeType = recorder.mimeType || mimeTypeRef.current || 'audio/webm';
    const chunks = chunksRef.current;
    chunksRef.current = [];
    mimeTypeRef.current = '';
    recorderRef.current = null;
    cleanupOutput();
    setState(current => ({
      ...current,
      active: false,
      startedAt: null
    }));

    if (!pending) return;
    if (!pending.exportResult || chunks.length === 0) {
      pending.resolve(null);
      return;
    }

    pending.resolve({
      blob: new Blob(chunks, { type: mimeType }),
      filename: djRecordingFilename(new Date(), mimeType),
      mimeType
    });
  }, [cleanupOutput]);

  const start = useCallback(() => {
    if (!active() || recorderRef.current) return false;
    if (typeof MediaRecorder === 'undefined') {
      setState({
        supported: false,
        active: false,
        startedAt: null,
        error: 'Gravação não suportada neste navegador.'
      });
      return false;
    }

    const graph = ensureGraph();
    if (!graph) {
      setState(current => ({
        ...current,
        error: 'Web Audio indisponível para capturar o master.'
      }));
      return false;
    }

    const output = createDjMasterRecordingOutput(graph);
    if (!output) {
      setState(current => ({
        ...current,
        supported: false,
        error: 'Captura do master indisponível neste navegador.'
      }));
      return false;
    }

    const mimeType = selectDjRecordingMimeType(MediaRecorder);
    if (mimeType === null) {
      output.dispose();
      setState({
        supported: false,
        active: false,
        startedAt: null,
        error: 'Nenhum formato de gravação compatível foi encontrado.'
      });
      return false;
    }

    try {
      const recorder = mimeType
        ? new MediaRecorder(output.stream, { mimeType })
        : new MediaRecorder(output.stream);
      outputRef.current = output;
      recorderRef.current = recorder;
      chunksRef.current = [];
      mimeTypeRef.current = recorder.mimeType || mimeType;

      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setState(current => ({
          ...current,
          error: 'A gravação do master foi interrompida pelo navegador.'
        }));
      };
      recorder.onstop = () => finish(recorder);
      recorder.start(1_000);
      setState({
        supported: true,
        active: true,
        startedAt: Date.now(),
        error: null
      });
      return true;
    } catch {
      output.dispose();
      setState(current => ({
        ...current,
        error: 'Não foi possível iniciar a gravação do master.'
      }));
      return false;
    }
  }, [active, ensureGraph, finish]);

  const stop = useCallback((exportResult = true): Promise<DjRecordingResult | null> => {
    const recorder = recorderRef.current;
    if (!recorder || stopRef.current) return Promise.resolve(null);

    return new Promise(resolve => {
      stopRef.current = { resolve, exportResult };
      if (recorder.state === 'inactive') {
        finish(recorder);
        return;
      }
      try {
        recorder.requestData();
      } catch {
        // Alguns engines não aceitam requestData imediatamente antes de stop.
      }
      recorder.stop();
    });
  }, [finish]);

  const discard = useCallback(() => {
    void stop(false);
  }, [stop]);

  return {
    state,
    start,
    stop,
    discard
  };
}
