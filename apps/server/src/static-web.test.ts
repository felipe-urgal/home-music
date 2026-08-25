import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import {
  cacheControlForPath,
  contentTypeForPath,
  prepareWebApp,
  requestPathname,
  resolveStaticFile,
  shouldServeShell
} from './static-web.js';

test('requestPathname decodifica URL e rejeita encoding inválido', () => {
  assert.equal(requestPathname('/assets/app.js?v=1'), '/assets/app.js');
  assert.equal(requestPathname('/Rock%20nacional'), '/Rock nacional');
  assert.equal(requestPathname('/%E0%A4%A'), null);
  assert.equal(requestPathname('/%00'), '/\0');
});

test('política de cache usa immutable apenas para assets com hash', () => {
  assert.equal(cacheControlForPath('/assets/app-abc12345.js'), 'public, max-age=31536000, immutable');
  assert.equal(cacheControlForPath('/assets/app.js'), 'public, max-age=3600, must-revalidate');
  assert.equal(cacheControlForPath('/manifest.webmanifest'), 'public, max-age=3600, must-revalidate');
  assert.equal(cacheControlForPath('/sw.js'), 'no-store');
  assert.equal(cacheControlForPath('/qualquer-rota'), 'no-store');
  assert.equal(contentTypeForPath('app.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeForPath('sw.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeForPath('manifest.webmanifest'), 'application/manifest+json; charset=utf-8');
});

test('fallback SPA é usado somente para rotas válidas da aplicação', () => {
  assert.equal(shouldServeShell('/'), true);
  assert.equal(shouldServeShell('/biblioteca/rock'), true);
  assert.equal(shouldServeShell('/assets/app-antigo.js'), false);
  assert.equal(shouldServeShell('/manifest.webmanifest'), false);
  assert.equal(shouldServeShell('/favicon.svg'), false);
  assert.equal(shouldServeShell('/sw.js'), false);
  assert.equal(shouldServeShell('/.env'), false);
  assert.equal(shouldServeShell('/%00'), false);
  assert.equal(shouldServeShell('/%2e%2e/secret'), false);
});

test('resolveStaticFile serve somente arquivo regular dentro do dist', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-web-'));
  const root = path.join(temp, 'dist');
  const assets = path.join(root, 'assets');
  await mkdir(assets, { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<html></html>');
  await writeFile(path.join(assets, 'app.js'), 'console.log(1)');

  const web = await prepareWebApp(root);
  const file = await resolveStaticFile(web.root, '/assets/app.js?x=1');
  assert.ok(file);
  assert.equal(file.pathname, '/assets/app.js');
  assert.equal(file.filePath, path.join(assets, 'app.js'));

  assert.equal(await resolveStaticFile(web.root, '/../secret'), null);
  assert.equal(await resolveStaticFile(web.root, '/%2e%2e/secret'), null);
  assert.equal(await resolveStaticFile(web.root, '/.env'), null);
  assert.equal(await resolveStaticFile(web.root, '/%00'), null);
});

test('resolveStaticFile rejeita symlink que aponta para fora do dist', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-web-link-'));
  const root = path.join(temp, 'dist');
  const outside = path.join(temp, 'outside.js');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<html></html>');
  await writeFile(outside, 'secret');
  await symlink(outside, path.join(root, 'linked.js'));

  const web = await prepareWebApp(root);
  assert.equal(await resolveStaticFile(web.root, '/linked.js'), null);
});

test('wildcard do Fastify cobre a rota raiz usada pelo shell de produção', async () => {
  const app = Fastify();
  app.get('/*', async () => 'shell');
  const response = await app.inject({ method: 'GET', url: '/' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'shell');
  await app.close();
});
