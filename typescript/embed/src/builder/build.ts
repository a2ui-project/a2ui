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

import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {build as esbuild} from 'esbuild';

import {createCatalogSchemaFile} from './catalog_schema.js';
import {findExternalReferences, renderAppHtml, ROOT_ELEMENT_ID} from './html.js';
import {
  ASSET_EXTENSIONS,
  configApiPlugin,
  CONFIG_FILE_NAMES,
  findConfigFile,
  loadConfigFile,
} from './load_config.js';

/** The app size above which the build warns. MCP Apps hosts cap resources at about 10 MiB. */
export const APP_SIZE_WARNING_BYTES = 5 * 1024 * 1024;

const DEFAULT_TITLE = 'A2UI app';

/** Options of {@link build}. */
export interface BuildOptions {
  /** The config file, relative to `cwd`. Optional (default: the first `a2ui-embed.config.*` in `cwd`). */
  config?: string;
  /** The directory to resolve `config` from. Optional (default: `process.cwd()`). */
  cwd?: string;
}

/** The files written by {@link build}. */
export interface BuildResult {
  /** The absolute path of the app HTML file. */
  htmlPath: string;
  /** The absolute path of the catalog schema file. */
  catalogSchemaPath: string;
  /** The size of the app HTML file in bytes. */
  htmlBytes: number;
  /** Problems that did not fail the build, such as an app above {@link APP_SIZE_WARNING_BYTES}. */
  warnings: string[];
}

/**
 * Builds the app HTML and the catalog schema file from a config file.
 *
 * The config file is evaluated in Node to write the catalog schema file, and bundled into the app
 * with the `@a2ui/embed/mcp` runtime, so both outputs come from the same catalog objects.
 *
 * @throws {Error} If the config is missing or invalid, the bundle fails, or the app would load
 *   anything from the network.
 */
export function build(options: BuildOptions = {}): Promise<BuildResult> {
  return buildApp({...options, runtimeModule: '@a2ui/embed/mcp'});
}

/** Options of {@link buildApp}, which tests use to bundle a stand-in runtime. */
export interface BuildAppOptions extends BuildOptions {
  /** The module that exports `startEmbedApp`, resolved from the config file's directory. */
  runtimeModule: string;
}

/** Implements {@link build} with a configurable runtime module. */
export async function buildApp({
  config,
  cwd = process.cwd(),
  runtimeModule,
}: BuildAppOptions): Promise<BuildResult> {
  const configPath = config === undefined ? findConfigFile(cwd) : resolve(cwd, config);
  if (configPath === undefined) {
    throw new Error(
      `No config file found in ${cwd}. Create one of ${CONFIG_FILE_NAMES.join(', ')}, or pass --config.`,
    );
  }
  const configApiPath = siblingModule('config_api');
  const embedConfig = await loadConfigFile(configPath, configApiPath);
  const configDir = dirname(configPath);
  const htmlPath = resolve(configDir, embedConfig.output);
  const catalogSchemaPath = htmlPath.replace(/\.html$/, '.catalog.json');

  const catalogSchemaFile = createCatalogSchemaFile(embedConfig.catalogs);
  const {script, style} = await bundleApp(configPath, configApiPath, runtimeModule);
  const html = renderAppHtml({title: embedConfig.title ?? DEFAULT_TITLE, script, style});

  const externalReferences = findExternalReferences(html);
  if (externalReferences.length > 0) {
    throw new Error(
      'The app would load these resources from the network, which MCP Apps hosts block by ' +
        `default. Bundle them instead:\n${externalReferences.map(ref => `  ${ref}`).join('\n')}`,
    );
  }

  const htmlBytes = Buffer.byteLength(html);
  const warnings: string[] = [];
  if (htmlBytes > APP_SIZE_WARNING_BYTES) {
    warnings.push(
      `The app is ${formatBytes(htmlBytes)}, above ${formatBytes(APP_SIZE_WARNING_BYTES)}; ` +
        'MCP Apps hosts may reject resources above 10 MiB.',
    );
  }

  await mkdir(dirname(htmlPath), {recursive: true});
  await writeFile(htmlPath, html);
  await writeFile(catalogSchemaPath, `${JSON.stringify(catalogSchemaFile, null, 2)}\n`);
  return {htmlPath, catalogSchemaPath, htmlBytes, warnings};
}

/** Bundles the config's catalogs and the runtime into one script and one stylesheet. */
async function bundleApp(
  configPath: string,
  configApiPath: string,
  runtimeModule: string,
): Promise<{script: string; style: string}> {
  const entry = [
    `import config from ${JSON.stringify(configPath)};`,
    `import {startEmbedApp} from ${JSON.stringify(runtimeModule)};`,
    'startEmbedApp({',
    '  catalogs: config.catalogs,',
    `  root: document.getElementById(${JSON.stringify(ROOT_ELEMENT_ID)}),`,
    '});',
  ].join('\n');
  const result = await esbuild({
    stdin: {contents: entry, resolveDir: dirname(configPath), sourcefile: 'a2ui-embed-entry.js'},
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    minify: true,
    charset: 'utf8',
    outfile: 'app.js',
    write: false,
    define: {'process.env.NODE_ENV': '"production"'},
    loader: Object.fromEntries(ASSET_EXTENSIONS.map(extension => [extension, 'dataurl' as const])),
    plugins: [configApiPlugin(configApiPath)],
    logLevel: 'silent',
  }).catch((error: unknown) => {
    throw new Error(
      `Could not bundle the app from ${configPath}. The config file and everything it imports ` +
        `must also run in the browser.\n${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const output = (extension: string) =>
    result.outputFiles.find(file => file.path.endsWith(extension))?.text ?? '';
  return {script: output('.js'), style: output('.css')};
}

/** Resolves a module next to this one, in TypeScript when the tests run the sources. */
function siblingModule(name: string): string {
  const here = fileURLToPath(import.meta.url);
  return resolve(dirname(here), `${name}${extname(here)}`);
}

/** Formats a byte count as MiB with two decimals, or KiB below 1 MiB. */
export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
    : `${(bytes / 1024).toFixed(1)} KiB`;
}
