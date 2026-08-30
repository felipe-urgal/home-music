import { useCallback, useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@home-music/shared';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Database,
  FileInput,
  HardDrive,
  ListMusic,
  LoaderCircle,
  Music2,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Trash2,
  Users
} from 'lucide-react';
import {
  clearAdminTranscodeCache,
  getAdminLibraryOverview,
  getAdminTranscodeCache,
  type AdminLibraryHealthOverview,
  type AdminLibraryProblemKey,
  type AdminTranscodeCacheStatus
} from '../admin-library-client';
import '../administration-health.css';
import { AdminImportMediaScreen } from './AdminImportMediaScreen';
import { AdminMediaQuarantineScreen } from './AdminMediaQuarantineScreen';
import { AdminOperationHistoryScreen } from './AdminOperationHistoryScreen';
import { AdminTrackAvailabilityScreen } from './AdminTrackAvailabilityScreen';
import { AdminTrackMetadataScreen } from './AdminTrackMetadataScreen';
import { AdminUsersScreen } from './AdminUsersScreen';

type AdministrationView = 'overview' | 'tracks' | 'metadata' | 'quarantine' | 'import' | 'operations' | 'users';

type AdministrationScreenProps = {
  currentUser: AuthenticatedUser;
  onBack: () => void;
};

type CacheFeedback = {
  message: string;
  error: boolean;
};

