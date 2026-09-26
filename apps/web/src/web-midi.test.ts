import { describe, expect, it, vi } from 'vitest';
import {
  normalizeMidiMessage,
  WebMidiSession,
  webMidiSupported,
  type MidiAccessLike,
  type MidiInputLike,
  type MidiOutputLike
} from './web-midi';

function input(id: string): MidiInputLike {
  return {
    id,
    name: id,
    manufacturer: 'Test',
    state: 'connected',
    type: 'input',
    onmidimessage: null
  };
}

function output(id: string): MidiOutputLike {
  return {
    id,
    name: id,
    manufacturer: 'Test',
    state: 'connected',
    type: 'output',
    send: vi.fn()
  };
}

function access(inputs: MidiInputLike[] = [], outputs: MidiOutputLike[] = []): MidiAccessLike {
  return {
    inputs: new Map(inputs.map(item => [item.id, item])),
    outputs: new Map(outputs.map(item => [item.id, item])),
    onstatechange: null
  };
}

describe('Web MIDI foundation', () => {
  it('considera Web MIDI opcional e exige contexto seguro', () => {
    const nav = { requestMIDIAccess: vi.fn() };
    expect(webMidiSupported(nav, true)).toBe(true);
    expect(webMidiSupported(nav, false)).toBe(false);
    expect(webMidiSupported({}, true)).toBe(false);
  });

  it('solicita acesso explicitamente sem SysEx', async () => {
    const midiAccess = access();
    const requestMIDIAccess = vi.fn(async () => midiAccess);
    const session = new WebMidiSession({ requestMIDIAccess });

    await session.connect();

    expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
    expect(requestMIDIAccess).toHaveBeenCalledWith({ sysex: false });
  });

  it('normaliza bytes sem expor MIDIMessageEvent', () => {
    expect(normalizeMidiMessage('controller', [0x91, 64, 127], 123)).toEqual({
      timestamp: 123,
      status: 0x90,
      channel: 1,
      data1: 64,
      data2: 127,
      sourceId: 'controller'
    });
  });

  it('troca input sem duplicar listeners', async () => {
    const first = input('first');
    const second = input('second');
    const session = new WebMidiSession({
      requestMIDIAccess: async () => access([first, second])
    });
    await session.connect();

    expect(session.selectInput('first')).toBe(true);
    expect(first.onmidimessage).not.toBeNull();

    expect(session.selectInput('second')).toBe(true);
    expect(first.onmidimessage).toBeNull();
    expect(second.onmidimessage).not.toBeNull();
  });

  it('propaga mensagem somente do input selecionado', async () => {
    const device = input('controller');
    const listener = vi.fn();
    const session = new WebMidiSession({
      requestMIDIAccess: async () => access([device])
    });
    session.onMessage(listener);
    await session.connect();
    session.selectInput('controller');

    device.onmidimessage?.({ data: [0xb0, 7, 100], receivedTime: 10 });

    expect(listener).toHaveBeenCalledWith({
      timestamp: 10,
      status: 0xb0,
      channel: 0,
      data1: 7,
      data2: 100,
      sourceId: 'controller'
    });
  });

  it('observa hot-plug e limpa listeners no disconnect', async () => {
    const device = input('controller');
    const midiAccess = access([device], [output('out')]);
    const changed = vi.fn();
    const session = new WebMidiSession({
      requestMIDIAccess: async () => midiAccess
    });
    session.onStateChange(changed);
    await session.connect();
    session.selectInput('controller');

    midiAccess.onstatechange?.({ port: device });
    expect(changed).toHaveBeenCalledTimes(1);

    session.disconnect();
    expect(midiAccess.onstatechange).toBeNull();
    expect(device.onmidimessage).toBeNull();
  });

  it('envia somente para output selecionado e conectado', async () => {
    const first = output('first');
    const second = output('second');
    const session = new WebMidiSession({
      requestMIDIAccess: async () => access([], [first, second])
    });
    await session.connect();

    expect(session.sendToSelectedOutput([0x90, 0x0b, 0x7f])).toBe(false);
    expect(first.send).not.toHaveBeenCalled();
    expect(second.send).not.toHaveBeenCalled();

    expect(session.selectOutput('second')).toBe(true);
    expect(session.sendToSelectedOutput([0x91, 0x0b, 0x7f])).toBe(true);
    expect(first.send).not.toHaveBeenCalled();
    expect(second.send).toHaveBeenCalledWith([0x91, 0x0b, 0x7f]);

    second.state = 'disconnected';
    expect(session.sendToSelectedOutput([0x91, 0x0b, 0])).toBe(false);
  });

  it('recusa porta desconectada', async () => {
    const device = input('controller');
    device.state = 'disconnected';
    const session = new WebMidiSession({
      requestMIDIAccess: async () => access([device])
    });
    await session.connect();

    expect(session.selectInput('controller')).toBe(false);
  });
});
