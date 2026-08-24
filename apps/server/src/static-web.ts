import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyReply } from 'fastify';

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

export type PreparedWebApp = {
  root: string;
  indexHtml: Buffer;
};

function isPathInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function requestPathname(rawUrl: string) {
  const rawPath = rawUrl.split('?', 1)[0] || '/';
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return null;
  }
}

function safeRelativePath(pathname: string) {
  if (!pathname.startsWith('/') || pathname.includes('\0') || pathname.includes('\\')) return null;
  const parts = pathname.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..' || part.startsWith('.'))) return null;
  return parts.join(path.sep);
}

export function contentTypeForPath(filePath: string) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export function cacheControlForPath(pathname: string) {
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (pathname === '/manifest.webmanifest' || pathname === '/favicon.svg') return 'public, max-age=3600, must-revalidate';
  return 'no-store';
}

export function shouldServeShell(rawUrl: string) {
  const pathname = requestPathname(rawUrl);
  if (!pathname) return false;
  if (pathname === '/') return true;
  if (pathname.startsWith('/assets/')) return false;
  return path.posix.extname(pathname) === '';
}

export async function prepareWebApp(root: string): Promise<PreparedWebApp> {
  const resolvedRoot = await realpath(root);
  const indexPath = path.join(resolvedRoot, 'index.html');
  const indexStat = await lstat(indexPath);
  if (!indexStat.isFile() || indexStat.isSymbolicLink()) {
    throw new Error('Frontend de produção inválido: index.html não é um arquivo regular.');
  }

  return {
    root: resolvedRoot,
    indexHtml: await readFile(indexPath)
  };
}

export async function resolveStaticFile(root: string, rawUrl: string) {
  const pathname = requestPathname(rawUrl);
  if (!pathname || pathname === '/') return null;

  const relative = safeRelativePath(pathname);
  if (!relative) return null;

  const candidate = path.resolve(root, relative);
  if (!isPathInside(root, candidate)) return null;

  try {
    const candidateStat = await lstat(candidate);
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) return null;
    const canonical = await realpath(candidate);
    if (!isPathInside(root, canonical)) return null;
    return { filePath: canonical, pathname, size: candidateStat.size };
  } catch {
    return null;
  }
}

export async function sendWebRequest(reply: FastifyReply, web: PreparedWebApp, rawUrl: string) {
  const staticFile = await resolveStaticFile(web.root, rawUrl);
  if (staticFile) {
    reply.type(contentTypeForPath(staticFile.filePath));
    reply.header('Cache-Control', cacheControlForPath(staticFile.pathname));
    reply.header('Content-Length', staticFile.size);
    return reply.send(createReadStream(staticFile.filePath));
  }

  if (!shouldServeShell(rawUrl)) {
    reply.header('Cache-Control', 'no-store');
    return reply.code(404).send({ error: 'Arquivo não encontrado.' });
  }

  reply.type('text/html; charset=utf-8');
  reply.header('Cache-Control', 'no-store');
  return reply.send(web.indexHtml);
}
