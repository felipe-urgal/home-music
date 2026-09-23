import { useEffect, useMemo, useState } from 'react';
import type { AdminLibraryDuplicateReviewResponse } from '@home-music/shared';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  Copy,
  EyeOff,
  Info,
  Link2,
  LoaderCircle,
  Music2,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2
} from 'lucide-react';
import {
  checkAdminLibraryDuplicates,
  getAdminLibraryDuplicates,
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
  hash: 'Mesmo hash SHA-256',
  title: 'Mesmo título',
  artist: 'Mesmo artista',
  album: 'Mesmo álbum',
  duration: 'Mesma duração',
  filename: 'Mesmo nome de arquivo'
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

function TrackCover({ track }: { track: AdminLibraryDuplicateTrack }) {
  return (
    <div className="admin-duplicates__cover" aria-hidden="true">
      <Music2 />
      <img
        src={`/api/tracks/${encodeURIComponent(track.id)}/cover`}
        alt=""
        onError={event => { event.currentTarget.style.display = 'none'; }}
      />
    </div>
  );
}

function TrackComparison({ track }: { track: AdminLibraryDuplicateTrack }) {
  return (
    <article className="admin-duplicates__track">
      <div className="admin-duplicates__track-head">
        <TrackCover track={track} />
        <div>
          <strong>{track.title || 'Sem título'}</strong>
          <small>{track.artist || 'Artista desconhecido'}</small>
        </div>
      </div>
      <dl>
        <div><dt>Duração</dt><dd>{formatDuration(track.durationSeconds)}</dd></div>
        <div><dt>Álbum</dt><dd>{track.album || '(não informado)'}</dd></div>
        <div><dt>Formato</dt><dd>{track.format || '—'}</dd></div>
        <div><dt>Tamanho</dt><dd>{formatBytes(track.sizeBytes)}</dd></div>
        <div><dt>Caminho</dt><dd title={track.relativePath}>{track.relativePath}</dd></div>
      </dl>
    </article>
  );
}

export function AdminLibraryDuplicateReviewScreen({ onBack }: AdminLibraryDuplicateReviewScreenProps) {
  const [review, setReview] = useState<AdminLibraryDuplicateReviewResponse | null>(null);
  const [loadingReview, setLoadingReview] = useState(true);
  const [filter, setFilter] = useState<DuplicateFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const visibleCandidates = useMemo(() => {
    if (!review) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
    return review.candidates.filter(candidate => {
      if (filter === 'ignored') {
        if (!candidate.ignored) return false;
      } else {
        if (candidate.ignored) return false;
        if (filter !== 'all' && candidate.confidence !== filter) return false;
      }
      if (!normalizedQuery) return true;
      return candidate.tracks.some(track =>
        [track.title, track.artist, track.album, track.relativePath, track.format]
          .some(value => value.toLocaleLowerCase('pt-BR').includes(normalizedQuery))
      );
    });
  }, [filter, query, review]);

  const selectedCandidate = useMemo(
    () => review?.candidates.find(candidate => candidate.key === selectedKey) ?? null,
    [review, selectedKey]
  );

  useEffect(() => {
    let active = true;
    void getAdminLibraryDuplicates()
      .then(next => {
        if (!active) return;
        setReview(next);
        setSelectedKey(next?.candidates.find(candidate => !candidate.ignored)?.key ?? next?.candidates[0]?.key ?? null);
      })
      .catch(caught => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : 'Não foi possível carregar a última análise de duplicatas.');
      })
      .finally(() => {
        if (active) setLoadingReview(false);
      });
    return () => { active = false; };
  }, []);

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
      setQuery('');
      setSelectedKey(next.candidates.find(candidate => !candidate.ignored)?.key ?? next.candidates[0]?.key ?? null);
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
  const staleReview = Boolean(review?.stale);

  const statusTitle = checking
    ? 'Analisando biblioteca…'
    : loadingReview
      ? 'Carregando última análise…'
      : !review
        ? 'Análise ainda não executada'
        : staleReview
          ? 'Análise desatualizada'
          : hasCandidates
            ? `${review.counts.reviewable.toLocaleString('pt-BR')} ${review.counts.reviewable === 1 ? 'par precisa' : 'pares precisam'} de revisão`
            : 'Nenhuma duplicata pendente';

  const statusDetail = checking
    ? 'Comparando metadados, duração e conteúdo dos arquivos.'
    : loadingReview
      ? 'Recuperando o último diagnóstico salvo.'
      : !review
        ? 'A análise é somente leitura e não altera nenhum arquivo.'
        : staleReview
          ? 'A biblioteca mudou desde esta análise. Execute novamente antes de decidir sobre os pares.'
          : hasCandidates
            ? 'Nada será removido sem sua confirmação. Revise os candidatos e decida o que fazer.'
            : 'A última análise não encontrou pares que precisem de revisão.';

  const tabs: Array<{ id: DuplicateFilter; label: string; count: number }> = review ? [
    { id: 'all', label: 'Todos', count: review.counts.reviewable },
    { id: 'exact', label: 'Exatas', count: review.counts.exact },
    { id: 'probable', label: 'Prováveis', count: review.counts.probable },
    { id: 'possible', label: 'Possíveis', count: review.counts.possible },
    { id: 'ignored', label: 'Ignoradas', count: review.counts.ignored }
  ] : [];

  return (
    <section className="my-account-screen admin-duplicates-screen admin-duplicates-screen--v2" aria-labelledby="admin-duplicates-title">
      <header className="admin-duplicates__page-header">
        <button className="admin-duplicates__back" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-duplicates-title">Duplicatas da biblioteca</strong>
          <small>Compare músicas semelhantes antes de qualquer ação</small>
        </div>
        <div className={`admin-duplicates__analysis-state ${review && !staleReview ? 'is-current' : staleReview ? 'is-stale' : ''}`}>
          <span />
          <div>
            <strong>{staleReview ? 'Análise desatualizada' : review ? 'Análise atual' : 'Aguardando análise'}</strong>
            <small>{review ? (review.hashComplete ? 'Hash completo' : 'Hash parcial') : 'Sem diagnóstico salvo'}</small>
          </div>
        </div>
      </header>

      <div className="admin-duplicates">
        {error && <div className="my-account-message is-error" role="alert">{error}</div>}
        {feedback && <div className="my-account-message is-success" role="status">{feedback}</div>}

        <section className={`admin-duplicates__hero${hasCandidates || staleReview ? ' is-warning' : hasReview ? ' is-success' : ''}`}>
          <div className="admin-duplicates__hero-icon" aria-hidden="true">
            {checking ? <LoaderCircle className="is-spinning" /> : hasCandidates || staleReview ? <AlertTriangle /> : hasReview ? <Check /> : <Search />}
          </div>
          <div className="admin-duplicates__hero-copy">
            <strong>{statusTitle}</strong>
            <small>{statusDetail}</small>
          </div>
          {review && (
            <div className="admin-duplicates__hero-meta">
              <CalendarDays />
              <div>
                <small>Última análise</small>
                <strong>{formatDate(review.checkedAt)}</strong>
                <span>{staleReview ? 'Biblioteca alterada' : 'Biblioteca atual'}</span>
              </div>
            </div>
          )}
          <button type="button" className="admin-duplicates__check" disabled={checking || mutating} onClick={() => void runCheck()}>
            {checking ? <LoaderCircle className="is-spinning" /> : <RefreshCw />}
            {checking ? 'Analisando…' : review ? 'Analisar novamente' : 'Analisar agora'}
          </button>
        </section>

        {loadingReview && !review ? (
          <section className="admin-duplicates__empty">
            <LoaderCircle className="is-spinning" />
            <strong>Carregando última análise</strong>
            <span>Recuperando o diagnóstico salvo desta biblioteca.</span>
          </section>
        ) : !review ? (
          <section className="admin-duplicates__empty">
            <Search />
            <strong>Comece com uma análise explícita</strong>
            <span>Nenhum arquivo é alterado durante a detecção.</span>
          </section>
        ) : (
          <>
            <section className="admin-duplicates__metrics" aria-label="Resumo da análise de duplicatas">
              <button type="button" className={filter === 'exact' ? 'is-active is-exact' : 'is-exact'} onClick={() => setFilter('exact')}>
                <span className="admin-duplicates__metric-icon"><Link2 /></span>
                <span><strong>{review.counts.exact.toLocaleString('pt-BR')}</strong><b>Exatas</b><small>Mesmo arquivo (SHA-256).</small></span>
              </button>
              <button type="button" className={filter === 'probable' ? 'is-active is-probable' : 'is-probable'} onClick={() => setFilter('probable')}>
                <span className="admin-duplicates__metric-icon"><Search /></span>
                <span><strong>{review.counts.probable.toLocaleString('pt-BR')}</strong><b>Prováveis</b><small>Alta similaridade.</small></span>
              </button>
              <button type="button" className={filter === 'possible' ? 'is-active is-possible' : 'is-possible'} onClick={() => setFilter('possible')}>
                <span className="admin-duplicates__metric-icon"><Copy /></span>
                <span><strong>{review.counts.possible.toLocaleString('pt-BR')}</strong><b>Possíveis</b><small>Pode ser a mesma música.</small></span>
              </button>
              <button type="button" className={filter === 'ignored' ? 'is-active is-ignored' : 'is-ignored'} onClick={() => setFilter('ignored')}>
                <span className="admin-duplicates__metric-icon"><EyeOff /></span>
                <span><strong>{review.counts.ignored.toLocaleString('pt-BR')}</strong><b>Ignoradas</b><small>Pares descartados por você.</small></span>
              </button>
            </section>

            <div className="admin-duplicates__workspace">
              <section className="admin-duplicates__list" aria-label="Pares candidatos">
                <header>
                  <div>
                    <strong>Candidatos ({review.counts.reviewable.toLocaleString('pt-BR')})</strong>
                    <small>Selecione um par para ver os detalhes e decidir o que fazer.</small>
                  </div>
                  <label className="admin-duplicates__search">
                    <Search />
                    <input
                      value={query}
                      onChange={event => setQuery(event.target.value)}
                      placeholder="Buscar candidatos…"
                      aria-label="Buscar candidatos"
                    />
                  </label>
                </header>

                <nav className="admin-duplicates__tabs" aria-label="Filtrar candidatos">
                  {tabs.map(tab => (
                    <button key={tab.id} type="button" className={filter === tab.id ? 'is-active' : ''} onClick={() => setFilter(tab.id)}>
                      {tab.label} ({tab.count.toLocaleString('pt-BR')})
                    </button>
                  ))}
                </nav>

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
                        <span className="admin-duplicates__row-check" aria-hidden="true" />
                        <span className={`admin-duplicates__confidence is-${candidate.ignored ? 'ignored' : candidate.confidence}`}>
                          {candidate.ignored ? 'Ignorada' : CONFIDENCE_LABELS[candidate.confidence]}
                        </span>
                        <span className="admin-duplicates__row-copy">
                          <strong>{candidate.tracks[0].title || 'Sem título'}</strong>
                          <small>{candidate.tracks[0].artist || 'Artista desconhecido'} · 2 arquivos</small>
                        </span>
                        <span className="admin-duplicates__row-duration">{formatDuration(candidate.tracks[0].durationSeconds)}</span>
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
                        <strong>Comparação</strong>
                        <small>Analise as informações das duas músicas antes de decidir.</small>
                      </div>
                      <span className={`admin-duplicates__confidence is-${selectedCandidate.ignored ? 'ignored' : selectedCandidate.confidence}`}>
                        {selectedCandidate.ignored ? 'Ignorada' : CONFIDENCE_LABELS[selectedCandidate.confidence]}
                      </span>
                    </header>

                    <div className="admin-duplicates__comparison">
                      <TrackComparison track={selectedCandidate.tracks[0]} />
                      <span className="admin-duplicates__swap" aria-hidden="true">↔</span>
                      <TrackComparison track={selectedCandidate.tracks[1]} />
                    </div>

                    <div className="admin-duplicates__reasons">
                      <strong>Por que foram consideradas duplicatas?</strong>
                      <div>
                        {selectedCandidate.reasons.map(reason => (
                          <span key={reason}><Check />{REASON_LABELS[reason]}</span>
                        ))}
                      </div>
                    </div>

                    <div className="admin-duplicates__actions">
                      <button
                        type="button"
                        className="admin-duplicates__ignore"
                        disabled={mutating || checking}
                        onClick={() => void toggleIgnored(selectedCandidate)}
                      >
                        {selectedCandidate.ignored ? <RotateCcw /> : <EyeOff />}
                        {selectedCandidate.ignored ? 'Reabrir revisão' : 'Não são duplicatas'}
                      </button>

                      {!selectedCandidate.ignored && (
                        <>
                          <button
                            type="button"
                            className="admin-duplicates__trash"
                            disabled={mutating || checking}
                            onClick={() => void moveToQuarantine(selectedCandidate.tracks[0])}
                          >
                            {mutating ? <LoaderCircle className="is-spinning" /> : <Trash2 />}
                            Enviar à lixeira (esq.)
                          </button>
                          <button
                            type="button"
                            className="admin-duplicates__trash"
                            disabled={mutating || checking}
                            onClick={() => void moveToQuarantine(selectedCandidate.tracks[1])}
                          >
                            {mutating ? <LoaderCircle className="is-spinning" /> : <Trash2 />}
                            Enviar à lixeira (dir.)
                          </button>
                        </>
                      )}
                    </div>
                    {!selectedCandidate.ignored && (
                      <div className="admin-duplicates__action-notes" aria-hidden="true">
                        <span>Ignora este par nas próximas análises.</span>
                        <span>Move a música da esquerda para a lixeira.</span>
                        <span>Move a música da direita para a lixeira.</span>
                      </div>
                    )}
                  </>
                )}
              </aside>
            </div>

            <aside className="admin-duplicates__footer-note">
              <Info />
              <span>Nenhum arquivo é excluído diretamente. A cópia escolhida é movida para a Lixeira e pode ser restaurada.</span>
            </aside>
          </>
        )}
      </div>
    </section>
  );
}
