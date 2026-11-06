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
 * The fixtures every live-pair spec uses.
 *
 * - `pair` names the shell, the agent and the format of the current project.
 * - `capture` records every message the page POSTs to the agent, and fails the test when an
 *   A2UI DataPart in one does not validate against the renderer-to-agent schema of the pair's
 *   version.
 * - `agentLog` reads the agent's model request log, and clears it before the test.
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {test as base, expect, type Page} from '@playwright/test';
import {Ajv2020, type ValidateFunction} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const A2UI_MIME_TYPE = 'application/a2ui+json';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..', '..');

export type Format = 'direct_json' | 'express';
export type ShellName = 'lit' | 'react';
export type AgentName = 'python' | 'typescript';

/** What a project passes through `use`. */
export interface PairOptions {
  shell: ShellName;
  format: Format;
  agent: AgentName;
  agentUrl: string;
  shellUrl: string;
}

/** The versions a shell can advertise, as the `caps` query parameter writes them. */
export type Caps = 'v1_0' | 'v0_9' | 'off';

/** A scenario version, as the scenario files write it. */
export type Version = '1.0' | '0.9.1';

export const WIRE_VERSION: Readonly<Record<Version, string>> = {
  '1.0': '1.0',
  '0.9.1': 'v0.9',
};

export const CAPS_FOR: Readonly<Record<Version, Caps>> = {
  '1.0': 'v1_0',
  '0.9.1': 'v0_9',
};

/** One message the page sent, as the agent received it. */
export interface CapturedMessage {
  readonly text: string[];
  readonly envelopes: Record<string, unknown>[];
  readonly metadata: Record<string, unknown> | undefined;
  readonly body: Record<string, unknown>;
}

export interface Capture {
  readonly messages: CapturedMessage[];
  /** The envelopes of every message so far, in order. */
  envelopes(): Record<string, unknown>[];
  /** Waits until at least `count` messages went out. */
  waitForMessages(count: number, timeoutMs?: number): Promise<CapturedMessage[]>;
  /** The schema violations seen so far. Empty when every envelope validated. */
  readonly violations: string[];
}

/** One model request the agent recorded, as `GET /e2e/log` returns it. */
export interface AgentLogRecord {
  readonly systemInstruction: string;
  readonly userContents: string[];
  readonly version: string | null;
  readonly a2uiEnabled: boolean;
  readonly format: string;
  readonly scenario: string | null;
  readonly turn: number | null;
  readonly chunks: number;
  readonly text: string;
  readonly note: string | null;
}

/** The Python agent logs its records with snake_case keys; the TypeScript agent with camelCase. */
function camelCaseKeys(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
}

function loadJson(relative: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));
}

const validators = new Map<string, ValidateFunction>();

