import type { DjDeckId } from './dj-controller-contract';
import {
  djEqFilterParameters,
  djEqGainDb,
  type DjChannelEqState
} from './dj-eq';
import { resolveDjFxDryGain, type DjDeckFxState } from './dj-fx';

type DjEqDeckNodes = {
  source: MediaElementAudioSourceNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  filter: BiquadFilterNode;
  dry: GainNode;
  echoDelay: DelayNode;
  echoWet: GainNode;
  echoFeedback: GainNode;
  reverb: ConvolverNode;
  reverbWet: GainNode;
  analyser: AnalyserNode;
  output: GainNode;
  meterData: Uint8Array<ArrayBuffer>;
};

export type DjEqAudioGraph = {
  context: AudioContext;
  master: GainNode;
  decks: Record<DjDeckId, DjEqDeckNodes>;
};

type AudioContextConstructor = new () => AudioContext;

function createReverbImpulse(context: AudioContext) {
  const seconds = 1.35;
  const frameCount = Math.max(1, Math.floor(context.sampleRate * seconds));
  const impulse = context.createBuffer(2, frameCount, context.sampleRate);

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < frameCount; index += 1) {
      const progress = index / frameCount;
      data[index] = ((Math.random() * 2) - 1) * Math.pow(1 - progress, 2.6);
    }
  }

  return impulse;
}

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
    const reverbImpulse = createReverbImpulse(context);
    const master = context.createGain();
    master.gain.value = 1;
    master.connect(context.destination);

    const createDeckNodes = (audio: HTMLAudioElement): DjEqDeckNodes => {
      const source = context!.createMediaElementSource(audio);
      const low = context!.createBiquadFilter();
      const mid = context!.createBiquadFilter();
      const high = context!.createBiquadFilter();
      const filter = context!.createBiquadFilter();
      const dry = context!.createGain();
      const echoDelay = context!.createDelay(1.5);
      const echoWet = context!.createGain();
      const echoFeedback = context!.createGain();
      const reverb = context!.createConvolver();
      const reverbWet = context!.createGain();
      const analyser = context!.createAnalyser();
      const output = context!.createGain();

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

      dry.gain.value = 1;
      echoDelay.delayTime.value = 0.25;
      echoWet.gain.value = 0;
      echoFeedback.gain.value = 0;
      reverb.buffer = reverbImpulse;
      reverbWet.gain.value = 0;

      output.gain.value = 1;
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      const meterData = new Uint8Array(new ArrayBuffer(analyser.fftSize));

      source.connect(low).connect(mid).connect(high).connect(filter);
      filter.connect(dry).connect(analyser);

      filter.connect(echoDelay);
      echoDelay.connect(echoWet).connect(analyser);
      echoDelay.connect(echoFeedback).connect(echoDelay);

      filter.connect(reverb).connect(reverbWet).connect(analyser);
      analyser.connect(output).connect(master);

      return {
        source,
        low,
        mid,
        high,
        filter,
        dry,
        echoDelay,
        echoWet,
        echoFeedback,
        reverb,
        reverbWet,
        analyser,
        output,
        meterData
      };
    };

    return {
      context,
      master,
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

export function applyDjFxStateToGraph(
  graph: DjEqAudioGraph,
  deck: DjDeckId,
  state: DjDeckFxState
) {
  const nodes = graph.decks[deck];
  const now = graph.context.currentTime;

  nodes.dry.gain.setTargetAtTime(resolveDjFxDryGain(state), now, 0.015);
  nodes.echoDelay.delayTime.setTargetAtTime(state.echo.delaySeconds, now, 0.015);
  nodes.echoFeedback.gain.setTargetAtTime(
    state.echo.enabled ? state.echo.feedback : 0,
    now,
    0.015
  );
  nodes.echoWet.gain.setTargetAtTime(
    state.echo.enabled ? state.echo.wet : 0,
    now,
    0.015
  );
  nodes.reverbWet.gain.setTargetAtTime(
    state.reverb.enabled ? state.reverb.wet : 0,
    now,
    0.015
  );
}

export function applyDjOutputGainToGraph(
  graph: DjEqAudioGraph,
  deck: DjDeckId,
  gain: number
) {
  const normalized = Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 0;
  graph.decks[deck].output.gain.setTargetAtTime(normalized, graph.context.currentTime, 0.01);
}

export type DjMasterRecordingOutput = {
  stream: MediaStream;
  dispose: () => void;
};

export function createDjMasterRecordingOutput(graph: DjEqAudioGraph): DjMasterRecordingOutput | null {
  const factory = graph.context.createMediaStreamDestination;
  if (typeof factory !== 'function') return null;

  let destination: MediaStreamAudioDestinationNode;
  try {
    destination = factory.call(graph.context);
    graph.master.connect(destination);
  } catch {
    return null;
  }

  let disposed = false;
  return {
    stream: destination.stream,
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        graph.master.disconnect(destination);
      } catch {
        // Já desconectado pelo browser.
      }
      for (const track of destination.stream.getTracks()) track.stop();
    }
  };
}

export function readDjEqMeterLevel(graph: DjEqAudioGraph, deck: DjDeckId) {
  const nodes = graph.decks[deck];
  nodes.analyser.getByteTimeDomainData(nodes.meterData);
  let sumSquares = 0;
  for (const sample of nodes.meterData) {
    const normalized = (sample - 128) / 128;
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, nodes.meterData.length));
  return Math.max(0, Math.min(1, rms * 3.2));
}

export async function resumeDjEqAudioGraph(graph: DjEqAudioGraph) {
  if (graph.context.state !== 'suspended') return;
  await graph.context.resume().catch(() => undefined);
}

export function disposeDjEqAudioGraph(graph: DjEqAudioGraph | null) {
  if (!graph) return;
  void graph.context.close().catch(() => undefined);
}
