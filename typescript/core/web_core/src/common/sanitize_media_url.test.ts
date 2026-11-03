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

import * as assert from 'node:assert';
import {describe, it} from 'node:test';
import {sanitizeMediaUrl} from '../index.js';

describe('sanitizeMediaUrl', () => {
  it('allows http, https, data, and relative URLs', () => {
    assert.strictEqual(
      sanitizeMediaUrl('https://example.com/image.png'),
      'https://example.com/image.png',
    );
    assert.strictEqual(
      sanitizeMediaUrl('  http://example.com/video.mp4  '),
      'http://example.com/video.mp4',
    );
    assert.strictEqual(
      sanitizeMediaUrl('data:image/png;base64,AAAA'),
      'data:image/png;base64,AAAA',
    );
    assert.strictEqual(sanitizeMediaUrl('/assets/logo.png'), '/assets/logo.png');
    assert.strictEqual(sanitizeMediaUrl('assets/logo.png'), 'assets/logo.png');
    assert.strictEqual(sanitizeMediaUrl('./logo.png'), './logo.png');
    assert.strictEqual(sanitizeMediaUrl('../logo.png'), '../logo.png');
  });

  it('rejects non-strings, empty strings, and disallowed schemes', () => {
    assert.strictEqual(sanitizeMediaUrl(undefined), undefined);
    assert.strictEqual(sanitizeMediaUrl(null), undefined);
    assert.strictEqual(sanitizeMediaUrl(123), undefined);
    assert.strictEqual(sanitizeMediaUrl(''), undefined);
    assert.strictEqual(sanitizeMediaUrl('   '), undefined);
    assert.strictEqual(sanitizeMediaUrl('javascript:alert(1)'), undefined);
    assert.strictEqual(sanitizeMediaUrl('vbscript:msgbox(1)'), undefined);
    assert.strictEqual(sanitizeMediaUrl('file:///etc/passwd'), undefined);
    assert.strictEqual(sanitizeMediaUrl('blob:https://example.com/123'), undefined);
  });

  it('rejects protocol-relative and schemeful-relative bypass URLs', () => {
    assert.strictEqual(sanitizeMediaUrl('//evil.example.com/a.png'), undefined);
    assert.strictEqual(sanitizeMediaUrl('\\\\evil.example.com\\a.png'), undefined);
    assert.strictEqual(sanitizeMediaUrl('/\\evil.example.com/a.png'), undefined);
    assert.strictEqual(sanitizeMediaUrl('/\t/evil.example.com/a.png'), undefined);
    assert.strictEqual(sanitizeMediaUrl('/\n/evil.example.com/a.png'), undefined);
    assert.strictEqual(sanitizeMediaUrl('http:evil.example.com/a.png'), undefined);
    assert.strictEqual(sanitizeMediaUrl('https:evil.example.com/a.png'), undefined);
    assert.strictEqual(sanitizeMediaUrl('https\t:evil.example.com/a.png'), undefined);
  });
});
