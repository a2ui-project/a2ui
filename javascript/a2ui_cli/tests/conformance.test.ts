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

import * as assert from 'node:assert';
import {describe, it} from 'node:test';
import {spawnSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

interface ConformanceTestCase {
  name: string;
  description?: string;
  catalog_schema?: Record<string, unknown>;
  raw_catalog_content?: string;
  args: string[];
  expect: {
    exit_code: number;
    stdout_contains?: string[];
    stderr_contains?: string[];
    files?: Record<
      string,
      {
        exact_content?: string;
        content_contains?: string[];
        content_not_contains?: string[];
      }
    >;
  };
}

describe('A2UI CLI Conformance Test Suite (conformance/cli/codegen.yaml)', () => {
  const cliPath = path.resolve(process.cwd(), 'dist/src/cli.js');
  const conformanceYamlPath = path.resolve(process.cwd(), '../../conformance/cli/codegen.yaml');

  assert.ok(
    fs.existsSync(conformanceYamlPath),
    `Conformance YAML file not found at ${conformanceYamlPath}`,
  );

  const rawYaml = fs.readFileSync(conformanceYamlPath, 'utf-8');
  const testCases = yaml.load(rawYaml) as ConformanceTestCase[];

  for (const tc of testCases) {
    it(`[conformance] ${tc.name}: ${tc.description || ''}`, () => {
      const repoRoot = path.resolve(process.cwd(), '../..');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `a2ui-conformance-${tc.name}-`));
      const catalogFile = path.join(tmpDir, 'catalog.json');
      const outDir = path.join(tmpDir, 'out');
      const outFile = path.join(tmpDir, 'direct_output.py');

      try {
        if (tc.catalog_schema) {
          fs.writeFileSync(catalogFile, JSON.stringify(tc.catalog_schema, null, 2), 'utf-8');
        } else if (tc.raw_catalog_content) {
          fs.writeFileSync(catalogFile, tc.raw_catalog_content, 'utf-8');
        }

        const args = tc.args.map(arg =>
          arg
            .replace('${CATALOG_PATH}', catalogFile)
            .replace('${OUT_DIR}', outDir)
            .replace('${OUT_FILE}', outFile)
            .replace('${REPO_ROOT}', repoRoot),
        );

        const res = spawnSync(process.execPath, [cliPath, ...args], {
          encoding: 'utf-8',
          cwd: process.cwd(),
        });

        assert.strictEqual(
          res.status,
          tc.expect.exit_code,
          `Test ${tc.name} expected exit code ${tc.expect.exit_code} but got ${res.status}.\nStdout: ${res.stdout}\nStderr: ${res.stderr}`,
        );

        if (tc.expect.stdout_contains) {
          for (const substr of tc.expect.stdout_contains) {
            assert.ok(
              res.stdout.includes(substr),
              `Test ${tc.name} expected stdout to contain "${substr}", got:\n${res.stdout}`,
            );
          }
        }

        if (tc.expect.stderr_contains) {
          for (const substr of tc.expect.stderr_contains) {
            assert.ok(
              res.stderr.includes(substr),
              `Test ${tc.name} expected stderr to contain "${substr}", got:\n${res.stderr}`,
            );
          }
        }

        if (tc.expect.files) {
          for (const [relPath, fileExpect] of Object.entries(tc.expect.files)) {
            let targetPath = path.join(outDir, relPath);
            if (
              !fs.existsSync(targetPath) &&
              fs.existsSync(outFile) &&
              relPath === path.basename(outFile)
            ) {
              targetPath = outFile;
            }

            assert.ok(
              fs.existsSync(targetPath),
              `Test ${tc.name} expected output file ${targetPath} to exist`,
            );

            const actualContent = fs
              .readFileSync(targetPath, 'utf-8')
              .replace(/\r\n/g, '\n')
              .trim();

            if (fileExpect.exact_content) {
              const expectedContent = fileExpect.exact_content.replace(/\r\n/g, '\n').trim();
              assert.strictEqual(
                actualContent,
                expectedContent,
                `Test ${tc.name} exact content mismatch for file ${relPath}`,
              );
            }

            if (fileExpect.content_contains) {
              for (const substr of fileExpect.content_contains) {
                assert.ok(
                  actualContent.includes(substr),
                  `Test ${tc.name} file ${relPath} expected to contain "${substr}"`,
                );
              }
            }

            if (fileExpect.content_not_contains) {
              for (const substr of fileExpect.content_not_contains) {
                assert.ok(
                  !actualContent.includes(substr),
                  `Test ${tc.name} file ${relPath} expected NOT to contain "${substr}"`,
                );
              }
            }
          }
        }
      } finally {
        fs.rmSync(tmpDir, {recursive: true, force: true});
      }
    });
  }
});
