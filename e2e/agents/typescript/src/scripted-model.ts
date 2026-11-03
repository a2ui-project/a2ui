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
 * A model that replays the scenario a conversation opened with.
 *
 * `ScriptedModel` stands in for a real model. It reads the system prompt and the chat history
 * the executor built, picks the scenario and turn from them, and streams that turn's scripted
 * chunks. Nothing is kept between requests, so what the model answers depends only on what the
 * request holds, as it would for a real model:
 *
 * - The scenario is the one whose turn 0 `userText` is the first user entry of the history.
 * - The protocol version is read from the catalog id the system prompt names
 *   (`.../specification/v1_0/...` or `.../v0_9/...`), so a v0.9 renderer gets the scenario's
 *   v0.9.1 copy.
 * - The turn is the position of the latest user entry among the user entries that carry text. A
 *   turn with `userText: null` therefore starts only when the renderer's message for the previous
 *   turn's `expectOutbound` has arrived as a user entry; a history whose latest user entry carries
 *   no text gets no reply.
 * - When the system prompt holds no A2UI snippet, because the renderer sent no capabilities, the
 *   model answers with the turn's text parts only.
 *
 * Every request is appended to a `RequestLog`, which the server exposes on `GET /e2e/log` so a
 * test can check what the model was shown.
 */

import {
  normalizeVersion,
  type Scenario,
  type ScenarioIndex,
  type Turn,
  turnText,
} from './scenarios.js';

const CATALOG_VERSION = /a2ui\.org\/specification\/v(\d+(?:_\d+)+)\//;
const SNIPPET_MARKERS = ['<a2ui>', '<a2ui-json>'];

/** One entry of the conversation as the model sees it. */
export interface ChatTurn {
  readonly role: 'user' | 'model';
  readonly text: string;
}

/** What one model request held and how the model answered it. */
export interface ModelRequestRecord {
  systemInstruction: string;
  userContents: string[];
  version: string | null;
  a2uiEnabled: boolean;
  format: string;
  scenario: string | null;
  turn: number | null;
  chunks: number;
  text: string;
  note: string | null;
}

/** The requests a `ScriptedModel` got, oldest first. */
export class RequestLog {
  private readonly entries: ModelRequestRecord[] = [];

  append(record: ModelRequestRecord): void {
    this.entries.push(record);
  }

  clear(): void {
    this.entries.length = 0;
  }

  get records(): ModelRequestRecord[] {
    return [...this.entries];
  }

  get length(): number {
    return this.entries.length;
  }
}

export interface ScriptedModelOptions {
  /** The inference format whose chunks are streamed, as the scenario files name it. */
  readonly format: string;
  /** The pause before each streamed chunk, in milliseconds. */
  readonly chunkDelayMs?: number;
  /** Where every request is recorded. */
  readonly log?: RequestLog;
}

interface Selection {
  scenario?: Scenario;
  turn?: Turn;
  note?: string;
  replyText?: string;
}

function userTexts(history: readonly ChatTurn[]): string[] {
  return history
    .filter(entry => entry.role === 'user')
    .map(entry => entry.text.trim())
    .filter(text => text.length > 0);
}

function versionFromPrompt(prompt: string): string | null {
  const match = CATALOG_VERSION.exec(prompt);
  return match ? normalizeVersion(match[1]) : null;
}

function hasSnippet(prompt: string): boolean {
  return SNIPPET_MARKERS.some(marker => prompt.includes(marker));
}

function collapse(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** A model that answers each request with a scripted scenario turn. */
export class ScriptedModel {
  readonly format: string;
  readonly chunkDelayMs: number;
  readonly log: RequestLog;

  constructor(
    private readonly scenarios: ScenarioIndex,
    options: ScriptedModelOptions,
  ) {
    this.format = options.format;
    this.chunkDelayMs = options.chunkDelayMs ?? 0;
    this.log = options.log ?? new RequestLog();
  }

  /** Streams the chunks of the turn that `systemPrompt` and `history` name. */
  async *generate(systemPrompt: string, history: readonly ChatTurn[]): AsyncIterable<string> {
    const texts = userTexts(history);
    const version = versionFromPrompt(systemPrompt);
    const a2uiEnabled = version !== null && hasSnippet(systemPrompt);
    const selection = this.select(texts, version);
    const chunks = this.chunks(selection, a2uiEnabled);
    this.log.append({
      systemInstruction: systemPrompt,
      userContents: texts,
      version,
      a2uiEnabled,
      format: this.format,
      scenario: selection.scenario?.name ?? null,
      turn: selection.turn?.index ?? null,
      chunks: chunks.length,
      text: chunks.join(''),
      note: selection.note ?? null,
    });
    for (const chunk of chunks) {
      if (this.chunkDelayMs > 0) {
        await sleep(this.chunkDelayMs);
      }
      yield chunk;
    }
  }

  /** Picks the scenario and turn the history's user entries name. */
  private select(texts: string[], version: string | null): Selection {
    if (texts.length === 0) {
      return {note: 'The request holds no user text; nothing to reply.'};
    }
    const opening = texts[0];
    let lookupVersion = version;
    if (lookupVersion === null) {
      // Without capabilities there is no version to replay; use the newest copy of the
      // scenario, whose text parts are the same.
      const versions = this.scenarios.versionsOf(opening);
      lookupVersion = versions.at(-1) ?? '1.0';
    }
    const scenario = this.scenarios.find(opening, lookupVersion);
    if (!scenario) {
      const known = this.scenarios.versionsOf(opening);
      const note =
        known.length > 0
          ? `No v${lookupVersion} copy of the scenario opening with ${JSON.stringify(opening)}; ` +
            `it exists for ${known.join(', ')}.`
          : `No scenario opens with ${JSON.stringify(opening)}.`;
      return {note, replyText: note};
    }
    const turnIndex = texts.length - 1;
    if (turnIndex >= scenario.turns.length) {
      const note =
        `Scenario '${scenario.name}' has ${scenario.turns.length} turns; ` +
        `this is user content ${turnIndex + 1}.`;
      return {scenario, note, replyText: note};
    }
    const turn = scenario.turns[turnIndex];
    const latest = texts[turnIndex];
    const note =
      turn.userText !== null && collapse(turn.userText) !== collapse(latest)
        ? `Turn ${turnIndex} expects user text ${JSON.stringify(turn.userText)}; ` +
          `got ${JSON.stringify(latest)}.`
        : undefined;
    return {scenario, turn, note};
  }

  private chunks(selection: Selection, a2uiEnabled: boolean): string[] {
    const {scenario, turn} = selection;
    if (!turn) {
      return selection.replyText ? [selection.replyText] : [];
    }
    if (!a2uiEnabled) {
      const text = turnText(turn);
      return text ? [text] : [];
    }
    const chunks = turn.modelChunks[this.format];
    if (!chunks) {
      return [
        `Scenario '${scenario?.name}' scripts no '${this.format}' chunks for turn ${turn.index}.`,
      ];
    }
    return [...chunks];
  }
}
