import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BootstrapEnvFileResolution {
  isProduction: boolean;
  envFilename: '.env' | '.env.development';
  envPath: string;
  source: 'default' | 'configured';
}

interface ResolveBootstrapEnvFileOptions {
  nodeEnv?: string;
  configuredEnvFile?: string;
}

export function resolveBootstrapEnvFile(
  options: ResolveBootstrapEnvFileOptions = {}
): BootstrapEnvFileResolution {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const configuredEnvFile = options.configuredEnvFile ?? process.env.HOME_MUSIC_ENV_FILE;
  const isProduction = nodeEnv === 'production';
  const envFilename = isProduction ? '.env' : '.env.development';
  const configuredPath = configuredEnvFile?.trim();

  if (configuredPath) {
    if (!path.isAbsolute(configuredPath)) {
      throw new Error('HOME_MUSIC_ENV_FILE deve apontar para um caminho absoluto.');
    }

    return {
      isProduction,
      envFilename,
      envPath: configuredPath,
      source: 'configured'
    };
  }

  return {
    isProduction,
    envFilename,
    envPath: fileURLToPath(new URL(`../../../${envFilename}`, import.meta.url)),
    source: 'default'
  };
}
