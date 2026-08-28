import { useEffect, useMemo, useState } from 'react';
import type { AdminTrack, AdminTrackMoveResponse } from '@home-music/shared';
import { Folder, LoaderCircle, MoveRight, ShieldCheck, X } from 'lucide-react';
import { getAdminTrackLocation, moveAdminTrack } from '../admin-tracks-client';

type AdminTrackMoveDialogProps = {
  track: AdminTrack;
  onClose: () => void;
  onMoved: (response: AdminTrackMoveResponse) => void;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível mover o arquivo.';
}

function targetPath(folderPath: string, fileName: string) {
  const folder = folderPath.trim().replace(/^\/+|\/+$/g, '');
  const name = fileName.trim();
  if (!name) return folder;
  return folder ? `${folder}/${name}` : name;
}

export function AdminTrackMoveDialog({ track, onClose, onMoved }: AdminTrackMoveDialogProps) {
  const [folderPath, setFolderPath] = useState('');
  const [fileName, setFileName] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destinationPreview = useMemo(
    () => targetPath(folderPath, fileName),
    [fileName, folderPath]
  );
  const unchanged = Boolean(currentPath && destinationPreview === currentPath);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const location = await getAdminTrackLocation(track.id);
        if (cancelled) return;
        setFolderPath(location.folderPath);
        setFileName(location.fileName);
        setCurrentPath(location.relativePath);
      } catch (error) {
        if (!cancelled) setError(errorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [track.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  async function submit() {
    if (loading || saving || !fileName.trim() || unchanged) return;
    setSaving(true);
    setError(null);
    try {
      const response = await moveAdminTrack(track.id, {
        folderPath: folderPath.trim(),
        fileName: fileName.trim()
      });
      onMoved(response);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="admin-file-move-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="admin-file-move-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-file-move-title"
      >
        <header className="admin-file-move-dialog__header">
          <div>
            <strong id="admin-file-move-title">Organizar arquivo</strong>
            <small>{track.title} · {track.artist}</small>
          </div>
          <button type="button" aria-label="Fechar organização de arquivo" disabled={saving} onClick={onClose}>
            <X />
          </button>
        </header>

        {loading ? (
          <div className="admin-file-move-dialog__loading" role="status">
            <LoaderCircle className="is-spinning" /> Carregando caminho atual…
          </div>
        ) : (
          <form onSubmit={event => { event.preventDefault(); void submit(); }}>
            {error && <div className="admin-file-move-dialog__message is-error" role="alert">{error}</div>}

            <div className="admin-file-move-dialog__notice" role="note">
              <ShieldCheck />
              <div>
                <strong>Movimentação confinada à biblioteca</strong>
                <small>O servidor bloqueia traversal, symlinks, colisões e troca de extensão. Letras locais acompanham o áudio.</small>
              </div>
            </div>

            <div className="admin-file-move-dialog__current">
              <span>Caminho atual</span>
              <code>{currentPath || 'Indisponível'}</code>
            </div>

            <div className="admin-file-move-fields">
              <label>
                <span>Pasta dentro de MUSIC_DIR</span>
                <input
                  autoFocus
                  value={folderPath}
                  disabled={saving}
                  maxLength={2048}
                  placeholder="Ex.: Rock/Queen/A Night at the Opera"
                  onChange={event => { setFolderPath(event.target.value); setError(null); }}
                />
                <small>Deixe vazio para mover para a raiz da biblioteca.</small>
              </label>
              <label>
                <span>Nome do arquivo</span>
                <input
                  required
                  value={fileName}
                  disabled={saving}
                  maxLength={255}
                  onChange={event => { setFileName(event.target.value); setError(null); }}
                />
                <small>A extensão atual deve ser mantida.</small>
              </label>
            </div>

            <div className="admin-file-move-dialog__target" aria-live="polite">
              <Folder />
              <div>
                <span>Destino</span>
                <code>{destinationPreview || 'Informe o nome do arquivo'}</code>
              </div>
            </div>

            <footer className="admin-file-move-dialog__actions">
              <button type="button" className="is-secondary" disabled={saving} onClick={onClose}>Cancelar</button>
              <button type="submit" className="is-primary" disabled={saving || loading || !fileName.trim() || unchanged}>
                {saving ? <LoaderCircle className="is-spinning" /> : <MoveRight />}
                {unchanged ? 'Sem alterações' : 'Mover arquivo'}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
