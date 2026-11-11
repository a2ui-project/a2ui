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

/**
 * Loads the font faces the host sends in the theme. The frame has no access to the page's
 * `@font-face` rules, so without them a theme font family falls back to a system font.
 */

/** A font face of the host theme (bridge protocol section 3.1). */
export interface ThemeFontFace {
  /** Family name, as the `--a2ui-font-family*` variables use it. */
  readonly family: string;
  /** A CSS `src` value, for example `url(data:font/woff2;base64,…) format("woff2")`, or a URL. */
  readonly src: string;
  /** CSS `font-weight` descriptor, for example `400` or `100 900`. */
  readonly weight?: string;
  /** CSS `font-style` descriptor, for example `italic`. */
  readonly style?: string;
}

/** Longest time the first render and charts wait for fonts before using the fallback. */
export const FONT_LOAD_TIMEOUT_MS = 2000;

const loaded = new Set<string>();
let ready: Promise<void> = Promise.resolve();

function toFontFace(value: unknown): ThemeFontFace | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const {family, src, weight, style} = value as Record<string, unknown>;
  if (typeof family !== 'string' || family === '' || typeof src !== 'string' || src === '') {
    return null;
  }
  return {
    family,
    src,
    ...(typeof weight === 'string' || typeof weight === 'number' ? {weight: String(weight)} : {}),
    ...(typeof style === 'string' ? {style} : {}),
  };
}

/** A `src` descriptor: kept when it is already `url(…)` or `local(…)`, else wrapped in `url()`. */
export function fontSrc(src: string): string {
  return /^\s*(?:url|local)\(/i.test(src) ? src : `url(${JSON.stringify(src)})`;
}

function withTimeout(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeoutMs);
    void promise.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Adds the font faces of a theme to `fonts` and starts loading them. Faces added before are
 * skipped. Resolves when they have loaded or failed, or after `timeoutMs`; a face that fails is
 * logged and the fallback font is used.
 */
export function loadFontFaces(
  faces: unknown,
  fonts: FontFaceSet | undefined = globalThis.document?.fonts,
  timeoutMs: number = FONT_LOAD_TIMEOUT_MS,
): Promise<void> {
  if (!Array.isArray(faces) || !fonts || typeof FontFace === 'undefined') {
    return ready;
  }
  const loads: Array<Promise<unknown>> = [];
  for (const face of faces.map(toFontFace)) {
    if (!face) {
      continue;
    }
    const key = JSON.stringify([face.family, face.src, face.weight, face.style]);
    if (loaded.has(key)) {
      continue;
    }
    loaded.add(key);
    const warn = (error: unknown) => console.warn(`Font "${face.family}" failed to load:`, error);
    try {
      const fontFace = new FontFace(face.family, fontSrc(face.src), {
        ...(face.weight !== undefined ? {weight: face.weight} : {}),
        ...(face.style !== undefined ? {style: face.style} : {}),
      });
      fonts.add(fontFace);
      loads.push(fontFace.load().catch(warn));
    } catch (error) {
      warn(error);
    }
  }
  if (loads.length > 0) {
    const previous = ready;
    const current = withTimeout(Promise.all(loads), timeoutMs);
    ready = Promise.all([previous, current]).then(() => undefined);
  }
  return ready;
}

/** Resolves when the theme fonts requested so far have loaded, failed or timed out. */
export function whenFontsReady(): Promise<void> {
  return ready;
}
