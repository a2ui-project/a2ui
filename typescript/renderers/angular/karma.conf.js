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

// Karma configuration file, see link for more information
// https://karma-runner.github.io/1.0/config/configuration-file.html

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const accessibility = yaml.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../conformance/core/accessibility.yaml'), 'utf8'),
);
const adapterConformance = yaml.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../conformance/core/adapter_conformance.yaml'),
    'utf8',
  ),
);
const basicCatalogJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../catalogs/basic/v1/catalog.json'), 'utf8'),
);

function ConformanceManifestReporter(baseReporterDecorator) {
  baseReporterDecorator(this);
  const manifestDir = process.env.A2UI_CONFORMANCE_MANIFEST_DIR;
  const manifestPath = manifestDir ? path.join(manifestDir, `angular-${process.pid}.jsonl`) : null;

  function appendRecord(rec) {
    if (!manifestPath || !rec || !rec.suite || !rec.case) {
      return;
    }
    fs.mkdirSync(manifestDir, {recursive: true});
    const entry = {
      harness: rec.harness || 'angular',
      suite: String(rec.suite).replace(/\\/g, '/'),
      case: rec.case,
      status: rec.status,
      ...(rec.reason ? {reason: rec.reason} : {}),
    };
    fs.appendFileSync(manifestPath, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  this.onBrowserInfo = function (_browser, info) {
    if (info && info.conformanceManifestRecord) {
      appendRecord(info.conformanceManifestRecord);
    }
  };
}
ConformanceManifestReporter.$inject = ['baseReporterDecorator'];

// Karma's middleware injects `config.client` into `context.html` via
// `data.replace('%CLIENT_CONFIG%', 'window.__karma__.config = ' + JSON.stringify(client))`,
// which evaluates `String.prototype.replace` `$` patterns (such as `$'` from `'$'` in
// `catalog.json`) and corrupts the inline `<script>` block. Base64-encoding keeps the
// serialized client config free of `$` and `</script>` sequences.
const conformanceSuites = Buffer.from(
  JSON.stringify({
    accessibility,
    adapterConformance,
    basicCatalogJson,
  }),
  'utf8',
).toString('base64');

module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      {'reporter:conformance-manifest': ['type', ConformanceManifestReporter]},
    ],
    client: {
      jasmine: {
        // you can add configuration options for Jasmine here
        // the possible options are listed at https://jasmine.github.io/api/edge/Configuration.html
        // for example, you can disable the random execution with `random: false`
        // or set a specific seed with `seed: 4321`
      },
      conformanceSuites,
    },
    jasmineHtmlReporter: {
      suppressAll: true, // removes the duplicated traces
    },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage/lib'),
      subdir: '.',
      reporters: [{type: 'html'}, {type: 'text-summary'}],
    },
    reporters: ['progress', 'kjhtml', 'conformance-manifest'],
    browsers: ['Chrome'],
    restartOnFileChange: true,
    hostname: '127.0.0.1',
    listenAddress: '127.0.0.1',
    captureTimeout: 210000,
    browserNoActivityTimeout: 210000,
    browserDisconnectTimeout: 10000,
    browserDisconnectTolerance: 3,
  });
};
