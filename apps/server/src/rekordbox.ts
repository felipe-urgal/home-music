import path from 'node:path';
import type { IndexedTrack } from './library.js';

export const MAX_REKORDBOX_XML_BYTES = 20 * 1024 * 1024;
export const MAX_REKORDBOX_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_COLLECTION_TRACKS = 100_000;
const MAX_PLAYLISTS = 10_000;
const MAX_UNMATCHED_SAMPLE = 12;
const DURATION_TOLERANCE_SECONDS = 4;

type XmlAttributes = Record<string, string>;

type ParsedTrack = {
  key: string;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  location: string | null;
};

type ParsedPlaylist = {
  sourceKey: string;
  name: string;
  trackKeys: string[];
};

type ParsedRekordbox = {
  productName: string | null;
  productVersion: string | null;
  tracks: ParsedTrack[];
  playlists: ParsedPlaylist[];
};

export type RekordboxPlaylistPlan = {
  sourceKey: string;
  name: string;
  trackIds: string[];
  totalEntries: number;
  matchedEntries: number;
};

export type RekordboxImportPlan = {
  productName: string | null;
  productVersion: string | null;
  collectionTracks: number;
  matchedCollectionTracks: number;
  unmatchedCollectionTracks: number;
  playlists: number;
  playlistEntries: number;
  matchedPlaylistEntries: number;
  unmatchedSample: Array<{ title: string; artist: string }>;
  playlistPlans: RekordboxPlaylistPlan[];
};

export class RekordboxXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RekordboxXmlError';
  }
}

type Tag = {
  name: string;
  attributes: XmlAttributes;
  closing: boolean;
  selfClosing: boolean;
};

function decodeXmlEntities(value: string) {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    if (entity === 'amp') return '&';
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";

    const hex = entity.startsWith('#x');
    const numeric = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0x10ffff) return match;
    try {
      return String.fromCodePoint(numeric);
    } catch {
      return match;
    }
  });
}

function parseTag(rawTag: string): Tag | null {
  let raw = rawTag.trim();
  if (!raw || raw.startsWith('?') || raw.startsWith('!')) return null;

  let closing = false;
  if (raw.startsWith('/')) {
    closing = true;
    raw = raw.slice(1).trimStart();
  }

  let selfClosing = false;
  if (!closing && raw.endsWith('/')) {
    selfClosing = true;
    raw = raw.slice(0, -1).trimEnd();
  }

  const nameMatch = raw.match(/^([A-Za-z_][A-Za-z0-9_.:-]*)/);
  if (!nameMatch) throw new RekordboxXmlError('XML do Rekordbox contém uma tag inválida.');
  const name = nameMatch[1];
  if (closing) return { name, attributes: {}, closing: true, selfClosing: false };

  const attributes: XmlAttributes = {};
  let index = name.length;
  while (index < raw.length) {
    while (index < raw.length && /\s/.test(raw[index])) index += 1;
    if (index >= raw.length) break;

    const attributeMatch = raw.slice(index).match(/^([A-Za-z_][A-Za-z0-9_.:-]*)/);
    if (!attributeMatch) throw new RekordboxXmlError(`Atributo inválido na tag ${name}.`);
    const attributeName = attributeMatch[1];
    index += attributeName.length;

    while (index < raw.length && /\s/.test(raw[index])) index += 1;
    if (raw[index] !== '=') throw new RekordboxXmlError(`Atributo ${attributeName} sem valor na tag ${name}.`);
    index += 1;
    while (index < raw.length && /\s/.test(raw[index])) index += 1;

    const quote = raw[index];
    if (quote !== '"' && quote !== "'") throw new RekordboxXmlError(`Atributo ${attributeName} sem aspas na tag ${name}.`);
    index += 1;
    const valueStart = index;
    while (index < raw.length && raw[index] !== quote) index += 1;
    if (index >= raw.length) throw new RekordboxXmlError(`Atributo ${attributeName} não foi fechado na tag ${name}.`);

    attributes[attributeName] = decodeXmlEntities(raw.slice(valueStart, index));
    index += 1;
  }

  return { name, attributes, closing: false, selfClosing };
}

