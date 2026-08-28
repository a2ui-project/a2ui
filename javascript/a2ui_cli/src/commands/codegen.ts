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

import * as fs from 'node:fs';
import * as path from 'node:path';
import {Command} from 'commander';
import {Catalog} from '@a2ui/web_core/v0_9';
import {CatalogAnalyzer} from '../analyzer/catalog-analyzer.js';
import {PythonEmitter} from '../emitters/python/python-emitter.js';

export function createCodegenCommand(): Command {
  const cmd = new Command('codegen');
  cmd
    .description('Generates typesafe A2UI component libraries from catalog schemas.')
    .requiredOption('--catalog <path>', 'Path to the catalog JSON Schema file.')
    .requiredOption('--out <dir>', 'Output directory where generated files will be written.')
    .option('--lang <language>', 'Target language for code generation (python).', 'python')
    .option(
      '--base-import <module>',
      'Base module from which ComponentBuilderNode, DataBinding, etc. are imported.',
      'a2ui.builder.base',
    )
    .action(async options => {
      const catalogPath = path.resolve(process.cwd(), options.catalog);
      if (!fs.existsSync(catalogPath)) {
        console.error(`Error: Catalog file not found at: ${catalogPath}`);
        process.exit(1);
      }

      let catalogJson: Record<string, any>;
      try {
        const raw = fs.readFileSync(catalogPath, 'utf-8');
        catalogJson = JSON.parse(raw);
      } catch (err: any) {
        console.error(`Error reading or parsing catalog JSON: ${err.message}`);
        process.exit(1);
      }

      let catalog: any;
      try {
        catalog = Catalog.fromJson(catalogJson);
      } catch (err: any) {
        console.error(`Error analyzing catalog schema: ${err.message}`);
        process.exit(1);
      }

      const analysed = CatalogAnalyzer.analyze(catalog);
      const outPath = path.resolve(process.cwd(), options.out);

      if (options.lang === 'python') {
        const emitter = new PythonEmitter(analysed, {
          baseImport: options.baseImport,
        });
        const written = emitter.emit(outPath);
        console.log(`Successfully generated ${written.length} file(s):`);
        for (const file of written) {
          console.log(`  - ${file}`);
        }
      } else {
        console.error(`Unsupported target language: ${options.lang}`);
        process.exit(1);
      }
    });

  return cmd;
}
