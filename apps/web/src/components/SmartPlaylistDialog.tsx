import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { Playlist, SmartPlaylistRule, Track } from '@home-music/shared';
import './SmartPlaylistDialog.css';

const DEFAULT_RULE: SmartPlaylistRule = {
  artist: null,
  album: null,
  folderPath: null,
  favorite: null,
  history: 'any',
  periodDays: null,
  sort: 'most-played',
  limit: 100
};

type SmartPlaylistDialogProps = {
  open: boolean;
  playlist?: Playlist | null;
  tracks: Track[];
  onPreview: (rule: SmartPlaylistRule) => Promise<string[]>;
  onSave: (name: string, rule: SmartPlaylistRule) => Promise<void>;
  onClose: () => void;
};

function draftForPlaylist(playlist?: Playlist | null) {
  return playlist?.source === 'smart' && playlist.rule
    ? { ...playlist.rule }
    : { ...DEFAULT_RULE };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

export function SmartPlaylistDialog({
  open,
  playlist,
  tracks,
  onPreview,
  onSave,
  onClose
}: SmartPlaylistDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previewRequest = useRef(0);
  const [name, setName] = useState('');
  const [rule, setRule] = useState<SmartPlaylistRule>(DEFAULT_RULE);
  const [previewIds, setPreviewIds] = useState<string[] | null>(null);
  const [previewSignature, setPreviewSignature] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(playlist?.name ?? '');
    setRule(draftForPlaylist(playlist));
    setPreviewIds(null);
    setPreviewSignature(null);
    setPreviewing(false);
    setSaving(false);
    setError(null);
    previewRequest.current += 1;
  }, [open, playlist]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const body = document.body;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';

    return () => {
      root.style.overflow = previousRootOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, [open]);

  const trackMap = useMemo(() => new Map(tracks.map(track => [track.id, track])), [tracks]);
  const previewTracks = useMemo(
    () => (previewIds ?? []).map(id => trackMap.get(id)).filter((track): track is Track => Boolean(track)),
    [previewIds, trackMap]
  );
  const currentSignature = JSON.stringify(rule);
  const previewCurrent = previewSignature === currentSignature && previewIds !== null;
  const canSave = name.trim().length > 0 && previewCurrent && !previewing && !saving;

  function updateRule(patch: Partial<SmartPlaylistRule>) {
    setRule(current => ({ ...current, ...patch }));
    setError(null);
  }

  async function preview() {
    const requestId = ++previewRequest.current;
    setPreviewing(true);
    setError(null);
    try {
      const ids = await onPreview(rule);
      if (previewRequest.current !== requestId) return;
      setPreviewIds(ids);
      setPreviewSignature(JSON.stringify(rule));
    } catch (error) {
      if (previewRequest.current === requestId) setError(errorMessage(error));
    } finally {
      if (previewRequest.current === requestId) setPreviewing(false);
    }
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), rule);
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function close() {
    previewRequest.current += 1;
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="smart-playlist-dialog"
      aria-labelledby="smart-playlist-title"
      onCancel={event => {
        event.preventDefault();
        close();
      }}
    >
      <div className="smart-playlist-dialog__header">
        <div>
          <span className="smart-playlist-dialog__eyebrow"><Sparkles />Playlist inteligente</span>
          <h2 id="smart-playlist-title">{playlist ? 'Editar regra' : 'Nova playlist inteligente'}</h2>
          <p>A lista é recalculada a partir da sua biblioteca, favoritos e histórico.</p>
        </div>
        <button type="button" className="smart-playlist-dialog__close" aria-label="Fechar" onClick={close}>
          <X />
        </button>
      </div>

      <div className="smart-playlist-dialog__body">
        <label className="smart-playlist-field smart-playlist-field--wide">
          <span>Nome</span>
          <input
            value={name}
            maxLength={120}
            autoFocus
            placeholder="Ex.: Favoritas antigas"
            onChange={event => setName(event.target.value)}
          />
        </label>

        <div className="smart-playlist-grid">
          <label className="smart-playlist-field">
            <span>Ordenar por</span>
            <select
              value={rule.sort}
              onChange={event => updateRule({ sort: event.target.value as SmartPlaylistRule['sort'] })}
            >
              <option value="most-played">Mais tocadas</option>
              <option value="recently-played">Tocadas recentemente</option>
              <option value="oldest-favorite">Favoritas mais antigas</option>
              <option value="title">Artista e título</option>
            </select>
          </label>

          <label className="smart-playlist-field">
            <span>Histórico</span>
            <select
              value={rule.history}
              onChange={event => updateRule({ history: event.target.value as SmartPlaylistRule['history'] })}
            >
              <option value="any">Qualquer</option>
              <option value="played">Já tocadas</option>
              <option value="never">Nunca tocadas</option>
            </select>
          </label>

          <label className="smart-playlist-field">
            <span>Favorito</span>
            <select
              value={rule.favorite == null ? 'any' : rule.favorite ? 'yes' : 'no'}
              onChange={event => updateRule({
                favorite: event.target.value === 'any' ? null : event.target.value === 'yes'
              })}
            >
              <option value="any">Qualquer</option>
              <option value="yes">Somente favoritas</option>
              <option value="no">Não favoritas</option>
            </select>
          </label>

          <label className="smart-playlist-field">
            <span>Período do histórico</span>
            <input
              type="number"
              min={1}
              max={3650}
              value={rule.periodDays ?? ''}
              placeholder="Todos os dias"
              onChange={event => updateRule({
                periodDays: event.target.value === '' ? null : Number(event.target.value)
              })}
            />
          </label>

          <label className="smart-playlist-field">
            <span>Artista</span>
            <input
              value={rule.artist ?? ''}
              maxLength={160}
              placeholder="Qualquer artista"
              onChange={event => updateRule({ artist: event.target.value.trim() ? event.target.value : null })}
            />
          </label>

          <label className="smart-playlist-field">
            <span>Álbum</span>
            <input
              value={rule.album ?? ''}
              maxLength={160}
              placeholder="Qualquer álbum"
              onChange={event => updateRule({ album: event.target.value.trim() ? event.target.value : null })}
            />
          </label>

          <label className="smart-playlist-field">
            <span>Pasta</span>
            <input
              value={rule.folderPath ?? ''}
              maxLength={512}
              placeholder="Ex.: Rock/Anos 90"
              onChange={event => updateRule({ folderPath: event.target.value.trim() ? event.target.value : null })}
            />
          </label>

          <label className="smart-playlist-field">
            <span>Limite</span>
            <input
              type="number"
              min={1}
              max={500}
              value={rule.limit}
              onChange={event => updateRule({ limit: Number(event.target.value) })}
            />
          </label>
        </div>

        <section className="smart-playlist-preview" aria-live="polite">
          <div className="smart-playlist-preview__heading">
            <div>
              <strong>Preview</strong>
              <span>{previewCurrent ? `${previewIds.length} músicas encontradas` : 'Gere o preview antes de salvar.'}</span>
            </div>
            <button type="button" disabled={previewing || saving} onClick={() => void preview()}>
              {previewing ? 'Calculando…' : previewCurrent ? 'Atualizar preview' : 'Gerar preview'}
            </button>
          </div>

          {previewCurrent && (
            previewTracks.length > 0 ? (
              <div className="smart-playlist-preview__list">
                {previewTracks.slice(0, 12).map(track => (
                  <div key={track.id}>
                    <strong>{track.title}</strong>
                    <span>{track.artist} · {track.album}</span>
                  </div>
                ))}
                {previewTracks.length > 12 && <small>+ {previewTracks.length - 12} músicas</small>}
              </div>
            ) : (
              <p className="smart-playlist-preview__empty">Nenhuma música corresponde a essa regra.</p>
            )
          )}
        </section>

        {error && <p className="smart-playlist-dialog__error" role="alert">{error}</p>}
      </div>

      <div className="smart-playlist-dialog__footer">
        <button type="button" className="smart-playlist-dialog__secondary" onClick={close} disabled={saving}>
          Cancelar
        </button>
        <button type="button" className="smart-playlist-dialog__primary" onClick={() => void save()} disabled={!canSave}>
          {saving ? 'Salvando…' : playlist ? 'Salvar alterações' : 'Criar playlist'}
        </button>
      </div>
    </dialog>
  );
}
