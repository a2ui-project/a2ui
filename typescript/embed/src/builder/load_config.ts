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

import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {unlink, writeFile} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';

import {build as esbuild, type Plugin} from 'esbuild';

import type {EmbedBuildConfig, EmbedCatalog} from './config.js';

/** The file names `a2ui-embed build` looks for, in order, when no config path is given. */
export const CONFIG_FILE_NAMES = [
  'a2ui-embed.config.ts',
  'a2ui-embed.config.mts',
  'a2ui-embed.config.mjs',
  'a2ui-embed.config.js',
] as const;

/** The asset files the app bundle inlines as data URLs. */
export const ASSET_EXTENSIONS = ['.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'] as const;

/** Finds the config file in `dir`, or returns `undefined`. */
export function findConfigFile(dir: string): string | undefined {
  return CONFIG_FILE_NAMES.map(name => join(dir, name)).find(path => existsSync(path));
}

/**
 * Resolves `@a2ui/embed/build` to `configApiPath`, so that a config file gets the same
 * `defineConfig` and `basicCatalog` in Node and in the app bundle.
 */
export function configApiPlugin(configApiPath: string): Plugin {
  return {
    name: 'a2ui-embed-config-api',
    setup(build) {
      build.onResolve({filter: /^@a2ui\/embed\/build$/}, () => ({path: configApiPath}));
    },
  };
}

/**
 * Loads a config file written in TypeScript or JavaScript and validates it.
 *
 * The file is bundled with its local imports into a temporary ES module next to it, which Node
 * then imports, so TypeScript configs need no loader. Packages stay external and resolve from the
 * config file's directory.
 */
export async function loadConfigFile(
  configPath: string,
  configApiPath: string,
): Promise<EmbedBuildConfig> {
  const result = await esbuild({
    entryPoints: [configPath],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'external',
    // Stylesheets and assets only matter in the app bundle.
    loader: Object.fromEntries(
      ['.css', ...ASSET_EXTENSIONS].map(extension => [extension, 'empty' as const]),
    ),
    plugins: [configApiPlugin(configApiPath)],
    write: false,
    logLevel: 'silent',
  }).catch((error: unknown) => {
    throw new Error(`Could not bundle the config file ${configPath}:\n${errorMessage(error)}`);
  });
  const tempPath = join(
    dirname(configPath),
    `.${basename(configPath)}.${randomBytes(6).toString('hex')}.mjs`,
  );
  await writeFile(tempPath, result.outputFiles[0].contents);
  let module: {default?: unknown};
  try {
    module = (await import(pathToFileURL(tempPath).href)) as {default?: unknown};
  } catch (error) {
    throw new Error(
      `Could not load the config file ${configPath}. It and the catalogs it imports must load in ` +
        `Node; move code that needs a browser into functions that run on render.\n${errorMessage(error)}`,
    );
  } finally {
    await unlink(tempPath);
  }
  return validateConfig(module.default, configPath);
}

/** Checks that `value` is a valid config and returns it typed. */
export function validateConfig(value: unknown, source: string): EmbedBuildConfig {
  const fail = (message: string): never => {
    throw new Error(`Invalid config in ${source}: ${message}`);
  };
  if (typeof value !== 'object' || value === null) {
    return fail(
      'the default export must be the config object; use `export default defineConfig({...})`.',
    );
  }
  const config = value as Partial<Record<keyof EmbedBuildConfig, unknown>>;
  if (!Array.isArray(config.catalogs) || config.catalogs.length === 0) {
    fail('`catalogs` must list at least one catalog, such as `basicCatalog`.');
  }
  (config.catalogs as unknown[]).forEach((catalog, index) => {
    if (!isCatalog(catalog)) {
      fail(
        `\`catalogs[${index}]\` is not a catalog; pass \`Catalog\` instances from @a2ui/web_core.`,
      );
    }
  });
  if (config.renderer !== undefined && config.renderer !== 'lit') {
    fail(`unknown renderer ${JSON.stringify(config.renderer)}; the only renderer is 'lit'.`);
  }
  if (typeof config.output !== 'string' || !config.output.endsWith('.html')) {
    fail('`output` must be the path of an `.html` file, such as `dist/a2ui-app.html`.');
  }
  if (config.title !== undefined && typeof config.title !== 'string') {
    fail('`title` must be a string.');
  }
  if (config.markdown !== undefined && typeof config.markdown !== 'boolean') {
    fail('`markdown` must be `true` or `false`.');
  }
  return config as EmbedBuildConfig;
}

function isCatalog(value: unknown): value is EmbedCatalog {
  // Duck-typed: the config may load another copy of @a2ui/web_core than this package.
  const catalog = value as Partial<EmbedCatalog> | null;
  return (
    typeof catalog === 'object' &&
    catalog !== null &&
    typeof catalog.id === 'string' &&
    typeof catalog.protocolVersion === 'string' &&
    'validationSchema' in catalog
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
