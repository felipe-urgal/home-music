import { useEffect, useState, type FormEvent } from 'react';
import type { ImportJob } from '@home-music/shared';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  ExternalLink,
  LoaderCircle,
  Search,
  ShieldCheck
} from 'lucide-react';
import { getAdminExternalProviders } from '../admin-external-provider-client';
import {
  checkAdminJamendoEligibility,
  searchAdminJamendo,
  startAdminJamendoImport,
  type AdminJamendoImportBlockReason,
  type AdminJamendoSearchResult,
  type AdminJamendoTrack
} from '../admin-jamendo-client';
import '../admin-jamendo.css';

const CREATIVE_COMMONS_HOSTS = new Set(['creativecommons.org', 'www.creativecommons.org']);

type AdminJamendoDiscoveryPanelProps = {
  onJobStarted?: (job: ImportJob) => void;
};

function formatDuration(seconds: number | null) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return 'Duração não informada';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function trustedLicenseLabel(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!CREATIVE_COMMONS_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] === 'licenses' && parts[1] && parts[2]) {
      return `CC ${parts[1].toUpperCase()} ${parts[2]}`;
    }
    if (parts[0] === 'publicdomain' && parts[1] === 'zero' && parts[2]) return `CC0 ${parts[2]}`;
    if (parts[0] === 'publicdomain' && parts[1] === 'mark' && parts[2]) return `Domínio público ${parts[2]}`;
  } catch {
    return null;
  }
  return null;
}

function blockReasonLabel(reason: AdminJamendoImportBlockReason | null) {
  switch (reason) {
    case 'download-not-allowed': return 'O Jamendo não permite download desta faixa.';
    case 'license-missing': return 'A faixa não possui licença verificável.';
    case 'license-unsupported': return 'A licença não está na política permitida do Home Music.';
    default: return null;
  }
}

