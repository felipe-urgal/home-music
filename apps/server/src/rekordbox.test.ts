import assert from 'node:assert/strict';
import test from 'node:test';
import type { IndexedTrack } from './library.js';
import { buildRekordboxImportPlan, RekordboxXmlError } from './rekordbox.js';

function track(overrides: Partial<IndexedTrack> & Pick<IndexedTrack, 'id' | 'filePath' | 'title' | 'artist'>): IndexedTrack {
  return {
    album: 'Álbum',
    albumArtist: overrides.artist,
    folder: 'DJ',
    folderPath: 'DJ',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb: null,
    replayGainAlbumDb: null,
    mimeType: 'audio/mpeg',
    fileSize: 123,
    mtimeMs: 456,
    ...overrides
  };
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="7.0.0" Company="AlphaTheta"/>
  <COLLECTION Entries="3">
    <TRACK TrackID="1" Name="One &amp; Only" Artist="DJ A" Album="Set" TotalTime="181" Location="file://localhost/music/DJ/One%20%26%20Only.mp3"/>
    <TRACK TrackID="2" Name="Second" Artist="DJ B" Album="Set" TotalTime="200" Location="file://localhost/other-machine/Music/Second.mp3"/>
    <TRACK TrackID="3" Name="Missing" Artist="DJ C" Album="Set" TotalTime="210" Location="file://localhost/music/Missing.mp3"/>
  </COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="1">
      <NODE Type="0" Name="House" Count="1">
        <NODE Type="1" Name="Warmup" Entries="3">
          <TRACK Key="1"/>
          <TRACK Key="2"/>
          <TRACK Key="3"/>
        </NODE>
      </NODE>
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>`;

test('Rekordbox XML preserva hierarquia e faz matching por caminho e metadados', () => {
  const library = [
    track({
      id: 'one',
      filePath: '/music/DJ/One & Only.mp3',
      title: 'One & Only',
      artist: 'DJ A',
      album: 'Set',
      duration: 181
    }),
    track({
      id: 'two',
      filePath: '/srv/music/renamed-second.mp3',
      title: 'Second',
      artist: 'DJ B',
      album: 'Set',
      duration: 201
    })
  ];

  const plan = buildRekordboxImportPlan(xml, library);
  assert.equal(plan.productName, 'rekordbox');
  assert.equal(plan.productVersion, '7.0.0');
  assert.equal(plan.collectionTracks, 3);
  assert.equal(plan.matchedCollectionTracks, 2);
  assert.equal(plan.unmatchedCollectionTracks, 1);
  assert.equal(plan.playlists, 1);
  assert.equal(plan.playlistEntries, 3);
  assert.equal(plan.matchedPlaylistEntries, 2);
  assert.deepEqual(plan.unmatchedSample, [{ title: 'Missing', artist: 'DJ C' }]);
  assert.equal(plan.playlistPlans[0].name, 'House / Warmup');
  assert.deepEqual(plan.playlistPlans[0].trackIds, ['one', 'two']);
});

test('matching por metadados recusa versões ambíguas', () => {
  const ambiguousXml = `
    <DJ_PLAYLISTS>
      <COLLECTION>
        <TRACK TrackID="1" Name="Same" Artist="Artist" TotalTime="180"/>
      </COLLECTION>
      <PLAYLISTS><NODE Type="0" Name="ROOT"><NODE Type="1" Name="Set"><TRACK Key="1"/></NODE></NODE></PLAYLISTS>
    </DJ_PLAYLISTS>`;
  const library = [
    track({ id: 'a', filePath: '/music/a.mp3', title: 'Same', artist: 'Artist', duration: 180 }),
    track({ id: 'b', filePath: '/music/b.mp3', title: 'Same', artist: 'Artist', duration: 180 })
  ];

  const plan = buildRekordboxImportPlan(ambiguousXml, library);
  assert.equal(plan.matchedCollectionTracks, 0);
  assert.deepEqual(plan.playlistPlans[0].trackIds, []);
});

test('matching por nome de arquivo único funciona mesmo quando a raiz mudou', () => {
  const movedXml = `
    <DJ_PLAYLISTS>
      <COLLECTION><TRACK TrackID="1" Name="Different metadata" Artist="Other" TotalTime="180" Location="file://localhost/Users/felipe/Music/Unique.mp3"/></COLLECTION>
      <PLAYLISTS><NODE Type="0" Name="ROOT"><NODE Type="1" Name="Set"><TRACK Key="1"/></NODE></NODE></PLAYLISTS>
    </DJ_PLAYLISTS>`;
  const library = [track({ id: 'unique', filePath: '/mnt/music/Unique.mp3', title: 'Local title', artist: 'Local artist', duration: 180 })];

  const plan = buildRekordboxImportPlan(movedXml, library);
  assert.equal(plan.matchedCollectionTracks, 1);
  assert.deepEqual(plan.playlistPlans[0].trackIds, ['unique']);
});

test('DOCTYPE e arquivos que não são DJ_PLAYLISTS são rejeitados', () => {
  assert.throws(
    () => buildRekordboxImportPlan('<!DOCTYPE foo><DJ_PLAYLISTS/>', []),
    (error: unknown) => error instanceof RekordboxXmlError && /DOCTYPE\/ENTITY/.test(error.message)
  );
  assert.throws(
    () => buildRekordboxImportPlan('<root/>', []),
    (error: unknown) => error instanceof RekordboxXmlError && /DJ_PLAYLISTS/.test(error.message)
  );
});

test('referências duplicadas na playlist não duplicam músicas importadas', () => {
  const duplicateXml = `
    <DJ_PLAYLISTS>
      <COLLECTION><TRACK TrackID="1" Name="One" Artist="DJ" TotalTime="180" Location="file://localhost/music/one.mp3"/></COLLECTION>
      <PLAYLISTS><NODE Type="0" Name="ROOT"><NODE Type="1" Name="Set"><TRACK Key="1"/><TRACK Key="1"/></NODE></NODE></PLAYLISTS>
    </DJ_PLAYLISTS>`;
  const library = [track({ id: 'one', filePath: '/music/one.mp3', title: 'One', artist: 'DJ', duration: 180 })];

  const plan = buildRekordboxImportPlan(duplicateXml, library);
  assert.equal(plan.playlistEntries, 2);
  assert.equal(plan.matchedPlaylistEntries, 2);
  assert.deepEqual(plan.playlistPlans[0].trackIds, ['one']);
});
