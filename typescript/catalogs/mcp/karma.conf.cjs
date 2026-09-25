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

module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine'],
    plugins: [require('karma-jasmine'), require('karma-chrome-launcher'), require('karma-esbuild')],
    files: [
      // The browser suite: the component, the catalog, the entry point and the shared sandbox
      // code. The catalog functions keep their Node test runner (see `test:node`).
      {pattern: 'src/catalog.test.ts', watched: true},
      {pattern: 'src/index.test.ts', watched: true},
      {pattern: 'src/components/**/*.test.ts', watched: true},
      {pattern: 'src/shared/**/*.test.ts', watched: true},
      {pattern: 'tests/**/*.test.ts', watched: true},
      // The real sandbox proxy, built into dist/sandbox/ by `build-sandbox`, and the fixtures of
      // the real-frame scenarios. Both are served, not included in the test bundle.
      {pattern: 'dist/sandbox/**', included: false, served: true, watched: false},
      {pattern: 'tests/fixtures/**', included: false, served: true, watched: false},
    ],
    // Serves the proxy at its default path and the fixtures next to it, so the tests load them
    // the way a host application would.
    proxies: {
      '/a2ui-sandbox/': '/base/dist/sandbox/',
      '/a2ui-fixtures/': '/base/tests/fixtures/',
    },
    preprocessors: {
      'src/**/*.test.ts': ['esbuild'],
      'tests/**/*.test.ts': ['esbuild'],
    },
    esbuild: {
      tsconfig: './tsconfig.test.json',
      target: 'es2022',
      format: 'iife',
      sourcemap: true,
      // The test bundle imports each spec file for its side effects; without this, the package's
      // "sideEffects": false would let esbuild drop those imports.
      ignoreAnnotations: true,
    },
    reporters: ['progress'],
    // The App SDK transport logs every message at debug level; only warnings and errors are
    // worth the terminal.
    browserConsoleLogOptions: {level: 'warn', terminal: true},
    port: 9878,
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
