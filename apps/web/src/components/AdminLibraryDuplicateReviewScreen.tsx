import { useEffect, useMemo, useState } from 'react';
import type { AdminLibraryDuplicateReviewResponse } from '@home-music/shared';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Copy,
  EyeOff,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import {
  checkAdminLibraryDuplicates,
  setAdminLibraryDuplicateIgnored,
  type AdminLibraryDuplicateCandidate,
  type AdminLibraryDuplicateConfidence,
  type AdminLibraryDuplicateReason,
  type AdminLibraryDuplicateTrack
} from '../admin-library-client';
import { quarantineAdminTrack } from '../admin-quarantine-client';
import '../admin-duplicates.css';

type AdminLibraryDuplicateReviewScreenProps = {
  onBack: () => void;
};

type DuplicateFilter = 'all' | AdminLibraryDuplicateConfidence | 'ignored';

const CONFIDENCE_LABELS: Record<AdminLibraryDuplicateConfidence, string> = {
  exact: 'Exata',
  probable: 'Provável',
  possible: 'Possível'
};

const REASON_LABELS: Record<AdminLibraryDuplicateReason, string> = {
  hash: 'Mesmo arquivo',
  title: 'Título',
  artist: 'Artista',
  album: 'Álbum',
  duration: 'Duração',
  filename: 'Nome do arquivo'
};

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);
  return `${new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: exponent === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2
  }).format(value)} ${units[exponent]}`;
}

