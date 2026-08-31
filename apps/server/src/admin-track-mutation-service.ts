import type { AdminTrack, AdminTrackMoveRequest } from '@home-music/shared';
import {
  type AppliedTrackLocation,
  MediaFileMoveOperationError,
  MediaFileMoveStore
} from './media-file-move.js';
import { MediaQuarantineOperationError, MediaQuarantineStore } from './media-quarantine.js';
import { UnsafeLibraryPathError } from './security.js';

export const PERMANENT_DELETE_CONFIRMATION = 'EXCLUIR PERMANENTEMENTE' as const;

type AdminTrackMutationStore = {
  listTracks: () => AdminTrack[];
  setEnabled: (trackId: string, enabled: boolean) => AdminTrack | null;
  setLocation: (trackId: string, location: AppliedTrackLocation) => AdminTrack | null;
};

type AdminTrackMutationServiceOptions = {
  databasePath: string;
  musicDir: string;
  tracks: AdminTrackMutationStore;
  decorateTrack: (track: AdminTrack) => AdminTrack;
  onVisibilityChanged: (trackId: string, enabled: boolean) => void;
  onFileMoved: () => void;
};

export class AdminTrackMutationError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'AdminTrackMutationError';
  }
}

function normalizeQuarantineError(error: unknown): never {
  if (error instanceof MediaQuarantineOperationError) {
    throw new AdminTrackMutationError(error.statusCode, error.message);
  }
  if (error instanceof UnsafeLibraryPathError) {
    throw new AdminTrackMutationError(409, 'A operação foi bloqueada por segurança de caminho.');
  }
  throw error;
}

function normalizeMoveError(error: unknown): never {
  if (error instanceof MediaFileMoveOperationError) {
    throw new AdminTrackMutationError(error.statusCode, error.message);
  }
  if (error instanceof UnsafeLibraryPathError) {
    throw new AdminTrackMutationError(409, 'A movimentação foi bloqueada por segurança de caminho.');
  }
  throw error;
}

export class AdminTrackMutationService {
  private readonly quarantine: MediaQuarantineStore;
  private readonly fileMoves: MediaFileMoveStore;

  constructor(private readonly options: AdminTrackMutationServiceOptions) {
    this.quarantine = new MediaQuarantineStore(options.databasePath, options.musicDir);
    this.fileMoves = new MediaFileMoveStore(options.databasePath, options.musicDir);
  }

  close() {
    this.fileMoves.close();
    this.quarantine.close();
  }

  hasHidden(trackId: string) {
    return this.quarantine.hasHidden(trackId);
  }

  pruneResolvedTombstones() {
    this.quarantine.pruneResolvedTombstones();
  }

  listQuarantine() {
    return this.quarantine.listItems();
  }

  async getLocation(trackId: string) {
    try {
      return await this.fileMoves.getLocation(trackId);
    } catch (error) {
      return normalizeMoveError(error);
    }
  }

  async move(trackId: string, request: AdminTrackMoveRequest) {
    try {
      const result = await this.fileMoves.move(
        trackId,
        request,
        location => this.options.tracks.setLocation(trackId, location)
      );
      if (result.moved) this.options.onFileMoved();
      return {
        ...result,
        track: this.options.decorateTrack(result.track)
      };
    } catch (error) {
      return normalizeMoveError(error);
    }
  }

  async quarantineTrack(trackId: string) {
    if (this.quarantine.hasHidden(trackId)) {
      throw new AdminTrackMutationError(409, 'Música já está na lixeira.');
    }

    const physicalTrack = this.options.tracks.listTracks().find(item => item.id === trackId);
    if (!physicalTrack) throw new AdminTrackMutationError(404, 'Música não encontrada.');

    const track = this.options.decorateTrack(physicalTrack);
    const { enabled: previousEnabled, ...publicTrack } = track;
    if (previousEnabled) {
      this.options.tracks.setEnabled(track.id, false);
      this.options.onVisibilityChanged(track.id, false);
    }

    try {
      return await this.quarantine.quarantine(track.id, publicTrack, previousEnabled);
    } catch (error) {
      if (previousEnabled && !this.quarantine.hasHidden(track.id)) {
        this.options.tracks.setEnabled(track.id, true);
        this.options.onVisibilityChanged(track.id, true);
      }
      return normalizeQuarantineError(error);
    }
  }

  async restore(trackId: string) {
    try {
      const track = await this.quarantine.restore(
        trackId,
        enabled => {
          const restored = this.options.tracks.setEnabled(trackId, enabled);
          if (!restored) {
            throw new MediaQuarantineOperationError(
              409,
              'Registro da música não está mais disponível para restauração.'
            );
          }
          this.options.onVisibilityChanged(restored.id, restored.enabled);
        },
        () => {
          this.options.tracks.setEnabled(trackId, false);
          this.options.onVisibilityChanged(trackId, false);
        }
      );
      return this.options.decorateTrack(track);
    } catch (error) {
      return normalizeQuarantineError(error);
    }
  }

  async deletePermanently(trackId: string, confirmation: unknown) {
    if (confirmation !== PERMANENT_DELETE_CONFIRMATION) {
      throw new AdminTrackMutationError(400, 'Confirmação explícita de exclusão permanente obrigatória.');
    }
    try {
      await this.quarantine.deletePermanently(trackId);
      this.options.onVisibilityChanged(trackId, false);
    } catch (error) {
      return normalizeQuarantineError(error);
    }
  }
}