function* xmlTags(xml: string): Generator<Tag> {
  let cursor = 0;
  while (cursor < xml.length) {
    const open = xml.indexOf('<', cursor);
    if (open < 0) break;

    if (xml.startsWith('<!--', open)) {
      const commentEnd = xml.indexOf('-->', open + 4);
      if (commentEnd < 0) throw new RekordboxXmlError('Comentário XML não foi fechado.');
      cursor = commentEnd + 3;
      continue;
    }

    let index = open + 1;
    let quote: '"' | "'" | null = null;
    for (; index < xml.length; index += 1) {
      const character = xml[index];
      if (quote) {
        if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === '>') break;
    }
    if (index >= xml.length) throw new RekordboxXmlError('XML do Rekordbox termina no meio de uma tag.');

    const parsed = parseTag(xml.slice(open + 1, index));
    if (parsed) yield parsed;
    cursor = index + 1;
  }
}

function optionalNumber(value: string | undefined) {
  if (value == null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function cleanText(value: string | undefined, fallback = '') {
  return (value || fallback).trim();
}

function parseRekordboxXml(xml: string): ParsedRekordbox {
  const byteLength = Buffer.byteLength(xml, 'utf8');
  if (byteLength === 0) throw new RekordboxXmlError('O arquivo XML está vazio.');
  if (byteLength > MAX_REKORDBOX_XML_BYTES) {
    throw new RekordboxXmlError(`O XML excede o limite de ${MAX_REKORDBOX_XML_BYTES / 1024 / 1024} MiB.`);
  }
  if (/<!DOCTYPE\b/i.test(xml) || /<!ENTITY\b/i.test(xml)) {
    throw new RekordboxXmlError('DOCTYPE/ENTITY não são aceitos no XML do Rekordbox.');
  }

  let rootSeen = false;
  let collectionDepth = 0;
  let playlistsDepth = 0;
  let productName: string | null = null;
  let productVersion: string | null = null;
  const tracks: ParsedTrack[] = [];
  const playlists: ParsedPlaylist[] = [];
  const trackKeys = new Set<string>();
  const playlistKeyCount = new Map<string, number>();
  const nodeStack: Array<{
    type: string;
    name: string;
    pathSegments: string[];
    trackKeys: string[];
  }> = [];

  function finishPlaylistNode() {
    const node = nodeStack.pop();
    if (!node || node.type !== '1') return;
    if (playlists.length >= MAX_PLAYLISTS) throw new RekordboxXmlError('O XML possui playlists demais para importação.');

    const displayName = node.pathSegments.join(' / ') || node.name || 'Playlist Rekordbox';
    const baseKey = node.pathSegments.join('\u001f') || node.name || 'playlist';
    const occurrence = (playlistKeyCount.get(baseKey) || 0) + 1;
    playlistKeyCount.set(baseKey, occurrence);
    const sourceKey = occurrence === 1 ? baseKey : `${baseKey}\u001e${occurrence}`;
    playlists.push({ sourceKey, name: displayName.slice(0, 120), trackKeys: node.trackKeys });
  }

  for (const tag of xmlTags(xml)) {
    const name = tag.name.toUpperCase();

    if (tag.closing) {
      if (name === 'NODE' && playlistsDepth > 0) finishPlaylistNode();
      if (name === 'COLLECTION') collectionDepth = Math.max(0, collectionDepth - 1);
      if (name === 'PLAYLISTS') playlistsDepth = Math.max(0, playlistsDepth - 1);
      continue;
    }

    if (name === 'DJ_PLAYLISTS') rootSeen = true;
    if (name === 'PRODUCT' && rootSeen) {
      productName = cleanText(tag.attributes.Name) || null;
      productVersion = cleanText(tag.attributes.Version) || null;
    }

    if (name === 'COLLECTION') collectionDepth += 1;
    if (name === 'PLAYLISTS') playlistsDepth += 1;

    if (name === 'TRACK' && collectionDepth > 0 && playlistsDepth === 0) {
      if (tracks.length >= MAX_COLLECTION_TRACKS) throw new RekordboxXmlError('O XML possui músicas demais para importação.');
      const key = cleanText(tag.attributes.TrackID);
      if (key && !trackKeys.has(key)) {
        trackKeys.add(key);
        tracks.push({
          key,
          title: cleanText(tag.attributes.Name, 'Faixa sem título'),
          artist: cleanText(tag.attributes.Artist, 'Artista desconhecido'),
          album: cleanText(tag.attributes.Album),
          duration: optionalNumber(tag.attributes.TotalTime),
          location: cleanText(tag.attributes.Location) || null
        });
      }
    }

    if (name === 'NODE' && playlistsDepth > 0) {
      const parent = nodeStack.at(-1);
      const nodeName = cleanText(tag.attributes.Name, 'Playlist Rekordbox');
      const type = cleanText(tag.attributes.Type);
      const isRoot = type === '0' && nodeName.toUpperCase() === 'ROOT' && nodeStack.length === 0;
      const pathSegments = parent?.pathSegments ? [...parent.pathSegments] : [];
      if (!isRoot) pathSegments.push(nodeName);
      nodeStack.push({ type, name: nodeName, pathSegments, trackKeys: [] });
      if (tag.selfClosing) finishPlaylistNode();
      continue;
    }

    if (name === 'TRACK' && playlistsDepth > 0 && nodeStack.length > 0) {
      const key = cleanText(tag.attributes.Key);
      if (key) nodeStack[nodeStack.length - 1].trackKeys.push(key);
    }

    if (tag.selfClosing) {
      if (name === 'COLLECTION') collectionDepth = Math.max(0, collectionDepth - 1);
      if (name === 'PLAYLISTS') playlistsDepth = Math.max(0, playlistsDepth - 1);
    }
  }

  if (!rootSeen) throw new RekordboxXmlError('O arquivo não parece ser um export XML DJ_PLAYLISTS do Rekordbox.');
  if (nodeStack.length > 0) throw new RekordboxXmlError('A árvore de playlists do XML está incompleta.');
  return { productName, productVersion, tracks, playlists };
}

function normalizeMetadata(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePathKey(value: string) {
  let normalized = value.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (/^\/[A-Za-z]:\//.test(normalized)) normalized = normalized.slice(1);
  return normalized.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\/$/, '');
}

function locationPath(location: string | null) {
  if (!location) return null;
  try {
    const url = new URL(location);
    if (url.protocol !== 'file:') return null;
    const host = url.hostname && url.hostname !== 'localhost' ? `//${url.hostname}` : '';
    return normalizePathKey(`${host}${decodeURIComponent(url.pathname)}`);
  } catch {
    if (location.startsWith('/') || /^[A-Za-z]:[\\/]/.test(location)) return normalizePathKey(location);
    return null;
  }
}

function filenameKey(value: string | null) {
  if (!value) return null;
  return path.posix.basename(value.replace(/\\/g, '/')).toLocaleLowerCase('en-US');
}

function metadataKey(track: Pick<ParsedTrack, 'artist' | 'title'> | Pick<IndexedTrack, 'artist' | 'title'>) {
  return `${normalizeMetadata(track.artist)}\u001f${normalizeMetadata(track.title)}`;
}

function pushIndex(map: Map<string, IndexedTrack[]>, key: string | null, track: IndexedTrack) {
  if (!key) return;
  const values = map.get(key);
  if (values) values.push(track);
  else map.set(key, [track]);
}

function durationCompatible(source: ParsedTrack, target: IndexedTrack) {
  if (source.duration == null || target.duration == null) return true;
  return Math.abs(source.duration - target.duration) <= DURATION_TOLERANCE_SECONDS;
}

function chooseMetadataCandidate(source: ParsedTrack, candidates: IndexedTrack[]) {
  let filtered = candidates.filter(candidate => durationCompatible(source, candidate));
  if (filtered.length === 0) return null;

  const album = normalizeMetadata(source.album);
  if (album && filtered.length > 1) {
    const albumMatches = filtered.filter(candidate => normalizeMetadata(candidate.album) === album);
    if (albumMatches.length > 0) filtered = albumMatches;
  }
  return filtered.length === 1 ? filtered[0] : null;
}

function matchTracks(sourceTracks: ParsedTrack[], libraryTracks: IndexedTrack[]) {
  const exactPath = new Map<string, IndexedTrack[]>();
  const basename = new Map<string, IndexedTrack[]>();
  const metadata = new Map<string, IndexedTrack[]>();

  for (const track of libraryTracks) {
    const pathKey = normalizePathKey(track.filePath);
    pushIndex(exactPath, pathKey, track);
    pushIndex(basename, filenameKey(pathKey), track);
    pushIndex(metadata, metadataKey(track), track);
  }

  const matched = new Map<string, string>();
  for (const source of sourceTracks) {
    const sourcePath = locationPath(source.location);
    const exact = sourcePath ? exactPath.get(sourcePath) : undefined;
    if (exact?.length === 1) {
      matched.set(source.key, exact[0].id);
      continue;
    }

    const sourceFilename = filenameKey(sourcePath);
    const filenameMatches = sourceFilename ? basename.get(sourceFilename) : undefined;
    if (filenameMatches?.length === 1 && durationCompatible(source, filenameMatches[0])) {
      matched.set(source.key, filenameMatches[0].id);
      continue;
    }

    const metadataMatches = metadata.get(metadataKey(source)) || [];
    const candidate = chooseMetadataCandidate(source, metadataMatches);
    if (candidate) matched.set(source.key, candidate.id);
  }

  return matched;
}

export function buildRekordboxImportPlan(xml: string, libraryTracks: IndexedTrack[]): RekordboxImportPlan {
  const parsed = parseRekordboxXml(xml);
  const matched = matchTracks(parsed.tracks, libraryTracks);
  const sourceByKey = new Map(parsed.tracks.map(track => [track.key, track]));
  let playlistEntries = 0;
  let matchedPlaylistEntries = 0;

  const playlistPlans = parsed.playlists.map(playlist => {
    const trackIds: string[] = [];
    const seenIds = new Set<string>();
    let matchedEntries = 0;

    for (const key of playlist.trackKeys) {
      playlistEntries += 1;
      const trackId = matched.get(key);
      if (!trackId) continue;
      matchedEntries += 1;
      matchedPlaylistEntries += 1;
      if (!seenIds.has(trackId)) {
        seenIds.add(trackId);
        trackIds.push(trackId);
      }
    }

    return {
      sourceKey: playlist.sourceKey,
      name: playlist.name,
      trackIds,
      totalEntries: playlist.trackKeys.length,
      matchedEntries
    };
  });

  const unmatchedSample = parsed.tracks
    .filter(track => !matched.has(track.key))
    .slice(0, MAX_UNMATCHED_SAMPLE)
    .map(track => ({ title: track.title, artist: track.artist }));

  // Referências de playlist podem apontar para IDs ausentes de COLLECTION; elas ficam
  // naturalmente como não correspondidas e não são inventadas a partir da biblioteca.
  void sourceByKey;

  return {
    productName: parsed.productName,
    productVersion: parsed.productVersion,
    collectionTracks: parsed.tracks.length,
    matchedCollectionTracks: matched.size,
    unmatchedCollectionTracks: parsed.tracks.length - matched.size,
    playlists: parsed.playlists.length,
    playlistEntries,
    matchedPlaylistEntries,
    unmatchedSample,
    playlistPlans
  };
}

export function publicRekordboxPlan(plan: RekordboxImportPlan) {
  return {
    productName: plan.productName,
    productVersion: plan.productVersion,
    collectionTracks: plan.collectionTracks,
    matchedCollectionTracks: plan.matchedCollectionTracks,
    unmatchedCollectionTracks: plan.unmatchedCollectionTracks,
    playlists: plan.playlists,
    playlistEntries: plan.playlistEntries,
    matchedPlaylistEntries: plan.matchedPlaylistEntries,
    unmatchedSample: plan.unmatchedSample,
    playlistPreview: plan.playlistPlans.slice(0, 12).map(playlist => ({
      name: playlist.name,
      totalEntries: playlist.totalEntries,
      matchedEntries: playlist.matchedEntries
    }))
  };
}
