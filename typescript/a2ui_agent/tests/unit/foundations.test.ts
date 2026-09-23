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
import {existsSync} from 'fs';
import * as webCore from '../../src/internal/web_core.js';
import {basicCatalog} from '../../src/types.js';
import {getBasicCatalogPath} from '../../src/utils/catalog_path.js';
import {ParseError, A2uiCatalogError, A2uiError} from '../../src/errors.js';

describe('Foundations', () => {
  it('protects the single dependency seam for @a2ui/web_core', () => {
    // Assert all symbols expected from web_core are defined at runtime.
    // Note: Types won't be in the runtime object, but runtime values must be present.
    expect(webCore.Catalog).toBeDefined();
    expect(webCore.AgentToRendererMessageSchema).toBeDefined();
    expect(webCore.RendererToAgentMessageSchema).toBeDefined();
    expect(webCore.V10RendererCapabilitiesSchema).toBeDefined();
    expect(webCore.BASIC_COMPONENTS).toBeDefined();
    expect(webCore.BASIC_FUNCTION_APIS).toBeDefined();
    expect(webCore.validateRecursionAndPaths).toBeDefined();
    expect(webCore.STRICT_VALIDATION).toBeDefined();
    expect(webCore.getComponentReferences).toBeDefined();
    expect(webCore.buildComponentRefMap).toBeDefined();
    expect(webCore.V10_CHILD_REF_OPTIONS).toBeDefined();
    expect(webCore.MessageProcessor).toBeDefined();
    expect(webCore.A2uiError).toBeDefined();
    expect(webCore.A2uiValidationError).toBeDefined();
    expect(webCore.A2uiDataError).toBeDefined();
    expect(webCore.A2uiExpressionError).toBeDefined();
    expect(webCore.A2uiStateError).toBeDefined();
    expect(webCore.A2uiIntegrityError).toBeDefined();
    expect(webCore.A2uiRecursionError).toBeDefined();
  });

  it('provides a properly configured basicCatalog()', () => {
    const catalog = basicCatalog();
    expect(catalog.id).toBe('https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json');
    expect(catalog.protocolVersion).toBe('v1.0');
    expect(catalog.catalogSchema).toBeDefined();
    expect(catalog.components.size).toBe(18);
    expect(catalog.functions.size).toBe(14);
    expect(typeof catalog.instructions).toBe('string');
    expect(catalog.instructions!.length).toBeGreaterThan(0);
  });

  it('memoizes basicCatalog() returning the identical instance across calls', () => {
    const first = basicCatalog();
    const second = basicCatalog();
    const defaultExplicit = basicCatalog('v1.0');
    expect(first).toBe(second);
    expect(first).toBe(defaultExplicit);

    // The memo is keyed on the normalised version, so every spelling of v1.0 lands on the
    // same instance rather than reloading and reparsing the JSON.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(basicCatalog('1.0' as any)).toBe(first);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(basicCatalog('v1_0' as any)).toBe(first);
  });

  it('provides a properly configured basicCatalog() for v0.9', () => {
    const catalog = basicCatalog('v0.9');
    expect(catalog.id).toBe('https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json');
    expect(catalog.protocolVersion).toBe('v0.9');
    expect(catalog.catalogSchema).toBeDefined();
    expect(catalog.components.size).toBe(18);
    expect(catalog.functions.size).toBe(14);
    expect(catalog).not.toBe(basicCatalog('v1.0'));
    expect(basicCatalog('v0.9')).toBe(catalog);
  });

  it('throws A2uiCatalogError when no catalog ships for the requested version', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => basicCatalog('v0.8' as any)).toThrow(A2uiCatalogError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => basicCatalog('invalid' as any)).toThrow(A2uiCatalogError);
  });

  it('resolves the basic catalog path to the web_core distribution json', () => {
    const catalogPath = getBasicCatalogPath('v1.0');
    expect(catalogPath).toMatch(/dist\/src\/v1_0\/schemas\/catalogs\/basic\/catalog\.json$/);
    expect(existsSync(catalogPath)).toBe(true);
    expect(getBasicCatalogPath('1.0')).toBe(catalogPath);

    const catalogPathV09 = getBasicCatalogPath('v0.9');
    expect(catalogPathV09).toMatch(/dist\/src\/v0_9\/schemas\/catalogs\/basic\/catalog\.json$/);
    expect(existsSync(catalogPathV09)).toBe(true);
    expect(getBasicCatalogPath('0.9')).toBe(catalogPathV09);

    expect(() => getBasicCatalogPath('v0.8')).toThrow(A2uiCatalogError);
  });

  it('defines custom errors extending A2uiError', () => {
    const parseError = new ParseError('test parse error');
    expect(parseError).toBeInstanceOf(A2uiError);
    expect(parseError.name).toBe('ParseError');
    expect(parseError.code).toBe('PARSE_ERROR');

    const catalogError = new A2uiCatalogError('test catalog error');
    expect(catalogError).toBeInstanceOf(A2uiError);
    expect(catalogError.name).toBe('A2uiCatalogError');
    expect(catalogError.code).toBe('CATALOG_ERROR');
  });
});
