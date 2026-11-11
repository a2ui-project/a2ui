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

import {describe, expect, it} from 'vitest';

import {
  AVAILABLE_MODULES,
  cspViolationMessage,
  decodeReactError,
  unavailableModuleMessage,
  unresolvedImport,
} from './error_messages.js';

/** The message React 19's production build throws. */
function minified(code: number, args: string[] = []): string {
  const query = args.map(arg => `args[]=${encodeURIComponent(arg)}`).join('&');
  const url = `https://react.dev/errors/${code}${query ? `?${query}` : ''}`;
  return (
    `Minified React error #${code}; visit ${url} for the full message or use the non-minified ` +
    'dev environment for full errors and additional helpful warnings.'
  );
}

describe('decodeReactError', () => {
  it('turns #321 into the hooks rule and how to follow it', () => {
    expect(decodeReactError(minified(321))).toBe(
      'React error #321: Hooks can only be called inside the body of a function component. ' +
        'Call useData, useFunction, useState, useTheme and the other hooks at the top level of a ' +
        'component, never inside useEffect, event handlers, callbacks, loops or conditions.',
    );
  });

  it.each([
    [300, 'Rendered fewer hooks than expected'],
    [310, 'Rendered more hooks than during the previous render'],
    [301, 'Too many re-renders: the component sets state while it renders.'],
    [185, 'Maximum update depth exceeded'],
    [482, 'A component is an async function.'],
  ])('decodes #%i', (code, start) => {
    expect(decodeReactError(minified(code))).toMatch(new RegExp(`^React error #${code}: ${start}`));
  });

  it('fills in the arguments of #31, #130 and #152', () => {
    expect(decodeReactError(minified(31, ['object with keys {name, price}']))).toBe(
      'React error #31: Objects are not valid as a React child (found: object with keys ' +
        '{name, price}). Render a string or number field of the object, or map an array to ' +
        'elements.',
    );
    expect(decodeReactError(minified(130, ['undefined', '']))).toMatch(
      /^React error #130: Element type is invalid: expected a component but got undefined\. /,
    );
    expect(decodeReactError(minified(152, ['App']))).toBe(
      'React error #152: App returned nothing from render. Return JSX, or null to render nothing.',
    );
    expect(decodeReactError(minified(152))).toMatch(/^React error #152: an unknown value returned/);
  });

  it('keeps the text around the error, and leaves other messages alone', () => {
    expect(decodeReactError(`VegaChart failed: ${minified(301)}`)).toMatch(
      /^VegaChart failed: React error #301: Too many re-renders/,
    );
    expect(decodeReactError(minified(9999))).toBe(minified(9999));
    expect(decodeReactError('x is not a function')).toBe('x is not a function');
  });
});

describe('unresolvedImport', () => {
  it('reads the specifier from the Chromium, Firefox and WebKit messages', () => {
    expect(
      unresolvedImport(
        new TypeError(
          'Failed to resolve module specifier "lodash". Relative references must start with ' +
            'either "/", "./", or "../".',
        ),
      ),
    ).toBe('lodash');
    expect(
      unresolvedImport(
        new TypeError(
          'The specifier “date-fns” was a bare specifier, but was not remapped to anything.',
        ),
      ),
    ).toBe('date-fns');
    expect(
      unresolvedImport(new TypeError("Module name, 'd3' does not resolve to a valid URL.")),
    ).toBe('d3');
  });

  it('returns undefined for other errors', () => {
    expect(unresolvedImport(new SyntaxError('Unexpected token'))).toBeUndefined();
    expect(unresolvedImport('boom')).toBeUndefined();
  });

  it('names the module and every available one', () => {
    const message = unavailableModuleMessage('lodash');

    expect(message).toContain('"lodash"');
    for (const name of AVAILABLE_MODULES) {
      expect(message).toContain(name);
    }
  });
});

describe('cspViolationMessage', () => {
  it('names what was blocked and points network access to agent functions', () => {
    expect(cspViolationMessage('connect-src', 'https://api.coingecko.com/x')).toBe(
      'The content security policy blocked https://api.coingecko.com/x (connect-src). Apps ' +
        'have no network access: get data from agent functions with callFunction or ' +
        'useFunction instead of fetch, XMLHttpRequest, WebSocket or EventSource.',
    );
    expect(cspViolationMessage('script-src-elem', 'https://cdn.example/chart.js')).toMatch(
      /blocked https:\/\/cdn\.example\/chart\.js \(script-src-elem\)\. Apps can load only/,
    );
  });
});
