/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const path = require('path');

module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine'],
    plugins: [require('karma-jasmine'), require('karma-chrome-launcher'), require('karma-esbuild')],
    files: [{pattern: 'tests/**/*.test.ts', watched: true}],
    preprocessors: {
      'tests/**/*.test.ts': ['esbuild'],
    },
    esbuild: {
      tsconfig: './tsconfig.json',
      target: 'es2022',
      format: 'iife',
      sourcemap: true,
      alias: {
        // Map @a2ui/lit packages directly to their TypeScript source files.
        // This allows tests to run against live code changes without requiring
        // a rebuild step first.
        '@a2ui/lit/v0_9': path.resolve(__dirname, '../src/v0_9/index.ts'),
        '@a2ui/lit': path.resolve(__dirname, '../src/index.ts'),
      },
    },
    reporters: ['progress'],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: false,
    browsers: ['ChromeHeadless'],
    singleRun: true,
    concurrency: Infinity,
    hostname: '127.0.0.1',
    listenAddress: '127.0.0.1',
    captureTimeout: 210000,
    browserNoActivityTimeout: 210000,
    browserDisconnectTimeout: 10000,
    browserDisconnectTolerance: 3,
  });
};
