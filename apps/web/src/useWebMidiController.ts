import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  WebMidiSession,
  webMidiSupported,
  type MidiNavigatorLike,
  type MidiPortInfo,
  type NormalizedMidiMessage
} from './web-midi';
import {
  midiPortStillConnected,
  preferredMidiInput,
  preferredMidiOutput,
  type StoredMidiSelection
} from './midi-port-selection';

const STORAGE_KEY = 'home-music:midi-controller:v1';

type StoredSelection = StoredMidiSelection;

function readStoredSelection(): StoredSelection {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const value = JSON.parse(raw) as StoredSelection;
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeStoredSelection(selection: StoredSelection) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Preferência best-effort; conexão MIDI não depende de persistência.
  }
}

function navigatorMidi(): MidiNavigatorLike {
  return navigator as Navigator & MidiNavigatorLike;
}

type WebMidiControllerOptions = {
  onMessage?: (message: NormalizedMidiMessage) => void;
};

export function useWebMidiController(options: WebMidiControllerOptions = {}) {
  const onMessageRef = useRef(options.onMessage);
  const diagnosticsEnabledRef = useRef(false);
  onMessageRef.current = options.onMessage;
  const supported = webMidiSupported(
    typeof navigator === 'undefined' ? {} : navigatorMidi(),
    typeof window !== 'undefined' && window.isSecureContext
  );
  const sessionRef = useRef<WebMidiSession | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'denied' | 'error'>('idle');
  const [ports, setPorts] = useState<MidiPortInfo[]>([]);
  const [selectedInputId, setSelectedInputIdState] = useState<string | null>(null);
  const [selectedOutputId, setSelectedOutputIdState] = useState<string | null>(null);
  const [diagnosticsEnabled, setDiagnosticsEnabledState] = useState(false);
  const [lastMessage, setLastMessage] = useState<NormalizedMidiMessage | null>(null);

  const setDiagnosticsEnabled = useCallback((enabled: boolean) => {
    diagnosticsEnabledRef.current = enabled;
    setDiagnosticsEnabledState(enabled);
    if (!enabled) setLastMessage(null);
  }, []);

  const refreshPorts = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const nextPorts = session.listPorts();
    setPorts(nextPorts);

    const selection = session.getSelection();
    let inputId = selection.inputId;
    let outputId = selection.outputId;
    if (inputId && !midiPortStillConnected(nextPorts, 'input', inputId)) {
      session.selectInput(null);
      inputId = null;
      setSelectedInputIdState(null);
    }
    if (outputId && !midiPortStillConnected(nextPorts, 'output', outputId)) {
      session.selectOutput(null);
      outputId = null;
      setSelectedOutputIdState(null);
    }

    const stored = readStoredSelection();
    if (!inputId) {
      const input = preferredMidiInput(nextPorts, stored, false);
      if (input && session.selectInput(input.id)) setSelectedInputIdState(input.id);
    }
    if (!outputId) {
      const output = preferredMidiOutput(nextPorts, stored);
      if (output && session.selectOutput(output.id)) setSelectedOutputIdState(output.id);
    }
  }, []);

  const connect = useCallback(async () => {
    if (!supported || status === 'connecting') return false;

    setStatus('connecting');
    const session = new WebMidiSession(navigatorMidi());
    sessionRef.current?.disconnect();
    sessionRef.current = session;
    session.onStateChange(refreshPorts);
    session.onMessage(message => {
      onMessageRef.current?.(message);
      if (diagnosticsEnabledRef.current) setLastMessage(message);
    });

    try {
      const nextPorts = await session.connect();
      setPorts(nextPorts);

      const stored = readStoredSelection();
      const input = preferredMidiInput(nextPorts, stored);
      const output = preferredMidiOutput(nextPorts, stored);

      if (input && session.selectInput(input.id)) setSelectedInputIdState(input.id);
      if (output && session.selectOutput(output.id)) setSelectedOutputIdState(output.id);
      setStatus('connected');
      return true;
    } catch (error) {
      session.disconnect();
      sessionRef.current = null;
      const name = error instanceof DOMException ? error.name : '';
      setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
      return false;
    }
  }, [refreshPorts, status, supported]);

  const disconnect = useCallback(() => {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    setPorts([]);
    setSelectedInputIdState(null);
    setSelectedOutputIdState(null);
    setLastMessage(null);
    setStatus('idle');
  }, []);

  const selectInput = useCallback((id: string | null) => {
    const session = sessionRef.current;
    if (!session || !session.selectInput(id)) return false;
    setSelectedInputIdState(id);
    const input = ports.find(port => port.type === 'input' && port.id === id) ?? null;
    const output = ports.find(port => port.type === 'output' && port.id === selectedOutputId) ?? null;
    writeStoredSelection({
      inputId: input?.id ?? null,
      inputName: input?.name ?? null,
      outputId: output?.id ?? null,
      outputName: output?.name ?? null
    });
    return true;
  }, [ports, selectedOutputId]);

  const send = useCallback((data: number[] | Uint8Array) => {
    return sessionRef.current?.sendToSelectedOutput(data) ?? false;
  }, []);

  const selectOutput = useCallback((id: string | null) => {
    const session = sessionRef.current;
    if (!session || !session.selectOutput(id)) return false;
    setSelectedOutputIdState(id);
    const input = ports.find(port => port.type === 'input' && port.id === selectedInputId) ?? null;
    const output = ports.find(port => port.type === 'output' && port.id === id) ?? null;
    writeStoredSelection({
      inputId: input?.id ?? null,
      inputName: input?.name ?? null,
      outputId: output?.id ?? null,
      outputName: output?.name ?? null
    });
    return true;
  }, [ports, selectedInputId]);

  useEffect(() => () => sessionRef.current?.disconnect(), []);

  const inputs = useMemo(
    () => ports.filter(port => port.type === 'input'),
    [ports]
  );
  const outputs = useMemo(
    () => ports.filter(port => port.type === 'output'),
    [ports]
  );

  return {
    supported,
    status,
    inputs,
    outputs,
    selectedInputId,
    selectedOutputId,
    diagnosticsEnabled,
    lastMessage,
    connect,
    disconnect,
    selectInput,
    selectOutput,
    send,
    setDiagnosticsEnabled
  };
}

export type WebMidiController = ReturnType<typeof useWebMidiController>;
