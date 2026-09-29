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

// Everything that differs by A2UI protocol version lives here. No other file in the
// sample branches on a version string: examples live in examples/<version>/ and the stub
// notice in stub_notice/<version>.json.

/** One A2UI protocol version this agent can answer in. */
export interface VersionProfile {
  /** The version the agent writes in its messages, and the key in the capabilities object. */
  version: 'v0.9' | 'v1.0';
  /** The message metadata key under which a renderer lists its capabilities. */
  capabilitiesKey: 'a2uiClientCapabilities' | 'a2uiRendererCapabilities';
}

/**
 * v0.9 messages and the v0.9 basic catalog id, sent with the v0.9.1 MIME type
 * (`application/a2ui+json`). v0.9.1 schemas accept `"version": "v0.9"`. The sample does
 * not write `"v0.9.1"` because `@a2ui/agent` has no v0.9.1 basic catalog yet, and the
 * sample clients send and expect the v0.9 catalog id.
 */
export const V0_9: VersionProfile = {
  version: 'v0.9',
  capabilitiesKey: 'a2uiClientCapabilities',
};

/** The v1.0 candidate protocol. */
export const V1_0: VersionProfile = {
  version: 'v1.0',
  capabilitiesKey: 'a2uiRendererCapabilities',
};

/** Every version this agent serves, oldest first. */
export const VERSIONS: readonly VersionProfile[] = [V0_9, V1_0];

/**
 * The version used when a request carries no renderer capabilities. The lit, angular and
 * react sample clients send none and render v0.9.
 */
export const DEFAULT_VERSION = V0_9;
