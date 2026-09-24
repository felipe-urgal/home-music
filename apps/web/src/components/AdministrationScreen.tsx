import { useCallback, useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@home-music/shared';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  FileInput,
  HardDrive,
  History,
  Link2,
  ListMusic,
  LoaderCircle,
  Music2,
  RefreshCw,
  ScanLine,
  Sparkles,
  Tag,
  Trash2,
  UserRound,
  Users
} from 'lucide-react';
import {
  getAdminLibraryOverview,
  runAdminLibraryScan,
  type AdminLibraryHealthOverview,
  type AdminLibraryProblemKey
} from '../admin-library-client';
import '../administration-health.css';
import { LIBRARY_CHANGED_EVENT } from '../library-events';
import { AdminImportMediaScreen } from './AdminImportMediaScreen';
import { AdminLibraryAssistantWithLocalLyricsScreen } from './AdminLibraryAssistantWithLocalLyricsScreen';
import { AdminLibraryDuplicateReviewScreen } from './AdminLibraryDuplicateReviewScreen';
import { AdminLibraryIntegrityScreen } from './AdminLibraryIntegrityScreen';
import { AdminLibraryNormalizationScreen } from './AdminLibraryNormalizationScreen';
import { AdminMediaQuarantineScreen } from './AdminMediaQuarantineScreen';
import { AdminOperationHistoryScreen } from './AdminOperationHistoryScreen';
import { AdminTrackAvailabilityScreen } from './AdminTrackAvailabilityScreen';
import { AdminTrackMetadataScreen } from './AdminTrackMetadataScreen';
import { AdminUsersScreen } from './AdminUsersScreen';

type AdministrationView = 'overview' | 'assistant' | 'tracks' | 'metadata' | 'normalization' | 'integrity' | 'duplicates' | 'quarantine' | 'import' | 'operations' | 'users';

type AdministrationScreenProps = {
  currentUser: AuthenticatedUser;
  onBack: () => void;
};

