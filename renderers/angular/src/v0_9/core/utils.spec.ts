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

import {getNormalizedPath} from './utils';

describe('getNormalizedPath', () => {
  it('should handle absolute paths', () => {
    expect(getNormalizedPath('/absolute', '/', 0)).toBe('/absolute/0');
    expect(getNormalizedPath('/absolute/', '/base', 5)).toBe('/absolute/5');
  });

  it('should resolve relative paths against dataContextPath', () => {
    expect(getNormalizedPath('relative', '/', 2)).toBe('/relative/2');
    expect(getNormalizedPath('relative', '/base', 3)).toBe('/base/relative/3');
  });

  it('should handle empty paths', () => {
    expect(getNormalizedPath('', '/', 1)).toBe('/1');
    expect(getNormalizedPath('', '/base', 4)).toBe('/base/4');
  });
});
