import type { TvRemoteCommand } from '@home-music/shared';

export type TvRemotePlayerControls = {
  togglePlay: () => void | Promise<void>;
  previous: () => void;
  next: () => void;
  seekBy: (deltaSeconds: -10 | 10) => void;
};

export function applyTvRemoteCommand(
  command: TvRemoteCommand,
  controls: TvRemotePlayerControls
): void {
  switch (command.type) {
    case 'toggle-play':
      void controls.togglePlay();
      return;
    case 'previous':
      controls.previous();
      return;
    case 'next':
      controls.next();
      return;
    case 'seek':
      controls.seekBy(command.deltaSeconds);
      return;
  }
}
