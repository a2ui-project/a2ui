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

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {fontSrc, loadFontFaces, whenFontsReady} from './fonts.js';

/** Records the faces the runtime creates; `load` settles as the test decides. */
class FakeFontFace {
  static created: FakeFontFace[] = [];
  static loadResult: () => Promise<unknown> = () => Promise.resolve();

  constructor(
    readonly family: string,
    readonly source: string,
    readonly descriptors: FontFaceDescriptors,
  ) {
    FakeFontFace.created.push(this);
  }

  load(): Promise<unknown> {
    return FakeFontFace.loadResult();
  }
}

function fakeFontSet(): FontFaceSet & {added: unknown[]} {
  const added: unknown[] = [];
  return {added, add: (face: unknown) => added.push(face)} as unknown as FontFaceSet & {
    added: unknown[];
  };
}

describe('loadFontFaces', () => {
  beforeEach(() => {
    FakeFontFace.created = [];
    FakeFontFace.loadResult = () => Promise.resolve();
    vi.stubGlobal('FontFace', FakeFontFace);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('adds each valid face once, with its descriptors, and skips invalid entries', async () => {
    const fonts = fakeFontSet();
    const faces = [
      {family: 'Plex Test', src: 'data:font/woff2;base64,AAAA', weight: 400},
      {family: 'Plex Test', src: 'url(x.woff2) format("woff2")', style: 'italic'},
      {family: '', src: 'data:x'},
      {family: 'No src'},
      'not a face',
    ];

    await loadFontFaces(faces, fonts);
    await loadFontFaces(faces, fonts);

    expect(fonts.added).toHaveLength(2);
    expect(FakeFontFace.created.map(face => [face.family, face.source, face.descriptors])).toEqual([
      ['Plex Test', 'url("data:font/woff2;base64,AAAA")', {weight: '400'}],
      ['Plex Test', 'url(x.woff2) format("woff2")', {style: 'italic'}],
    ]);
  });

  it('stops waiting after the timeout, and logs a face that fails', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    FakeFontFace.loadResult = () => new Promise(() => {});
    let settled = false;
    void loadFontFaces([{family: 'Slow Test', src: 'data:a'}], fakeFontSet(), 500).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);

    FakeFontFace.loadResult = () => Promise.reject(new Error('bad font'));
    await loadFontFaces([{family: 'Broken Test', src: 'data:b'}], fakeFontSet());
    await whenFontsReady();
    expect(warn).toHaveBeenCalledWith('Font "Broken Test" failed to load:', expect.any(Error));
  });

  it('does nothing without a font set or FontFace', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('FontFace', undefined);
    const fonts = fakeFontSet();

    await loadFontFaces([{family: 'None Test', src: 'data:c'}], fonts);

    expect(fonts.added).toEqual([]);
  });
});

describe('fontSrc', () => {
  it('keeps url() and local() values and wraps a bare URL', () => {
    expect(fontSrc('local("Plex")')).toBe('local("Plex")');
    expect(fontSrc('URL(a.woff2)')).toBe('URL(a.woff2)');
    expect(fontSrc('https://fonts.example/a.woff2')).toBe('url("https://fonts.example/a.woff2")');
  });
});
