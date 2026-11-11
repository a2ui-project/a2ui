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

/** Line-drawn glyphs for the use-case cards: a balance curve, a route, a brushed scatter. */
export function UseCaseGlyph({id}: {id: 'loan' | 'trip' | 'sales'}) {
  return (
    <svg className="glyph" viewBox="0 0 40 28" aria-hidden="true">
      {id === 'loan' && (
        <>
          <path d="M3 25 H37" className="glyph-rule" />
          {[6, 11, 16, 21, 26, 31].map((x, i) => (
            <rect key={x} x={x - 1.5} y={5 + i * 3} width="3" height={20 - i * 3} rx="0.5" />
          ))}
        </>
      )}
      {id === 'trip' && (
        <>
          <path d="M6 22 C 12 4, 22 26, 34 7" className="glyph-line" />
          <circle cx="6" cy="22" r="2.4" />
          <circle cx="17" cy="15" r="2.4" />
          <circle cx="34" cy="7" r="2.4" />
        </>
      )}
      {id === 'sales' && (
        <>
          <rect x="13" y="4" width="13" height="20" className="glyph-brush" />
          {[
            [5, 18],
            [9, 12],
            [16, 9],
            [19, 16],
            [23, 7],
            [30, 14],
            [35, 10],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" />
          ))}
        </>
      )}
    </svg>
  );
}

/** A chevron that points right when closed and down when open. */
export function Chevron({open}: {open: boolean}) {
  return (
    <svg className={`chevron${open ? ' is-open' : ''}`} viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3 1.5 L7 5 L3 8.5" />
    </svg>
  );
}

/** A small arrow for the send button. */
export function SendArrow() {
  return (
    <svg className="send-arrow" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 8 H13 M8.5 3.5 L13 8 L8.5 12.5" />
    </svg>
  );
}
