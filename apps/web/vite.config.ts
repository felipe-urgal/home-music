import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function basicAuthPlugin(username: string, password: string): Plugin {
  return {
    name: 'home-music-basic-auth',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const authorization = request.headers.authorization ?? '';

        if (authorization.startsWith('Basic ')) {
          try {
            const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
            const separator = decoded.indexOf(':');
            const suppliedUser = separator >= 0 ? decoded.slice(0, separator) : '';
            const suppliedPassword = separator >= 0 ? decoded.slice(separator + 1) : '';

            if (safeEqual(suppliedUser, username) && safeEqual(suppliedPassword, password)) {
              next();
              return;
            }
          } catch {
            // Credencial inválida segue para o challenge abaixo.
          }
        }

        response.statusCode = 401;
        response.setHeader('WWW-Authenticate', 'Basic realm="Home Music", charset="UTF-8"');
        response.setHeader('Cache-Control', 'no-store');
        response.end('Autenticação necessária.');
      });
    }
  };
}

export default defineConfig(({ mode, command }) => {
  const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, projectRoot, '');
  const username = env.HOME_MUSIC_USER;
  const password = env.HOME_MUSIC_PASSWORD;
  const isVitest = process.env.VITEST === 'true';
  const requiresAuth = command === 'serve' && !isVitest;

  if (requiresAuth && (!username || !password || password.length < 12)) {
    throw new Error('Configure HOME_MUSIC_USER e HOME_MUSIC_PASSWORD (mínimo 12 caracteres) no .env da raiz.');
  }

  return {
    plugins: [
      ...(requiresAuth ? [basicAuthPlugin(username!, password!)] : []),
      react()
    ],
    server: {
      host: true,
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY'
      },
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:8787',
          changeOrigin: false
        }
      }
    }
  };
});
