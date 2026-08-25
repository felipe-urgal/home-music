import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { probeFfmpeg } from './ffmpeg.js';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));
config({ path: rootEnvPath });

const status = await probeFfmpeg(process.env.HOME_MUSIC_FFMPEG_PATH);

if (status.available) {
  console.log(`FFmpeg disponível: ${status.version}`);
  console.log(`Origem: ${status.customCommand ? 'HOME_MUSIC_FFMPEG_PATH' : 'PATH do sistema'}`);
} else {
  console.error(`FFmpeg indisponível: ${status.issue ?? 'desconhecido'}`);
  console.error('Instale o FFmpeg ou ajuste HOME_MUSIC_FFMPEG_PATH para um executável válido.');
  process.exitCode = 1;
}
