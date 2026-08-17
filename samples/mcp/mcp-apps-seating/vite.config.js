import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'path';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    rollupOptions: {
      input: resolve(import.meta.dirname, 'index.html')
    }
  }
});
