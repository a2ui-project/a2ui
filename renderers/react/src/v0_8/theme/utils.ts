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

/**
 * Converts a theme class map (Record<string, boolean>) to a className string.
 *
 * @param classMap - An object where keys are class names and values are booleans
 * @returns A space-separated string of class names where the value is true
 *
 * @example
 * classMapToString({ 'a2ui-button': true, 'a2ui-button--primary': true, 'disabled': false })
 * // Returns: 'a2ui-button a2ui-button--primary'
 */
export function classMapToString(classMap: Record<string, boolean> | undefined): string {
  if (!classMap) return '';
  return Object.entries(classMap)
    .filter(([, enabled]) => enabled)
    .map(([className]) => className)
    .join(' ');
}

/**
 * Converts an additional styles object (Record<string, string>) to a React style object.
 *
 * @param styles - An object with CSS property names as keys and values as strings
 * @returns A React-compatible style object, or undefined if no styles
 *
 * @example
 * stylesToObject({ 'background-color': 'red', 'font-size': '16px', '--custom-var': 'blue' })
 * // Returns: { backgroundColor: 'red', fontSize: '16px', '--custom-var': 'blue' }
 */
export function stylesToObject(
  styles: Record<string, string> | undefined,
): React.CSSProperties | undefined {
  if (!styles || Object.keys(styles).length === 0) return undefined;

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(styles)) {
    // Preserve CSS custom properties (--var-name) as-is
    if (key.startsWith('--')) {
      result[key] = value;
    } else {
      // Convert kebab-case to camelCase for React
      const camelKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      result[camelKey] = value;
    }
  }
  return result as React.CSSProperties;
}
