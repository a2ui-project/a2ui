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
import * as webCore from '../../src/internal/web_core.js';
import {basicCatalog} from '../../src/types.js';
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
    expect(catalog.protocolVersion).toBe('v1.0');
    expect(catalog.catalogSchema).toBeDefined();
    // Contains a plausible number of components
    expect(catalog.components.size).toBeGreaterThan(5);
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
