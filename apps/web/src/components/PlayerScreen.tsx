import type { Playlist, RepeatMode, Track } from '@home-music/shared';
import { LyricsPanel } from './LyricsPanel';
import { PlayerPlaybackControls } from './PlayerPlaybackControls';
import { PlayerQueuePanel } from './PlayerQueuePanel';
import { PlayerTrackPresentation } from './PlayerTrackPresentation';

type PlayerScreenProps = {
  current: Track;
  libraryReturnLabel: string;
  queue: Track[];
  currentIndex: number;
  playing: boolean;
  autoplayBlocked: boolean;
  playbackError?: string | null;
  currentTime: number;
  duration: number;
  volume: number;
  usesSystemVolume: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  playlists: Playlist[];
  offlineMode?: boolean;
  isDownloaded?: boolean;
  availableViaCollection?: boolean;
  downloading?: boolean;
  onOpenLibrary: () => void;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onToggleDownload?: () => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onReorderQueue: (from: number, to: number) => void;
  onAddToPlaylist: (playlist: Playlist) => void;
  onExitOffline?: () => void;
};

export function PlayerScreen({
  current,
  libraryReturnLabel,
  queue,
  currentIndex,
  playing,
  autoplayBlocked,
  playbackError,
  currentTime,
  duration,
  volume,
  usesSystemVolume,
  shuffle,
  repeatMode,
  playlists,
  offlineMode = false,
  isDownloaded = false,
  availableViaCollection = false,
  downloading = false,
  onOpenLibrary,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  onVolume,
  onShuffle,
  onRepeat,
  onToggleDownload,
  onPlayTrack,
  onReorderQueue,
  onAddToPlaylist,
  onExitOffline
}: PlayerScreenProps) {
  return (
    <>
      <PlayerTrackPresentation
        current={current}
        queueLength={queue.length}
        libraryReturnLabel={libraryReturnLabel}
        playlists={playlists}
        offlineMode={offlineMode}
        isDownloaded={isDownloaded}
        availableViaCollection={availableViaCollection}
        downloading={downloading}
        onOpenLibrary={onOpenLibrary}
        onToggleDownload={onToggleDownload}
        onAddToPlaylist={onAddToPlaylist}
        onExitOffline={onExitOffline}
      />

      <PlayerPlaybackControls
        queueLength={queue.length}
        currentIndex={currentIndex}
        playing={playing}
        autoplayBlocked={autoplayBlocked}
        playbackError={playbackError}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        usesSystemVolume={usesSystemVolume}
        shuffle={shuffle}
        repeatMode={repeatMode}
        onTogglePlay={onTogglePlay}
        onPrevious={onPrevious}
        onNext={onNext}
        onSeek={onSeek}
        onVolume={onVolume}
        onShuffle={onShuffle}
        onRepeat={onRepeat}
      />

      <LyricsPanel track={current} currentTime={currentTime} offlineMode={offlineMode} />

      <PlayerQueuePanel
        current={current}
        queue={queue}
        currentIndex={currentIndex}
        offlineMode={offlineMode}
        onPlayTrack={onPlayTrack}
        onReorderQueue={onReorderQueue}
      />
    </>
  );
}
