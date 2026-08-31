import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminLibraryNormalizationReviewResponse } from '@home-music/shared';
import {
  ChevronLeft,
  Link2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck
} from 'lucide-react';
import {
  associateAdminLibraryNormalization,
  getAdminLibraryNormalization,
  removeAdminLibraryNormalizationAlias,
  type LibraryMetadataNormalizationCandidate
} from '../admin-library-client';
import { notifyLibraryChanged, notifyPlaylistsChanged } from '../library-events';
import '../admin-normalization.css';

type AdminLibraryNormalizationScreenProps = {
  onBack: () => void;
};

function kindLabel(kind: LibraryMetadataNormalizationCandidate['kind']) {
  return kind === 'artist' ? 'Artista' : 'Álbum';
}

function candidateDescription(candidate: LibraryMetadataNormalizationCandidate) {
  if (candidate.kind === 'artist') return 'Mesma grafia provável em artista ou artista do álbum.';
  return `Álbum dentro de ${candidate.scope || 'artista desconhecido'}.`;
}

export function AdminLibraryNormalizationScreen({ onBack }: AdminLibraryNormalizationScreenProps) {
  const [review, setReview] = useState<AdminLibraryNormalizationReviewResponse | null>(null);
  const [selectedCanonical, setSelectedCanonical] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [mutatingKey, setMutatingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const mounted = useRef(true);

  const loadReview = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const next = await getAdminLibraryNormalization();
      if (!mounted.current || sequence !== requestSequence.current) return;
      setReview(next);
      setSelectedCanonical(current => {
        const nextSelections: Record<string, string> = {};
        for (const candidate of next.candidates) {
          const currentValue = current[candidate.key];
          nextSelections[candidate.key] = candidate.variants.some(variant => variant.value === currentValue)
            ? currentValue
            : candidate.variants[0]?.value ?? '';
        }
        return nextSelections;
      });
    } catch (caught) {
      if (!mounted.current || sequence !== requestSequence.current) return;
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar a normalização lógica.');
    } finally {
      if (mounted.current && sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadReview();
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
    };
  }, [loadReview]);

  function publishCanonicalChange() {
    notifyLibraryChanged();
    notifyPlaylistsChanged();
  }

  async function associate(candidate: LibraryMetadataNormalizationCandidate) {
    if (mutatingKey) return;
    const canonicalValue = selectedCanonical[candidate.key] || candidate.variants[0]?.value;
    if (!canonicalValue) return;
    const sourceValues = candidate.variants
      .map(variant => variant.value)
      .filter(value => value !== canonicalValue);
    if (sourceValues.length === 0) return;

    setMutatingKey(candidate.key);
    setError(null);
    setFeedback(null);
    try {
      const next = await associateAdminLibraryNormalization({
        kind: candidate.kind,
        scope: candidate.scope,
        canonicalValue,
        sourceValues
      });
      if (!mounted.current) return;
      setReview(next);
      publishCanonicalChange();
      setFeedback(
        candidate.kind === 'artist'
          ? `Variações associadas a “${canonicalValue}”. Os arquivos físicos não foram alterados.`
          : `Variações do álbum associadas a “${canonicalValue}”. Os arquivos físicos não foram alterados.`
      );
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : 'Não foi possível criar a associação lógica.');
    } finally {
      if (mounted.current) setMutatingKey(null);
    }
  }

  async function undoAlias(id: string, label: string) {
    if (mutatingKey) return;
    setMutatingKey(id);
    setError(null);
    setFeedback(null);

    try {
      await removeAdminLibraryNormalizationAlias(id);
    } catch (caught) {
      if (mounted.current) {
        setError(caught instanceof Error ? caught.message : 'Não foi possível desfazer a associação.');
        setMutatingKey(null);
      }
      return;
    }

    publishCanonicalChange();
    if (!mounted.current) return;

    setReview(current => current ? {
      ...current,
      aliases: current.aliases.filter(alias => alias.id !== id),
      counts: {
        ...current.counts,
        aliases: Math.max(0, current.counts.aliases - 1)
      }
    } : current);
    setFeedback(`Associação “${label}” desfeita. A metadata física continua intacta.`);

    try {
      const next = await getAdminLibraryNormalization();
      if (mounted.current) setReview(next);
    } catch {
      if (mounted.current) {
        setError('A associação foi desfeita, mas não foi possível atualizar a revisão agora. Use Atualizar para reconciliar a tela.');
      }
    } finally {
      if (mounted.current) setMutatingKey(null);
    }
  }

  const candidates = review?.candidates ?? [];
  const aliases = review?.aliases ?? [];

  return (
    <section className="my-account-screen admin-normalization-screen" aria-labelledby="admin-normalization-title">
      <header className="my-account-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-normalization-title">Normalização lógica</strong>
          <small>Una grafias sem alterar os arquivos</small>
        </div>
        <button
          className="admin-normalization__refresh"
          type="button"
          aria-label="Atualizar normalização lógica"
          disabled={loading || Boolean(mutatingKey)}
          onClick={() => void loadReview()}
        >
          {loading ? <LoaderCircle className="is-spinning" /> : <RefreshCw />}
          <span>Atualizar</span>
        </button>
      </header>

      <div className="admin-normalization">
        <section className="admin-normalization__hero" aria-labelledby="admin-normalization-status-title">
          <span className="admin-normalization__hero-icon" aria-hidden="true"><ShieldCheck /></span>
          <div>
            <small>Camada reversível</small>
            <strong id="admin-normalization-status-title">Arquivo físico → override → alias lógico</strong>
            <p>Somente a organização exibida pelo Home Music muda. Nenhum arquivo é renomeado e nenhuma tag embutida é regravada.</p>
          </div>
          {review && (
            <dl>
              <div><dt>Candidatos</dt><dd>{review.candidates.length.toLocaleString('pt-BR')}</dd></div>
              <div><dt>Aliases</dt><dd>{review.counts.aliases.toLocaleString('pt-BR')}</dd></div>
            </dl>
          )}
        </section>

        {error && <div className="my-account-message is-error" role="alert">{error}</div>}
        {feedback && <div className="my-account-message is-success" role="status">{feedback}</div>}

        {loading && !review ? (
          <div className="admin-normalization__state" role="status"><LoaderCircle className="is-spinning" /> Analisando grafias da biblioteca…</div>
        ) : !review ? (
          <div className="admin-normalization__state">
            <RefreshCw aria-hidden="true" />
            <strong>Revisão ainda não verificada</strong>
            <span>Não vamos afirmar que a biblioteca está consistente sem uma resposta válida do servidor.</span>
            <button className="admin-normalization__retry" type="button" onClick={() => void loadReview()}>Tentar novamente</button>
          </div>
        ) : (
          <>
            <section className="admin-normalization__section" aria-labelledby="admin-normalization-candidates-title">
              <div className="admin-normalization__heading">
                <div>
                  <strong id="admin-normalization-candidates-title">Variações para revisar</strong>
                  <small>A heurística considera apenas acentos, caixa e espaços. Pontuação e artigos continuam distintos.</small>
                </div>
              </div>

              {candidates.length === 0 ? (
                <div className="admin-normalization__empty">
                  <ShieldCheck />
                  <strong>Nenhuma variação provável pendente</strong>
                  <span>A biblioteca já está consistente para a heurística conservadora atual.</span>
                </div>
              ) : (
                <div className="admin-normalization__candidates">
                  {candidates.map(candidate => {
                    const selected = selectedCanonical[candidate.key] || candidate.variants[0]?.value || '';
                    const busy = mutatingKey === candidate.key;
                    return (
                      <article className="admin-normalization__candidate" key={candidate.key}>
                        <div className="admin-normalization__candidate-copy">
                          <span>{kindLabel(candidate.kind)}</span>
                          <strong>{candidateDescription(candidate)}</strong>
                          <small>Escolha qual grafia será exibida como canônica.</small>
                        </div>

                        <fieldset disabled={Boolean(mutatingKey)}>
                          <legend>Grafia canônica</legend>
                          {candidate.variants.map(variant => (
                            <label key={variant.value}>
                              <input
                                type="radio"
                                name={`canonical-${candidate.key}`}
                                value={variant.value}
                                checked={selected === variant.value}
                                onChange={() => setSelectedCanonical(current => ({
                                  ...current,
                                  [candidate.key]: variant.value
                                }))}
                              />
                              <span>{variant.value}</span>
                              <small>{variant.trackCount.toLocaleString('pt-BR')} {variant.trackCount === 1 ? 'faixa' : 'faixas'}</small>
                            </label>
                          ))}
                        </fieldset>

                        <button
                          className="admin-normalization__associate"
                          type="button"
                          disabled={Boolean(mutatingKey) || candidate.variants.length < 2}
                          onClick={() => void associate(candidate)}
                        >
                          {busy ? <LoaderCircle className="is-spinning" /> : <Link2 />}
                          {busy ? 'Associando…' : 'Associar variações'}
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="admin-normalization__section" aria-labelledby="admin-normalization-aliases-title">
              <div className="admin-normalization__heading">
                <div>
                  <strong id="admin-normalization-aliases-title">Aliases ativos</strong>
                  <small>Cada associação é explícita, persistida no SQLite e pode ser desfeita individualmente.</small>
                </div>
              </div>

              {aliases.length === 0 ? (
                <div className="admin-normalization__empty is-compact">
                  <Link2 />
                  <strong>Nenhum alias ativo</strong>
                  <span>As grafias ainda são exibidas exatamente como chegam da metadata efetiva.</span>
                </div>
              ) : (
                <div className="admin-normalization__aliases">
                  {aliases.map(alias => {
                    const busy = mutatingKey === alias.id;
                    const label = `${alias.sourceValue} → ${alias.canonicalValue}`;
                    return (
                      <article key={alias.id}>
                        <div>
                          <span>{alias.kind === 'artist' ? 'Artista' : 'Álbum'}</span>
                          <strong>{label}</strong>
                          {alias.scope && <small>Artista do álbum: {alias.scope}</small>}
                        </div>
                        <button
                          type="button"
                          disabled={Boolean(mutatingKey)}
                          aria-label={`Desfazer associação ${label}`}
                          onClick={() => void undoAlias(alias.id, label)}
                        >
                          {busy ? <LoaderCircle className="is-spinning" /> : <RotateCcw />}
                          {busy ? 'Desfazendo…' : 'Desfazer'}
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}
