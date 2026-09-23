import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AdminLibraryNormalizationReviewResponse,
  LibraryMetadataAlias
} from '@home-music/shared';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Info,
  Lightbulb,
  Link2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Users
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

type AliasFilter = 'all' | 'artist' | 'album';

type NormalizationExternalEvidence = {
  source: 'musicbrainz';
  providerCanonical: string | null;
  suggestedCanonical: string | null;
  externalIds: string[];
  conflict: boolean;
  reasonCodes: string[];
};

type EnrichedNormalizationCandidate = LibraryMetadataNormalizationCandidate & {
  externalEvidence?: NormalizationExternalEvidence;
};

const ALIASES_PER_PAGE = 6;

function evidenceFor(candidate: LibraryMetadataNormalizationCandidate) {
  return (candidate as EnrichedNormalizationCandidate).externalEvidence;
}

function kindLabel(kind: LibraryMetadataNormalizationCandidate['kind']) {
  return kind === 'artist' ? 'Artista' : 'Álbum';
}

function candidateDescription(candidate: LibraryMetadataNormalizationCandidate) {
  if (candidate.kind === 'artist') return 'Mesma grafia provável em artista ou artista do álbum.';
  return `Álbum dentro de ${candidate.scope || 'artista desconhecido'}.`;
}

function evidenceDescription(candidate: LibraryMetadataNormalizationCandidate) {
  const evidence = evidenceFor(candidate);
  if (!evidence) return null;
  if (evidence.conflict) {
    return 'MusicBrainz encontrou IDs externos conflitantes. Nenhuma grafia é sugerida automaticamente.';
  }
  if (evidence.suggestedCanonical) {
    return `MusicBrainz corrobora “${evidence.suggestedCanonical}” como grafia canônica provável.`;
  }
  if (evidence.providerCanonical) {
    return `MusicBrainz identificou “${evidence.providerCanonical}”, mas essa grafia não está presente exatamente entre as variantes locais.`;
  }
  return 'MusicBrainz forneceu evidência externa sem determinar uma grafia canônica local.';
}

function aliasMatchesQuery(alias: LibraryMetadataAlias, query: string) {
  const normalized = query.trim().toLocaleLowerCase('pt-BR');
  if (!normalized) return true;
  return [
    alias.sourceValue,
    alias.canonicalValue,
    alias.scope ?? '',
    alias.kind === 'artist' ? 'artista' : 'álbum'
  ].some(value => value.toLocaleLowerCase('pt-BR').includes(normalized));
}

