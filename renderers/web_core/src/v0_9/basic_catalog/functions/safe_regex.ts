/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Options for regular expression safety validation.
 */
export interface SafeRegexOptions {
  /** Maximum allowable length of the regex pattern string (default: 256). */
  maxPatternLength?: number;
}

/**
 * AST Node representations for regular expression static analysis.
 */
type RegexNode =
  | RootNode
  | SequenceNode
  | GroupNode
  | CharacterClassNode
  | EscapeNode
  | LiteralNode
  | AnchorNode;

interface QuantifierInfo {
  raw: string;
  min: number;
  max: number;
  lazy: boolean;
}

interface RootNode {
  type: 'Root';
  branches: SequenceNode[];
}

interface SequenceNode {
  type: 'Sequence';
  elements: RegexNode[];
}

interface GroupNode {
  type: 'Group';
  groupType: 'capture' | 'non-capture' | 'lookahead' | 'lookbehind' | 'named-capture';
  branches: SequenceNode[];
  quantifier: QuantifierInfo | null;
}

interface CharacterClassNode {
  type: 'CharacterClass';
  negated: boolean;
  content: string;
  quantifier: QuantifierInfo | null;
}

interface EscapeNode {
  type: 'Escape';
  value: string;
  quantifier: QuantifierInfo | null;
}

interface LiteralNode {
  type: 'Literal';
  value: string;
  quantifier: QuantifierInfo | null;
}

interface AnchorNode {
  type: 'Anchor';
  value: string;
}

/**
 * Tests whether a character matches a parsed character class.
 */
function matchesCharacterClass(classContent: string, negated: boolean, char: string): boolean {
  if (!char || char.length !== 1) return true;
  let matches = false;
  let i = 0;
  while (i < classContent.length) {
    if (classContent[i] === '\\' && i + 1 < classContent.length) {
      const esc = classContent[i + 1];
      if (esc === 'd' && /^[0-9]$/.test(char)) {
        matches = true;
        break;
      }
      if (esc === 'w' && /^[a-zA-Z0-9_]$/.test(char)) {
        matches = true;
        break;
      }
      if (esc === 's' && /^\s$/.test(char)) {
        matches = true;
        break;
      }
      if (char === esc) {
        matches = true;
        break;
      }
      i += 2;
    } else if (i + 2 < classContent.length && classContent[i + 1] === '-') {
      const start = classContent.charCodeAt(i);
      const end = classContent.charCodeAt(i + 2);
      const code = char.charCodeAt(0);
      if (code >= start && code <= end) {
        matches = true;
        break;
      }
      i += 3;
    } else {
      if (classContent[i] === char) {
        matches = true;
        break;
      }
      i++;
    }
  }
  return negated ? !matches : matches;
}

/**
 * Parses a regular expression pattern string into a structured AST.
 */
