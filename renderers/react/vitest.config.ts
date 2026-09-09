/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {defineConfig} from 'vitest/config';
import path from 'path';
import react from '@vitejs/plugin-react';
import {createRequire} from 'module';

const require = createRequire(import.meta.url);
const isReact18 = process.env.REACT_VERSION === '18';

const getReact18Aliases = () => {
  if (!isReact18) return [];
  return [
    {find: /^react-dom\/client$/, replacement: require.resolve('react-dom-18/client')},
    {find: /^react-dom\/server$/, replacement: require.resolve('react-dom-18/server')},
    {find: /^react-dom$/, replacement: require.resolve('react-dom-18')},
    {find: /^react\/jsx-dev-runtime$/, replacement: require.resolve('react-18/jsx-dev-runtime')},
    {find: /^react\/jsx-runtime$/, replacement: require.resolve('react-18/jsx-runtime')},
    {find: /^react$/, replacement: require.resolve('react-18')},
    {find: /^@testing-library\/react$/, replacement: require.resolve('@testing-library/react-18')},
  ];
};

export default defineConfig({
  plugins: [react(isReact18 ? {jsxImportSource: 'react-18'} : {})],
  server: {
    deps: {
      inline: [true],
    },
  },
  ssr: {
    alias: getReact18Aliases(),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
    },
  },
  resolve: {
    alias: [
      ...getReact18Aliases(),
      {find: '@', replacement: path.resolve(process.cwd(), 'src/v0_8')},
      {find: '@a2ui/react/v0_9', replacement: path.resolve(process.cwd(), 'src/v0_9/index.ts')},
      {find: '@a2ui/react/v0_8', replacement: path.resolve(process.cwd(), 'src/v0_8/index.ts')},
      {find: '@a2ui/react/styles', replacement: path.resolve(process.cwd(), 'src/styles/index.ts')},
      {find: '@a2ui/react', replacement: path.resolve(process.cwd(), 'src/index.ts')},
    ],
  },
});
