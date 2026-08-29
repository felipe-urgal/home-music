import { useEffect, useState } from 'react';
import type { ImportJob } from '@home-music/shared';
import { CheckCircle2, FolderInput, LoaderCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  getAdminImportDestination,
  promoteAdminImport,
  type AdminImportDestinationPlan
} from '../admin-import-destination-client';
import type { AdminImportDuplicateCheck } from '../admin-import-client';
import '../admin-import-destination.css';

type AdminImportDestinationPanelProps = {
  job: ImportJob;
  check: AdminImportDuplicateCheck;
  onJobUpdated: (job: ImportJob) => void;
};

function duplicateReady(check: AdminImportDuplicateCheck) {
  if (check.disposition === 'blocked') return false;
  if (check.disposition === 'review') return Boolean(check.reviewedAt);
  return true;
}

export function AdminImportDestinationPanel({
  job,
  check,
  onJobUpdated
}: AdminImportDestinationPanelProps) {
  const [folderPath, setFolderPath] = useState('Importados');
  const [plan, setPlan] = useState<AdminImportDestinationPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = duplicateReady(check);

  const loadPlan = async () => {
    if (!ready || loading || promoting) return;
    setLoading(true);
    setError(null);
    try {
      setPlan(await getAdminImportDestination(job.id, folderPath));
    } catch (caught) {
      setPlan(null);
      setError(caught instanceof Error ? caught.message : 'Não foi possível calcular o destino.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready) {
      setPlan(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void getAdminImportDestination(job.id, 'Importados')
      .then(result => { if (active) setPlan(result); })
      .catch(caught => {
        if (!active) return;
        setPlan(null);
        setError(caught instanceof Error ? caught.message : 'Não foi possível calcular o destino.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [job.id, job.metadataPreview?.generatedAt, ready]);

  const promote = async () => {
    if (!ready || !plan || promoting || loading) return;
    setPromoting(true);
    setError(null);
    try {
      const result = await promoteAdminImport(job.id, folderPath);
      onJobUpdated(result.job);
    } catch (caught) {
      setPlan(null);
      setError(caught instanceof Error ? caught.message : 'Não foi possível promover a mídia.');
    } finally {
      setPromoting(false);
    }
  };

  if (check.disposition === 'blocked') {
    return (
      <div className="admin-import-destination is-blocked">
        <ShieldAlert />
        <span>
          <strong>Promoção bloqueada</strong>
          <small>Uma duplicata exata já existe na biblioteca. O arquivo permanece no staging.</small>
        </span>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="admin-import-destination is-waiting">
        <FolderInput />
        <span>
          <strong>Destino final</strong>
          <small>Conclua a revisão da duplicata provável para liberar a promoção.</small>
        </span>
      </div>
    );
  }

  return (
    <div className="admin-import-destination is-ready">
      <div className="admin-import-destination__heading">
        <FolderInput />
        <span>
          <strong>Destino final</strong>
          <small>O caminho é validado no servidor e sempre fica confinado a MUSIC_DIR.</small>
        </span>
      </div>

      <div className="admin-import-destination__form">
        <label htmlFor={`admin-import-destination-${job.id}`}>
          Pasta relativa
        </label>
        <div className="admin-import-destination__folder-row">
          <input
            id={`admin-import-destination-${job.id}`}
            type="text"
            value={folderPath}
            maxLength={1024}
            disabled={loading || promoting}
            onChange={event => {
              setFolderPath(event.target.value);
              setPlan(null);
              if (error) setError(null);
            }}
            placeholder="Importados"
          />
          <button type="button" disabled={loading || promoting} onClick={() => void loadPlan()}>
            {loading ? <LoaderCircle className="is-spinning" /> : <RefreshCw />}
            {loading ? 'Calculando…' : 'Atualizar destino'}
          </button>
        </div>
      </div>

      {plan && (
        <div className="admin-import-destination__plan">
          <CheckCircle2 />
          <span>
            <small>Arquivo final</small>
            <strong>{plan.relativePath}</strong>
            {plan.collisionIndex > 1 && (
              <small>Colisão resolvida automaticamente com o sufixo ({plan.collisionIndex}).</small>
            )}
          </span>
        </div>
      )}

      <div className="admin-import-destination__actions">
        <small>A promoção não sobrescreve arquivos existentes e usa operação sem replace no mesmo filesystem.</small>
        <button
          className="is-primary"
          type="button"
          disabled={!plan || loading || promoting}
          onClick={() => void promote()}
        >
          {promoting ? <LoaderCircle className="is-spinning" /> : <FolderInput />}
          {promoting ? 'Promovendo…' : 'Promover para biblioteca'}
        </button>
      </div>

      {error && <small className="admin-import-destination__error" role="alert">{error}</small>}
    </div>
  );
}
