/*
 * Copyright 2026 Google LLC
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

/**
 * Node side of the runtime package: where the built runtime lives, its manifest, and a request
 * handler that serves it with the headers app frames need.
 */

import {createReadStream, readFileSync, statSync} from 'node:fs';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {dirname, extname, join, normalize, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * The manifest the build writes next to the runtime files (`manifest.json`). Paths are relative
 * to the manifest's URL.
 */
export interface ReactAppRuntimeManifest {
  /** Version of the runtime package. */
  readonly version: string;
  /** Version of the bridge protocol the runtime speaks. */
  readonly protocolVersion: string;
  /** Import map of the app document: module name to file. */
  readonly importMap: {readonly imports: Readonly<Record<string, string>>};
  /** Import map name of the module whose `start()` runs the app. */
  readonly entry: string;
  /** The `a2ui-lite.css` stylesheet. */
  readonly stylesheet: string;
  /** Module files the first render needs, for `<link rel="modulepreload">`. */
  readonly preload: readonly string[];
}

/** Directory of the built runtime: the files to serve at `.../react-app/v1/`. */
export const REACT_APP_RUNTIME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'v1');

/** Reads the manifest of a built runtime directory. */
export function readRuntimeManifest(dir: string = REACT_APP_RUNTIME_DIR): ReactAppRuntimeManifest {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as ReactAppRuntimeManifest;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Whether a file name carries a content hash (`name-HASH.ext`), so it never changes. */
export function isHashedFileName(name: string): boolean {
  return /-[A-Z0-9]{8,}\.(js|css)$/i.test(name);
}

/**
 * Headers of a runtime file. App frames have an opaque origin and load module scripts with CORS,
 * so every response allows any origin. Hashed files are immutable; the manifest is revalidated.
 */
export function runtimeHeaders(fileName: string): Record<string, string> {
  return {
    'Content-Type': CONTENT_TYPES[extname(fileName)] ?? 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': isHashedFileName(fileName)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  };
}

/** Options of {@link createReactAppRuntimeHandler}. */
export interface RuntimeHandlerOptions {
  /** Directory to serve; defaults to {@link REACT_APP_RUNTIME_DIR}. */
  readonly dir?: string;
  /** URL path prefix the handler answers under, for example `/a2ui-sandbox/react-app/v1/`. */
  readonly basePath?: string;
}

/**
 * A request handler for Node `http`, Connect, Express or a Vite dev server middleware that
 * serves the runtime files with {@link runtimeHeaders}. Requests outside `basePath`, or for files
 * that don't exist, go to `next` (or get a 404 without one).
 */
export function createReactAppRuntimeHandler(
  options: RuntimeHandlerOptions = {},
): (req: IncomingMessage, res: ServerResponse, next?: () => void) => void {
  const dir = resolve(options.dir ?? REACT_APP_RUNTIME_DIR);
  const basePath = options.basePath ?? '/';
  return (req, res, next) => {
    const notFound = () => {
      if (next) {
        next();
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    };
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (!pathname.startsWith(basePath)) {
      notFound();
      return;
    }
    const relative = normalize(pathname.slice(basePath.length));
    const file = resolve(dir, relative);
    if (file !== dir && !file.startsWith(dir + sep)) {
      notFound();
      return;
    }
    let isFile = false;
    try {
      isFile = statSync(file).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      notFound();
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      });
      res.end();
      return;
    }
    res.writeHead(200, runtimeHeaders(file));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  };
}
