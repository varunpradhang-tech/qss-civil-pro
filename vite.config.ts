import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // libredwg-web ships a large prebuilt wasm; don't let Vite try to pre-bundle/optimize it.
  optimizeDeps: { exclude: ['@mlightcad/libredwg-web'] },
});