export function AdminJamendoDiscoveryPanel({ onJobStarted }: AdminJamendoDiscoveryPanelProps) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [result, setResult] = useState<AdminJamendoSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminJamendoTrack | null>(null);
  const [startedJobId, setStartedJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getAdminExternalProviders()
      .then(providers => {
        if (!active) return;
        setConfigured(providers.find(provider => provider.id === 'jamendo')?.configured ?? false);
      })
      .catch(() => { if (active) setConfigured(false); });
    return () => { active = false; };
  }, []);

  const runSearch = async (searchQuery: string, page: number) => {
    const clean = searchQuery.trim();
    if (clean.length < 2) {
      setError('Digite pelo menos 2 caracteres para buscar no Jamendo.');
      return;
    }
    setLoading(true);
    setError(null);
    setSelected(null);
    setStartedJobId(null);
    try {
      const next = await searchAdminJamendo(clean, page, 20);
      setResult(next);
      setSearchedQuery(clean);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível buscar no Jamendo.');
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runSearch(query, 1);
  };

  const importTrack = async (track: AdminJamendoTrack) => {
    if (!track.importAllowed || checkingId) return;
    setCheckingId(track.sourceId);
    setError(null);
    setSelected(null);
    setStartedJobId(null);
    try {
      const verified = await checkAdminJamendoEligibility(track.sourceId);
      const job = await startAdminJamendoImport(verified.sourceId);
      onJobStarted?.(job);
      setSelected(verified);
      setStartedJobId(job.id);
    } catch (caught) {
      setSelected(null);
      setStartedJobId(null);
      setError(caught instanceof Error ? caught.message : 'A faixa não está mais disponível para importação.');
    } finally {
      setCheckingId(null);
    }
  };

  if (configured === null) {
    return <div className="admin-jamendo-empty" role="status"><LoaderCircle className="is-spinning" /> Verificando Jamendo…</div>;
  }

  if (!configured) {
    return (
      <div className="admin-jamendo-unavailable">
        <CircleAlert />
        <div>
          <strong>Jamendo ainda não está configurado</strong>
          <small>Defina HOME_MUSIC_JAMENDO_CLIENT_ID no servidor para habilitar a descoberta.</small>
        </div>
      </div>
    );
  }

  return (
    <section className="admin-jamendo" aria-labelledby="admin-jamendo-title">
      <div className="admin-jamendo__heading">
        <div>
          <strong id="admin-jamendo-title">Descobrir no Jamendo</strong>
          <small>Pesquise música livre/licenciada antes de decidir o que importar.</small>
        </div>
        <Search />
      </div>

      <form className="admin-jamendo__search" onSubmit={submit}>
        <input
          type="search"
          value={query}
          disabled={loading}
          maxLength={120}
          aria-label="Buscar músicas no Jamendo"
          placeholder="Música, artista ou álbum"
          onChange={event => { setQuery(event.target.value); if (error) setError(null); }}
        />
        <button className="is-primary" type="submit" disabled={loading || query.trim().length < 2}>
          {loading ? <LoaderCircle className="is-spinning" /> : <Search />}
          {loading ? 'Buscando…' : 'Buscar'}
        </button>
      </form>

      <small className="admin-jamendo__policy">
        <ShieldCheck /> O servidor revalida licença e permissão antes de baixar qualquer byte para o scratch privado.
      </small>

      {error && <div className="my-account-message is-error admin-import-message" role="alert">{error}</div>}

      {selected && startedJobId && (
        <div className="admin-jamendo-selected" role="status">
          <CheckCircle2 />
          <div>
            <strong>Importação de {selected.title} iniciada</strong>
            <small>{selected.attribution}. O job entrou no pipeline seguro de staging, validação e promoção.</small>
          </div>
        </div>
      )}

      {result && result.items.length === 0 && !loading && (
        <div className="admin-jamendo-empty"><Search /><span>Nenhuma faixa encontrada para “{searchedQuery}”.</span></div>
      )}

      {result && result.items.length > 0 && (
        <div className="admin-jamendo-results" aria-live="polite">
          <div className="admin-jamendo-results__summary">
            <strong>Resultados</strong>
            <small>{result.pagination.total == null ? 'Total não informado' : `${result.pagination.total} encontradas`}</small>
          </div>

          <div className="admin-jamendo-list">
            {result.items.map(track => {
              const blockReason = blockReasonLabel(track.importBlockReason);
              const licenseLabel = trustedLicenseLabel(track.licenseUrl);
              return (
                <article className={`admin-jamendo-track${track.importAllowed ? '' : ' is-blocked'}`} key={track.sourceId}>
                  <div className="admin-jamendo-track__main">
                    <strong>{track.title}</strong>
                    <small>{track.artist || 'Artista não informado'}{track.album ? ` · ${track.album}` : ''}</small>
                    <div className="admin-jamendo-track__facts">
                      <span>{formatDuration(track.durationSeconds)}</span>
                      <span className={track.downloadAllowed ? 'is-allowed' : 'is-blocked'}>
                        <Download /> {track.downloadAllowed ? 'Download permitido' : 'Download indisponível'}
                      </span>
                      <span>{track.previewAvailable ? 'Preview disponível' : 'Sem preview'}</span>
                    </div>
                    <small className="admin-jamendo-track__attribution">{track.attribution}</small>
                    {track.licenseUrl && licenseLabel ? (
                      <a href={track.licenseUrl} target="_blank" rel="noreferrer noopener">
                        {licenseLabel} <ExternalLink />
                      </a>
                    ) : (
                      <small className="admin-jamendo-track__license-missing">
                        {track.licenseUrl ? 'Licença não reconhecida' : 'Licença não informada'}
                      </small>
                    )}
                    {blockReason && <small className="admin-jamendo-track__block-reason"><CircleAlert /> {blockReason}</small>}
                  </div>
                  <button
                    type="button"
                    disabled={!track.importAllowed || checkingId !== null}
                    onClick={() => void importTrack(track)}
                    title={blockReason ?? undefined}
                  >
                    {checkingId === track.sourceId ? <LoaderCircle className="is-spinning" /> : track.importAllowed ? <Download /> : <CircleAlert />}
                    {checkingId === track.sourceId ? 'Importando…' : track.importAllowed ? 'Importar' : 'Bloqueada'}
                  </button>
                </article>
              );
            })}
          </div>

          <div className="admin-jamendo-pagination">
            <button
              type="button"
              disabled={loading || result.pagination.page <= 1}
              onClick={() => void runSearch(searchedQuery, result.pagination.page - 1)}
            ><ChevronLeft /> Anterior</button>
            <span>Página {result.pagination.page}</span>
            <button
              type="button"
              disabled={loading || result.pagination.nextPage === null}
              onClick={() => result.pagination.nextPage && void runSearch(searchedQuery, result.pagination.nextPage)}
            >Próxima <ChevronRight /></button>
          </div>
        </div>
      )}
    </section>
  );
}
