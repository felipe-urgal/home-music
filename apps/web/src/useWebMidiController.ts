import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  WebMidiSession,
  webMidiSupported,
  type MidiNavigatorLike,
  type MidiPortInfo,
  type NormalizedMidiMessage
} from './web-midi';

const STORAGE_KEY = 'home-music:midi-controller:v1';

type StoredSelection = {
  inputId?: string | null;
  outputId?: string | null;
  inputName?: string | null;
  outputName?: string | null;
};

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

export function useWebMidiController() {
  const supported = webMidiSupported(
    typeof navigator === 'undefined' ? {} : navigatorMidi(),
    typeof window !== 'undefined' && window.isSecureContext
  );
  const sessionRef = useRef<WebMidiSession | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'denied' | 'error'>('idle');
  const [ports, setPorts] = useState<MidiPortInfo[]>([]);
  const [selectedInputId, setSelectedInputIdState] = useState<string | null>(null);
  const [selectedOutputId, setSelectedOutputIdState] = useState<string | null>(null);
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false);
  const [lastMessage, setLastMessage] = useState<NormalizedMidiMessage | null>(null);

  const refreshPorts = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const nextPorts = session.listPorts();
    setPorts(nextPorts);

    const selection = session.getSelection();
    if (
      selection.inputId
      && !nextPorts.some(port => port.type === 'input' && port.id === selection.inputId && port.state === 'connected')
    ) {
      session.selectInput(null);
      setSelectedInputIdState(null);
    }
    if (
      selection.outputId
      && !nextPorts.some(port => port.type === 'output' && port.id === selection.outputId && port.state === 'connected')
    ) {
      session.selectOutput(null);
      setSelectedOutputIdState(null);
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
      if (diagnosticsEnabled) setLastMessage(message);
    });

    try {
      const nextPorts = await session.connect();
      setPorts(nextPorts);

      const stored = readStoredSelection();
      const connectedInputs = nextPorts.filter(port => port.type === 'input' && port.state === 'connected');
      const connectedOutputs = nextPorts.filter(port => port.type === 'output' && port.state === 'connected');
      const input = connectedInputs.find(port => port.id === stored.inputId)
        ?? connectedInputs.find(port => port.name === stored.inputName)
        ?? connectedInputs[0]
        ?? null;
      const output = connectedOutputs.find(port => port.id === stored.outputId)
        ?? connectedOutputs.find(port => port.name === stored.outputName)
        ?? null;

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
  }, [diagnosticsEnabled, refreshPorts, status, supported]);

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

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.onMessage(message => {
      if (diagnosticsEnabled) setLastMessage(message);
    });
  }, [diagnosticsEnabled]);

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
    setDiagnosticsEnabled
  };
}
