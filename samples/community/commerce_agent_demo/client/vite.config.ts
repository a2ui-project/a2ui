import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@a2ui\/web_core\/v0_9$/,
        replacement: path.resolve(
          __dirname,
          '../../../../renderers/web_core/dist/src/v0_9/index.js',
        ),
      },
      {
        find: /^@a2ui\/web_core\/v0_9\/basic_catalog$/,
        replacement: path.resolve(
          __dirname,
          '../../../../renderers/web_core/dist/src/v0_9/basic_catalog/index.js',
        ),
      },
      {
        find: /^@a2ui\/react\/v0_9$/,
        replacement: path.resolve(
          __dirname,
          '../../../../renderers/react/dist/v0_9/index.js',
        ),
      },
      {
        find: '@a2ui/web_core',
        replacement: path.resolve(
          __dirname,
          '../../../../renderers/web_core/dist/src',
        ),
      },
      {
        find: '@a2ui/react',
        replacement: path.resolve(
          __dirname,
          '../../../../renderers/react/dist',
        ),
      },
    ],
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
