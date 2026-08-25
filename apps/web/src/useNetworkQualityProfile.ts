import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  detectNetwork,
  parseStreamingSelection,
  readNetworkPreference,
  resolveNetworkStreamingMode,
  STREAMING_SELECTION_STORAGE_KEY,
  type DetectedNetwork,
  type NetworkConnectionSnapshot,
  type NetworkPreference,
  type StreamingMode,
  type StreamingSelection,
  writeNetworkPreference,
  writeStreamingSelection
} from './streaming-quality';

type BrowserNetworkConnection = NetworkConnectionSnapshot & {
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
};

type NavigatorWithConnection = Navigator & {
  connection?: BrowserNetworkConnection;
  mozConnection?: BrowserNetworkConnection;
  webkitConnection?: BrowserNetworkConnection;
};

function browserConnection() {
  const candidate = navigator as NavigatorWithConnection;
  return candidate.connection ?? candidate.mozConnection ?? candidate.webkitConnection ?? null;
}

function initialSelection(currentMode: StreamingMode): StreamingSelection {
  try {
    const raw = window.localStorage.getItem(STREAMING_SELECTION_STORAGE_KEY);
    return raw == null ? currentMode : parseStreamingSelection(raw);
  } catch {
    return currentMode;
  }
}

function initialNetworkPreference(): NetworkPreference {
  try {
    return readNetworkPreference(window.localStorage);
  } catch {
    return 'auto';
  }
}

export function useNetworkQualityProfile(
  currentMode: StreamingMode,
  onMode: (mode: StreamingMode) => void
) {
  const [selection, setSelectionState] = useState<StreamingSelection>(() => initialSelection(currentMode));
  const [networkPreference, setNetworkPreferenceState] = useState<NetworkPreference>(initialNetworkPreference);
  const [detectedNetwork, setDetectedNetwork] = useState<DetectedNetwork>(() => detectNetwork(browserConnection()));

  const networkMode = useMemo(
    () => resolveNetworkStreamingMode(networkPreference, detectedNetwork),
    [detectedNetwork, networkPreference]
  );

  useEffect(() => {
    const connection = browserConnection();
    if (!connection) {
      setDetectedNetwork('unknown');
      return;
    }

    const update = () => setDetectedNetwork(detectNetwork(connection));
    update();
    connection.addEventListener?.('change', update);
    return () => connection.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (selection !== 'network' || currentMode === networkMode) return;
    onMode(networkMode);
  }, [currentMode, networkMode, onMode, selection]);

  const setSelection = useCallback((next: StreamingSelection) => {
    if (next === selection) return;
    writeStreamingSelection(window.localStorage, next);
    setSelectionState(next);
    if (next !== 'network') onMode(next);
  }, [onMode, selection]);

  const setNetworkPreference = useCallback((next: NetworkPreference) => {
    if (next === networkPreference) return;
    writeNetworkPreference(window.localStorage, next);
    setNetworkPreferenceState(next);
  }, [networkPreference]);

  return {
    selection,
    networkPreference,
    detectedNetwork,
    effectiveMode: selection === 'network' ? networkMode : currentMode,
    setSelection,
    setNetworkPreference
  };
}
