import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages hosts the temporary staging build under /qss-civil-pro/.
  // Netlify and local builds continue to use the domain root.
  base: process.env.QSS_BASE_PATH || '/',
  plugins: [react()],
  server: { port: 5173 },
  // libredwg-web ships a large prebuilt wasm; don't let Vite try to pre-bundle/optimize it.
  optimizeDeps: { exclude: ['@mlightcad/libredwg-web'] },
});
