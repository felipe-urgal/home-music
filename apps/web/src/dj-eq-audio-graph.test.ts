import { describe, expect, it, vi } from 'vitest';
import {
  applyDjEqStateToGraph,
  createDjEqAudioGraph,
  disposeDjEqAudioGraph,
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

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 12.5;
  destination = new FakeNode();
  state: AudioContextState = 'suspended';
  sources: FakeSourceNode[] = [];
  filters: FakeBiquadNode[] = [];
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
}

function fakeAudio() {
  return {} as HTMLAudioElement;
}

describe('DJ EQ audio graph', () => {
  it('cria uma única cadeia por deck com configuração neutra', () => {
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

    expect(context.filters[0]?.type).toBe('lowshelf');
    expect(context.filters[0]?.frequency.value).toBe(220);
    expect(context.filters[1]?.type).toBe('peaking');
    expect(context.filters[1]?.frequency.value).toBe(1_000);
    expect(context.filters[1]?.Q.value).toBe(0.9);
    expect(context.filters[2]?.type).toBe('highshelf');
    expect(context.filters[2]?.frequency.value).toBe(4_000);
    expect(context.filters[3]?.type).toBe('allpass');

    expect(context.sources[0]?.connections).toHaveLength(1);
    expect(context.filters[0]?.connections).toHaveLength(1);
    expect(context.filters[1]?.connections).toHaveLength(1);
    expect(context.filters[2]?.connections).toHaveLength(1);
    expect(context.filters[3]?.connections[0]).toBe(context.destination);
  });

  it('atualiza parâmetros sem reconstruir o graph', () => {
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
    const sourceCount = context.sources.length;
    const filterCount = context.filters.length;

    const startedAt = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      const direction = index % 2 === 0 ? 1 : -1;
      applyDjEqStateToGraph(graph, index % 2 === 0 ? 'a' : 'b', {
        low: direction * 0.5,
        mid: direction * 0.25,
        high: direction * 0.75,
        filter: direction * 0.5
      });
    }
    const durationMs = performance.now() - startedAt;

    expect(context.sources).toHaveLength(sourceCount);
    expect(context.filters).toHaveLength(filterCount);
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
      createMediaElementSource() {
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
