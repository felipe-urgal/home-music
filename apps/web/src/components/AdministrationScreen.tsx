import { useCallback, useEffect, useState } from 'react';
import type { AdminLibraryOverviewResponse, AuthenticatedUser } from '@home-music/shared';
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
import { getAdminLibraryOverview } from '../admin-library-client';
import { AdminImportMediaScreen } from './AdminImportMediaScreen';
import { AdminMediaQuarantineScreen } from './AdminMediaQuarantineScreen';
import { AdminTrackAvailabilityScreen } from './AdminTrackAvailabilityScreen';
import { AdminTrackMetadataScreen } from './AdminTrackMetadataScreen';
import { AdminUsersScreen } from './AdminUsersScreen';

type AdministrationView = 'overview' | 'tracks' | 'metadata' | 'quarantine' | 'import' | 'users';

type AdministrationScreenProps = {
  currentUser: AuthenticatedUser;
  onBack: () => void;
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

function formatAutoRescan(scanner: AdminLibraryOverviewResponse['scanner']) {
  if (!scanner.autoRescan.enabled || !scanner.autoRescan.intervalSeconds) return 'Automático desativado';
  const minutes = scanner.autoRescan.intervalSeconds / 60;
  return `Automático a cada ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(minutes)} min`;
}

export function AdministrationScreen({ currentUser, onBack }: AdministrationScreenProps) {
  const [view, setView] = useState<AdministrationView>('overview');
  const [overview, setOverview] = useState<AdminLibraryOverviewResponse | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

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

  if (currentUser.role !== 'admin') return null;

  if (view === 'tracks') {
    return <AdminTrackAvailabilityScreen onBack={() => setView('overview')} />;
  }

  if (view === 'metadata') {
    return <AdminTrackMetadataScreen onBack={() => setView('overview')} />;
  }

  if (view === 'quarantine') {
    return <AdminMediaQuarantineScreen onBack={() => setView('overview')} />;
  }

  if (view === 'import') {
    return <AdminImportMediaScreen onBack={() => setView('overview')} />;
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
              disabled={loadingOverview}
              onClick={() => void loadOverview()}
            >
              <RefreshCw className={loadingOverview ? 'is-spinning' : ''} />
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

                <article className="administration-metric" aria-label="Armazenamento da biblioteca">
                  <span className="administration-metric__icon"><HardDrive /></span>
                  <div><small>Armazenamento</small><strong>{formatBytes(overview.storage.libraryBytes)}</strong></div>
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
                    <div><dt>Sem capa</dt><dd>{overview.problems.missingCover.toLocaleString('pt-BR')}</dd></div>
                    <div><dt>Artista desconhecido</dt><dd>{overview.problems.unknownArtist.toLocaleString('pt-BR')}</dd></div>
                    <div><dt>Álbum desconhecido</dt><dd>{overview.problems.unknownAlbum.toLocaleString('pt-BR')}</dd></div>
                    <div><dt>Duração indisponível</dt><dd>{overview.problems.missingDuration.toLocaleString('pt-BR')}</dd></div>
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
            <button type="button" onClick={() => setView('metadata')}>
              <span className="my-account-card__icon"><Database /></span>
              <span><strong>Metadados</strong><small>Corrija título, artista e álbum sem modificar o arquivo original.</small></span>
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