export function AdminLibraryNormalizationScreen({ onBack }: AdminLibraryNormalizationScreenProps) {
  const [review, setReview] = useState<AdminLibraryNormalizationReviewResponse | null>(null);
  const [selectedCanonical, setSelectedCanonical] = useState<Record<string, string>>({});
  const [aliasFilter, setAliasFilter] = useState<AliasFilter>('all');
  const [aliasQuery, setAliasQuery] = useState('');
  const [aliasPage, setAliasPage] = useState(1);
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
          const evidence = evidenceFor(candidate);
          const suggested = !evidence?.conflict ? evidence?.suggestedCanonical : null;
          nextSelections[candidate.key] = candidate.variants.some(variant => variant.value === currentValue)
            ? currentValue
            : suggested && candidate.variants.some(variant => variant.value === suggested)
              ? suggested
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
        setError('A associação foi desfeita, mas não foi possível atualizar a revisão agora. Atualize a análise para reconciliar a tela.');
      }
    } finally {
      if (mounted.current) setMutatingKey(null);
    }
  }

  const candidates = review?.candidates ?? [];
  const aliases = review?.aliases ?? [];
  const artistAliases = aliases.filter(alias => alias.kind === 'artist').length;
  const albumAliases = aliases.filter(alias => alias.kind === 'album').length;

  const filteredAliases = useMemo(() => aliases.filter(alias => {
    if (aliasFilter !== 'all' && alias.kind !== aliasFilter) return false;
    return aliasMatchesQuery(alias, aliasQuery);
  }), [aliasFilter, aliasQuery, aliases]);

  const aliasPageCount = Math.max(1, Math.ceil(filteredAliases.length / ALIASES_PER_PAGE));
  const visibleAliases = filteredAliases.slice(
    (aliasPage - 1) * ALIASES_PER_PAGE,
    aliasPage * ALIASES_PER_PAGE
  );

  useEffect(() => {
    setAliasPage(1);
  }, [aliasFilter, aliasQuery]);

  useEffect(() => {
    if (aliasPage > aliasPageCount) setAliasPage(aliasPageCount);
  }, [aliasPage, aliasPageCount]);

  const libraryNormalized = Boolean(review && candidates.length === 0);

  return (
    <section className="my-account-screen admin-normalization-screen admin-normalization-screen--v2" aria-labelledby="admin-normalization-title">
      <header className="admin-normalization__page-header">
        <button className="admin-normalization__back" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-normalization-title">Normalização lógica</strong>
          <small>Unifique grafias sem alterar seus arquivos</small>
        </div>
        <button
          className="admin-normalization__refresh"
          type="button"
          aria-label="Atualizar análise de normalização lógica"
          disabled={loading || Boolean(mutatingKey)}
          onClick={() => void loadReview()}
        >
          {loading ? <LoaderCircle className="is-spinning" /> : <RefreshCw />}
          <span>Atualizar análise</span>
        </button>
      </header>

      <div className="admin-normalization">
        {error && <div className="my-account-message is-error" role="alert">{error}</div>}
        {feedback && <div className="my-account-message is-success" role="status">{feedback}</div>}

        {loading && !review ? (
          <div className="admin-normalization__state" role="status">
            <LoaderCircle className="is-spinning" />
            <strong>Analisando grafias da biblioteca…</strong>
          </div>
        ) : !review ? (
          <div className="admin-normalization__state">
            <RefreshCw aria-hidden="true" />
            <strong>Revisão ainda não verificada</strong>
            <span>Não vamos afirmar que a biblioteca está consistente sem uma resposta válida do servidor.</span>
            <button className="admin-normalization__retry" type="button" onClick={() => void loadReview()}>Tentar novamente</button>
          </div>
        ) : (
          <>
            <section className={`admin-normalization__hero ${libraryNormalized ? 'is-success' : 'has-review'}`}>
              <span className="admin-normalization__hero-icon" aria-hidden="true">
                {libraryNormalized ? <Check /> : <Sparkles />}
              </span>
              <div className="admin-normalization__hero-copy">
                <strong>{libraryNormalized ? 'Biblioteca normalizada' : 'Há variações para revisar'}</strong>
                <small>
                  {libraryNormalized
                    ? 'Nenhuma variação pendente para revisar. Suas músicas já estão consistentes.'
                    : `${candidates.length.toLocaleString('pt-BR')} ${candidates.length === 1 ? 'variação precisa' : 'variações precisam'} da sua decisão.`}
                </small>
              </div>
              <div className="admin-normalization__hero-metrics">
                <article>
                  <Users />
                  <div>
                    <small>Candidatos</small>
                    <strong>{candidates.length.toLocaleString('pt-BR')}</strong>
                    <span>variações para revisar</span>
                  </div>
                </article>
                <article>
                  <FileText />
                  <div>
                    <small>Aliases ativos</small>
                    <strong>{review.counts.aliases.toLocaleString('pt-BR')}</strong>
                    <span>regras em uso</span>
                  </div>
                </article>
              </div>
            </section>

            <section className="admin-normalization__explainer">
              <div className="admin-normalization__explainer-copy">
                <span className="admin-normalization__explainer-icon"><Info /></span>
                <div>
                  <strong>O que é normalização lógica?</strong>
                  <p>Associa grafias diferentes à mesma entidade (artista ou álbum), sem alterar seus arquivos.</p>
                  <p>Isso mantém sua biblioteca organizada e melhora a busca e as Smart Playlists. Nenhum arquivo é renomeado e nenhuma tag embutida é regravada.</p>
                </div>
              </div>
              <div className="admin-normalization__example" aria-label="Exemplo de normalização de artista">
                <small>Exemplo (Artista)</small>
                <div className="admin-normalization__example-flow">
                  <div className="admin-normalization__example-variants">
                    <span>RITA LEE</span>
                    <span>Rita Lee</span>
                    <span>rita lee</span>
                  </div>
                  <span className="admin-normalization__example-arrow">→</span>
                  <strong>Rita Lee</strong>
                </div>
              </div>
            </section>

            <div className="admin-normalization__workspace">
              <section className="admin-normalization__panel admin-normalization__review" aria-labelledby="admin-normalization-candidates-title">
                <header>
                  <div className="admin-normalization__panel-heading">
                    <span className="is-purple"><Search /></span>
                    <div>
                      <strong id="admin-normalization-candidates-title">Variações para revisar</strong>
                      <small>A heurística encontrou grafias que podem ser a mesma entidade.</small>
                    </div>
                  </div>
                  <span className="admin-normalization__count">{candidates.length.toLocaleString('pt-BR')}</span>
                </header>

                {candidates.length === 0 ? (
                  <div className="admin-normalization__empty">
                    <span className="admin-normalization__empty-check"><Check /></span>
                    <strong>Nenhuma variação pendente</strong>
                    <span>A biblioteca já está consistente para a heurística conservadora atual.</span>
                  </div>
                ) : (
                  <div className="admin-normalization__candidates">
                    {candidates.map(candidate => {
                      const selected = selectedCanonical[candidate.key] || candidate.variants[0]?.value || '';
                      const busy = mutatingKey === candidate.key;
                      const evidence = evidenceFor(candidate);
                      const evidenceCopy = evidenceDescription(candidate);
                      return (
                        <article className="admin-normalization__candidate" key={candidate.key}>
                          <div className="admin-normalization__candidate-copy">
                            <span>{kindLabel(candidate.kind)}</span>
                            <strong>{candidateDescription(candidate)}</strong>
                            {evidenceCopy && (
                              <small role={evidence?.conflict ? 'alert' : 'note'}>{evidenceCopy}</small>
                            )}
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

              <section className="admin-normalization__panel admin-normalization__aliases-panel" aria-labelledby="admin-normalization-aliases-title">
                <header>
                  <div className="admin-normalization__panel-heading">
                    <span className="is-green"><FileText /></span>
                    <div>
                      <strong id="admin-normalization-aliases-title">Aliases ativos ({aliases.length.toLocaleString('pt-BR')})</strong>
                      <small>Regras de normalização aplicadas na biblioteca.</small>
                    </div>
                  </div>
                  <label className="admin-normalization__search">
                    <Search />
                    <input
                      value={aliasQuery}
                      onChange={event => setAliasQuery(event.target.value)}
                      placeholder="Buscar aliases…"
                      aria-label="Buscar aliases"
                    />
                  </label>
                </header>

                <nav className="admin-normalization__filters" aria-label="Filtrar aliases">
                  <button type="button" className={aliasFilter === 'all' ? 'is-active' : ''} onClick={() => setAliasFilter('all')}>
                    Todos ({aliases.length.toLocaleString('pt-BR')})
                  </button>
                  <button type="button" className={aliasFilter === 'artist' ? 'is-active' : ''} onClick={() => setAliasFilter('artist')}>
                    Artistas ({artistAliases.toLocaleString('pt-BR')})
                  </button>
                  <button type="button" className={aliasFilter === 'album' ? 'is-active' : ''} onClick={() => setAliasFilter('album')}>
                    Álbuns ({albumAliases.toLocaleString('pt-BR')})
                  </button>
                </nav>

                {filteredAliases.length === 0 ? (
                  <div className="admin-normalization__empty is-compact">
                    <Link2 />
                    <strong>{aliases.length === 0 ? 'Nenhum alias ativo' : 'Nenhum alias encontrado'}</strong>
                    <span>{aliases.length === 0 ? 'As grafias ainda são exibidas exatamente como chegam da metadata efetiva.' : 'Ajuste a busca ou o filtro.'}</span>
                  </div>
                ) : (
                  <>
                    <div className="admin-normalization__aliases">
                      {visibleAliases.map(alias => {
                        const busy = mutatingKey === alias.id;
                        const label = `${alias.sourceValue} → ${alias.canonicalValue}`;
                        return (
                          <article key={alias.id}>
                            <span className={`admin-normalization__alias-kind is-${alias.kind}`}>
                              {alias.kind === 'artist' ? 'Artista' : 'Álbum'}
                            </span>
                            <div>
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

                    <footer className="admin-normalization__pagination">
                      <span>
                        Mostrando {visibleAliases.length.toLocaleString('pt-BR')} de {filteredAliases.length.toLocaleString('pt-BR')} aliases
                      </span>
                      <div>
                        <button
                          type="button"
                          aria-label="Página anterior"
                          disabled={aliasPage === 1}
                          onClick={() => setAliasPage(page => Math.max(1, page - 1))}
                        ><ChevronLeft /></button>
                        {Array.from({ length: aliasPageCount }, (_, index) => index + 1)
                          .filter(page => aliasPageCount <= 7 || page === 1 || page === aliasPageCount || Math.abs(page - aliasPage) <= 1)
                          .map(page => (
                            <button key={page} type="button" className={aliasPage === page ? 'is-active' : ''} onClick={() => setAliasPage(page)}>
                              {page}
                            </button>
                          ))}
                        <button
                          type="button"
                          aria-label="Próxima página"
                          disabled={aliasPage === aliasPageCount}
                          onClick={() => setAliasPage(page => Math.min(aliasPageCount, page + 1))}
                        ><ChevronRight /></button>
                      </div>
                    </footer>
                  </>
                )}
              </section>
            </div>

            <aside className="admin-normalization__tip">
              <Lightbulb />
              <div>
                <strong>Dica</strong>
                <span>A análise ignora músicas na Lixeira e considera apenas arquivos visíveis. Quando novas músicas forem adicionadas ou metadados forem alterados, execute a análise novamente.</span>
              </div>
            </aside>
          </>
        )}
      </div>
    </section>
  );
}
