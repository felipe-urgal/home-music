import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(name: string) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

test('index remains a composition root instead of implementing domains', () => {
  const index = source('index.ts');

  assert.match(index, /createServerInfrastructure\(/);
  assert.match(index, /new LibraryService\(/);
  assert.match(index, /new PersonalLibraryService\(/);
  assert.match(index, /new TrackMediaInfrastructure\(/);
  assert.match(index, /installApiAuthPolicy\(/);
  assert.match(index, /registerAuthRoutes\(/);
  assert.match(index, /registerLibraryRoutes\(/);
  assert.match(index, /registerPersonalRoutes\(/);
  assert.match(index, /registerMediaRoutes\(/);
  assert.match(index, /registerSystemRoutes\(/);

  assert.doesNotMatch(index, /['"]\/api\//);
  assert.doesNotMatch(index, /scanLibrary\(/);
  assert.doesNotMatch(index, /auditLibraryIntegrity\(/);
  assert.doesNotMatch(index, /openRegularFileInside\(/);
  assert.doesNotMatch(index, /readTrackLyrics\(/);
  assert.doesNotMatch(index, /readCover\(/);
  assert.doesNotMatch(index, /new HomeMusicDatabase\(/);
  assert.doesNotMatch(index, /new TranscodeManager\(/);
});

test('business state and infrastructure stay behind explicit modules', () => {
  const library = source('library-service.ts');
  const personal = source('personal-library-service.ts');
  const media = source('track-media-infrastructure.ts');
  const infrastructure = source('server-infrastructure.ts');

  assert.match(library, /new LibraryMutationLock\(/);
  assert.match(library, /scanLibrary\(/);
  assert.match(library, /auditLibraryIntegrity\(/);
  assert.doesNotMatch(library, /from ['"]fastify['"]/);

  assert.match(personal, /HomeMusicDatabase/);
  assert.match(personal, /savePlaybackState\(/);
  assert.match(personal, /setPlaylistTracks\(/);
  assert.doesNotMatch(personal, /from ['"]fastify['"]/);

  assert.match(media, /openRegularFileInside\(/);
  assert.match(media, /readTrackLyrics\(/);
  assert.match(media, /readCover\(/);
  assert.doesNotMatch(media, /from ['"]fastify['"]/);

  assert.match(infrastructure, /new HomeMusicDatabase\(/);
  assert.match(infrastructure, /new SessionManager\(/);
  assert.match(infrastructure, /new TranscodeManager\(/);
  assert.doesNotMatch(infrastructure, /app\.(?:get|post|put|patch|delete)/);
});

test('HTTP handlers are grouped by domain while auth policy stays central', () => {
  const auth = source('auth-routes.ts');
  const sessions = source('account-session-routes.ts');
  const library = source('library-routes.ts');
  const personal = source('personal-routes.ts');
  const media = source('media-routes.ts');
  const system = source('system-routes.ts');

  assert.match(auth, /\/api\/auth\/login/);
  assert.match(sessions, /\/api\/auth\/sessions/);
  assert.doesNotMatch(sessions, /registerLibraryViewRoutes/);
  assert.doesNotMatch(sessions, /registerSmartPlaylistRoutes/);
  assert.doesNotMatch(sessions, /registerPlaybackHistoryRoutes/);

  assert.match(library, /\/api\/library/);
  assert.match(personal, /PersonalLibraryService/);
  assert.doesNotMatch(personal, /HomeMusicDatabase/);
  assert.doesNotMatch(personal, /from ['"]\.\/library-service\.js['"]/);
  assert.match(personal, /\/api\/favorites/);
  assert.match(personal, /\/api\/player\/state/);
  assert.match(personal, /registerLibraryViewRoutes\(/);
  assert.match(personal, /registerSmartPlaylistRoutes\(/);
  assert.match(personal, /registerPlaybackHistoryRoutes\(/);
  assert.match(media, /\/api\/tracks\/:id\/stream/);
  assert.match(system, /\/api\/health/);
  assert.doesNotMatch(system, /ServerInfrastructure/);

  for (const routeSource of [auth, sessions, library, personal, media, system]) {
    assert.doesNotMatch(routeSource, /installApiAuthPolicy\(/);
  }
});

test('high-risk orchestration stays behind explicit framework-agnostic services', () => {
  const trackRoutes = source('admin-track-routes.ts');
  const trackMutations = source('admin-track-mutation-service.ts');
  const importEntry = source('admin-import-routes.ts');
  const importRoutes = source('admin-import-service-routes.ts');
  const importService = source('admin-import-service.ts');
  const backupCli = source('backup-cli.ts');
  const backupService = source('backup-service.ts');

  assert.match(trackRoutes, /new AdminTrackMutationService\(/);
  assert.doesNotMatch(trackRoutes, /new MediaQuarantineStore\(/);
  assert.doesNotMatch(trackRoutes, /new MediaFileMoveStore\(/);
  assert.match(trackMutations, /new MediaQuarantineStore\(/);
  assert.match(trackMutations, /new MediaFileMoveStore\(/);
  assert.doesNotMatch(trackMutations, /from ['"]fastify['"]/);

  assert.match(importEntry, /admin-import-service-routes\.js/);
  assert.match(importRoutes, /new AdminImportService\(/);
  assert.match(importRoutes, /installImportRetryStarter\(app, \(context, input\) => imports\.startRetry/);
  assert.doesNotMatch(importService, /from ['"]fastify['"]/);
  assert.match(importService, /safeDestination\.promote/);
  assert.match(importService, /automaticFlow\.startWhenReady/);

  assert.match(backupCli, /new BackupService\(/);
  assert.doesNotMatch(backupCli, /createBackupArtifact\(/);
  assert.doesNotMatch(backupCli, /restoreBackupArtifact\(/);
  assert.match(backupService, /restoreOfflineBlocker/);
  assert.match(backupService, /beforeReplace/);
  assert.doesNotMatch(backupService, /from ['"]fastify['"]/);
});
