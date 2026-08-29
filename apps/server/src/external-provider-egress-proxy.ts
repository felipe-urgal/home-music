import { lookup } from 'node:dns/promises';
import http, { type ClientRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { isUnsafeImportAddress } from './import-url.js';

const PROVIDER_CONNECT_TIMEOUT_MS = 8_000;
const PROVIDER_TARGET_TIMEOUT_MS = 2_500;

export type ProviderResolvedAddress = Readonly<{
  address: string;
  family: 4 | 6;
}>;

type ResolveHost = (hostname: string) => Promise<ProviderResolvedAddress[]>;

export class ExternalProviderEgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalProviderEgressError';
  }
}

function unbracket(value: string) {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function blockedHostname(hostname: string) {
  const value = unbracket(hostname).toLowerCase();
  return value === 'localhost'
    || value.endsWith('.localhost')
    || value.endsWith('.local')
    || value.endsWith('.internal');
}

async function defaultResolveHost(hostname: string): Promise<ProviderResolvedAddress[]> {
  const clean = unbracket(hostname);
  const family = net.isIP(clean);
  if (family === 4 || family === 6) return [{ address: clean, family }];
  const result = await lookup(clean, { all: true, verbatim: true });
  return result.map(item => ({ address: item.address, family: item.family === 6 ? 6 : 4 }));
}

export async function resolveSafeProviderTargets(hostname: string, resolver: ResolveHost = defaultResolveHost) {
  const clean = unbracket(hostname).trim();
  if (!clean || blockedHostname(clean)) {
    throw new ExternalProviderEgressError('O provider tentou acessar uma rede não permitida.');
  }

  let addresses: ProviderResolvedAddress[];
  try {
    addresses = await resolver(clean);
  } catch {
    throw new ExternalProviderEgressError('Não foi possível resolver um destino solicitado pelo provider.');
  }
  if (addresses.length === 0) {
    throw new ExternalProviderEgressError('O destino solicitado pelo provider não possui IP utilizável.');
  }
  if (addresses.some(item => isUnsafeImportAddress(item.address))) {
    throw new ExternalProviderEgressError('O provider tentou acessar uma rede não permitida.');
  }

  const unique = new Map<string, ProviderResolvedAddress>();
  for (const item of addresses) unique.set(`${item.family}:${item.address}`, item);
  const candidates = [...unique.values()];

  // IPv4 vem primeiro porque servidores domésticos frequentemente têm IPv6
  // anunciado no DNS, mas sem rota funcional. Se o primeiro IPv4 falhar, o
  // proxy tenta os demais candidatos públicos antes de desistir.
  return [
    ...candidates.filter(item => item.family === 4),
    ...candidates.filter(item => item.family === 6)
  ];
}

export async function resolveSafeProviderTarget(hostname: string, resolver: ResolveHost = defaultResolveHost) {
  return (await resolveSafeProviderTargets(hostname, resolver))[0];
}

function parseAuthority(value: string) {
  let url: URL;
  try {
    url = new URL(`http://${value}`);
  } catch {
    throw new ExternalProviderEgressError('Destino CONNECT inválido.');
  }
  if (url.username || url.password || !url.hostname) {
    throw new ExternalProviderEgressError('Destino CONNECT inválido.');
  }
  const port = url.port ? Number(url.port) : 443;
  if (!Number.isInteger(port) || (port !== 80 && port !== 443)) {
    throw new ExternalProviderEgressError('O provider tentou usar uma porta de rede não permitida.');
  }
  return { hostname: url.hostname, port };
}

function copyHeaders(headers: IncomingMessage['headers']) {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    const normalized = key.toLowerCase();
    if (
      normalized === 'connection'
      || normalized === 'proxy-authorization'
      || normalized === 'proxy-connection'
      || normalized === 'upgrade'
    ) continue;
    result[key] = value;
  }
  return result;
}

function failResponse(response: ServerResponse, statusCode: number) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    Connection: 'close'
  });
  response.end('Destino remoto bloqueado.');
}

function failConnect(client: Duplex, statusCode: 403 | 502) {
  if (client.destroyed) return;
  const message = statusCode === 403 ? 'Forbidden' : 'Bad Gateway';
  client.end(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
}

export class ExternalProviderEgressProxy {
  private readonly resolveHost: ResolveHost;
  private readonly sockets = new Set<Duplex>();
  private readonly requests = new Set<ClientRequest>();
  private server: http.Server | null = null;

  constructor(options: { resolveHost?: ResolveHost } = {}) {
    this.resolveHost = options.resolveHost ?? defaultResolveHost;
  }

  async start() {
    if (this.server) throw new Error('Proxy de egress já iniciado.');
    const server = http.createServer((request, response) => {
      void this.handleHttp(request, response);
    });
    server.on('connect', (request, client, head) => {
      void this.handleConnect(request, client, head);
    });
    server.on('connection', socket => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      await this.close();
      throw new Error('Não foi possível iniciar o proxy local do provider.');
    }
    return `http://127.0.0.1:${address.port}`;
  }

  async close() {
    const server = this.server;
    this.server = null;
    for (const request of this.requests) request.destroy();
    this.requests.clear();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (!server) return;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  private connectTarget(target: ProviderResolvedAddress, port: number, timeoutMs: number) {
    return new Promise<net.Socket>((resolve, reject) => {
      const socket = net.connect({ host: target.address, port, family: target.family });
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));

      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) socket.destroy(new Error('provider connect timeout'));
      }, timeoutMs);
      timer.unref?.();

      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once('error', error => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(error);
      });
    });
  }

  private async connectTargets(targets: readonly ProviderResolvedAddress[], port: number) {
    const deadline = Date.now() + PROVIDER_CONNECT_TIMEOUT_MS;
    let lastError: unknown = null;

    for (const target of targets) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        return await this.connectTarget(target, port, Math.min(PROVIDER_TARGET_TIMEOUT_MS, remaining));
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('provider connect failed');
  }

  private async handleConnect(request: IncomingMessage, client: Duplex, head: Buffer) {
    try {
      const target = parseAuthority(request.url ?? '');
      const resolved = await resolveSafeProviderTargets(target.hostname, this.resolveHost);
      const upstream = await this.connectTargets(resolved, target.port);
      if (client.destroyed) {
        upstream.destroy();
        return;
      }

      upstream.once('error', () => client.destroy());
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    } catch (error) {
      failConnect(client, error instanceof ExternalProviderEgressError ? 403 : 502);
    }
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse) {
    try {
      const target = new URL(request.url ?? '');
      if (target.protocol !== 'http:' || target.username || target.password) {
        failResponse(response, 403);
        return;
      }
      const port = target.port ? Number(target.port) : 80;
      if (port !== 80) {
        failResponse(response, 403);
        return;
      }
      const resolved = await resolveSafeProviderTarget(target.hostname, this.resolveHost);
      const upstream = http.request({
        host: resolved.address,
        family: resolved.family,
        port: 80,
        method: request.method,
        path: `${target.pathname}${target.search}`,
        headers: {
          ...copyHeaders(request.headers),
          host: target.host
        }
      }, upstreamResponse => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      this.requests.add(upstream);
      upstream.once('close', () => this.requests.delete(upstream));
      upstream.once('error', () => failResponse(response, 502));
      request.pipe(upstream);
    } catch {
      failResponse(response, 403);
    }
  }
}
