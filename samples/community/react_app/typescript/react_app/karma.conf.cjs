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
      // The package's own tests and the tests of the copied shared sandbox, which run in every
      // package that copies it.
      {pattern: 'src/*.test.ts', watched: true},
      {pattern: 'src/shared/**/*.test.ts', watched: true},
      // The real sandbox proxy, built into dist/sandbox/ by `build`; served, not bundled.
      {pattern: 'dist/sandbox/**', included: false, served: true, watched: false},
    ],
    proxies: {
      '/a2ui-sandbox/': '/base/dist/sandbox/',
    },
    preprocessors: {
      'src/**/*.test.ts': ['esbuild'],
    },
    esbuild: {
      tsconfig: './tsconfig.test.json',
      target: 'es2022',
      format: 'iife',
      sourcemap: true,
      ignoreAnnotations: true,
    },
    reporters: ['dots'],
    browserConsoleLogOptions: {level: 'warn', terminal: true},
    port: 9879,
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
