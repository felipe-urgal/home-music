import { describe, expect, it, vi } from 'vitest';
import {
  applyDjEqStateToGraph,
  applyDjFxStateToGraph,
  createDjEqAudioGraph,
  disposeDjEqAudioGraph,
  readDjEqMeterLevel,
  resumeDjEqAudioGraph
} from './dj-eq-audio-graph';

class FakeAudioParam {
  value = 0;
  updates: Array<{ value: number; startTime: number; timeConstant: number }> = [];

  setTargetAtTime(value: number, startTime: number, timeConstant: number) {
    this.updates.push({ value, startTime, timeConstant });
    this.value = value;
    return this as unknown as AudioParam;
  }
}

class FakeNode {
  connections: FakeNode[] = [];

  connect(node: FakeNode) {
    this.connections.push(node);
    return node;
  }
}

class FakeSourceNode extends FakeNode {}

class FakeBiquadNode extends FakeNode {
  type: BiquadFilterType = 'lowpass';
  frequency = new FakeAudioParam();
  Q = new FakeAudioParam();
  gain = new FakeAudioParam();
}

class FakeGainNode extends FakeNode {
  gain = new FakeAudioParam();
}

class FakeDelayNode extends FakeNode {
  delayTime = new FakeAudioParam();
}

class FakeConvolverNode extends FakeNode {
  buffer: AudioBuffer | null = null;
}

class FakeAnalyserNode extends FakeNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  level = 128;

  getByteTimeDomainData(data: Uint8Array<ArrayBuffer>) {
    data.fill(this.level);
  }
}

class FakeAudioBuffer {
  readonly numberOfChannels: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number) {
    this.numberOfChannels = numberOfChannels;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number) {
    return this.channels[channel]!;
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 12.5;
  sampleRate = 48_000;
  destination = new FakeNode();
  state: AudioContextState = 'suspended';
  sources: FakeSourceNode[] = [];
  filters: FakeBiquadNode[] = [];
  gains: FakeGainNode[] = [];
  delays: FakeDelayNode[] = [];
  convolvers: FakeConvolverNode[] = [];
  analysers: FakeAnalyserNode[] = [];
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  resume = vi.fn(async () => {
    this.state = 'running';
  });

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createMediaElementSource() {
    const node = new FakeSourceNode();
    this.sources.push(node);
    return node as unknown as MediaElementAudioSourceNode;
  }

  createBiquadFilter() {
    const node = new FakeBiquadNode();
    this.filters.push(node);
    return node as unknown as BiquadFilterNode;
  }

  createGain() {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node as unknown as GainNode;
  }

  createDelay() {
    const node = new FakeDelayNode();
    this.delays.push(node);
    return node as unknown as DelayNode;
  }

  createConvolver() {
    const node = new FakeConvolverNode();
    this.convolvers.push(node);
    return node as unknown as ConvolverNode;
  }

  createAnalyser() {
    const node = new FakeAnalyserNode();
    this.analysers.push(node);
    return node as unknown as AnalyserNode;
  }

  createBuffer(numberOfChannels: number, length: number) {
    return new FakeAudioBuffer(numberOfChannels, length) as unknown as AudioBuffer;
  }
}

function fakeAudio() {
  return {} as HTMLAudioElement;
}

