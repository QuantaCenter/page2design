import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('/node_modules/konva/') ? 'canvas-engine' : undefined),
      },
    },
  },
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: true,
    watch: { usePolling: true, interval: 300 },
    proxy: { '/api': `http://127.0.0.1:${process.env.PORT || 8787}` },
  },
});
