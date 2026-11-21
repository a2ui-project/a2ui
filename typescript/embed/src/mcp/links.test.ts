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

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {isOpenableUrl} from './links.js';

describe('isOpenableUrl', () => {
  it('accepts absolute http, https and mailto URLs', () => {
    assert.equal(isOpenableUrl('https://a2ui.org/docs'), true);
    assert.equal(isOpenableUrl('http://localhost:8080/'), true);
    assert.equal(isOpenableUrl('mailto:team@example.com'), true);
  });

  it('rejects script, data and frame-local URLs', () => {
    assert.equal(isOpenableUrl('javascript:alert(1)'), false);
    assert.equal(isOpenableUrl('data:text/html,<p>hi</p>'), false);
    assert.equal(isOpenableUrl('about:srcdoc#section'), false);
    assert.equal(isOpenableUrl('/relative/path'), false);
  });
});
