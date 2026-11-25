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

/**
 * Bracket-balanced and code-fence-tolerant JSON parser for structured model outputs.
 */

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

export function balanceJson(
  text: string,
  mismatch: 'drop' | 'replace' = 'drop',
): string | undefined {
  const out: string[] = [];
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let changed = false;

  for (const char of text) {
    if (inString) {
      out.push(char);
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out.push(char);
    } else if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']');
      out.push(char);
    } else if (char === '}' || char === ']') {
      let last = out.length - 1;
      while (last >= 0 && /\s/.test(out[last]!)) last--;
      if (out[last] === ',') {
        out.splice(last, 1);
        changed = true;
      }
      const expected = stack[stack.length - 1];
      if (expected === undefined) {
        changed = true;
        continue;
      }
      if (expected !== char) {
        changed = true;
        if (mismatch === 'drop') continue;
      }
      stack.pop();
      out.push(expected);
    } else {
      out.push(char);
    }
  }
  if (inString) return undefined;
  if (stack.length > 0) {
    changed = true;
    out.push(...stack.reverse());
  }
  return changed ? out.join('') : undefined;
}

export function parseModelJson(raw: string): unknown {
  const text = stripCodeFences(raw);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    for (const strategy of ['drop', 'replace'] as const) {
      const balanced = balanceJson(text, strategy);
      if (balanced === undefined) continue;
      try {
        return JSON.parse(balanced) as unknown;
      } catch {
        // Try next repair strategy.
      }
    }
    throw error;
  }
}