function parseRegexAst(pattern: string): RootNode {
  let i = 0;

  function parseSequence(): SequenceNode {
    const elements: RegexNode[] = [];
    while (i < pattern.length) {
      const char = pattern[i];
      if (char === '|' || char === ')') {
        break;
      }

      if (char === '(') {
        i++; // skip '('
        let groupType: GroupNode['groupType'] = 'capture';
        if (pattern[i] === '?') {
          i++;
          if (pattern[i] === ':') {
            groupType = 'non-capture';
            i++;
          } else if (pattern[i] === '=' || pattern[i] === '!') {
            groupType = 'lookahead';
            i++;
          } else if (pattern[i] === '<') {
            i++;
            if (pattern[i] === '=' || pattern[i] === '!') {
              groupType = 'lookbehind';
              i++;
            } else {
              while (i < pattern.length && pattern[i] !== '>') i++;
              if (i < pattern.length) i++;
              groupType = 'named-capture';
            }
          }
        }

        const branches: SequenceNode[] = [];
        branches.push(parseSequence());
        while (i < pattern.length && pattern[i] === '|') {
          i++;
          branches.push(parseSequence());
        }

        if (i < pattern.length && pattern[i] === ')') {
          i++;
        }

        const groupNode: GroupNode = {
          type: 'Group',
          groupType,
          branches,
          quantifier: null,
        };
        parseQuantifier(groupNode);
        elements.push(groupNode);
      } else if (char === '[') {
        i++; // skip '['
        let negated = false;
        if (pattern[i] === '^') {
          negated = true;
          i++;
        }
        let classContent = '';
        while (i < pattern.length) {
          if (pattern[i] === '\\' && i + 1 < pattern.length) {
            classContent += pattern[i] + pattern[i + 1];
            i += 2;
          } else if (pattern[i] === ']') {
            i++;
            break;
          } else {
            classContent += pattern[i];
            i++;
          }
        }
        const classNode: CharacterClassNode = {
          type: 'CharacterClass',
          negated,
          content: classContent,
          quantifier: null,
        };
        parseQuantifier(classNode);
        elements.push(classNode);
      } else if (char === '\\') {
        i++;
        const esc = pattern[i] || '';
        i++;
        if (['d', 'w', 's', 'D', 'W', 'S'].includes(esc)) {
          const escNode: EscapeNode = {
            type: 'Escape',
            value: esc,
            quantifier: null,
          };
          parseQuantifier(escNode);
          elements.push(escNode);
        } else {
          const litNode: LiteralNode = {
            type: 'Literal',
            value: esc,
            quantifier: null,
          };
          parseQuantifier(litNode);
          elements.push(litNode);
        }
      } else if (char === '^' || char === '$') {
        i++;
        elements.push({type: 'Anchor', value: char});
      } else if (char === '.') {
        i++;
        const dotNode: EscapeNode = {
          type: 'Escape',
          value: '.',
          quantifier: null,
        };
        parseQuantifier(dotNode);
        elements.push(dotNode);
      } else {
        const lit = pattern[i];
        i++;
        const litNode: LiteralNode = {
          type: 'Literal',
          value: lit,
          quantifier: null,
        };
        parseQuantifier(litNode);
        elements.push(litNode);
      }
    }
    return {type: 'Sequence', elements};
  }

  function parseQuantifier(node: GroupNode | CharacterClassNode | EscapeNode | LiteralNode): void {
    if (i >= pattern.length) return;
    const char = pattern[i];
    let quant: QuantifierInfo | null = null;

    if (char === '*' || char === '+' || char === '?') {
      i++;
      quant = {
        raw: char,
        min: char === '+' ? 1 : 0,
        max: char === '?' ? 1 : Infinity,
        lazy: false,
      };
    } else if (char === '{') {
      const start = i;
      i++;
      let numStr = '';
      while (i < pattern.length && pattern[i] !== '}' && pattern[i] !== ',') {
        numStr += pattern[i];
        i++;
      }
      const min = parseInt(numStr, 10);
      let max = min;
      if (i < pattern.length && pattern[i] === ',') {
        i++;
        let maxStr = '';
        while (i < pattern.length && pattern[i] !== '}') {
          maxStr += pattern[i];
          i++;
        }
        max = maxStr === '' ? Infinity : parseInt(maxStr, 10);
      }
      if (i < pattern.length && pattern[i] === '}') {
        i++;
        if (!isNaN(min) && !isNaN(max)) {
          quant = {
            raw: pattern.slice(start, i),
            min,
            max,
            lazy: false,
          };
        } else {
          i = start;
        }
      } else {
        i = start;
      }
    }

    if (quant) {
      if (i < pattern.length && pattern[i] === '?') {
        quant.lazy = true;
        i++;
      }
      node.quantifier = quant;
    }
  }

  const branches: SequenceNode[] = [parseSequence()];
  while (i < pattern.length && pattern[i] === '|') {
    i++;
    branches.push(parseSequence());
  }
  return {type: 'Root', branches};
}

/**
 * Checks if a group contains any descendant element that has a repetition quantifier.
 */
