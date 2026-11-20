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
 * Reads the hub's scenario files and turns their expectations into checks on a real page.
 *
 * A scenario's `expectViewTree` becomes locator checks (`expectOutcome`), its `uiOps` become
 * real typing and clicks (`runUiOps`), and its `expectOutbound` becomes a structural match with
 * `$match` wildcards (`matchOutbound`). The pure parts, `locatorPlan` and `matchOutbound`, have
 * unit tests in `tests/unit/hub.test.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';

import {expect, type Locator, type Page} from '@playwright/test';
import yaml from 'js-yaml';

import {repoRoot, type Version} from './fixtures.js';

export interface ViewNode {
  readonly id: string;
  readonly type: string;
  readonly text?: string;
  readonly label?: string;
  readonly value?: unknown;
  readonly children?: readonly ViewNode[];
}

/** A surface's rendered tree, or `null` for a surface that must not exist. */
export type ViewTrees = Readonly<Record<string, ViewNode | null>>;

export interface UiOp {
  readonly op: 'user_input' | 'user_gesture';
  readonly surfaceId: string;
  readonly targetNode: string;
  readonly inputValue?: string;
}

export type WirePart = {text: string} | {a2ui: Record<string, unknown>[]};

export interface ScenarioTurn {
  readonly userText: string | null;
  readonly expectWire: readonly WirePart[];
  readonly expectViewTree?: ViewTrees;
  readonly uiOps?: readonly UiOp[];
  readonly expectOutbound?: readonly Record<string, unknown>[];
  readonly expectDataModel?: Readonly<Record<string, unknown>>;
  readonly expectErrors?: readonly unknown[];
}

export interface Scenario {
  readonly name: string;
  readonly file: string;
  readonly protocolVersion: string;
  readonly formats: readonly string[];
  readonly turns: readonly ScenarioTurn[];
}

/** Where the scenarios of each version live, relative to the repository root. */
const SCENARIO_DIRS: Readonly<Record<Version, string>> = {
  '1.0': 'conformance/e2e',
  '0.9.1': 'conformance/e2e/v0_9_1',
};

/** The live-only scenarios next to the specs, which the hub runners do not read. */
export const LOCAL_SCENARIO_DIR = path.join(repoRoot, 'e2e', 'web', 'scenarios');

function readScenario(file: string): Scenario {
  const loaded = yaml.load(fs.readFileSync(file, 'utf8'));
  const documents = (Array.isArray(loaded) ? loaded : [loaded]) as Record<string, unknown>[];
  const raw = documents.find(doc => doc && doc.action === 'e2e_scenario');
  if (!raw) throw new Error(`${file} holds no e2e_scenario document.`);
  return {
    name: String(raw.name),
    file,
    protocolVersion: String(raw.protocolVersion),
    formats: (raw.formats ?? []) as string[],
    turns: (raw.turns ?? []) as ScenarioTurn[],
  };
}

/** Loads `conformance/e2e/<name>.yaml`, or the `v0_9_1/` copy for version `0.9.1`. */
export function loadScenario(name: string, version: Version = '1.0'): Scenario {
  return readScenario(path.join(repoRoot, SCENARIO_DIRS[version], `${name}.yaml`));
}

/** Loads a live-only scenario from `e2e/web/scenarios/<name>.yaml`. */
export function loadLocalScenario(name: string): Scenario {
  return readScenario(path.join(LOCAL_SCENARIO_DIR, `${name}.yaml`));
}

/** The names of the seeds a version has, from the files in its directory. */
export function listScenarios(version: Version): string[] {
  const dir = path.join(repoRoot, SCENARIO_DIRS[version]);
  return fs
    .readdirSync(dir)
    .filter(entry => entry.endsWith('.yaml'))
    .map(entry => entry.slice(0, -'.yaml'.length))
    .sort();
}

/** The user text the scenario opens with. */
export function openingText(scenario: Scenario): string {
  const text = scenario.turns[0]?.userText;
  if (text === null || text === undefined) {
    throw new Error(`Scenario '${scenario.name}' has no user text in turn 0.`);
  }
  return text;
}

/** The text parts of a turn's wire, joined as the transcript shows them. */
export function turnText(turn: ScenarioTurn): string {
  return turn.expectWire
    .filter((part): part is {text: string} => 'text' in part)
    .map(part => part.text)
    .join('');
}

/** A check `expectOutcome` runs for one kind of rendered content. */
export type LocatorCheck =
  | {readonly kind: 'text'; readonly text: string; readonly count: number}
  | {
      readonly kind: 'role';
      readonly role: 'button' | 'textbox' | 'checkbox';
      readonly name: string;
      readonly count: number;
    }
  | {readonly kind: 'value'; readonly label: string; readonly value: string};

/** Removes the markdown a Text may carry, leaving the words the page shows. */
export function plainText(text: string): string {
  return text
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim();
}

function descendantText(node: ViewNode): string {
  const own = node.type === 'Text' && node.text ? plainText(node.text) : '';
  const children = (node.children ?? []).map(descendantText).filter(Boolean);
  return [own, ...children].filter(Boolean).join(' ');
}

/**
 * Turns a view tree into the checks a page must satisfy.
 *
 * Texts are counted by their words, buttons by their accessible name, text fields and check
 * boxes by their label. Layout components add nothing of their own.
 */
export function locatorPlan(tree: ViewNode): LocatorCheck[] {
  const texts = new Map<string, number>();
  const roles = new Map<
    string,
    {role: 'button' | 'textbox' | 'checkbox'; name: string; count: number}
  >();
  const values: LocatorCheck[] = [];
  const bump = (role: 'button' | 'textbox' | 'checkbox', name: string) => {
    const key = `${role}\u0000${name}`;
    const entry = roles.get(key) ?? {role, name, count: 0};
    entry.count++;
    roles.set(key, entry);
  };
  const visit = (node: ViewNode, insideButton: boolean) => {
    switch (node.type) {
      case 'Text':
        if (node.text) {
          const text = plainText(node.text);
          if (!insideButton) texts.set(text, (texts.get(text) ?? 0) + 1);
        }
        break;
      case 'Button':
        bump('button', descendantText(node));
        for (const child of node.children ?? []) visit(child, true);
        return;
      case 'TextField':
        if (node.label) {
          bump('textbox', node.label);
          if (typeof node.value === 'string') {
            values.push({kind: 'value', label: node.label, value: node.value});
          }
        }
        break;
      case 'CheckBox':
        if (node.label) bump('checkbox', node.label);
        break;
      default:
        break;
    }
    for (const child of node.children ?? []) visit(child, insideButton);
  };
  visit(tree, false);
  return [
    ...[...texts].map(([text, count]): LocatorCheck => ({kind: 'text', text, count})),
    ...[...roles.values()].map((entry): LocatorCheck => ({kind: 'role', ...entry})),
    ...values,
  ];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matches the words of a Text whether or not the page rendered its markdown. */
export function textPattern(text: string): RegExp {
  return new RegExp(`^\\s*(?:#{1,6}\\s*)?${escapeRegExp(text)}\\s*$`);
}

