/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, expect, it, vi} from 'vitest';
import {extractA2uiMessages} from './extract-a2ui-messages';

const MESSAGE = {
  version: 'v0.9',
  updateDataModel: {surfaceId: 'counter', path: '/counter', value: 1},
};

function resourceBlock(text: string, mimeType = 'application/a2ui+json') {
  return {type: 'resource', resource: {uri: 'a2ui://test', mimeType, text}};
}

describe('extractA2uiMessages', () => {
  it('returns [] for non-array content', () => {
    expect(extractA2uiMessages(undefined)).toEqual([]);
    expect(extractA2uiMessages(null)).toEqual([]);
    expect(extractA2uiMessages({})).toEqual([]);
  });

  it('extracts an array payload from an a2ui+json resource', () => {
    const content = [resourceBlock(JSON.stringify([MESSAGE, MESSAGE]))];
    expect(extractA2uiMessages(content)).toEqual([MESSAGE, MESSAGE]);
  });

  it('wraps a single-message payload in an array', () => {
    const content = [resourceBlock(JSON.stringify(MESSAGE))];
    expect(extractA2uiMessages(content)).toEqual([MESSAGE]);
  });

  it('accepts the legacy application/json+a2ui mime type', () => {
    const content = [resourceBlock(JSON.stringify([MESSAGE]), 'application/json+a2ui')];
    expect(extractA2uiMessages(content)).toEqual([MESSAGE]);
  });

  it('collects payloads from multiple resources in order', () => {
    const other = {...MESSAGE, updateDataModel: {...MESSAGE.updateDataModel, value: 2}};
    const content = [
      resourceBlock(JSON.stringify([MESSAGE])),
      {type: 'text', text: 'ignored'},
      resourceBlock(JSON.stringify([other])),
    ];
    expect(extractA2uiMessages(content)).toEqual([MESSAGE, other]);
  });

  it('ignores non-resource blocks and other mime types', () => {
    const content = [
      {type: 'text', text: JSON.stringify([MESSAGE])},
      resourceBlock(JSON.stringify([MESSAGE]), 'text/html'),
      {type: 'resource', resource: {uri: 'a2ui://no-text', mimeType: 'application/a2ui+json'}},
    ];
    expect(extractA2uiMessages(content)).toEqual([]);
  });

  it('ignores JSON scalars and null payloads', () => {
    const content = [resourceBlock('null'), resourceBlock('123'), resourceBlock('"text"')];
    expect(extractA2uiMessages(content)).toEqual([]);
  });

  it('skips resources with invalid JSON and keeps the rest', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const content = [resourceBlock('{not json'), resourceBlock(JSON.stringify([MESSAGE]))];
    expect(extractA2uiMessages(content)).toEqual([MESSAGE]);
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});
