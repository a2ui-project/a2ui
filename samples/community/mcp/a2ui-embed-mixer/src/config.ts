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

/** Paths and environment overrides (`MIXER_APP_HTML`, `MIXER_ENV_FILE`) for Goal Mixer. */

import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Path of the built MCP App HTML; `MIXER_APP_HTML` overrides it. */
export function appHtmlPath(env: NodeJS.ProcessEnv = process.env): string {
  return env['MIXER_APP_HTML'] ?? join(packageRoot, 'dist', 'a2ui-app.html');
}

/** Path of the catalog JSON Schema emitted alongside `a2ui-app.html`. */
export function catalogSchemaPath(env: NodeJS.ProcessEnv = process.env): string {
  return appHtmlPath(env).replace(/\.html$/, '.catalog.json');
}

/**
 * Loads `KEY=value` lines from `MIXER_ENV_FILE` (or the package's `.env`) into `env`
 * without overriding variables already set.
 */
export function loadEnvFile(
  env: NodeJS.ProcessEnv = process.env,
  envFilePath = env['MIXER_ENV_FILE'] ?? join(packageRoot, '.env'),
): void {
  if (!existsSync(envFilePath)) return;
  for (const line of readFileSync(envFilePath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match?.[1] || env[match[1]] !== undefined) continue;
    env[match[1]] = (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
  }
}
