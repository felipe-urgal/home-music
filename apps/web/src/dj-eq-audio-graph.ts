import type { DjDeckId } from './dj-controller-contract';
import {
  djEqFilterParameters,
  djEqGainDb,
  type DjChannelEqState
} from './dj-eq';

type DjEqDeckNodes = {
  source: MediaElementAudioSourceNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  filter: BiquadFilterNode;
};

export type DjEqAudioGraph = {
  context: AudioContext;
  decks: Record<DjDeckId, DjEqDeckNodes>;
};

type AudioContextConstructor = new () => AudioContext;

export function createDjEqAudioGraph(options: {
  deckA: HTMLAudioElement;
  deckB: HTMLAudioElement;
  AudioContextConstructor?: AudioContextConstructor | undefined;
}) {
  const AudioContextCtor = options.AudioContextConstructor;
  if (!AudioContextCtor) return null;

  let context: AudioContext | null = null;
  try {
    context = new AudioContextCtor();

    const createDeckNodes = (audio: HTMLAudioElement): DjEqDeckNodes => {
      const source = context!.createMediaElementSource(audio);
      const low = context!.createBiquadFilter();
      const mid = context!.createBiquadFilter();
      const high = context!.createBiquadFilter();
      const filter = context!.createBiquadFilter();

      low.type = 'lowshelf';
      low.frequency.value = 220;
      low.gain.value = 0;

      mid.type = 'peaking';
      mid.frequency.value = 1_000;
      mid.Q.value = 0.9;
      mid.gain.value = 0;

      high.type = 'highshelf';
      high.frequency.value = 4_000;
      high.gain.value = 0;

      filter.type = 'allpass';
      filter.frequency.value = 1_000;
      filter.Q.value = 0.0001;

      source.connect(low).connect(mid).connect(high).connect(filter).connect(context!.destination);
      return { source, low, mid, high, filter };
    };

    return {
      context,
      decks: {
        a: createDeckNodes(options.deckA),
        b: createDeckNodes(options.deckB)
      }
    } satisfies DjEqAudioGraph;
  } catch {
    if (context) void context.close().catch(() => undefined);
    return null;
  }
}

export function applyDjEqStateToGraph(
  graph: DjEqAudioGraph,
  deck: DjDeckId,
  state: DjChannelEqState
) {
  const nodes = graph.decks[deck];
  const now = graph.context.currentTime;

  nodes.low.gain.setTargetAtTime(djEqGainDb(state.low), now, 0.015);
  nodes.mid.gain.setTargetAtTime(djEqGainDb(state.mid), now, 0.015);
  nodes.high.gain.setTargetAtTime(djEqGainDb(state.high), now, 0.015);

  const filter = djEqFilterParameters(state.filter);
  nodes.filter.type = filter.type;
  nodes.filter.frequency.setTargetAtTime(filter.frequency, now, 0.015);
  nodes.filter.Q.setTargetAtTime(filter.q, now, 0.015);
}

export async function resumeDjEqAudioGraph(graph: DjEqAudioGraph) {
  if (graph.context.state !== 'suspended') return;
  await graph.context.resume().catch(() => undefined);
}

export function disposeDjEqAudioGraph(graph: DjEqAudioGraph | null) {
  if (!graph) return;
  void graph.context.close().catch(() => undefined);
}