function formatDuration(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return 'Indisponível';
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function rebuildCounts(candidates: AdminLibraryDuplicateCandidate[]) {
  const active = candidates.filter(candidate => !candidate.ignored);
  return {
    reviewable: active.length,
    exact: active.filter(candidate => candidate.confidence === 'exact').length,
    probable: active.filter(candidate => candidate.confidence === 'probable').length,
    possible: active.filter(candidate => candidate.confidence === 'possible').length,
    ignored: candidates.length - active.length
  };
}

function updateIgnoredState(
  review: AdminLibraryDuplicateReviewResponse,
  candidateKey: string,
  ignored: boolean
): AdminLibraryDuplicateReviewResponse {
  const candidates = review.candidates.map(candidate =>
    candidate.key === candidateKey ? { ...candidate, ignored } : candidate
  );
  return { ...review, candidates, counts: rebuildCounts(candidates) };
}

function TrackComparison({ track, label }: { track: AdminLibraryDuplicateTrack; label: string }) {
  return (
    <article className="admin-duplicates__track">
      <span className="admin-duplicates__track-label">{label}</span>
      <strong>{track.title || 'Sem título'}</strong>
      <small>{track.artist || 'Artista desconhecido'}{track.album ? ` · ${track.album}` : ''}</small>
      <dl>
        <div><dt>Duração</dt><dd>{formatDuration(track.durationSeconds)}</dd></div>
        <div><dt>Formato</dt><dd>{track.format || '—'}</dd></div>
        <div><dt>Tamanho</dt><dd>{formatBytes(track.sizeBytes)}</dd></div>
        <div><dt>Caminho</dt><dd title={track.relativePath}>{track.relativePath}</dd></div>
      </dl>
    </article>
  );
}

export function AdminLibraryDuplicateReviewScreen({ onBack }: AdminLibraryDuplicateReviewScreenProps) {
  const [review, setReview] = useState<AdminLibraryDuplicateReviewResponse | null>(null);
  const [filter, setFilter] = useState<DuplicateFilter>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const visibleCandidates = useMemo(() => {
    if (!review) return [];
    return review.candidates.filter(candidate => {
      if (filter === 'ignored') return candidate.ignored;
      if (candidate.ignored) return false;
      if (filter === 'all') return true;
      return candidate.confidence === filter;
    });
  }, [filter, review]);

  const selectedCandidate = useMemo(
    () => review?.candidates.find(candidate => candidate.key === selectedKey) ?? null,
    [review, selectedKey]
  );

  useEffect(() => {
    if (visibleCandidates.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!visibleCandidates.some(candidate => candidate.key === selectedKey)) {
      setSelectedKey(visibleCandidates[0].key);
    }
  }, [selectedKey, visibleCandidates]);

  async function runCheck(options: { preserveFeedback?: boolean } = {}) {
    if (checking) return;
    setChecking(true);
    setError(null);
    if (!options.preserveFeedback) setFeedback(null);
    try {
      const next = await checkAdminLibraryDuplicates();
      setReview(next);
      setFilter('all');
      setSelectedKey(next.candidates.find(candidate => !candidate.ignored)?.key ?? null);
      if (!options.preserveFeedback) {
        setFeedback(
          next.counts.reviewable === 0
            ? 'Análise concluída sem pares que precisem de revisão.'
            : `Análise concluída: ${next.counts.reviewable.toLocaleString('pt-BR')} ${next.counts.reviewable === 1 ? 'par precisa' : 'pares precisam'} de revisão.`
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível analisar duplicatas.');
    } finally {
      setChecking(false);
    }
  }

  async function toggleIgnored(candidate: AdminLibraryDuplicateCandidate) {
    if (mutating) return;
    setMutating(true);
    setError(null);
    setFeedback(null);
    try {
      const nextIgnored = !candidate.ignored;
      await setAdminLibraryDuplicateIgnored(
        [candidate.tracks[0].id, candidate.tracks[1].id],
        nextIgnored
      );
      setReview(current => current ? updateIgnoredState(current, candidate.key, nextIgnored) : current);
      setFeedback(nextIgnored ? 'Par marcado como falso positivo.' : 'Par devolvido para a revisão.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível atualizar a revisão.');
    } finally {
      setMutating(false);
    }
  }

  async function moveToQuarantine(track: AdminLibraryDuplicateTrack) {
    if (mutating || checking) return;
    const confirmed = window.confirm(
      `Mover “${track.title || track.relativePath}” para a lixeira?\n\nO arquivo será colocado em quarentena e poderá ser restaurado pela tela Lixeira. Nada será excluído permanentemente agora.`
    );
    if (!confirmed) return;

    setMutating(true);
    setError(null);
    setFeedback(null);
    try {
      await quarantineAdminTrack(track.id);
      setFeedback('Música movida para a lixeira. A análise foi atualizada.');
      await runCheck({ preserveFeedback: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível mover a música para a lixeira.');
    } finally {
      setMutating(false);
    }
  }

  const hasReview = Boolean(review);
  const hasCandidates = Boolean(review && review.counts.reviewable > 0);
  const statusTitle = checking
    ? 'Analisando biblioteca…'
    : !review
      ? 'Análise ainda não executada'
      : hasCandidates
        ? 'Há pares para revisar'
        : 'Nenhuma duplicata pendente';
  const statusDetail = checking
    ? 'Comparando metadata, duração e candidatos de mesmo tamanho; hashes são lidos somente quando necessários.'
    : !review
      ? 'A verificação é explícita e não altera nenhum arquivo.'
      : hasCandidates
        ? `${review.counts.reviewable.toLocaleString('pt-BR')} ${review.counts.reviewable === 1 ? 'par aguarda' : 'pares aguardam'} decisão humana.`
        : 'Nenhum par ativo foi classificado como duplicata exata, provável ou possível.';

  return (
    <section className="my-account-screen admin-duplicates-screen" aria-labelledby="admin-duplicates-title">
      <header className="my-account-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-duplicates-title">Duplicatas da biblioteca</strong>
          <small>Compare candidatos antes de qualquer ação</small>
        </div>
        <span className="my-account-header__spacer" />
      </header>

      <div className="admin-duplicates">
        <section className={`admin-duplicates__hero${hasCandidates ? ' is-warning' : hasReview ? ' is-success' : ''}`}>
          <div className="admin-duplicates__hero-icon" aria-hidden="true">
            {checking ? <LoaderCircle className="is-spinning" /> : hasCandidates ? <AlertTriangle /> : hasReview ? <ShieldCheck /> : <Search />}
          </div>
          <div className="admin-duplicates__hero-copy">
            <span>Revisão humana</span>
            <strong>{statusTitle}</strong>
            <small>{statusDetail}</small>
            {review && (
              <div className="admin-duplicates__hero-meta">
                <span>Última análise: {formatDate(review.checkedAt)}</span>
                <span>{review.hashComplete ? 'Hashes comparáveis verificados' : 'Hash parcial — revise com cautela'}</span>
              </div>
            )}
          </div>
          <button type="button" className="admin-duplicates__check" disabled={checking || mutating} onClick={() => void runCheck()}>
            {checking ? <LoaderCircle className="is-spinning" /> : <RefreshCw />}
            {checking ? 'Analisando…' : review ? 'Analisar novamente' : 'Analisar agora'}
          </button>
        </section>

        {error && <div className="my-account-message is-error" role="alert">{error}</div>}
        {feedback && <div className="my-account-message is-success" role="status">{feedback}</div>}

        {!review ? (
          <section className="admin-duplicates__empty">
            <Search />
            <strong>Comece com uma análise explícita</strong>
            <span>Nenhum arquivo é alterado durante a detecção. Ações de lixeira só aparecem depois que você seleciona um par.</span>
          </section>
        ) : (
          <>
            <section className="admin-duplicates__metrics" aria-label="Filtrar candidatos por confiança">
              <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>
                <Copy /><span><small>Para revisar</small><strong>{review.counts.reviewable.toLocaleString('pt-BR')}</strong></span>
              </button>
              <button type="button" className={filter === 'exact' ? 'is-active' : ''} onClick={() => setFilter('exact')}>
                <CheckCircle2 /><span><small>Exatas</small><strong>{review.counts.exact.toLocaleString('pt-BR')}</strong></span>
              </button>
              <button type="button" className={filter === 'probable' ? 'is-active' : ''} onClick={() => setFilter('probable')}>
                <AlertTriangle /><span><small>Prováveis</small><strong>{review.counts.probable.toLocaleString('pt-BR')}</strong></span>
              </button>
              <button type="button" className={filter === 'possible' ? 'is-active' : ''} onClick={() => setFilter('possible')}>
                <Search /><span><small>Possíveis</small><strong>{review.counts.possible.toLocaleString('pt-BR')}</strong></span>
              </button>
              <button type="button" className={filter === 'ignored' ? 'is-active' : ''} onClick={() => setFilter('ignored')}>
                <EyeOff /><span><small>Ignorados</small><strong>{review.counts.ignored.toLocaleString('pt-BR')}</strong></span>
              </button>
            </section>

            <div className="admin-duplicates__workspace">
              <section className="admin-duplicates__list" aria-label="Pares candidatos">
                <header>
                  <div>
                    <span>Candidatos</span>
                    <strong>{visibleCandidates.length.toLocaleString('pt-BR')} {visibleCandidates.length === 1 ? 'par' : 'pares'}</strong>
                  </div>
                </header>

                {visibleCandidates.length === 0 ? (
                  <div className="admin-duplicates__list-empty">
                    <CheckCircle2 />
                    <span>Nenhum par neste filtro.</span>
                  </div>
                ) : (
                  <div className="admin-duplicates__items">
                    {visibleCandidates.map(candidate => (
                      <button
                        type="button"
                        key={candidate.key}
                        className={candidate.key === selectedKey ? 'is-active' : ''}
                        aria-pressed={candidate.key === selectedKey}
                        onClick={() => setSelectedKey(candidate.key)}
                      >
                        <span className={`admin-duplicates__confidence is-${candidate.confidence}`}>
                          {candidate.ignored ? 'Ignorado' : CONFIDENCE_LABELS[candidate.confidence]}
                        </span>
                        <strong>{candidate.tracks[0].title || 'Sem título'}</strong>
                        <small>{candidate.tracks[0].artist || 'Artista desconhecido'} · {candidate.tracks[1].title || 'Sem título'}</small>
                        <span className="admin-duplicates__reason-summary">
                          {candidate.reasons.map(reason => REASON_LABELS[reason]).join(' · ')}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <aside className="admin-duplicates__inspector" aria-label="Comparação do par selecionado">
                {!selectedCandidate ? (
                  <div className="admin-duplicates__inspector-empty">
                    <Search />
                    <span>Selecione um par para comparar os detalhes.</span>
                  </div>
                ) : (
                  <>
                    <header className="admin-duplicates__inspector-header">
                      <div>
                        <span>Comparação</span>
                        <strong>{selectedCandidate.ignored ? 'Falso positivo ignorado' : `${CONFIDENCE_LABELS[selectedCandidate.confidence]} duplicata`}</strong>
                      </div>
                      <span className={`admin-duplicates__confidence is-${selectedCandidate.confidence}`}>
                        {CONFIDENCE_LABELS[selectedCandidate.confidence]}
                      </span>
                    </header>

                    <div className="admin-duplicates__reasons">
                      <span>Por que apareceu</span>
                      <div>{selectedCandidate.reasons.map(reason => <strong key={reason}>{REASON_LABELS[reason]}</strong>)}</div>
                    </div>

                    <div className="admin-duplicates__comparison">
                      <TrackComparison track={selectedCandidate.tracks[0]} label="Música A" />
                      <TrackComparison track={selectedCandidate.tracks[1]} label="Música B" />
                    </div>

                    <div className="admin-duplicates__actions">
                      <button
                        type="button"
                        className="admin-duplicates__ignore"
                        disabled={mutating || checking}
                        onClick={() => void toggleIgnored(selectedCandidate)}
                      >
                        {selectedCandidate.ignored ? <RotateCcw /> : <EyeOff />}
                        {selectedCandidate.ignored ? 'Reabrir revisão' : 'Ignorar falso positivo'}
                      </button>

                      {!selectedCandidate.ignored && (
                        <div className="admin-duplicates__quarantine">
                          <span>Nenhuma exclusão é feita aqui. Se você decidir remover uma cópia, ela vai primeiro para a lixeira.</span>
                          {selectedCandidate.tracks.map((track, index) => (
                            <button
                              type="button"
                              key={track.id}
                              disabled={mutating || checking}
                              onClick={() => void moveToQuarantine(track)}
                            >
                              {mutating ? <LoaderCircle className="is-spinning" /> : <Trash2 />}
                              Mover música {index === 0 ? 'A' : 'B'} para lixeira
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </aside>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