/** The validator of the renderer-to-agent envelope of a wire version. */
export function outboundValidator(wireVersion: string): ValidateFunction {
  const key = wireVersion === '1.0' ? '1.0' : 'v0.9';
  let validator = validators.get(key);
  if (validator) return validator;
  const ajv = new Ajv2020({strict: false, allErrors: true});
  addFormats(ajv);
  if (key === '1.0') {
    ajv.addSchema(loadJson('specification/v1_0/json/common_types.json'));
    // `common_types.json` leaves the function call shapes to the active catalog, which the
    // conformance suite also stands in for: a call is any object here.
    ajv.addSchema({
      $id: 'https://a2ui.org/specification/v1_0/catalog.json',
      $defs: {anyFunction: {type: 'object', additionalProperties: true}},
    });
    validator = ajv.compile(loadJson('specification/v1_0/json/renderer_to_agent.json'));
  } else {
    validator = ajv.compile(loadJson('specification/v0_9_1/json/client_to_server.json'));
  }
  validators.set(key, validator);
  return validator;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function partsOf(body: Record<string, unknown>): Record<string, unknown>[] {
  const params = isRecord(body.params) ? body.params : {};
  const message = isRecord(params.message) ? params.message : {};
  return Array.isArray(message.parts) ? message.parts.filter(isRecord) : [];
}

function messageOf(body: Record<string, unknown>): CapturedMessage {
  const params = isRecord(body.params) ? body.params : {};
  const message = isRecord(params.message) ? params.message : {};
  const parts = partsOf(body);
  return {
    body,
    metadata: isRecord(message.metadata) ? message.metadata : undefined,
    text: parts
      .filter(part => part.kind === 'text' && typeof part.text === 'string')
      .map(part => part.text as string),
    envelopes: parts
      .filter(
        part =>
          part.kind === 'data' &&
          isRecord(part.metadata) &&
          part.metadata.mimeType === A2UI_MIME_TYPE &&
          isRecord(part.data),
      )
      .map(part => part.data as Record<string, unknown>),
  };
}

/** The schema violation of an envelope, judged by the version the envelope names. */
export function envelopeViolation(envelope: Record<string, unknown>): string | undefined {
  const version = envelope.version;
  if (version !== '1.0' && version !== 'v0.9' && version !== 'v0.9.1') {
    return `Outbound envelope ${JSON.stringify(envelope)} names no known version.`;
  }
  const validate = outboundValidator(version);
  if (validate(envelope)) return undefined;
  return (
    `Outbound envelope ${JSON.stringify(envelope)} violates the ${version} ` +
    `renderer-to-agent schema: ${JSON.stringify(validate.errors)}`
  );
}

async function installCapture(page: Page, agentUrl: string): Promise<Capture> {
  const messages: CapturedMessage[] = [];
  const violations: string[] = [];
  const waiters: {count: number; resolve: () => void}[] = [];
  await page.route(`${agentUrl}**`, async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown> | null;
      if (body && isRecord(body) && body.method === 'message/stream') {
        const captured = messageOf(body);
        for (const envelope of captured.envelopes) {
          const violation = envelopeViolation(envelope);
          if (violation) violations.push(violation);
        }
        messages.push(captured);
        for (const waiter of [...waiters]) {
          if (messages.length >= waiter.count) {
            waiters.splice(waiters.indexOf(waiter), 1);
            waiter.resolve();
          }
        }
      }
    }
    await route.continue();
  });
  return {
    messages,
    violations,
    envelopes: () => messages.flatMap(message => message.envelopes),
    waitForMessages(count, timeoutMs = 15_000) {
      if (messages.length >= count) return Promise.resolve(messages);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `Expected ${count} messages to the agent within ${timeoutMs}ms; ` +
                  `saw ${messages.length}.`,
              ),
            ),
          timeoutMs,
        );
        waiters.push({
          count,
          resolve: () => {
            clearTimeout(timer);
            resolve(messages);
          },
        });
      });
    },
  };
}

export interface PairFixtures {
  pair: PairOptions;
  /** Opens the shell against the pair's agent, advertising `caps`. */
  open: (caps?: Caps) => Promise<Page>;
  capture: Capture;
  agentLog: () => Promise<AgentLogRecord[]>;
}

export const test = base.extend<PairOptions & PairFixtures>({
  shell: ['lit', {option: true}],
  format: ['direct_json', {option: true}],
  agent: ['typescript', {option: true}],
  agentUrl: ['http://localhost:10201/', {option: true}],
  shellUrl: ['http://localhost:5174/lit.html', {option: true}],

  pair: async ({shell, format, agent, agentUrl, shellUrl}, use) => {
    await use({shell, format, agent, agentUrl, shellUrl});
  },

  capture: async ({page, agentUrl}, use) => {
    const capture = await installCapture(page, agentUrl);
    await use(capture);
    expect(capture.violations, 'every outbound envelope validates').toEqual([]);
  },

  open: async ({page, shellUrl, agentUrl, capture: _capture}, use) => {
    await use(async (caps: Caps = 'v1_0') => {
      const url = new URL(shellUrl);
      url.searchParams.set('agent', agentUrl);
      url.searchParams.set('caps', caps);
      await page.goto(url.href);
      await expect(page.locator('#prompt')).toBeVisible();
      return page;
    });
  },

  agentLog: async ({agentUrl}, use) => {
    const endpoint = new URL('/e2e/log', agentUrl);
    const cleared = await fetch(endpoint, {method: 'DELETE'});
    expect(cleared.ok).toBe(true);
    await use(async () => {
      const response = await fetch(endpoint);
      expect(response.ok).toBe(true);
      const records = (await response.json()) as Record<string, unknown>[];
      return records.map(camelCaseKeys) as unknown as AgentLogRecord[];
    });
  },
});

export {expect};
