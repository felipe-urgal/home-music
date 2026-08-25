import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var projectRoot = fileURLToPath(new URL('../../', import.meta.url));
    var env = loadEnv(mode, projectRoot, '');
    return {
        plugins: [react()],
        server: {
            host: true,
            headers: {
                'X-Content-Type-Options': 'nosniff',
                'Referrer-Policy': 'no-referrer',
                'X-Frame-Options': 'DENY',
                'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
                'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
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