/** The element that holds surface `surfaceId`. */
export function surfaceLocator(page: Page, surfaceId: string): Locator {
  return page.locator(`[data-a2ui-surface="${surfaceId}"]`);
}

/** The element that renders component `componentId` in surface `surfaceId`. */
export function componentLocator(page: Page, surfaceId: string, componentId: string): Locator {
  return surfaceLocator(page, surfaceId).locator(`[data-a2ui-id="${componentId}"]`);
}

/** Asserts that the page shows each surface as its view tree says, or not at all. */
export async function expectOutcome(page: Page, viewTrees: ViewTrees | undefined): Promise<void> {
  if (!viewTrees) return;
  for (const [surfaceId, tree] of Object.entries(viewTrees)) {
    const surface = surfaceLocator(page, surfaceId);
    if (tree === null) {
      await expect(surface, `surface '${surfaceId}' is absent`).toHaveCount(0);
      continue;
    }
    await expect(surface, `surface '${surfaceId}' is shown`).toBeVisible();
    for (const check of locatorPlan(tree)) {
      switch (check.kind) {
        case 'text':
          await expect(
            surface.getByText(textPattern(check.text)),
            `'${check.text}' in surface '${surfaceId}'`,
          ).toHaveCount(check.count);
          break;
        case 'role':
          await expect(
            surface.getByRole(check.role, {name: check.name, exact: true}),
            `${check.role} '${check.name}' in surface '${surfaceId}'`,
          ).toHaveCount(check.count);
          break;
        case 'value':
          await expect(
            surface.getByLabel(check.label, {exact: true}).first(),
            `'${check.label}' in surface '${surfaceId}' holds '${check.value}'`,
          ).toHaveValue(check.value);
          break;
      }
    }
  }
}

