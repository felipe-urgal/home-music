import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cpu, LoaderCircle, Search, Square } from 'lucide-react';
import type {
  LocalLyricsCapabilityResponse,
  LocalLyricsEligibleTrack,
  LocalLyricsJob
} from '@home-music/shared/library-assistant';
import {
  cancelLocalLyricsJob,
  getLocalLyricsCapability,
  getLocalLyricsEligibleTracks,
  getLocalLyricsJob,
  startLocalLyricsJob
} from '../library-assistant-client';
import './admin-local-lyrics-panel.css';

type Props = {
  onReviewReady: () => void | Promise<void>;
};

const TERMINAL = new Set<LocalLyricsJob['status']>(['review', 'failed', 'cancelled']);

function timestamp(value: number | null) {
  if (value == null) return '--:--';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function actionLabel(track: LocalLyricsEligibleTrack) {
  return track.action === 'align' ? 'Sincronizar localmente' : 'Transcrever localmente';
}

export function AdminLocalLyricsPanel({ onReviewReady }: Props) {
  const [capability, setCapability] = useState<LocalLyricsCapabilityResponse | null>(null);
  const [tracks, setTracks] = useState<LocalLyricsEligibleTrack[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [languageHint, setLanguageHint] = useState('');
  const [job, setJob] = useState<LocalLyricsJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const reviewNotified = useRef<string | null>(null);

  const load = useCallback(async (search = '') => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const nextCapability = await getLocalLyricsCapability();
      if (version !== requestVersion.current) return;
      setCapability(nextCapability);
      if (!nextCapability.available) {
        setTracks([]);
        setSelectedId('');
        return;
      }
      const response = await getLocalLyricsEligibleTracks(search, 50);
      if (version !== requestVersion.current) return;
      setTracks(response.tracks);
      setSelectedId(current => (
        response.tracks.some(track => track.id === current)
          ? current
          : response.tracks[0]?.id ?? ''
      ));
    } catch (reason) {
      if (version === requestVersion.current) {
        setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o Whisper local.');
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]);

  useEffect(() => {
    if (!job || TERMINAL.has(job.status)) return undefined;
    let active = true;
    const timer = window.setInterval(() => {
      void getLocalLyricsJob(job.id).then(response => {
        if (!active) return;
        setJob(response.job);
      }).catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Falha ao acompanhar o job local.');
      });
    }, 1_500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (job?.status !== 'review' || reviewNotified.current === job.id) return;
    reviewNotified.current = job.id;
    void Promise.resolve(onReviewReady());
  }, [job, onReviewReady]);

  const selected = tracks.find(track => track.id === selectedId) ?? null;
  const active = Boolean(job && !TERMINAL.has(job.status));

  async function start() {
    if (!selected || mutating) return;
    setMutating(true);
    setError(null);
    try {
      const response = await startLocalLyricsJob({
        trackId: selected.id,
        mode: selected.action,
        languageHint: languageHint.trim() || null
      });
      reviewNotified.current = null;
      setJob(response.job);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar o processamento local.');
    } finally {
      setMutating(false);
    }
  }

  async function cancel() {
    if (!job || mutating) return;
    setMutating(true);
    setError(null);
    try {
      const response = await cancelLocalLyricsJob(job.id);
      setJob(response.job);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível cancelar o processamento local.');
    } finally {
      setMutating(false);
    }
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    await load(query.trim());
  }

  return (
    <section className="local-lyrics-panel" aria-labelledby="local-lyrics-title">
      <div className="local-lyrics-panel__header">
        <div>
          <span className="local-lyrics-panel__eyebrow"><Cpu size={14} /> Processamento local opcional</span>
          <h3 id="local-lyrics-title">Whisper para lyrics</h3>
          <p>Transcreve faixas sem letra ou sincroniza uma letra plain. O resultado nunca é aplicado automaticamente.</p>
        </div>
        <div className="local-lyrics-panel__warning">
          <AlertTriangle size={16} />
          <span>Usa CPU e pode levar alguns minutos. O áudio não sai deste servidor.</span>
        </div>
      </div>

      {loading && !capability ? (
        <div className="local-lyrics-panel__state"><LoaderCircle className="is-spinning" /> Verificando capacidade local…</div>
      ) : capability && !capability.available ? (
        <div className="local-lyrics-panel__state is-warning">
          <AlertTriangle />
          <div><strong>Whisper local indisponível</strong><span>{capability.action}</span></div>
        </div>
      ) : (
        <>
          <form className="local-lyrics-panel__controls" onSubmit={search}>
            <label>
              <span>Faixa elegível</span>
              <select value={selectedId} onChange={event => setSelectedId(event.target.value)} disabled={active || loading}>
                {tracks.length === 0 && <option value="">Nenhuma faixa elegível</option>}
                {tracks.map(track => (
                  <option key={track.id} value={track.id}>{track.title} — {track.artist}</option>
                ))}
              </select>
            </label>
            <label className="local-lyrics-panel__language">
              <span>Idioma (opcional)</span>
              <input
                value={languageHint}
                onChange={event => setLanguageHint(event.target.value.replace(/[^A-Za-z]/g, '').slice(0, 3))}
                placeholder="auto"
                disabled={active}
                aria-label="Dica opcional de idioma"
              />
            </label>
            <label className="local-lyrics-panel__search">
              <span>Filtrar faixas</span>
              <div><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Título, artista ou álbum" /><button type="submit" disabled={active || loading}><Search size={16} /></button></div>
            </label>
            {!active ? (
              <button className="local-lyrics-panel__primary" type="button" onClick={() => void start()} disabled={!selected || mutating}>
                {mutating && <LoaderCircle className="is-spinning" />}
                {selected ? actionLabel(selected) : 'Selecionar faixa'}
              </button>
            ) : (
              <button className="local-lyrics-panel__cancel" type="button" onClick={() => void cancel()} disabled={mutating}>
                <Square size={14} /> Cancelar
              </button>
            )}
          </form>

          {job && (
            <div className={`local-lyrics-panel__job is-${job.status}`}>
              <div className="local-lyrics-panel__job-title">
                {job.status === 'review' ? <CheckCircle2 /> : job.status === 'failed' ? <AlertTriangle /> : !TERMINAL.has(job.status) ? <LoaderCircle className="is-spinning" /> : <Square />}
                <div>
                  <strong>{job.stage}</strong>
                  <span>{job.status === 'review' ? 'A sugestão foi adicionada à revisão do Assistente.' : job.error || 'Processando apenas neste servidor.'}</span>
                </div>
              </div>
              {job.quality && (
                <div className="local-lyrics-panel__quality">
                  <span>Cobertura <strong>{Math.round(job.quality.coverage * 100)}%</strong></span>
                  <span>Alinhadas <strong>{job.quality.alignedLines}</strong></span>
                  <span>Incertas <strong>{job.quality.lowConfidenceLines + job.quality.unalignedLines}</strong></span>
                </div>
              )}
              {job.previewLines.length > 0 && (
                <div className="local-lyrics-panel__preview" aria-label="Prévia da letra local">
                  {job.previewLines.slice(0, 12).map((line, index) => (
                    <div key={`${line.time}-${index}`} className={`is-${line.state}`}>
                      <time>{timestamp(line.time)}</time><span>{line.text}</span>
                    </div>
                  ))}
                  {job.previewLines.length > 12 && <small>Prévia limitada; a revisão usa o candidato completo.</small>}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {error && <div className="local-lyrics-panel__error" role="alert">{error}</div>}
    </section>
  );
}
