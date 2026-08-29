import { useEffect, useRef, useState } from 'react';
import type { ImportJob } from '@home-music/shared';
import {
  CheckCircle2,
  ChevronDown,
  Folder,
  FolderInput,
  LoaderCircle,
  Plus,
  ShieldAlert
} from 'lucide-react';
import {
  getAdminImportDestination,
  getAdminImportDestinationFolders,
  promoteAdminImport,
  type AdminImportDestinationFolder,
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
  const [folders, setFolders] = useState<AdminImportDestinationFolder[]>([]);
  const [plan, setPlan] = useState<AdminImportDestinationPlan | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const planRequestRef = useRef(0);
  const ready = duplicateReady(check);

  const loadPlan = async (nextFolderPath: string) => {
    if (!ready || promoting) return false;
    const requestId = ++planRequestRef.current;
    setFolderPath(nextFolderPath);
    setPlan(null);
    setLoading(true);
    setError(null);
    try {
      const nextPlan = await getAdminImportDestination(job.id, nextFolderPath);
      if (planRequestRef.current !== requestId) return false;
      setPlan(nextPlan);
      return true;
    } catch (caught) {
      if (planRequestRef.current !== requestId) return false;
      setError(caught instanceof Error ? caught.message : 'Não foi possível calcular o destino.');
      return false;
    } finally {
      if (planRequestRef.current === requestId) setLoading(false);
    }
  };

  useEffect(() => {
    const requestId = ++planRequestRef.current;
    if (!ready) {
      setPlan(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      getAdminImportDestination(job.id, 'Importados'),
      getAdminImportDestinationFolders().catch(() => [] as AdminImportDestinationFolder[])
    ])
      .then(([destination, availableFolders]) => {
        if (!active || planRequestRef.current !== requestId) return;
        setFolderPath('Importados');
        setPlan(destination);
        setFolders(availableFolders);
      })
      .catch(caught => {
        if (!active || planRequestRef.current !== requestId) return;
        setPlan(null);
        setError(caught instanceof Error ? caught.message : 'Não foi possível calcular o destino.');
      })
      .finally(() => {
        if (active && planRequestRef.current === requestId) setLoading(false);
      });
    return () => { active = false; };
  }, [job.id, job.metadataPreview?.generatedAt, ready]);

  const useNewFolder = async () => {
    const next = newFolderPath.trim();
    if (!next || loading || promoting) return;
    const accepted = await loadPlan(next);
    if (accepted) setCreatingFolder(false);
  };

  const promote = async () => {
    if (!ready || !plan || promoting || loading) return;
    setPromoting(true);
    setError(null);
    try {
      const result = await promoteAdminImport(job.id, folderPath);
      onJobUpdated(result.job);
    } catch (caught) {
      setPlan(null);
      setError(caught instanceof Error ? caught.message : 'Não foi possível importar a mídia para a biblioteca.');
    } finally {
      setPromoting(false);
    }
  };

  if (check.disposition === 'blocked') {
    return (
      <div className="admin-import-destination is-blocked">
        <ShieldAlert />
        <span>
          <strong>Importação bloqueada</strong>
          <small>Essa música já existe na biblioteca.</small>
        </span>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="admin-import-destination is-waiting">
        <FolderInput />
        <span>
          <strong>Escolher destino</strong>
          <small>Conclua a revisão da possível duplicata para continuar.</small>
        </span>
      </div>
    );
  }

  const selectedFolder = folders.find(folder => folder.path === folderPath) ?? null;

  return (
    <div className="admin-import-destination is-ready">
      <div className="admin-import-destination__heading">
        <Folder />
        <span>
          <strong>Salvar em</strong>
          <small>Escolha uma pasta existente ou crie uma nova.</small>
        </span>
      </div>

      <div className="admin-import-destination__picker">
        <Folder />
        <div className="admin-import-destination__select-wrap">
          <select
            aria-label="Pasta de destino"
            value={folderPath}
            disabled={loading || promoting}
            onChange={event => {
              const next = event.target.value;
              setCreatingFolder(false);
              void loadPlan(next);
            }}
          >
            {!folders.some(folder => folder.path === 'Importados') && <option value="Importados">Importados</option>}
            {folders.map(folder => <option value={folder.path} key={folder.path}>{folder.path}</option>)}
          </select>
          <ChevronDown aria-hidden="true" />
        </div>
        <small>
          {selectedFolder
            ? `${selectedFolder.trackCount} ${selectedFolder.trackCount === 1 ? 'música' : 'músicas'}`
            : folderPath === 'Importados'
              ? 'Pasta padrão'
              : 'Nova pasta'}
        </small>
      </div>

      {!creatingFolder ? (
        <button
          className="admin-import-destination__create"
          type="button"
          disabled={loading || promoting}
          onClick={() => {
            setCreatingFolder(true);
            setNewFolderPath('');
            setError(null);
          }}
        >
          <Plus /> Criar nova pasta
        </button>
      ) : (
        <div className="admin-import-destination__new-folder">
          <label htmlFor={`admin-import-new-folder-${job.id}`}>Nova pasta</label>
          <div>
            <input
              id={`admin-import-new-folder-${job.id}`}
              type="text"
              maxLength={1024}
              value={newFolderPath}
              placeholder="Ex.: Rock/Jota Quest"
              disabled={loading || promoting}
              autoFocus
              onChange={event => {
                setNewFolderPath(event.target.value);
                if (error) setError(null);
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void useNewFolder();
                }
              }}
            />
            <button type="button" disabled={!newFolderPath.trim() || loading || promoting} onClick={() => void useNewFolder()}>
              {loading ? <LoaderCircle className="is-spinning" /> : <CheckCircle2 />}
              Usar pasta
            </button>
          </div>
          <button className="admin-import-destination__cancel-new" type="button" onClick={() => setCreatingFolder(false)}>Cancelar</button>
        </div>
      )}

      {plan && (
        <div className="admin-import-destination__plan">
          <CheckCircle2 />
          <span>
            <small>Arquivo final</small>
            <strong>{plan.relativePath}</strong>
            {plan.collisionIndex > 1 && <small>Nome ajustado automaticamente para evitar colisão.</small>}
          </span>
        </div>
      )}

      <button
        className="admin-import-destination__primary"
        type="button"
        disabled={!plan || loading || promoting}
        onClick={() => void promote()}
      >
        {promoting ? <LoaderCircle className="is-spinning" /> : <FolderInput />}
        {promoting ? 'Importando…' : 'Importar para biblioteca'}
      </button>

      <small className="admin-import-destination__safety">Nenhum arquivo existente será sobrescrito.</small>
      {error && <small className="admin-import-destination__error" role="alert">{error}</small>}
    </div>
  );
}