/** Performs the turn's operations on the page, as a user would. */
export async function runUiOps(page: Page, ops: readonly UiOp[] | undefined): Promise<void> {
  for (const op of ops ?? []) {
    const target = componentLocator(page, op.surfaceId, op.targetNode).first();
    await expect(target, `component '${op.targetNode}' in '${op.surfaceId}'`).toBeVisible();
    if (op.op === 'user_input') {
      const field = target.locator('input, textarea').first();
      await field.fill(op.inputValue ?? '');
    } else {
      const button = target.getByRole('button');
      if ((await button.count()) > 0) {
        await button.first().click();
      } else {
        await target.click();
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function wildcard(expected: Record<string, unknown>): string | undefined {
  const keys = Object.keys(expected);
  return keys.length === 1 && keys[0] === '$match' ? String(expected.$match) : undefined;
}

/**
 * Compares an envelope to an expectation with `$match` wildcards.
 *
 * `{$match: any}` accepts any present value, `{$match: string}` any string, and
 * `{$match: iso8601}` any ISO 8601 timestamp. Everything else must be equal, and objects must
 * have the same keys.
 *
 * @returns The first difference found, as a path and a reason, or `null` when they match.
 */
export function matchOutbound(actual: unknown, expected: unknown, at = '$'): string | null {
  if (isRecord(expected)) {
    const kind = wildcard(expected);
    if (kind !== undefined) {
      if (actual === undefined) return `${at}: expected a value, got none`;
      if (kind === 'any') return null;
      if (kind === 'string') {
        return typeof actual === 'string' ? null : `${at}: expected a string, got ${typeof actual}`;
      }
      if (kind === 'iso8601') {
        return typeof actual === 'string' && ISO_8601.test(actual)
          ? null
          : `${at}: expected an ISO 8601 timestamp, got ${JSON.stringify(actual)}`;
      }
      return `${at}: unknown wildcard '${kind}'`;
    }
    if (!isRecord(actual)) return `${at}: expected an object, got ${JSON.stringify(actual)}`;
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (expectedKeys.join(',') !== actualKeys.join(',')) {
      return `${at}: expected keys [${expectedKeys}], got [${actualKeys}]`;
    }
    for (const key of expectedKeys) {
      const difference = matchOutbound(actual[key], expected[key], `${at}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${at}: expected an array, got ${JSON.stringify(actual)}`;
    if (actual.length !== expected.length) {
      return `${at}: expected ${expected.length} items, got ${actual.length}`;
    }
    for (let i = 0; i < expected.length; i++) {
      const difference = matchOutbound(actual[i], expected[i], `${at}[${i}]`);
      if (difference) return difference;
    }
    return null;
  }
  return Object.is(actual, expected) || actual === expected
    ? null
    : `${at}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

/** Asserts that `actual` holds exactly the expected envelopes, in order. */
export function expectOutbound(
  actual: readonly Record<string, unknown>[],
  expected: readonly Record<string, unknown>[] | undefined,
): void {
  const difference = matchOutbound(actual, expected ?? []);
  expect(difference, `outbound envelopes ${JSON.stringify(actual)}`).toBeNull();
}
