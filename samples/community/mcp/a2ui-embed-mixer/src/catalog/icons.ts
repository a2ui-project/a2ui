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

/** Pure inline SVG icons across everyday, financial, hardware, home, and work domains. */

import {svg, type SVGTemplateResult} from 'lit';

export function renderMixerIcon(kind: string): SVGTemplateResult {
  switch (kind) {
    case 'bowl':
      return svg`<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 9.5h14a7 7 0 0 1-14 0Z" />
        <path d="M6.5 16.5h7" />
        <path d="M7 6.5c0-1.2 1-1.8 1-3M11.5 6.5c0-1.2 1-1.8 1-3" />
      </svg>`;
    case 'skillet':
      return svg`<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="8.5" cy="10.5" r="5.5" />
        <circle cx="8.5" cy="10.5" r="2" />
        <path d="M13 7l4.5-3" />
      </svg>`;
    case 'grain':
      return svg`<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 17V4" />
        <path d="M10 7c-2.5 0-4-1.5-4-3.5 2.5 0 4 1.5 4 3.5ZM10 7c2.5 0 4-1.5 4-3.5-2.5 0-4 1.5-4 3.5Z" />
        <path d="M10 11.5c-2.5 0-4-1.5-4-3.5 2.5 0 4 1.5 4 3.5ZM10 11.5c2.5 0 4-1.5 4-3.5-2.5 0-4 1.5-4 3.5Z" />
      </svg>`;
    case 'greens':
      return svg`<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4.5 15.5c1-6.5 5.5-11 11.5-11.5-.5 6-5 10.5-11.5 11.5Z" />
        <path d="M4.5 15.5L11 9" />
      </svg>`;
    case 'card':
      return svg`<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
        <path d="M2.5 8.5h15M6 12.5h3" />
      </svg>`;
    case 'vault':
      return svg`<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="3.5" width="14" height="13" rx="2.2" />
        <circle cx="10" cy="10" r="3" />
        <path d="M10 7v1.2M10 11.8V13M7 10h1.2M11.8 10H13" />
      </svg>`;
    case 'shield':
      return svg`<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 2.5l6 2.3v4.7c0 4-2.6 6.8-6 8-3.4-1.2-6-4-6-8V4.8l6-2.3Z" />
        <path d="M7.5 10.2l1.8 1.8 3.4-3.5" />
      </svg>`;
    case 'run':
      return svg`<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12.5" cy="4.2" r="1.6" />
        <path d="M6.5 9.5l3-2 2.5 2 3-1.5M9.5 7.5l-1.5 4.5 3 2 1 3.5M8 12l-3.5 2.5" />
      </svg>`;
    case 'weights':
      return svg`<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2.5 10h15M5 6.5v7M15 6.5v7M3.2 8v4M16.8 8v4" />
      </svg>`;
    case 'sun':
      return svg`<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="10" cy="10" r="3.6" />
        <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" />
      </svg>`;
    case 'home':
      return svg`<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 9.5L10 3.5l7 6" />
        <path d="M5 8v8.5h10V8" />
        <path d="M8.5 16.5v-4.5h3v4.5" />
      </svg>`;
    case 'rocket':
      return svg`<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M11.5 13.5l-5-5C8.5 5 12.5 3.5 16.5 3.5c0 4-1.5 8-5 10Z" />
        <path d="M6.5 8.5L3.5 10l2 2M11.5 13.5L10 16.5l-2-2" />
        <circle cx="12.5" cy="7.5" r="1.2" />
      </svg>`;
    case 'heart':
      return svg`<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 16.5s-6.5-4.1-6.5-8.6A3.6 3.6 0 0 1 10 5.6a3.6 3.6 0 0 1 6.5 2.3c0 4.5-6.5 8.6-6.5 8.6Z" />
      </svg>`;
    case 'clock':
      return svg`<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="10" cy="10" r="7" />
        <path d="M10 6v4.2l2.8 1.8" />
      </svg>`;
    case 'sleep':
    default:
      return svg`<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14.8 12.8A6 6 0 0 1 7.2 5.2a6 6 0 1 0 7.6 7.6Z" />
      </svg>`;
  }
}
