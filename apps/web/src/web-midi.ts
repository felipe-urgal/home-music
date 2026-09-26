export type MidiPortState = 'connected' | 'disconnected';

export type MidiPortInfo = {
  id: string;
  name: string;
  manufacturer: string | null;
  state: MidiPortState;
  type: 'input' | 'output';
};

export type NormalizedMidiMessage = {
  timestamp: number;
  status: number;
  channel: number;
  data1: number;
  data2: number;
  sourceId: string;
};

export type MidiAccessLike = {
  inputs: Map<string, MidiInputLike>;
  outputs: Map<string, MidiOutputLike>;
  onstatechange: ((event: { port: MidiPortLike }) => void) | null;
};

export type MidiPortLike = {
  id: string;
  name?: string | null;
  manufacturer?: string | null;
  state: MidiPortState;
  type: 'input' | 'output';
};

export type MidiInputLike = MidiPortLike & {
  type: 'input';
  onmidimessage: ((event: { data: ArrayLike<number>; receivedTime?: number }) => void) | null;
};

export type MidiOutputLike = MidiPortLike & {
  type: 'output';
  send(data: number[] | Uint8Array): void;
};

export type MidiNavigatorLike = {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MidiAccessLike>;
};

export function webMidiSupported(navigatorLike: MidiNavigatorLike, secureContext: boolean) {
  return secureContext && typeof navigatorLike.requestMIDIAccess === 'function';
}

export function normalizeMidiMessage(
  sourceId: string,
  data: ArrayLike<number>,
  timestamp = 0
): NormalizedMidiMessage | null {
  if (data.length < 1) return null;
  const statusByte = Number(data[0] ?? 0);
  const data1 = Number(data[1] ?? 0);
  const data2 = Number(data[2] ?? 0);
  if (![statusByte, data1, data2].every(Number.isFinite)) return null;

  return {
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    status: statusByte & 0xf0,
    channel: statusByte & 0x0f,
    data1: data1 & 0x7f,
    data2: data2 & 0x7f,
    sourceId
  };
}

function portInfo(port: MidiPortLike): MidiPortInfo {
  return {
    id: port.id,
    name: port.name?.trim() || 'Dispositivo MIDI',
    manufacturer: port.manufacturer?.trim() || null,
    state: port.state,
    type: port.type
  };
}

export class WebMidiSession {
  private access: MidiAccessLike | null = null;
  private selectedInputId: string | null = null;
  private selectedOutputId: string | null = null;
  private messageListener: ((message: NormalizedMidiMessage) => void) | null = null;
  private stateListener: (() => void) | null = null;

  constructor(private readonly navigatorLike: MidiNavigatorLike) {}

  async connect() {
    if (typeof this.navigatorLike.requestMIDIAccess !== 'function') {
      throw new Error('Web MIDI não é suportado neste navegador.');
    }
    this.disconnect();
    this.access = await this.navigatorLike.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this.stateListener?.();
    return this.listPorts();
  }

  disconnect() {
    if (this.access) {
      this.access.onstatechange = null;
      for (const input of this.access.inputs.values()) input.onmidimessage = null;
    }
    this.access = null;
    this.selectedInputId = null;
    this.selectedOutputId = null;
  }

  onStateChange(listener: (() => void) | null) {
    this.stateListener = listener;
  }

  onMessage(listener: ((message: NormalizedMidiMessage) => void) | null) {
    this.messageListener = listener;
  }

  listPorts() {
    const ports: MidiPortInfo[] = [];
    if (!this.access) return ports;
    for (const input of this.access.inputs.values()) ports.push(portInfo(input));
    for (const output of this.access.outputs.values()) ports.push(portInfo(output));
    return ports;
  }

  selectInput(id: string | null) {
    if (!this.access) return false;
    for (const input of this.access.inputs.values()) input.onmidimessage = null;
    this.selectedInputId = null;
    if (!id) return true;
    const input = this.access.inputs.get(id);
    if (!input || input.state !== 'connected') return false;

    input.onmidimessage = event => {
      const message = normalizeMidiMessage(
        input.id,
        event.data,
        event.receivedTime ?? performance.now()
      );
      if (message) this.messageListener?.(message);
    };
    this.selectedInputId = id;
    return true;
  }

  selectOutput(id: string | null) {
    if (!this.access) return false;
    if (!id) {
      this.selectedOutputId = null;
      return true;
    }
    const output = this.access.outputs.get(id);
    if (!output || output.state !== 'connected') return false;
    this.selectedOutputId = id;
    return true;
  }

  getSelection() {
    return {
      inputId: this.selectedInputId,
      outputId: this.selectedOutputId
    };
  }
}
