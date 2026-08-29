import type { FastifyInstance } from 'fastify';
import type { ImportJob, ImportJobSource } from '@home-music/shared';

const RETRY_STARTER_DECORATOR = 'homeMusicImportRetryStarter';

export type ImportJobRetryLineage = Readonly<{
  parentJobId: string;
  rootJobId: string;
  attempt: number;
}>;

export type ImportJobWithRetry = ImportJob & {
  retry: ImportJobRetryLineage | null;
};

export type ImportRetryContext = Readonly<{
  source: ImportJobSource;
  lineage: ImportJobRetryLineage;
}>;

export type ImportRetryInput = Readonly<{
  fileName?: unknown;
  size?: unknown;
  url?: unknown;
}>;

export type ImportRetryStarter = (
  context: ImportRetryContext,
  input: ImportRetryInput
) => Promise<{ job: ImportJob }>;

export class ImportRetryStartError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'ImportRetryStartError';
  }
}

type RetryCapableFastify = FastifyInstance & {
  homeMusicImportRetryStarter?: ImportRetryStarter;
};

export function installImportRetryStarter(app: FastifyInstance, starter: ImportRetryStarter) {
  if (app.hasDecorator(RETRY_STARTER_DECORATOR)) {
    throw new Error('Starter de retry de importação já registrado.');
  }
  app.decorate(RETRY_STARTER_DECORATOR, starter);
}

export function getImportRetryStarter(app: FastifyInstance) {
  return (app as RetryCapableFastify).homeMusicImportRetryStarter ?? null;
}
