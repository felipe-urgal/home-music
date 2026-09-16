import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/receiver/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    outDir: 'dist-tv-receiver',
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./tv-offline-receiver.html', import.meta.url))
    }
  }
});
