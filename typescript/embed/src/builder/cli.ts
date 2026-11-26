#!/usr/bin/env node
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

import {relative} from 'node:path';
import {parseArgs} from 'node:util';

import {build, formatBytes} from './build.js';

const USAGE = `Usage: a2ui-embed build [--config <path>]

Builds the single-file app HTML and its catalog schema file from a2ui-embed.config.{ts,mts,mjs,js}.

Options:
  -c, --config <path>  The config file. Optional (default: a2ui-embed.config.* in the current directory).
  -h, --help           Shows this help.`;

/** Runs the `a2ui-embed` command and returns its exit code. */
export async function main(args: readonly string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      options: {config: {type: 'string', short: 'c'}, help: {type: 'boolean', short: 'h'}},
    });
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 1;
  }
  const {values, positionals} = parsed;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (positionals.length !== 1 || positionals[0] !== 'build') {
    console.error(USAGE);
    return 1;
  }
  try {
    const result = await build({config: values.config});
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    console.log(
      `Wrote ${relative(process.cwd(), result.htmlPath)} (${formatBytes(result.htmlBytes)}) and ` +
        relative(process.cwd(), result.catalogSchemaPath),
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
