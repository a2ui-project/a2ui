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
 * Small syntax highlighters for the explanation panels: Express, TSX and JSON. They split text
 * into classed tokens; they don't validate anything.
 */

export type TokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'component'
  | 'name'
  | 'path'
  | 'punct'
  | 'prose'
  | 'tag'
  | 'raw-block';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

interface Rule {
  readonly kind: TokenKind;
  readonly pattern: RegExp;
}

/** Splits `text` with sticky regexes tried in order; unmatched characters become `plain`. */
function tokenize(text: string, rules: readonly Rule[]): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let plain = '';
  outer: while (index < text.length) {
    for (const rule of rules) {
      rule.pattern.lastIndex = index;
      const match = rule.pattern.exec(text);
      if (match && match[0].length > 0) {
        if (plain) {
          tokens.push({kind: 'plain', text: plain});
          plain = '';
        }
        tokens.push({kind: rule.kind, text: match[0]});
        index += match[0].length;
        continue outer;
      }
    }
    plain += text[index];
    index++;
  }
  if (plain) {
    tokens.push({kind: 'plain', text: plain});
  }
  return tokens;
}

const EXPRESS_RULES: readonly Rule[] = [
  {kind: 'raw-block', pattern: /r"""[\s\S]*?(?:"""|$)/y},
  {kind: 'string', pattern: /"""[\s\S]*?(?:"""|$)/y},
  {kind: 'string', pattern: /"(?:[^"\\\n]|\\.)*"?/y},
  {kind: 'comment', pattern: /#[^\n]*/y},
  {kind: 'path', pattern: /\$\/[\w/.-]*/y},
  {kind: 'keyword', pattern: /\b(?:surface|true|false|null|Event)\b/y},
  {kind: 'component', pattern: /\b[A-Z]\w*(?=\s*\()/y},
  {kind: 'name', pattern: /^[a-z_]\w*(?=\s*=)/my},
  {kind: 'number', pattern: /-?\b\d+(?:\.\d+)?\b/y},
  {kind: 'punct', pattern: /[()[\]{},=:]/y},
];

/**
 * Highlights an Express response. Text outside `<a2ui>` blocks is `prose`; raw triple-quoted
 * strings become one `raw-block` token so the view can fold them.
 */
export function highlightExpress(text: string): Token[] {
  const tokens: Token[] = [];
  const blocks = /(<a2ui>)([\s\S]*?)(<\/a2ui>|$)/g;
  let last = 0;
  for (const match of text.matchAll(blocks)) {
    const start = match.index ?? 0;
    if (start > last) {
      tokens.push({kind: 'prose', text: text.slice(last, start)});
    }
    tokens.push({kind: 'tag', text: match[1] ?? ''});
    tokens.push(...tokenize(match[2] ?? '', EXPRESS_RULES));
    if (match[3]) {
      tokens.push({kind: 'tag', text: match[3]});
    }
    last = start + match[0].length;
  }
  if (last < text.length) {
    tokens.push({kind: 'prose', text: text.slice(last)});
  }
  return tokens;
}

const TSX_RULES: readonly Rule[] = [
  {kind: 'comment', pattern: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y},
  {kind: 'string', pattern: /`(?:[^`\\]|\\.)*`?|'(?:[^'\\\n]|\\.)*'?|"(?:[^"\\\n]|\\.)*"?/y},
  {
    kind: 'keyword',
    pattern:
      /\b(?:import|from|export|default|function|const|let|var|return|if|else|for|of|in|while|type|interface|new|async|await|true|false|null|undefined|typeof|as)\b/y,
  },
  {kind: 'tag', pattern: /<\/?[A-Za-z][\w.]*|\/?>/y},
  {kind: 'component', pattern: /\b[A-Z]\w*/y},
  {kind: 'number', pattern: /\b\d+(?:\.\d+)?\b/y},
  {kind: 'punct', pattern: /[()[\]{};,=:?]/y},
];

/** Highlights TSX source. */
export function highlightTsx(text: string): Token[] {
  return tokenize(text, TSX_RULES);
}

const JSON_RULES: readonly Rule[] = [
  {kind: 'name', pattern: /"(?:[^"\\]|\\.)*"(?=\s*:)/y},
  {kind: 'string', pattern: /"(?:[^"\\]|\\.)*"/y},
  {kind: 'number', pattern: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y},
  {kind: 'keyword', pattern: /\b(?:true|false|null)\b/y},
  {kind: 'punct', pattern: /[{}[\],:]/y},
];

/** Highlights JSON text. */
export function highlightJson(text: string): Token[] {
  return tokenize(text, JSON_RULES);
}
