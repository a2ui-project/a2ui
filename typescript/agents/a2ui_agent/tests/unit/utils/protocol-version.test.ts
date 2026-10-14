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
import {A2uiCatalogError} from '../../../src/errors.js';
import {toWireProtocolVersion} from '../../../src/utils/protocol-version.js';

describe('toWireProtocolVersion', () => {
  it('passes through an already wire-formatted version', () => {
    expect(toWireProtocolVersion('v1.0')).toBe('v1.0');
    expect(toWireProtocolVersion('v0.9')).toBe('v0.9');
    expect(toWireProtocolVersion('v0.9.1')).toBe('v0.9.1');
  });

  it('adds the v prefix to the bare version the catalog JSON carries', () => {
    expect(toWireProtocolVersion('1.0')).toBe('v1.0');
    expect(toWireProtocolVersion('0.9')).toBe('v0.9');
  });

  it('converts the underscore spelling used by directory names', () => {
    expect(toWireProtocolVersion('v0_9_1')).toBe('v0.9.1');
    expect(toWireProtocolVersion('1_0')).toBe('v1.0');
  });

  it('throws rather than assuming a version when none is given', () => {
    expect(() => toWireProtocolVersion(undefined)).toThrow(A2uiCatalogError);
    expect(() => toWireProtocolVersion(null)).toThrow(A2uiCatalogError);
    expect(() => toWireProtocolVersion('')).toThrow(A2uiCatalogError);
  });
});
