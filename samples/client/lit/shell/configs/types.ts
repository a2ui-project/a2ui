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
 * A quick-action button shown below the text input bar.
 */
export interface QuickAction {
  /** Label shown inside the button. */
  label: string;
  /** Message sent to the agent when clicked. */
  message: string;
  /** Optional tooltip text. */
  title?: string;
}

/**
 * Configuration interface for the Universal App Shell.
 */
export interface AppConfig {
  /** Unique key for the app (e.g., 'restaurant', 'contacts') */
  key: string;
  /** Display title of the application */
  title: string;
  /** The background for the page */
  background?: string;
  /** Path to the hero image */
  heroImage?: string;
  /** Path to the hero image */
  heroImageDark?: string;
  /** Placeholder text for the input field */
  placeholder: string;
  /** Text to display while loading (optional). */
  loadingText?: string[];
  /** Optional server URL for the agent (e.g., http://localhost:10003) */
  serverUrl?: string;
  /** Custom CSSStyleSheet overrides for components */
  cssOverrides?: CSSStyleSheet;
  /**
   * Whether to delete every rendered surface before processing an agent
   * response (default `true`). Set it to `false` for agents that keep
   * surfaces across turns, so a reused surface id updates in place.
   */
  clearSurfacesOnResponse?: boolean;
  /** Optional row of example buttons rendered below the text input. */
  quickActions?: QuickAction[];
  /** Whether to render the split-screen <playground-inspector> side panel. */
  inspector?: boolean;
}
