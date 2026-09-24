/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, it, expect} from 'vitest';
import {getProtocolSchemaPaths} from '../../../src/utils/catalog_path.js';
import {getProtocolSchemas} from '../../../src/utils/protocol_schemas.js';
import {A2uiCatalogError} from '../../../src/errors.js';

describe('getProtocolSchemaPaths', () => {
  it('resolves the v0.9 filenames', () => {
    const paths = getProtocolSchemaPaths('v0.9');
    expect(paths.serverToClientPath).toContain('v0_9/schemas/server_to_client.json');
    expect(paths.commonTypesPath).toContain('v0_9/schemas/common_types.json');
  });

  // v1.0 renamed the server-to-client file. Nothing else in the suite exercises that
  // rename, and an untested v1.0 schema path is exactly how the Child ref regression went
  // unnoticed, so it is asserted explicitly here.
  it('resolves the renamed v1.0 server-to-client file', () => {
    const paths = getProtocolSchemaPaths('v1.0');
    expect(paths.serverToClientPath).toContain('v1_0/schemas/agent_to_renderer.json');
    expect(paths.commonTypesPath).toContain('v1_0/schemas/common_types.json');
  });

  it('accepts the bare version spelling the catalog JSON carries', () => {
    expect(getProtocolSchemaPaths('0.9').serverToClientPath).toBe(
      getProtocolSchemaPaths('v0.9').serverToClientPath,
    );
  });

  it('refuses a version it ships no schemas for', () => {
    expect(() => getProtocolSchemaPaths('v0.8')).toThrow(A2uiCatalogError);
    expect(() => getProtocolSchemaPaths('v0.8')).toThrow(/No protocol schemas are available/);
  });
});

describe('getProtocolSchemas', () => {
  it('loads schemas that actually carry the constraints the parser relies on', () => {
    const schemas = getProtocolSchemas('v0.9');

    // Assert on content rather than merely on the files parsing, so a silently empty or
    // wrong file cannot pass.
    expect(schemas.serverToClient.$defs).toBeDefined();
    const defs = schemas.serverToClient.$defs as Record<string, unknown>;
    expect(Object.keys(defs)).toContain('CreateSurfaceMessage');
    expect(Object.keys(defs)).toContain('UpdateComponentsMessage');

    expect(schemas.commonTypes.$defs).toBeDefined();
    expect(
      Object.keys(schemas.commonTypes.$defs as Record<string, unknown>).length,
    ).toBeGreaterThan(0);
  });

  it('loads the v1.0 schemas through the renamed file', () => {
    const schemas = getProtocolSchemas('v1.0');
    expect(schemas.serverToClient.$defs).toBeDefined();
    expect(schemas.commonTypes.$defs).toBeDefined();
  });

  it('memoizes, returning the same object for repeated calls', () => {
    expect(getProtocolSchemas('v0.9')).toBe(getProtocolSchemas('v0.9'));
  });

  it('propagates the error for an unsupported version rather than returning empty schemas', () => {
    expect(() => getProtocolSchemas('v0.8')).toThrow(A2uiCatalogError);
  });
});
