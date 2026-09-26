import { describe, expect, it } from 'vitest';
import {
  midiPortStillConnected,
  preferredMidiInput,
  preferredMidiOutput
} from './midi-port-selection';
import type { MidiPortInfo } from './web-midi';

function port(
  type: 'input' | 'output',
  id: string,
  name: string,
  state: 'connected' | 'disconnected' = 'connected'
): MidiPortInfo {
  return { type, id, name, state, manufacturer: 'Pioneer DJ' };
}

describe('MIDI port selection lifecycle', () => {
  it('restaura por id após reconnect', () => {
    const ports = [
      port('input', 'ddj-in', 'DDJ-400 MIDI'),
      port('output', 'ddj-out', 'DDJ-400 MIDI')
    ];

    expect(preferredMidiInput(ports, { inputId: 'ddj-in' })?.id).toBe('ddj-in');
    expect(preferredMidiOutput(ports, { outputId: 'ddj-out' })?.id).toBe('ddj-out');
  });

  it('restaura por nome quando o browser troca o id após hot-plug', () => {
    const ports = [
      port('input', 'new-in', 'DDJ-400 MIDI'),
      port('output', 'new-out', 'DDJ-400 MIDI')
    ];

    expect(preferredMidiInput(ports, {
      inputId: 'old-in',
      inputName: 'DDJ-400 MIDI'
    })?.id).toBe('new-in');

    expect(preferredMidiOutput(ports, {
      outputId: 'old-out',
      outputName: 'DDJ-400 MIDI'
    })?.id).toBe('new-out');
  });

  it('não restaura porta desconectada', () => {
    const ports = [
      port('input', 'ddj-in', 'DDJ-400 MIDI', 'disconnected'),
      port('output', 'ddj-out', 'DDJ-400 MIDI', 'disconnected')
    ];

    expect(preferredMidiInput(ports, { inputId: 'ddj-in' }, false)).toBeNull();
    expect(preferredMidiOutput(ports, { outputId: 'ddj-out' })).toBeNull();
  });

  it('input pode cair para primeira porta conectada, output não', () => {
    const ports = [
      port('input', 'other-in', 'Outro controlador'),
      port('output', 'other-out', 'Outra saída')
    ];

    expect(preferredMidiInput(ports, {})?.id).toBe('other-in');
    expect(preferredMidiOutput(ports, {})).toBeNull();
  });

  it('detecta seleção atual que deixou de estar conectada', () => {
    const ports = [
      port('input', 'ddj-in', 'DDJ-400 MIDI', 'disconnected'),
      port('output', 'ddj-out', 'DDJ-400 MIDI')
    ];

    expect(midiPortStillConnected(ports, 'input', 'ddj-in')).toBe(false);
    expect(midiPortStillConnected(ports, 'output', 'ddj-out')).toBe(true);
  });
});
