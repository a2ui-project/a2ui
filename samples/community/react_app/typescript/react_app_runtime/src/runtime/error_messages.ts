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
 * Error messages for the model that wrote the app. The error card and `ui/error` show them, and
 * the agent may send them back to the model, so each says what went wrong and what to change.
 */

/** Modules the import map of an app frame provides (bridge protocol section 9). */
export const AVAILABLE_MODULES: readonly string[] = [
  'a2ui',
  'a2ui:bindings',
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
];

/**
 * The production React build throws `Minified React error #N` with a link instead of the message.
 * These are the errors model-written apps run into, rewritten to name the fix. `%s` takes the
 * error's arguments in order.
 */
const REACT_ERRORS: Readonly<Record<string, string>> = {
  '31':
    'Objects are not valid as a React child (found: %s). Render a string or number field of the ' +
    'object, or map an array to elements.',
  '130':
    'Element type is invalid: expected a component but got %s. A name that "a2ui" or "react" ' +
    "doesn't export is undefined: use only the components a2ui.d.ts declares, and define every " +
    'local component before using it.',
  '152': '%s returned nothing from render. Return JSX, or null to render nothing.',
  '185':
    'Maximum update depth exceeded: a state update causes a render that updates the state again. ' +
    'Usually a useEffect sets state (or calls a useData setter) whose value is in its own ' +
    'dependency list or changes on every render. Set the value only when it differs, or move the ' +
    'update into an event handler.',
  '300':
    'Rendered fewer hooks than expected, usually because of an early return before a hook. Call ' +
    'every hook at the top of the component, before any return, in the same order on every render.',
  '301':
    'Too many re-renders: the component sets state while it renders. Call state setters (including ' +
    'useData setters) in event handlers or useEffect, never in the component body.',
  '310':
    'Rendered more hooks than during the previous render, usually because a hook is called after ' +
    'an early return or inside a condition. Call every hook at the top of the component, before ' +
    'any return, in the same order on every render.',
  '321':
    'Hooks can only be called inside the body of a function component. Call useData, ' +
    'useFunction, useState, useTheme and the other hooks at the top level of a component, never ' +
    'inside useEffect, event handlers, callbacks, loops or conditions.',
  '482':
    'A component is an async function. Components must render synchronously: get data with ' +
    'useFunction, or with callFunction inside useEffect, and keep it in state.',
};

/** `Minified React error #N; visit <url> for the full message or use … warnings.` */
const MINIFIED_REACT_ERROR =
  /Minified React error #(\d+); visit (\S+)(?: for the full message[^.]*\.)?/;

function reactErrorArgs(url: string): string[] {
  try {
    return new URL(url).searchParams.getAll('args[]');
  } catch {
    return [];
  }
}

/**
 * Replaces a minified React error in `message` with a readable one, for example
 * `React error #321: Hooks can only be called inside the body of a function component. …`.
 * Other messages, and React errors this module doesn't know, are returned unchanged.
 */
export function decodeReactError(message: string): string {
  const match = MINIFIED_REACT_ERROR.exec(message);
  const template = match ? REACT_ERRORS[match[1]] : undefined;
  if (!match || template === undefined) {
    return message;
  }
  const args = reactErrorArgs(match[2]);
  let next = 0;
  const text = template.replace(/%s/g, () => args[next++] ?? 'an unknown value');
  return message.replace(match[0], `React error #${match[1]}: ${text}`);
}

/** How Chromium, Firefox and WebKit word an import that doesn't resolve. */
const UNRESOLVED_IMPORT = [
  /Failed to resolve module specifier ["']([^"']+)["']/,
  /The specifier [“"]([^”"]+)[”"] was a bare specifier/,
  /Module name, '([^']+)' does not resolve to a valid URL/,
];

/** The module specifier an import failed to resolve, or `undefined` for other errors. */
export function unresolvedImport(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  for (const pattern of UNRESOLVED_IMPORT) {
    const specifier = pattern.exec(message)?.[1];
    if (specifier !== undefined) {
      return specifier;
    }
  }
  return undefined;
}

/** The error card message for an import of a module the frame doesn't provide. */
export function unavailableModuleMessage(specifier: string): string {
  return (
    `The app imports "${specifier}", which is not available. Apps can import only: ` +
    `${AVAILABLE_MODULES.join(', ')}. Remove the import and write the code with React and a2ui.`
  );
}

const CSP_HINTS: Readonly<Record<string, string>> = {
  'connect-src':
    'Apps have no network access: get data from agent functions with callFunction or ' +
    'useFunction instead of fetch, XMLHttpRequest, WebSocket or EventSource.',
  'img-src': 'Apps can show only data: and blob: images: draw with SVG or CSS instead.',
  'media-src': 'Apps can play only data: and blob: media.',
  'frame-src': 'Apps cannot embed frames.',
};

/** The `ui/error` message for a content security policy violation. */
export function cspViolationMessage(directive: string, blockedUri: string): string {
  const hint =
    CSP_HINTS[directive] ??
    "Apps can load only the runtime's own modules, styles and fonts, and nothing from other sites.";
  return `The content security policy blocked ${blockedUri} (${directive}). ${hint}`;
}
