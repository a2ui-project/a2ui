import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@a2ui/web_core/v0_9/basic_catalog': path.resolve(
        __dirname,
        '../../../../renderers/web_core/dist/src/v0_9/basic_catalog/index.js',
      ),
      '@a2ui/web_core/v0_9': path.resolve(
        __dirname,
        '../../../../renderers/web_core/dist/src/v0_9/index.js',
      ),
      '@a2ui/react/v0_9': path.resolve(
        __dirname,
        '../../../../renderers/react/dist/v0_9/index.js',
      ),
      '@a2ui/web_core': path.resolve(
        __dirname,
        '../../../../renderers/web_core/dist/src',
      ),
      '@a2ui/react': path.resolve(
        __dirname,
        '../../../../renderers/react/dist',
      ),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5180,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8090',
        changeOrigin: true,
      },
    },
  },
});
