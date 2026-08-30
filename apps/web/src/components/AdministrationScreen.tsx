import { useCallback, useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@home-music/shared';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Copy,
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
import { AdminLibraryDuplicateReviewScreen } from './AdminLibraryDuplicateReviewScreen';
import { AdminLibraryIntegrityScreen } from './AdminLibraryIntegrityScreen';
import { AdminMediaQuarantineScreen } from './AdminMediaQuarantineScreen';
import { AdminOperationHistoryScreen } from './AdminOperationHistoryScreen';
import { AdminTrackAvailabilityScreen } from './AdminTrackAvailabilityScreen';
import { AdminTrackMetadataScreen } from './AdminTrackMetadataScreen';
import { AdminUsersScreen } from './AdminUsersScreen';

type AdministrationView = 'overview' | 'tracks' | 'metadata' | 'integrity' | 'duplicates' | 'quarantine' | 'import' | 'operations' | 'users';

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

function formatScanDate(value: string | null) {
  if (!value) return 'Ainda não concluído';
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
  return `A cada ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(minutes)} min`;
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

  if (view === 'tracks') return <AdminTrackAvailabilityScreen onBack={() => setView('overview')} />;
  if (view === 'metadata') {
    return <AdminTrackMetadataScreen initialHealthFilter={metadataHealthFilter} onBack={() => setView('overview')} />;
  }
  if (view === 'integrity') return <AdminLibraryIntegrityScreen onBack={() => setView('overview')} />;
  if (view === 'duplicates') return <AdminLibraryDuplicateReviewScreen onBack={() => setView('overview')} />;
  if (view === 'quarantine') return <AdminMediaQuarantineScreen onBack={() => setView('overview')} />;
  if (view === 'import') return <AdminImportMediaScreen onBack={() => setView('overview')} />;
  if (view === 'operations') return <AdminOperationHistoryScreen onBack={() => setView('overview')} />;
  if (view === 'users') return <AdminUsersScreen currentUser={currentUser} onBack={() => setView('overview')} />;

  const problemCount = overview?.problems.affectedTracks ?? 0;
  const integrityCount = overview?.integrity.counts.total ?? 0;
  const integrityVerified = Boolean(overview?.integrity.checkedAt);
  const attentionCount = problemCount + integrityCount;
  const scannerLabel = overview?.scanner.scanning
    ? 'Atualizando'
    : overview?.scanner.ready
      ? 'Pronto'
      : 'Atenção';
  const cacheBusy = Boolean(cache && (cache.active > 0 || cache.pending > 0));
  const healthy = Boolean(overview && !overviewError && overview.scanner.ready && integrityVerified && attentionCount === 0);
  const statusTone = overviewError ? 'has-warning' : !overview ? 'is-loading' : healthy ? 'is-healthy' : 'has-warning';
  const statusTitle = overviewError
    ? overview ? 'Visão geral desatualizada' : 'Estado da biblioteca indisponível'
    : !overview
      ? 'Carregando estado da biblioteca'
      : overview.scanner.scanning
        ? 'Biblioteca sendo atualizada'
        : !overview.scanner.ready
          ? 'Biblioteca requer atenção'
          : !integrityVerified
            ? 'Integridade ainda não verificada'
            : attentionCount > 0
              ? 'Há itens para revisar'
              : 'Biblioteca pronta';
  const statusDetail = overviewError
    ? overview
      ? 'Não foi possível confirmar o estado atual. Os dados abaixo são o último snapshot conhecido.'
      : 'Tente atualizar novamente para carregar scanner, índice e integridade.'
    : !overview
      ? 'Consultando índice, scanner e integridade.'
      : !overview.scanner.ready
        ? 'O scanner ainda não marcou a biblioteca como pronta para uso.'
        : !integrityVerified
          ? 'Execute Verificar agora em Integridade para concluir o diagnóstico.'
          : attentionCount > 0
            ? `${attentionCount.toLocaleString('pt-BR')} ${attentionCount === 1 ? 'item precisa' : 'itens precisam'} de revisão.`
            : 'Scanner pronto e última verificação de integridade sem inconsistências conhecidas.';

  return (
    <section className="my-account-screen administration-screen administration-cockpit" aria-labelledby="administration-title">
      <header className="my-account-header administration-cockpit__header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="administration-title">Administração</strong>
          <small>Foque no que precisa ser feito</small>
        </div>
        <button
          className="administration-cockpit__refresh"
          type="button"
          aria-label="Atualizar visão geral"
          disabled={loadingOverview || loadingCache || clearingCache}
          onClick={() => void refreshOverview()}
        >
          <RefreshCw className={loadingOverview || loadingCache ? 'is-spinning' : ''} />
          <span>Atualizar</span>
        </button>
      </header>

      <div className="administration-cockpit__content">
        {overviewError && (
          <div className="my-account-message is-error administration-cockpit__message" role="alert">
            <span>{overviewError}</span>
            <button type="button" onClick={() => void loadOverview()}>Tentar novamente</button>
          </div>
        )}

        <section className={`administration-cockpit-status ${statusTone}`} aria-labelledby="administration-status-title">
          <span className="administration-cockpit-status__icon">
            {!overview && !overviewError ? <LoaderCircle className="is-spinning" /> : healthy ? <CheckCircle2 /> : <AlertTriangle />}
          </span>
          <div className="administration-cockpit-status__copy">
            <small>Status da biblioteca</small>
            <strong id="administration-status-title">{statusTitle}</strong>
            <span>{statusDetail}</span>
          </div>
          {overview && (
            <dl className="administration-cockpit-status__meta">
              <div><dt>Scanner</dt><dd>{scannerLabel}</dd></div>
              <div><dt>Último scan</dt><dd>{formatScanDate(overview.scanner.scannedAt)}</dd></div>
            </dl>
          )}
        </section>

        <section className="administration-cockpit-section" aria-labelledby="administration-actions-title">
          <div className="administration-cockpit-section__heading">
            <div><strong id="administration-actions-title">Ações rápidas</strong><small>Acesse diretamente as ferramentas mais usadas.</small></div>
          </div>
          <div className="administration-cockpit-actions">
            <button type="button" onClick={() => setView('tracks')}><ListMusic /><span>Gerenciar músicas</span></button>
            <button type="button" onClick={() => setView('import')}><FileInput /><span>Importar mídia</span></button>
            <button type="button" onClick={() => setView('integrity')}><ScanLine /><span>Integridade</span></button>
            <button type="button" onClick={() => setView('duplicates')}><Copy /><span>Duplicatas</span></button>
            <button type="button" onClick={() => setView('users')}><Users /><span>Usuários</span></button>
            <button type="button" onClick={openAllMetadata}><Database /><span>Metadados</span></button>
            <button type="button" onClick={() => setView('quarantine')}><Trash2 /><span>Lixeira</span></button>
            <button type="button" onClick={() => setView('operations')}><ShieldCheck /><span>Histórico</span></button>
          </div>
        </section>

        {loadingOverview && !overview ? (
          <div className="administration-cockpit-loading" role="status">
            <LoaderCircle className="is-spinning" /> Carregando visão geral…
          </div>
        ) : overview ? (
          <>
            <section className="administration-cockpit-section" aria-labelledby="administration-library-title">
              <div className="administration-cockpit-section__heading">
                <div><strong id="administration-library-title">Biblioteca</strong><small>Os indicadores essenciais em um único lugar.</small></div>
              </div>
              <div className="administration-cockpit-metrics">
                <article><span><Music2 /></span><div><small>Faixas</small><strong>{overview.tracks.total.toLocaleString('pt-BR')}</strong></div></article>
                <article><span><HardDrive /></span><div><small>Biblioteca física</small><strong>{formatBytes(overview.storage.libraryBytes)}</strong></div></article>
                <article className={problemCount > 0 ? 'has-warning' : ''}><span><AlertTriangle /></span><div><small>Metadados</small><strong>{problemCount.toLocaleString('pt-BR')}</strong></div></article>
                <article className={integrityCount > 0 ? 'has-warning' : ''}><span><ScanLine /></span><div><small>Integridade</small><strong>{integrityVerified ? integrityCount.toLocaleString('pt-BR') : '—'}</strong></div></article>
              </div>
            </section>

            {attentionCount > 0 && (
              <section className="administration-cockpit-section administration-cockpit-attention" aria-labelledby="administration-attention-title">
                <div className="administration-cockpit-section__heading">
                  <div><strong id="administration-attention-title">Atenção necessária</strong><small>Mostramos apenas o que precisa de ação.</small></div>
                </div>
                <div className="administration-cockpit-attention__items">
                  {overview.problems.missingTitle > 0 && <button type="button" onClick={() => openHealthProblem('missingTitle', 'Sem título')}><span>Sem título</span><strong>{overview.problems.missingTitle.toLocaleString('pt-BR')}</strong></button>}
                  {overview.problems.missingCover > 0 && <button type="button" onClick={() => openHealthProblem('missingCover', 'Sem capa')}><span>Sem capa</span><strong>{overview.problems.missingCover.toLocaleString('pt-BR')}</strong></button>}
                  {overview.problems.unknownArtist > 0 && <button type="button" onClick={() => openHealthProblem('unknownArtist', 'Artista desconhecido')}><span>Artista desconhecido</span><strong>{overview.problems.unknownArtist.toLocaleString('pt-BR')}</strong></button>}
                  {overview.problems.unknownAlbum > 0 && <button type="button" onClick={() => openHealthProblem('unknownAlbum', 'Álbum desconhecido')}><span>Álbum desconhecido</span><strong>{overview.problems.unknownAlbum.toLocaleString('pt-BR')}</strong></button>}
                  {overview.problems.missingDuration > 0 && <button type="button" onClick={() => openHealthProblem('missingDuration', 'Duração indisponível')}><span>Duração indisponível</span><strong>{overview.problems.missingDuration.toLocaleString('pt-BR')}</strong></button>}
                  {integrityCount > 0 && <button type="button" onClick={() => setView('integrity')}><span>Inconsistências de integridade</span><strong>{integrityCount.toLocaleString('pt-BR')}</strong></button>}
                </div>
              </section>
            )}

            <div className="administration-cockpit-lower-grid">
              <section className="administration-cockpit-section" aria-labelledby="administration-activity-title">
                <div className="administration-cockpit-section__heading">
                  <div><strong id="administration-activity-title">Atividade e diagnóstico</strong><small>Últimos estados conhecidos.</small></div>
                  <button className="administration-cockpit-section__link" type="button" onClick={() => setView('operations')}>Ver histórico</button>
                </div>
                <dl className="administration-cockpit-activity">
                  <div><dt>Último scan</dt><dd>{formatScanDate(overview.scanner.scannedAt)}</dd></div>
                  <div><dt>Rescan automático</dt><dd>{formatAutoRescan(overview.scanner)}</dd></div>
                  <div><dt>Integridade</dt><dd>{integrityVerified ? formatScanDate(overview.integrity.checkedAt) : 'Ainda não verificada'}</dd></div>
                  <div><dt>Scanner</dt><dd>{scannerLabel}</dd></div>
                </dl>
              </section>

              <section className="administration-cockpit-section" aria-labelledby="administration-storage-title">
                <div className="administration-cockpit-section__heading">
                  <div><strong id="administration-storage-title">Armazenamento e cache</strong><small>Dados persistidos e arquivos derivados.</small></div>
                </div>

                {cacheError && <div className="administration-cockpit-cache-message is-error" role="alert">{cacheError}</div>}
                {cacheFeedback && <div className={`administration-cockpit-cache-message ${cacheFeedback.error ? 'is-error' : 'is-success'}`} role={cacheFeedback.error ? 'alert' : 'status'}>{cacheFeedback.message}</div>}

                <dl className="administration-cockpit-storage">
                  <div><dt>SQLite</dt><dd>{overview.storage.databaseBytes == null ? 'Indisponível' : formatBytes(overview.storage.databaseBytes)}</dd></div>
                  <div><dt>Cache</dt><dd>{cache ? formatBytes(cache.bytes) : loadingCache ? 'Carregando…' : 'Indisponível'}</dd></div>
                  <div><dt>Limite</dt><dd>{cache ? formatBytes(cache.limitBytes) : '—'}</dd></div>
                  <div><dt>Transcoding</dt><dd>{cache ? formatCacheActivity(cache) : '—'}</dd></div>
                </dl>

                <button
                  className="administration-cockpit-clear-cache"
                  type="button"
                  disabled={!cache || cache.bytes === 0 || cacheBusy || clearingCache}
                  title={cacheBusy ? 'Aguarde o transcoding em andamento terminar.' : undefined}
                  onClick={() => void clearTranscodeCache()}
                >
                  {clearingCache ? <LoaderCircle className="is-spinning" /> : <Trash2 />}
                  {clearingCache ? 'Limpando…' : 'Limpar cache derivado'}
                </button>
              </section>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