type MetadataHealthFilter = {
  problem: AdminLibraryProblemKey;
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

export function AdministrationScreen({ currentUser, onBack }: AdministrationScreenProps) {
  const [view, setView] = useState<AdministrationView>('overview');
  const [overview, setOverview] = useState<AdminLibraryHealthOverview | null>(null);
  const [metadataHealthFilter, setMetadataHealthFilter] = useState<MetadataHealthFilter | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [runningScan, setRunningScan] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);

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

  useEffect(() => {
    if (currentUser.role !== 'admin') return;
    void loadOverview();
  }, [currentUser.role, loadOverview]);

  useEffect(() => {
    if (currentUser.role !== 'admin') return;
    const onLibraryChanged = () => { void loadOverview(); };
    window.addEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);
  }, [currentUser.role, loadOverview]);

  useEffect(() => {
    if (!overview) return;
    setMetadataHealthFilter(current => {
      if (!current) return current;
      return {
        ...current,
        trackIds: overview.problems.trackIds[current.problem] ?? []
      };
    });
  }, [overview]);

  function openHealthProblem(problem: AdminLibraryProblemKey, label: string) {
    const trackIds = overview?.problems.trackIds[problem] ?? [];
    if (trackIds.length === 0) return;
    setMetadataHealthFilter({ problem, label, trackIds });
    setView('metadata');
  }

  function openAllMetadata() {
    setMetadataHealthFilter(null);
    setView('metadata');
  }

  async function runScan() {
    if (runningScan || overview?.scanner.scanning) return;
    setRunningScan(true);
    setScanError(null);
    setScanFeedback(null);
    try {
      const result = await runAdminLibraryScan();
      await loadOverview();
      const changed = result.added + result.updated + result.removed;
      setScanFeedback(
        changed === 0
          ? `Scan concluído: ${result.tracks.toLocaleString('pt-BR')} faixas verificadas, sem alterações.`
          : `Scan concluído: ${result.added.toLocaleString('pt-BR')} adicionadas, ${result.updated.toLocaleString('pt-BR')} atualizadas e ${result.removed.toLocaleString('pt-BR')} removidas.`
      );
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Não foi possível executar o scan da biblioteca.');
    } finally {
      setRunningScan(false);
    }
  }

  if (currentUser.role !== 'admin') return null;

  if (view === 'assistant') return <AdminLibraryAssistantWithLocalLyricsScreen onBack={() => setView('overview')} />;
  if (view === 'tracks') return <AdminTrackAvailabilityScreen onBack={() => setView('overview')} />;
  if (view === 'metadata') {
    return (
      <AdminTrackMetadataScreen
        initialHealthFilter={metadataHealthFilter}
        onHealthFilterCleared={() => setMetadataHealthFilter(null)}
        onBack={() => setView('overview')}
      />
    );
  }
  if (view === 'normalization') return <AdminLibraryNormalizationScreen onBack={() => setView('overview')} />;
  if (view === 'integrity') {
    return (
      <AdminLibraryIntegrityScreen
        onBack={() => setView('overview')}
        onOpenTracks={() => setView('tracks')}
        onOpenMetadata={openAllMetadata}
        onOpenDuplicates={() => setView('duplicates')}
      />
    );
  }
  if (view === 'duplicates') return <AdminLibraryDuplicateReviewScreen onBack={() => setView('overview')} />;
  if (view === 'quarantine') return <AdminMediaQuarantineScreen onBack={() => setView('overview')} />;
  if (view === 'import') return <AdminImportMediaScreen onBack={() => setView('overview')} />;
  if (view === 'operations') return <AdminOperationHistoryScreen onBack={() => setView('overview')} />;
  if (view === 'users') return <AdminUsersScreen currentUser={currentUser} onBack={() => setView('overview')} />;

  const problemCount = overview?.problems.affectedTracks ?? 0;
  const integrityCount = overview?.integrity.counts.total ?? 0;
  const integrityVerified = Boolean(overview?.integrity.checkedAt);
  const attentionCount = problemCount + integrityCount;
  const scannerActive = Boolean(runningScan || overview?.scanner.scanning);
  const scannerReady = Boolean(overview?.scanner.ready && !scannerActive);
  const healthy = Boolean(
    overview
    && !overviewError
    && scannerReady
    && integrityVerified
    && attentionCount === 0
  );
  const statusTitle = !overview
    ? 'Carregando biblioteca'
    : healthy
      ? 'Biblioteca em dia'
      : scannerActive
        ? 'Biblioteca sendo atualizada'
        : attentionCount > 0
          ? 'Há itens para revisar'
          : !integrityVerified
            ? 'Integridade ainda não verificada'
            : 'Biblioteca requer atenção';
  const statusDetail = !overview
    ? 'Consultando o estado atual.'
    : healthy
      ? 'Sua biblioteca está pronta para uso.'
      : attentionCount > 0
        ? `${attentionCount.toLocaleString('pt-BR')} ${attentionCount === 1 ? 'música precisa' : 'músicas precisam'} de revisão.`
        : !integrityVerified
          ? 'Execute a verificação de integridade para concluir o diagnóstico.'
          : 'O scanner ainda não marcou a biblioteca como pronta para uso.';

  return (
    <section className="my-account-screen administration-screen administration-cockpit" aria-labelledby="administration-title">
      <header className="administration-cockpit__header">
        <button className="administration-cockpit__back" type="button" aria-label="Voltar" onClick={onBack}>
          <ChevronLeft />
        </button>
        <div className="administration-cockpit__title">
          <strong id="administration-title">Administração</strong>
          <small>Foque no que precisa ser feito</small>
        </div>
        <div className={`administration-cockpit__header-status ${healthy ? 'is-healthy' : attentionCount > 0 ? 'has-warning' : ''}`}>
          <span />
          <div>
            <strong>{scannerActive ? 'Scanner atualizando' : healthy ? 'Biblioteca pronta' : attentionCount > 0 ? 'Revisão necessária' : scannerReady ? 'Scanner pronto' : 'Biblioteca carregando'}</strong>
            <small>Último scan em {formatScanDate(overview?.scanner.scannedAt ?? null)}</small>
          </div>
        </div>
      </header>

      <div className="administration-cockpit__content">
        {overviewError && (
          <div className="my-account-message is-error administration-cockpit__message" role="alert">
            <span>{overviewError}</span>
            <button type="button" onClick={() => void loadOverview()}>Tentar novamente</button>
          </div>
        )}

        {scanError && (
          <div className="my-account-message is-error administration-cockpit__message" role="alert">
            <span>{scanError}</span>
            <button type="button" onClick={() => void runScan()}>Tentar novamente</button>
          </div>
        )}
        {scanFeedback && (
          <div className="my-account-message is-success administration-cockpit__message" role="status">
            <span>{scanFeedback}</span>
          </div>
        )}

        {loadingOverview && !overview ? (
          <div className="administration-cockpit-loading" role="status">
            <LoaderCircle className="is-spinning" /> Carregando visão geral…
          </div>
        ) : overview ? (
          <>
            <section className={`administration-cockpit-status ${healthy ? 'is-healthy' : 'has-warning'}`} aria-labelledby="administration-status-title">
              <span className="administration-cockpit-status__icon">
                {healthy ? <CheckCircle2 /> : <AlertTriangle />}
              </span>
              <div className="administration-cockpit-status__copy">
                <strong id="administration-status-title">{statusTitle}</strong>
                <span>{statusDetail}</span>
              </div>

              <div className="administration-cockpit-status__metrics">
                <article>
                  <Music2 />
                  <div><strong>{overview.tracks.total.toLocaleString('pt-BR')}</strong><small>faixas</small></div>
                </article>
                <article>
                  <HardDrive />
                  <div><strong>{formatBytes(overview.storage.libraryBytes)}</strong><small>biblioteca</small></div>
                </article>
                <article className="is-scanner">
                  <RefreshCw className={scannerActive ? 'is-spinning' : ''} />
                  <div>
                    <strong>{scannerActive ? 'Scanner atualizando' : overview.scanner.ready ? 'Scanner pronto' : 'Scanner requer atenção'}</strong>
                    <small>Último scan em<br />{formatScanDate(overview.scanner.scannedAt)}</small>
                  </div>
                  <button
                    type="button"
                    className="administration-cockpit-status__scan"
                    disabled={scannerActive}
                    onClick={() => void runScan()}
                  >
                    {scannerActive ? <LoaderCircle className="is-spinning" /> : <RefreshCw />}
                    {scannerActive ? 'Executando…' : 'Executar scan'}
                  </button>
                </article>
              </div>
            </section>

            {attentionCount > 0 && (
              <section className="administration-cockpit-attention" aria-labelledby="administration-attention-title">
                <div className="administration-cockpit-section__heading">
                  <div className="administration-cockpit-attention__heading-copy">
                    <AlertTriangle />
                    <div>
                      <strong id="administration-attention-title">Atenção necessária</strong>
                      <small>{problemCount.toLocaleString('pt-BR')} {problemCount === 1 ? 'música precisa' : 'músicas precisam'} de revisão.</small>
                    </div>
                  </div>
                  <button className="administration-cockpit-section__link" type="button" onClick={openAllMetadata}>Ver todas</button>
                </div>

                <div className="administration-cockpit-attention__items">
                  {overview.problems.missingCover > 0 && (
                    <button className="is-cover" type="button" onClick={() => openHealthProblem('missingCover', 'Sem capa')}>
                      <span className="administration-cockpit-attention__icon"><Database /></span>
                      <span><strong>{overview.problems.missingCover.toLocaleString('pt-BR')}</strong><small>Sem capa</small></span>
                      <ChevronRight />
                    </button>
                  )}
                  {overview.problems.unknownAlbum > 0 && (
                    <button className="is-album" type="button" onClick={() => openHealthProblem('unknownAlbum', 'Álbum desconhecido')}>
                      <span className="administration-cockpit-attention__icon"><Tag /></span>
                      <span><strong>{overview.problems.unknownAlbum.toLocaleString('pt-BR')}</strong><small>Álbum desconhecido</small></span>
                      <ChevronRight />
                    </button>
                  )}
                  {overview.problems.unknownArtist > 0 && (
                    <button className="is-artist" type="button" onClick={() => openHealthProblem('unknownArtist', 'Artista desconhecido')}>
                      <span className="administration-cockpit-attention__icon"><UserRound /></span>
                      <span><strong>{overview.problems.unknownArtist.toLocaleString('pt-BR')}</strong><small>Artista desconhecido</small></span>
                      <ChevronRight />
                    </button>
                  )}
                  {overview.problems.missingTitle > 0 && (
                    <button className="is-title" type="button" onClick={() => openHealthProblem('missingTitle', 'Sem título')}>
                      <span className="administration-cockpit-attention__icon"><Music2 /></span>
                      <span><strong>{overview.problems.missingTitle.toLocaleString('pt-BR')}</strong><small>Sem título</small></span>
                      <ChevronRight />
                    </button>
                  )}
                  {overview.problems.missingDuration > 0 && (
                    <button className="is-duration" type="button" onClick={() => openHealthProblem('missingDuration', 'Duração indisponível')}>
                      <span className="administration-cockpit-attention__icon"><History /></span>
                      <span><strong>{overview.problems.missingDuration.toLocaleString('pt-BR')}</strong><small>Duração indisponível</small></span>
                      <ChevronRight />
                    </button>
                  )}
                  {integrityCount > 0 && (
                    <button className="is-integrity" type="button" onClick={() => setView('integrity')}>
                      <span className="administration-cockpit-attention__icon"><ScanLine /></span>
                      <span><strong>{integrityCount.toLocaleString('pt-BR')}</strong><small>Integridade</small></span>
                      <ChevronRight />
                    </button>
                  )}
                </div>
              </section>
            )}

            <section className="administration-cockpit-section administration-cockpit-primary" aria-labelledby="administration-primary-title">
              <div className="administration-cockpit-section__heading">
                <div>
                  <strong id="administration-primary-title">Ações principais</strong>
                  <small>Gerencie e mantenha sua biblioteca.</small>
                </div>
              </div>
              <div className="administration-cockpit-primary__grid">
                <button className="is-tracks" type="button" onClick={() => setView('tracks')}>
                  <ListMusic />
                  <span><strong>Gerenciar músicas</strong><small>Visualize, edite e organize sua biblioteca.</small></span>
                  <ChevronRight />
                </button>
                <button className="is-import" type="button" onClick={() => setView('import')}>
                  <FileInput />
                  <span><strong>Importar mídia</strong><small>Adicione novas músicas à sua biblioteca.</small></span>
                  <ChevronRight />
                </button>
                <button className="is-metadata" type="button" onClick={openAllMetadata}>
                  <Sparkles />
                  <span><strong>Metadados</strong><small>Corrija e edite informações das músicas.</small></span>
                  <ChevronRight />
                </button>
                <button className="is-assistant" type="button" onClick={() => setView('assistant')}>
                  <Sparkles />
                  <span><strong>Assistente da Biblioteca</strong><small>Correções automáticas, capas e sugestões.</small></span>
                  <ChevronRight />
                </button>
              </div>
            </section>

            <div className="administration-cockpit-bottom">
              <section className="administration-cockpit-section administration-cockpit-users" aria-labelledby="administration-users-title">
                <div className="administration-cockpit-section__heading">
                  <div>
                    <strong id="administration-users-title">Administração</strong>
                    <small>Usuários e acessos.</small>
                  </div>
                </div>
                <button type="button" onClick={() => setView('users')}>
                  <Users />
                  <span><strong>Usuários</strong><small>Gerencie os usuários do Home Music.</small></span>
                  <ChevronRight />
                </button>
              </section>

              <section className="administration-cockpit-section administration-cockpit-maintenance" aria-labelledby="administration-maintenance-title">
                <div className="administration-cockpit-section__heading">
                  <div>
                    <strong id="administration-maintenance-title">Manutenção</strong>
                    <small>Ferramentas para manter sua biblioteca saudável.</small>
                  </div>
                </div>
                <div className="administration-cockpit-maintenance__grid">
                  <button className="is-integrity" type="button" onClick={() => setView('integrity')}>
                    <ScanLine />
                    <span><strong>Integridade</strong><small>Verifique problemas na biblioteca.</small></span>
                    <ChevronRight />
                  </button>
                  <button className="is-duplicates" type="button" onClick={() => setView('duplicates')}>
                    <Copy />
                    <span><strong>Duplicatas</strong><small>Encontre músicas duplicadas.</small></span>
                    <ChevronRight />
                  </button>
                  <button className="is-normalization" type="button" onClick={() => setView('normalization')}>
                    <Link2 />
                    <span><strong>Normalização</strong><small>Padronize informações da sua biblioteca.</small></span>
                    <ChevronRight />
                  </button>
                  <button className="is-trash" type="button" onClick={() => setView('quarantine')}>
                    <Trash2 />
                    <span><strong>Lixeira</strong><small>Gerencie itens removidos.</small></span>
                    <ChevronRight />
                  </button>
                  <button className="is-history" type="button" onClick={() => setView('operations')}>
                    <History />
                    <span><strong>Histórico</strong><small>Veja as últimas ações realizadas.</small></span>
                    <ChevronRight />
                  </button>
                </div>
              </section>
            </div>

            <footer className="administration-cockpit__footer" aria-hidden="true">
              <span>Home Music&nbsp;&nbsp;•&nbsp;&nbsp;Música para uma vida mais sua.</span>
              <span>Ouça&nbsp;&nbsp;•&nbsp;&nbsp;Organize&nbsp;&nbsp;•&nbsp;&nbsp;Viva melhor <i /></span>
            </footer>
          </>
        ) : null}
      </div>
    </section>
  );
}
