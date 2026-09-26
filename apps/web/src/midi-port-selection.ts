import type { MidiPortInfo } from './web-midi';

export type StoredMidiSelection = {
  inputId?: string | null;
  outputId?: string | null;
  inputName?: string | null;
  outputName?: string | null;
};

export function preferredMidiInput(
  ports: readonly MidiPortInfo[],
  stored: StoredMidiSelection,
  fallbackToFirst = true
) {
  const inputs = ports.filter(port => port.type === 'input' && port.state === 'connected');
  return inputs.find(port => port.id === stored.inputId)
    ?? inputs.find(port => port.name === stored.inputName)
    ?? (fallbackToFirst ? inputs[0] ?? null : null);
}

export function preferredMidiOutput(
  ports: readonly MidiPortInfo[],
  stored: StoredMidiSelection
) {
  const outputs = ports.filter(port => port.type === 'output' && port.state === 'connected');
  return outputs.find(port => port.id === stored.outputId)
    ?? outputs.find(port => port.name === stored.outputName)
    ?? null;
}

export function midiPortStillConnected(
  ports: readonly MidiPortInfo[],
  type: 'input' | 'output',
  id: string | null
) {
  if (!id) return false;
  return ports.some(port => port.type === type && port.id === id && port.state === 'connected');
}
