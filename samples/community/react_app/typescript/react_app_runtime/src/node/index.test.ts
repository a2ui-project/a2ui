/**
 * @vitest-environment node
 */
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

import {mkdtempSync, writeFileSync} from 'node:fs';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {createReactAppRuntimeHandler, isHashedFileName, runtimeHeaders} from './index.js';

describe('runtime headers', () => {
  it('marks hashed files immutable and allows any origin', () => {
    expect(isHashedFileName('react-ABCD1234.js')).toBe(true);
    expect(isHashedFileName('a2ui-lite-0F3A9C21.css')).toBe(true);
    expect(isHashedFileName('manifest.json')).toBe(false);
    expect(runtimeHeaders('chunks/chunk-ABCD1234.js')).toMatchObject({
      'Content-Type': 'text/javascript; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    expect(runtimeHeaders('manifest.json')['Cache-Control']).toBe('no-cache');
  });
});

describe('createReactAppRuntimeHandler', () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'react-app-runtime-'));
    writeFileSync(join(dir, 'a2ui-ABCD1234.js'), 'export const x = 1;');
    writeFileSync(join(dir, 'manifest.json'), '{}');
    const handler = createReactAppRuntimeHandler({dir, basePath: '/rt/'});
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('serves files under the base path with CORS', async () => {
    const response = await fetch(`${origin}/rt/a2ui-ABCD1234.js`, {headers: {Origin: 'null'}});

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await response.text()).toBe('export const x = 1;');
  });

  it('answers 404 outside the base path, for missing files and for traversal', async () => {
    expect((await fetch(`${origin}/other/manifest.json`)).status).toBe(404);
    expect((await fetch(`${origin}/rt/missing.js`)).status).toBe(404);
    expect((await fetch(`${origin}/rt/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
  });

  it('answers 400 for a path that is not valid percent encoding, and keeps serving', async () => {
    expect((await fetch(`${origin}/rt/%E0`)).status).toBe(400);
    expect((await fetch(`${origin}/rt/a2ui-ABCD1234.js`)).status).toBe(200);
  });
});