describe('DJ EQ/FX audio graph', () => {
  it('cria uma única cadeia por deck com EQ e FX neutros', () => {
    FakeAudioContext.instances = [];
    const graph = createDjEqAudioGraph({
      deckA: fakeAudio(),
      deckB: fakeAudio(),
      AudioContextConstructor: FakeAudioContext as unknown as new () => AudioContext
    });

    expect(graph).not.toBeNull();
    const context = FakeAudioContext.instances[0]!;
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(context.sources).toHaveLength(2);
    expect(context.filters).toHaveLength(8);
    expect(context.gains).toHaveLength(8);
    expect(context.delays).toHaveLength(2);
    expect(context.convolvers).toHaveLength(2);
    expect(context.analysers).toHaveLength(2);

    expect(context.filters[0]?.type).toBe('lowshelf');
    expect(context.filters[0]?.frequency.value).toBe(220);
    expect(context.filters[1]?.type).toBe('peaking');
    expect(context.filters[1]?.frequency.value).toBe(1_000);
    expect(context.filters[1]?.Q.value).toBe(0.9);
    expect(context.filters[2]?.type).toBe('highshelf');
    expect(context.filters[2]?.frequency.value).toBe(4_000);
    expect(context.filters[3]?.type).toBe('allpass');

    expect(graph!.decks.a.dry.gain.value).toBe(1);
    expect(graph!.decks.a.echoWet.gain.value).toBe(0);
    expect(graph!.decks.a.echoFeedback.gain.value).toBe(0);
    expect(graph!.decks.a.reverbWet.gain.value).toBe(0);
    expect(graph!.decks.a.echoDelay.delayTime.value).toBe(0.25);
    expect(graph!.decks.a.reverb.buffer).not.toBeNull();

    expect(context.sources[0]?.connections).toContain(context.filters[0]!);
    expect(context.filters[3]?.connections).toHaveLength(3);
    expect(graph!.decks.a.analyser.connections[0]).toBe(context.destination);
  });

  it('atualiza EQ sem reconstruir o graph', () => {
    FakeAudioContext.instances = [];
    const graph = createDjEqAudioGraph({
      deckA: fakeAudio(),
      deckB: fakeAudio(),
      AudioContextConstructor: FakeAudioContext as unknown as new () => AudioContext
    })!;
    const context = FakeAudioContext.instances[0]!;
    const sourceCount = context.sources.length;
    const filterCount = context.filters.length;

    applyDjEqStateToGraph(graph, 'a', {
      low: 0.5,
      mid: -0.25,
      high: 1,
      filter: -0.5
    });
    applyDjEqStateToGraph(graph, 'a', {
      low: 0,
      mid: 0,
      high: 0,
      filter: 0
    });

    expect(context.sources).toHaveLength(sourceCount);
    expect(context.filters).toHaveLength(filterCount);
    expect(context.filters[0]?.gain.value).toBe(0);
    expect(context.filters[1]?.gain.value).toBe(0);
    expect(context.filters[2]?.gain.value).toBe(0);
    expect(context.filters[3]?.type).toBe('allpass');
    expect(context.filters[3]?.frequency.value).toBe(1_000);
  });

  it('aplica Echo e Reverb sem rebuild e faz bypass real por ganho', () => {
    FakeAudioContext.instances = [];
    const graph = createDjEqAudioGraph({
      deckA: fakeAudio(),
      deckB: fakeAudio(),
      AudioContextConstructor: FakeAudioContext as unknown as new () => AudioContext
    })!;
    const context = FakeAudioContext.instances[0]!;
    const sourceCount = context.sources.length;
    const gainCount = context.gains.length;
    const delayCount = context.delays.length;
    const convolverCount = context.convolvers.length;

    applyDjFxStateToGraph(graph, 'a', {
      echo: {
        enabled: true,
        wet: 0.44,
        feedback: 0.35,
        delaySeconds: 0.5
      },
      reverb: {
        enabled: true,
        wet: 0.3
      }
    });

    expect(graph.decks.a.dry.gain.value).toBeCloseTo(0.56);
    expect(graph.decks.a.echoDelay.delayTime.value).toBe(0.5);
    expect(graph.decks.a.echoWet.gain.value).toBe(0.44);
    expect(graph.decks.a.echoFeedback.gain.value).toBe(0.35);
    expect(graph.decks.a.reverbWet.gain.value).toBe(0.3);
    expect(graph.decks.b.echoWet.gain.value).toBe(0);
    expect(graph.decks.b.reverbWet.gain.value).toBe(0);

    applyDjFxStateToGraph(graph, 'a', {
      echo: {
        enabled: false,
        wet: 0.44,
        feedback: 0.35,
        delaySeconds: 0.5
      },
      reverb: {
        enabled: false,
        wet: 0.3
      }
    });

    expect(graph.decks.a.dry.gain.value).toBe(1);
    expect(graph.decks.a.echoWet.gain.value).toBe(0);
    expect(graph.decks.a.echoFeedback.gain.value).toBe(0);
    expect(graph.decks.a.reverbWet.gain.value).toBe(0);
    expect(context.sources).toHaveLength(sourceCount);
    expect(context.gains).toHaveLength(gainCount);
    expect(context.delays).toHaveLength(delayCount);
    expect(context.convolvers).toHaveLength(convolverCount);
  });

  it('mantém decks independentes', () => {
    FakeAudioContext.instances = [];
    const graph = createDjEqAudioGraph({
      deckA: fakeAudio(),
      deckB: fakeAudio(),
      AudioContextConstructor: FakeAudioContext as unknown as new () => AudioContext
    })!;

    applyDjEqStateToGraph(graph, 'a', {
      low: 1,
      mid: 0,
      high: 0,
      filter: 0
    });

    expect((graph.decks.a.low.gain as unknown as FakeAudioParam).value).toBe(18);
    expect((graph.decks.b.low.gain as unknown as FakeAudioParam).value).toBe(0);
  });

  it('mede nível RMS sem alocar outro graph', () => {
    FakeAudioContext.instances = [];
    const graph = createDjEqAudioGraph({
      deckA: fakeAudio(),
      deckB: fakeAudio(),
      AudioContextConstructor: FakeAudioContext as unknown as new () => AudioContext
    })!;
    const context = FakeAudioContext.instances[0]!;
    const sourceCount = context.sources.length;
    const filterCount = context.filters.length;

    expect(readDjEqMeterLevel(graph, 'a')).toBe(0);
    context.analysers[0]!.level = 160;
    expect(readDjEqMeterLevel(graph, 'a')).toBeGreaterThan(0);
    expect(context.sources).toHaveLength(sourceCount);
    expect(context.filters).toHaveLength(filterCount);
  });

  it('faz resume somente quando o contexto está suspenso', async () => {
    FakeAudioContext.instances = [];
    const graph = createDjEqAudioGraph({
      deckA: fakeAudio(),
      deckB: fakeAudio(),
      AudioContextConstructor: FakeAudioContext as unknown as new () => AudioContext
    })!;
    const context = FakeAudioContext.instances[0]!;

    await resumeDjEqAudioGraph(graph);
    await resumeDjEqAudioGraph(graph);

    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  it('mantém custo de atualização previsível sem alocar novos nodes', () => {
    FakeAudioContext.instances = [];
    const graph = createDjEqAudioGraph({
      deckA: fakeAudio(),
      deckB: fakeAudio(),
      AudioContextConstructor: FakeAudioContext as unknown as new () => AudioContext
    })!;
    const context = FakeAudioContext.instances[0]!;
    const counts = {
      sources: context.sources.length,
      filters: context.filters.length,
      gains: context.gains.length,
      delays: context.delays.length,
      convolvers: context.convolvers.length
    };

    const startedAt = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      const direction = index % 2 === 0 ? 1 : -1;
      const deck = index % 2 === 0 ? 'a' : 'b';
      applyDjEqStateToGraph(graph, deck, {
        low: direction * 0.5,
        mid: direction * 0.25,
        high: direction * 0.75,
        filter: direction * 0.5
      });
      applyDjFxStateToGraph(graph, deck, {
        echo: {
          enabled: index % 3 !== 0,
          wet: 0.4,
          feedback: 0.3,
          delaySeconds: 0.25
        },
        reverb: {
          enabled: index % 5 !== 0,
          wet: 0.25
        }
      });
    }
    const durationMs = performance.now() - startedAt;

    expect(context.sources).toHaveLength(counts.sources);
    expect(context.filters).toHaveLength(counts.filters);
    expect(context.gains).toHaveLength(counts.gains);
    expect(context.delays).toHaveLength(counts.delays);
    expect(context.convolvers).toHaveLength(counts.convolvers);
    expect(durationMs).toBeLessThan(1_000);
  });

  it('fecha o contexto no cleanup', () => {
    FakeAudioContext.instances = [];
    const graph = createDjEqAudioGraph({
      deckA: fakeAudio(),
      deckB: fakeAudio(),
      AudioContextConstructor: FakeAudioContext as unknown as new () => AudioContext
    })!;
    const context = FakeAudioContext.instances[0]!;

    disposeDjEqAudioGraph(graph);

    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('degrada sem Web Audio e fecha contexto criado parcialmente quando a montagem falha', () => {
    expect(createDjEqAudioGraph({
      deckA: fakeAudio(),
      deckB: fakeAudio()
    })).toBeNull();

    class FailingAudioContext extends FakeAudioContext {
      createMediaElementSource(): MediaElementAudioSourceNode {
        throw new Error('unsupported');
      }
    }

    FakeAudioContext.instances = [];
    const graph = createDjEqAudioGraph({
      deckA: fakeAudio(),
      deckB: fakeAudio(),
      AudioContextConstructor: FailingAudioContext as unknown as new () => AudioContext
    });

    expect(graph).toBeNull();
    expect(FakeAudioContext.instances[0]?.close).toHaveBeenCalledTimes(1);
  });
});
