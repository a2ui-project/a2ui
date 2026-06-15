/*
 * Copyright 2025 Google LLC
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
 * Theme Provider for A2UI Components
 *
 * This component wraps A2UI surfaces and provides the theme context
 * required by the newer A2UI component library.
 */

import {SignalWatcher} from '@lit-labs/signals';
import {LitElement, html, css} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {provide} from '@lit/context';
import {v0_8} from '@a2ui/lit';
import * as UI from '@a2ui/lit/ui';
import {theme as defaultTheme} from './theme.js';

// Import and register custom components
import {Flashcard} from './flashcard.js';
import {QuizCard} from './quiz-card.js';

UI.componentRegistry.register(
  'Flashcard',
  Flashcard as unknown as UI.CustomElementConstructorOf<HTMLElement>,
  'a2ui-flashcard',
);
UI.componentRegistry.register(
  'QuizCard',
  QuizCard as unknown as UI.CustomElementConstructorOf<HTMLElement>,
  'a2ui-quizcard',
);

// Type alias for the processor - use the actual exported class name
type A2UIModelProcessorInstance = InstanceType<typeof v0_8.Data.A2uiMessageProcessor>;

@customElement('a2ui-theme-provider')
export class A2UIThemeProvider extends SignalWatcher(LitElement) {
  @provide({context: UI.Context.themeContext})
  theme: v0_8.Types.Theme = defaultTheme;

  @property({type: String})
  surfaceId: string = '';

  @property({type: Object})
  surface: v0_8.Types.Surface | undefined;

  @property({type: Object})
  processor: A2UIModelProcessorInstance | undefined;

  static styles = css`
    :host {
      display: block;
    }
  `;

  render() {
    if (!this.surface || !this.processor) {
      return html``;
    }

    return html`
      <a2ui-surface
        .surfaceId=${this.surfaceId}
        .surface=${this.surface}
        .processor=${this.processor}
        .enableCustomElements=${true}
      ></a2ui-surface>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'a2ui-theme-provider': A2UIThemeProvider;
  }
}