function hasDescendantQuantifier(groupNode: GroupNode): boolean {
  for (const branch of groupNode.branches) {
    for (const el of branch.elements) {
      if (
        'quantifier' in el &&
        el.quantifier &&
        (el.quantifier.max > 1 || el.quantifier.min !== el.quantifier.max)
      ) {
        return true;
      }
      if (el.type === 'Group' && hasDescendantQuantifier(el)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks if a quantified group has an invariant, disjoint separator that prevents exponential ambiguity.
 */
function hasDisjointSeparator(groupNode: GroupNode): boolean {
  for (const branch of groupNode.branches) {
    if (branch.elements.length < 2) return false;
    const first = branch.elements[0];
    const last = branch.elements[branch.elements.length - 1];

    const firstIsSep =
      (first.type === 'Literal' ||
        (first.type === 'Escape' && !['d', 'w', 's', '.'].includes(first.value))) &&
      !('quantifier' in first && first.quantifier);
    const lastIsSep =
      (last.type === 'Literal' ||
        (last.type === 'Escape' && !['d', 'w', 's', '.'].includes(last.value))) &&
      !('quantifier' in last && last.quantifier);

    if (!firstIsSep && !lastIsSep) return false;

    const sep = firstIsSep
      ? first.type === 'Literal'
        ? first.value
        : (first as EscapeNode).value
      : last.type === 'Literal'
        ? last.value
        : (last as EscapeNode).value;

    const sepEl = firstIsSep ? first : last;
    for (const el of branch.elements) {
      if (el !== sepEl && 'quantifier' in el && el.quantifier) {
        if (nodeMatchesChar(el, sep)) {
          return false;
        }
      }
    }
  }
  return true;
}

function nodeMatchesChar(node: RegexNode, char: string): boolean {
  if (node.type === 'Literal') return node.value === char;
  if (node.type === 'CharacterClass') {
    return matchesCharacterClass(node.content, node.negated, char);
  }
  if (node.type === 'Escape') {
    if (node.value === '.') return true;
    if (node.value === 'd' && /^[0-9]$/.test(char)) return true;
    if (node.value === 'w' && /^[a-zA-Z0-9_]$/.test(char)) return true;
    if (node.value === 's' && /^\s$/.test(char)) return true;
    return node.value === char;
  }
  return true;
}

function getFirstCharSummary(branch: SequenceNode): {
  any?: boolean;
  literal?: string;
  escape?: string;
  class?: string;
  negated?: boolean;
} {
  if (!branch.elements || branch.elements.length === 0) return {any: true};
  const first = branch.elements[0];
  if (first.type === 'Literal') return {literal: first.value};
  if (first.type === 'Escape') return {escape: first.value};
  if (first.type === 'CharacterClass') return {class: first.content, negated: first.negated};
  if (first.type === 'Group' && first.branches.length > 0) {
    return getFirstCharSummary(first.branches[0]);
  }
  return {any: true};
}

function branchesOverlap(b1: SequenceNode, b2: SequenceNode): boolean {
  const s1 = getFirstCharSummary(b1);
  const s2 = getFirstCharSummary(b2);

  if (s1.any || s2.any) return true;
  if (s1.escape === '.' || s2.escape === '.') return true;
  if (s1.literal && s2.literal) {
    return s1.literal === s2.literal;
  }
  if (s1.literal && s2.escape) {
    return nodeMatchesChar({type: 'Escape', value: s2.escape, quantifier: null}, s1.literal);
  }
  if (s2.literal && s1.escape) {
    return nodeMatchesChar({type: 'Escape', value: s1.escape, quantifier: null}, s2.literal);
  }
  if (s1.escape && s2.escape) {
    if (s1.escape === s2.escape) return true;
    if ((s1.escape === 'w' && s2.escape === 'd') || (s1.escape === 'd' && s2.escape === 'w')) {
      return true;
    }
    return false;
  }
  if (s1.literal && s2.class) {
    return matchesCharacterClass(s2.class, s2.negated ?? false, s1.literal);
  }
  if (s2.literal && s1.class) {
    return matchesCharacterClass(s1.class, s1.negated ?? false, s2.literal);
  }
  if (s1.class || s2.class) {
    return true;
  }
  return false;
}

function nodesOverlap(n1: RegexNode, n2: RegexNode): boolean {
  if (n1.type === 'Literal' && n2.type === 'Literal') return n1.value === n2.value;
  return true;
}

function isNodeSafe(node: RegexNode, insideQuantifier: boolean): boolean {
  if (!node) return true;

  if (node.type === 'Root') {
    for (const b of node.branches) {
      if (!isNodeSafe(b, false)) return false;
    }
    return true;
  }

  if (node.type === 'Sequence') {
    for (let idx = 0; idx < node.elements.length; idx++) {
      const el = node.elements[idx];
      if (!isNodeSafe(el, insideQuantifier)) return false;

      // Check adjacent overlapping quantifiers inside a quantified group (e.g. (a+a+)+)
      if (insideQuantifier && idx + 1 < node.elements.length) {
        const next = node.elements[idx + 1];
        if (
          'quantifier' in el &&
          el.quantifier &&
          el.quantifier.max > 1 &&
          'quantifier' in next &&
          next.quantifier &&
          next.quantifier.max > 1
        ) {
          if (nodesOverlap(el, next)) {
            return false;
          }
        }
      }
    }
    return true;
  }

  if (node.type === 'Group') {
    const isQuantified = node.quantifier && node.quantifier.max > 1;
    const isDisjoint = isQuantified && hasDisjointSeparator(node);

    // 1. Nested quantified group inside another quantifier
    if (isQuantified && insideQuantifier) {
      return false;
    }

    // 2. Quantified group containing descendant quantifiers without disjoint boundary
    if (isQuantified) {
      if (hasDescendantQuantifier(node)) {
        if (!isDisjoint) {
          return false;
        }
      }

      // 3. Overlapping alternations in a quantified group (e.g. (a|aa)+)
      if (node.branches.length > 1) {
        for (let i = 0; i < node.branches.length; i++) {
          for (let j = i + 1; j < node.branches.length; j++) {
            if (branchesOverlap(node.branches[i], node.branches[j])) {
              return false;
            }
          }
        }
      }
    }

    const nextInsideQuant = isDisjoint ? false : insideQuantifier || !!isQuantified;
    for (const branch of node.branches) {
      if (!isNodeSafe(branch, nextInsideQuant)) {
        return false;
      }
    }
    return true;
  }

  if ('quantifier' in node && node.quantifier && node.quantifier.max > 1) {
    if (insideQuantifier) {
      return false;
    }
    if (
      node.quantifier.min > 1000 ||
      (node.quantifier.max !== Infinity && node.quantifier.max > 1000)
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Validates whether a regular expression pattern is safe from catastrophic backtracking (ReDoS).
 *
 * Checks for:
 * 1. Valid RegExp compilation syntax
 * 2. Pattern length bounded to maxPatternLength
 * 3. Absence of nested quantifiers (Star Height > 1)
 * 4. Absence of overlapping alternations in quantified groups (e.g. `(a|aa)+$`, `(a|a+)+$`)
 * 5. Absence of adjacent overlapping quantifiers inside repeated sequences (e.g. `(x+x+)+y`)
 *
 * @param pattern The regular expression string to inspect.
 * @param options Configuration options including maximum pattern length.
 * @returns `true` if the regex pattern is safe to execute on the client main thread; `false` otherwise.
 */
export function isSafeRegex(pattern: string, options?: SafeRegexOptions): boolean {
  const maxLen = options?.maxPatternLength ?? 256;
  if (!pattern || typeof pattern !== 'string') return true;
  if (pattern.length > maxLen) return false;

  // 1. Must be valid regex syntax
  try {
    new RegExp(pattern);
  } catch {
    return false;
  }

  // 2. Parse AST and perform structural safety validation
  try {
    const ast = parseRegexAst(pattern);
    return isNodeSafe(ast, false);
  } catch {
    // Fail closed if parsing fails on unexpected exotic construct
    return false;
  }
}
