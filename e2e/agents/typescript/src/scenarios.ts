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
 * Loads the `conformance/e2e` scenarios the scripted agent replays.
 *
 * A scenario file holds a list of `e2e_scenario` cases. Each case has a protocol version and
 * turns, and each turn has the text the user types (or `null` when the turn is started by the
 * renderer's outbound message for the previous turn), the chunks the model streams for each
 * inference format, and the wire messages those chunks parse to.
 */

import fs from 'fs';
import path from 'path';

import yaml from 'js-yaml';

const ACTION = 'e2e_scenario';

/** One part of a turn's `expectWire`: text, or a run of A2UI messages. */
export type WirePart = {text: string} | {a2ui: Record<string, unknown>[]};

export interface Turn {
  readonly index: number;
  /** What the user types to start the turn, or null when a renderer message starts it. */
  readonly userText: string | null;
  /** The chunks the model streams, by inference format name. */
  readonly modelChunks: Readonly<Record<string, readonly string[]>>;
  readonly expectWire: readonly WirePart[];
  /** The envelopes the renderer sends after this turn's `uiOps`, if any. */
  readonly expectOutbound: readonly Record<string, unknown>[];
}

export interface Scenario {
  readonly name: string;
  /** The version as the scenario files write it: `1.0` or `0.9.1`. */
  readonly protocolVersion: string;
  readonly formats: readonly string[];
  readonly catalogPaths: readonly string[];
  readonly turns: readonly Turn[];
  readonly path: string;
}

/**
 * Returns the protocol version as the scenario files write it.
 *
 * Scenario files write `"1.0"` and `"0.9.1"`. Capability keys, extension URIs and catalog ids
 * write `v1.0`, `v0.9`, `v1_0` and `v0_9`; this maps them all to the scenario form, treating
 * v0.9 and v0.9.1 as one version.
 */
export function normalizeVersion(version: string): string {
  const normalized = version.trim().toLowerCase().replace(/^v/, '').replace(/_/g, '.');
  return normalized === '0.9' ? '0.9.1' : normalized;
}

/** The user text of turn 0, which picks the scenario. */
export function openingText(scenario: Scenario): string {
  const text = scenario.turns[0]?.userText;
  if (text === null || text === undefined) {
    throw new Error(`Scenario '${scenario.name}' has no user text in turn 0.`);
  }
  return text;
}

/** The turn's text parts of `expectWire`, merged, for a text-only reply. */
export function turnText(turn: Turn): string {
  return turn.expectWire
    .filter((part): part is {text: string} => 'text' in part)
    .map(part => part.text)
    .join('\n\n');
}

/** The A2UI messages of `expectWire`, in order. */
export function turnA2uiMessages(turn: Turn): Record<string, unknown>[] {
  return turn.expectWire.flatMap(part => ('a2ui' in part ? part.a2ui : []));
}

function normalizeText(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ');
}

/** The loaded scenarios, looked up by opening text and protocol version. */
export class ScenarioIndex implements Iterable<Scenario> {
  private readonly byKey = new Map<string, Scenario>();

  constructor(private readonly scenarios: readonly Scenario[]) {
    for (const scenario of scenarios) {
      const key = this.key(openingText(scenario), scenario.protocolVersion);
      const existing = this.byKey.get(key);
      if (existing) {
        throw new Error(
          `Scenarios '${existing.name}' and '${scenario.name}' both open with ` +
            `${JSON.stringify(openingText(scenario))} for v${scenario.protocolVersion}.`,
        );
      }
      this.byKey.set(key, scenario);
    }
  }

  [Symbol.iterator](): Iterator<Scenario> {
    return this.scenarios[Symbol.iterator]();
  }

  get size(): number {
    return this.scenarios.length;
  }

  /**
   * The scenario whose turn 0 is `text`, written for `version`.
   *
   * `version` is normalized with `normalizeVersion`, so a v0.9 renderer gets the scenario's
   * v0.9.1 copy when one exists.
   */
  find(text: string, version: string): Scenario | undefined {
    return this.byKey.get(this.key(text, normalizeVersion(version)));
  }

  /** The protocol versions a scenario with this opening text exists in. */
  versionsOf(text: string): string[] {
    const wanted = normalizeText(text);
    return this.scenarios
      .filter(scenario => normalizeText(openingText(scenario)) === wanted)
      .map(scenario => scenario.protocolVersion)
      .sort();
  }

  private key(text: string, version: string): string {
    return `${version}\u0000${normalizeText(text)}`;
  }
}

function toTurn(index: number, raw: Record<string, unknown>): Turn {
  const chunks = (raw.modelChunks ?? {}) as Record<string, string[]>;
  return {
    index,
    userText: typeof raw.userText === 'string' ? raw.userText : null,
    modelChunks: Object.fromEntries(
      Object.entries(chunks).map(([name, list]) => [name, [...list]]),
    ),
    expectWire: [...((raw.expectWire ?? []) as WirePart[])],
    expectOutbound: [...((raw.expectOutbound ?? []) as Record<string, unknown>[])],
  };
}

function toScenario(raw: Record<string, unknown>, file: string): Scenario {
  return {
    name: String(raw.name),
    protocolVersion: normalizeVersion(String(raw.protocolVersion)),
    formats: [...((raw.formats ?? []) as string[])],
    catalogPaths: [...((raw.catalogPaths ?? []) as string[])],
    turns: ((raw.turns ?? []) as Record<string, unknown>[]).map((turn, index) =>
      toTurn(index, turn),
    ),
    path: file,
  };
}

function* yamlFiles(dir: string): Generator<string> {
  const entries = fs
    .readdirSync(dir, {withFileTypes: true})
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* yamlFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
      yield full;
    }
  }
}

/**
 * Loads every `e2e_scenario` case under `dir`, recursively.
 *
 * @throws {Error} If `dir` does not exist, or two scenarios share an opening text and version.
 */
export function loadScenarios(dir: string): ScenarioIndex {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`Scenario directory not found: ${dir}`);
  }
  const scenarios: Scenario[] = [];
  for (const file of yamlFiles(dir)) {
    const loaded = yaml.load(fs.readFileSync(file, 'utf8')) ?? [];
    const documents = Array.isArray(loaded) ? loaded : [loaded];
    for (const raw of documents) {
      if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).action === ACTION) {
        scenarios.push(toScenario(raw as Record<string, unknown>, file));
      }
    }
  }
  return new ScenarioIndex(scenarios);
}
