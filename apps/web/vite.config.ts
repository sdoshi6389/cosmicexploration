import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = process.env.COSMOS_API_PORT ?? '8000';

export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: {
      // Engine is consumed from source so model changes apply without a separate build.
      '@cosmos/engine': path.resolve(__dirname, '../../packages/engine/src/index.ts'),
    },
    dedupe: ['three', 'react', 'react-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true },
      '/assets/generated': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 4000,
    target: 'es2022',
    rollupOptions: {
      output: {
        // Vendor chunks cache across deploys; app code changes don't re-download three.js.
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei', '@react-three/postprocessing', 'postprocessing'],
          spacetime: ['spacetimedb'],
          ui: ['react', 'react-dom', 'motion', 'zustand', 'lucide-react'],
        },
      },
    },
  },
});