type MetadataHealthFilter = {
  label: string;
  trackIds: string[];
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);
  const digits = exponent === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(value)} ${units[exponent]}`;
}

function formatScanDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return 'Ainda não concluído';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function formatAutoRescan(scanner: AdminLibraryHealthOverview['scanner']) {
  if (!scanner.autoRescan.enabled || !scanner.autoRescan.intervalSeconds) return 'Automático desativado';
  const minutes = scanner.autoRescan.intervalSeconds / 60;
  return `Automático a cada ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(minutes)} min`;
}

function formatCacheActivity(cache: AdminTranscodeCacheStatus) {
  if (cache.active === 0 && cache.pending === 0) return 'Ocioso';
  const parts: string[] = [];
  if (cache.active > 0) parts.push(`${cache.active} ${cache.active === 1 ? 'ativo' : 'ativos'}`);
  if (cache.pending > 0) parts.push(`${cache.pending} ${cache.pending === 1 ? 'pendente' : 'pendentes'}`);
  return parts.join(' · ');
}

export function AdministrationScreen({ currentUser, onBack }: AdministrationScreenProps) {
  const [view, setView] = useState<AdministrationView>('overview');
  const [overview, setOverview] = useState<AdminLibraryHealthOverview | null>(null);
  const [metadataHealthFilter, setMetadataHealthFilter] = useState<MetadataHealthFilter | null>(null);
  const [cache, setCache] = useState<AdminTranscodeCacheStatus | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingCache, setLoadingCache] = useState(true);
  const [clearingCache, setClearingCache] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [cacheFeedback, setCacheFeedback] = useState<CacheFeedback | null>(null);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      setOverview(await getAdminLibraryOverview());
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : 'Não foi possível carregar a visão geral.');
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  const loadCache = useCallback(async () => {
    setLoadingCache(true);
    setCacheError(null);
    try {
      setCache(await getAdminTranscodeCache());
    } catch (error) {
      setCacheError(error instanceof Error ? error.message : 'Não foi possível carregar o cache de transcoding.');
    } finally {
      setLoadingCache(false);
    }
  }, []);

  const refreshOverview = useCallback(async () => {
    await Promise.all([loadOverview(), loadCache()]);
  }, [loadCache, loadOverview]);

  useEffect(() => {
    if (currentUser.role !== 'admin') return;
    void refreshOverview();
  }, [currentUser.role, refreshOverview]);

  function openHealthProblem(problem: AdminLibraryProblemKey, label: string) {
    const trackIds = overview?.problems.trackIds[problem] ?? [];
    if (trackIds.length === 0) return;
    setMetadataHealthFilter({ label, trackIds });
    setView('metadata');
  }

  function openAllMetadata() {
    setMetadataHealthFilter(null);
    setView('metadata');
  }

  async function clearTranscodeCache() {
    if (clearingCache) return;
    const confirmed = window.confirm(
      'Limpar o cache de transcoding?\n\nSomente arquivos derivados serão removidos. As músicas originais não serão alteradas.'
    );
    if (!confirmed) return;

    setClearingCache(true);
    setCacheError(null);
    setCacheFeedback(null);
    try {
      const result = await clearAdminTranscodeCache();
      setCache(result.cache);
      if (result.failedEntries > 0) {
        setCacheFeedback({
          message: `Cache limpo parcialmente: ${formatBytes(result.freedBytes)} liberados e ${result.failedEntries} ${result.failedEntries === 1 ? 'arquivo não pôde' : 'arquivos não puderam'} ser removido${result.failedEntries === 1 ? '' : 's'}.`,
          error: true
        });
      } else if (result.freedBytes > 0) {
        setCacheFeedback({
          message: `Cache limpo: ${formatBytes(result.freedBytes)} liberados. Nenhuma música original foi alterada.`,
          error: false
        });
      } else {
        setCacheFeedback({ message: 'O cache já estava vazio.', error: false });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível limpar o cache de transcoding.';
      try {
        setCache(await getAdminTranscodeCache());
      } catch {
        // Mantém o último estado conhecido do cache quando o refresh também falhar.
      }
      setCacheError(message);
    } finally {
      setClearingCache(false);
    }
  }

  if (currentUser.role !== 'admin') return null;

  if (view === 'tracks') {
    return <AdminTrackAvailabilityScreen onBack={() => setView('overview')} />;
  }

  if (view === 'metadata') {
    return (
      <AdminTrackMetadataScreen
        initialHealthFilter={metadataHealthFilter}
        onBack={() => setView('overview')}
      />
    );
  }

  if (view === 'quarantine') {
    return <AdminMediaQuarantineScreen onBack={() => setView('overview')} />;
  }

  if (view === 'import') {
    return <AdminImportMediaScreen onBack={() => setView('overview')} />;
  }

  if (view === 'operations') {
    return <AdminOperationHistoryScreen onBack={() => setView('overview')} />;
  }

  if (view === 'users') {
    return <AdminUsersScreen currentUser={currentUser} onBack={() => setView('overview')} />;
  }

  const problemCount = overview?.problems.affectedTracks ?? 0;
  const scannerLabel = overview?.scanner.scanning
    ? 'Atualizando'
    : overview?.scanner.ready
      ? 'Pronto'
      : 'Atenção';
  const cacheBusy = Boolean(cache && (cache.active > 0 || cache.pending > 0));

  return (
    <section className="my-account-screen administration-screen" aria-labelledby="administration-title">
      <header className="my-account-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="administration-title">Administração</strong>
          <small>Controles do Home Music</small>
        </div>
        <span className="my-account-header__spacer" />
      </header>

      <div className="my-account-overview administration-overview">
        <section className="my-account-profile" aria-label="Acesso administrativo">
          <span className="my-account-profile__icon"><ShieldCheck /></span>
          <div>
            <strong>{currentUser.username}</strong>
            <small>Área restrita a administradores</small>
          </div>
          <span className="my-account-profile__badge"><ShieldCheck /> Administrador</span>
        </section>

        <section className="administration-summary" aria-labelledby="administration-summary-title">
          <div className="administration-summary__heading">
            <div>
              <span className="my-account-link-group__label" id="administration-summary-title">Visão geral</span>
              <small>Estado atual da biblioteca indexada</small>
            </div>
            <button
              type="button"
              aria-label="Atualizar visão geral"
              disabled={loadingOverview || loadingCache || clearingCache}
              onClick={() => void refreshOverview()}
            >
              <RefreshCw className={loadingOverview || loadingCache ? 'is-spinning' : ''} />
            </button>
          </div>

          {overviewError && (
            <div className="my-account-message is-error administration-summary__message" role="alert">
              <span>{overviewError}</span>
              <button type="button" onClick={() => void loadOverview()}>Tentar novamente</button>
            </div>
          )}

          {loadingOverview && !overview ? (
            <div className="administration-summary__loading" role="status">
              <LoaderCircle className="is-spinning" /> Carregando visão geral…
            </div>
          ) : overview ? (
            <>
              <div className="administration-metrics">
                <article className="administration-metric" aria-label="Faixas indexadas">
                  <span className="administration-metric__icon"><Music2 /></span>
                  <div><small>Faixas</small><strong>{overview.tracks.total.toLocaleString('pt-BR')}</strong></div>
                </article>

                <article className="administration-metric" aria-label="Armazenamento da biblioteca física">
                  <span className="administration-metric__icon"><HardDrive /></span>
                  <div><small>Biblioteca física</small><strong>{formatBytes(overview.storage.libraryBytes)}</strong></div>
                </article>

                <article className={`administration-metric ${problemCount > 0 ? 'has-warning' : ''}`} aria-label="Problemas da biblioteca">
                  <span className="administration-metric__icon"><AlertTriangle /></span>
                  <div><small>Problemas</small><strong>{problemCount.toLocaleString('pt-BR')}</strong></div>
                </article>

                <article className={`administration-metric ${overview.scanner.ready ? '' : 'has-warning'}`} aria-label="Estado do scanner">
                  <span className="administration-metric__icon"><ScanLine /></span>
                  <div><small>Scanner</small><strong>{scannerLabel}</strong></div>
                </article>
              </div>

              <div className="administration-detail-grid">
                <article className="administration-detail-card" aria-labelledby="administration-problems-title">
                  <div className="administration-detail-card__heading">
                    <AlertTriangle />
                    <div><strong id="administration-problems-title">Qualidade da biblioteca</strong><small>{problemCount === 0 ? 'Nenhum problema detectado' : `${problemCount.toLocaleString('pt-BR')} faixas precisam de atenção`}</small></div>
                  </div>
                  <dl className="administration-problem-list">
                    <div>
                      <dt><button className="administration-problem-list__button" type="button" disabled={overview.problems.missingTitle === 0} onClick={() => openHealthProblem('missingTitle', 'Sem título')}><span>Sem título</span>{overview.problems.missingTitle > 0 && <ChevronRight />}</button></dt>
                      <dd>{overview.problems.missingTitle.toLocaleString('pt-BR')}</dd>
                    </div>
                    <div>
                      <dt><button className="administration-problem-list__button" type="button" disabled={overview.problems.missingCover === 0} onClick={() => openHealthProblem('missingCover', 'Sem capa')}><span>Sem capa</span>{overview.problems.missingCover > 0 && <ChevronRight />}</button></dt>
                      <dd>{overview.problems.missingCover.toLocaleString('pt-BR')}</dd>
                    </div>
                    <div>
                      <dt><button className="administration-problem-list__button" type="button" disabled={overview.problems.unknownArtist === 0} onClick={() => openHealthProblem('unknownArtist', 'Artista desconhecido')}><span>Artista desconhecido</span>{overview.problems.unknownArtist > 0 && <ChevronRight />}</button></dt>
                      <dd>{overview.problems.unknownArtist.toLocaleString('pt-BR')}</dd>
                    </div>
                    <div>
                      <dt><button className="administration-problem-list__button" type="button" disabled={overview.problems.unknownAlbum === 0} onClick={() => openHealthProblem('unknownAlbum', 'Álbum desconhecido')}><span>Álbum desconhecido</span>{overview.problems.unknownAlbum > 0 && <ChevronRight />}</button></dt>
                      <dd>{overview.problems.unknownAlbum.toLocaleString('pt-BR')}</dd>
                    </div>
                    <div>
                      <dt><button className="administration-problem-list__button" type="button" disabled={overview.problems.missingDuration === 0} onClick={() => openHealthProblem('missingDuration', 'Duração indisponível')}><span>Duração indisponível</span>{overview.problems.missingDuration > 0 && <ChevronRight />}</button></dt>
                      <dd>{overview.problems.missingDuration.toLocaleString('pt-BR')}</dd>
                    </div>
                  </dl>
                </article>

                <article className="administration-detail-card" aria-labelledby="administration-scanner-title">
                  <div className="administration-detail-card__heading">
                    <Database />
                    <div><strong id="administration-scanner-title">Scanner</strong><small>{overview.scanner.ready ? 'Biblioteca pronta para uso' : 'Biblioteca ainda não está pronta'}</small></div>
                  </div>
                  <dl className="administration-scanner-list">
                    <div><dt>Estado</dt><dd>{scannerLabel}</dd></div>
                    <div><dt>Último scan</dt><dd>{formatScanDate(overview.scanner.scannedAt)}</dd></div>
                    <div><dt>Rescan</dt><dd>{formatAutoRescan(overview.scanner)}</dd></div>
                  </dl>
                </article>

                <article className="administration-detail-card administration-storage-card" aria-labelledby="administration-storage-title">
                  <div className="administration-detail-card__heading">
                    <HardDrive />
                    <div><strong id="administration-storage-title">Armazenamento</strong><small>Biblioteca, banco SQLite e cache derivado de transcoding</small></div>
                  </div>

                  {cacheError && <div className="administration-cache-message is-error" role="alert">{cacheError}</div>}
                  {cacheFeedback && (
                    <div className={`administration-cache-message ${cacheFeedback.error ? 'is-error' : 'is-success'}`} role={cacheFeedback.error ? 'alert' : 'status'}>
                      {cacheFeedback.message}
                    </div>
                  )}

                  <dl className="administration-storage-list">
                    <div><dt>Biblioteca física</dt><dd>{formatBytes(overview.storage.libraryBytes)}</dd></div>
                    <div><dt>Banco SQLite</dt><dd>{overview.storage.databaseBytes == null ? 'Indisponível' : formatBytes(overview.storage.databaseBytes)}</dd></div>
                    <div><dt>Cache atual</dt><dd>{cache ? formatBytes(cache.bytes) : loadingCache ? 'Carregando…' : 'Indisponível'}</dd></div>
                    <div><dt>Limite configurado</dt><dd>{cache ? formatBytes(cache.limitBytes) : '—'}</dd></div>
                    <div><dt>Arquivos em cache</dt><dd>{cache ? cache.entries.toLocaleString('pt-BR') : '—'}</dd></div>
                    <div><dt>Transcoding</dt><dd>{cache ? formatCacheActivity(cache) : '—'}</dd></div>
                  </dl>

                  <div className="administration-cache-actions">
                    <small>Limpar remove somente arquivos derivados do cache; suas músicas não são alteradas.</small>
                    <button
                      type="button"
                      disabled={!cache || cache.bytes === 0 || cacheBusy || clearingCache}
                      title={cacheBusy ? 'Aguarde o transcoding em andamento terminar.' : undefined}
                      onClick={() => void clearTranscodeCache()}
                    >
                      {clearingCache ? <LoaderCircle className="is-spinning" /> : <Trash2 />}
                      {clearingCache ? 'Limpando…' : 'Limpar cache'}
                    </button>
                  </div>
                </article>
              </div>
            </>
          ) : null}
        </section>

        <section className="my-account-link-group" aria-labelledby="administration-group-library">
          <span className="my-account-link-group__label" id="administration-group-library">Biblioteca</span>
          <div className="my-account-links">
            <button type="button" onClick={() => setView('tracks')}>
              <span className="my-account-card__icon"><ListMusic /></span>
              <span><strong>Gerenciar músicas</strong><small>Desative, reative ou mova faixas para a lixeira com segurança.</small></span>
              <ChevronRight />
            </button>
            <button type="button" onClick={openAllMetadata}>
              <span className="my-account-card__icon"><Database /></span>
              <span><strong>Metadados</strong><small>Corrija texto e capa sem modificar o arquivo de áudio original.</small></span>
              <ChevronRight />
            </button>
            <button type="button" onClick={() => setView('quarantine')}>
              <span className="my-account-card__icon"><Trash2 /></span>
              <span><strong>Lixeira</strong><small>Restaure músicas ou confirme a exclusão física permanente.</small></span>
              <ChevronRight />
            </button>
            <button type="button" onClick={() => setView('import')}>
              <span className="my-account-card__icon"><FileInput /></span>
              <span><strong>Importar mídia</strong><small>Centralize uploads, URLs e fontes externas em um único pipeline.</small></span>
              <ChevronRight />
            </button>
            <button type="button" onClick={() => setView('operations')}>
              <span className="my-account-card__icon"><ScanLine /></span>
              <span><strong>Histórico operacional</strong><small>Revise scans e importações com duração, resultado e falhas acionáveis.</small></span>
              <ChevronRight />
            </button>
          </div>
        </section>

        <section className="my-account-link-group" aria-labelledby="administration-group-access">
          <span className="my-account-link-group__label" id="administration-group-access">Acesso</span>
          <div className="my-account-links">
            <button type="button" onClick={() => setView('users')}>
              <span className="my-account-card__icon"><Users /></span>
              <span><strong>Usuários</strong><small>Crie contas e gerencie papéis, acesso e sessões.</small></span>
              <ChevronRight />
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
