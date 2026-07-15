/*
 * Copyright 2026 Google LLC
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

import {html, nothing, css} from 'lit';
import {customElement} from 'lit/decorators.js';
import {ProgressBarApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../../../a2ui-controller.js';

@customElement('a2ui-progress-bar')
export class A2uiProgressBarElement extends BasicCatalogA2uiLitElement<typeof ProgressBarApi> {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-xs, 0.25rem);
      margin: var(--a2ui-progress-bar-margin, var(--a2ui-spacing-m));
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header label {
      font-size: var(
        --a2ui-progress-bar-label-font-size,
        var(--a2ui-label-font-size, var(--a2ui-font-size-s))
      );
      font-weight: var(
        --a2ui-progress-bar-label-font-weight,
        var(--a2ui-label-font-weight, bold)
      );
    }
    .percentage {
      font-size: var(--a2ui-progress-bar-percentage-font-size, var(--a2ui-font-size-xs, 0.75rem));
      color: var(--a2ui-progress-bar-percentage-color, var(--a2ui-text-caption-color, #666));
    }
    .track {
      width: 100%;
      height: var(--a2ui-progress-bar-height, 0.5rem);
      background: var(--a2ui-progress-bar-track-color, var(--a2ui-color-secondary, #e9ecef));
      border-radius: var(--a2ui-progress-bar-border-radius, 0.25rem);
      overflow: hidden;
    }
    .fill {
      height: 100%;
      background: var(--a2ui-progress-bar-fill-color, var(--a2ui-color-primary, #007bff));
      border-radius: var(--a2ui-progress-bar-border-radius, 0.25rem);
      transition: width 0.3s ease;
    }
    .indeterminate .fill {
      width: 30% !important;
      animation: a2ui-progress-indeterminate 1.5s ease-in-out infinite;
    }
    @keyframes a2ui-progress-indeterminate {
      0% {
        transform: translateX(-100%);
      }
      100% {
        transform: translateX(400%);
      }
    }
  `;

  protected createController() {
    return new A2uiController(this, ProgressBarApi);
  }

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const isIndeterminate = (props.variant ?? 'determinate') === 'indeterminate';
    const max = props.max ?? 100;
    const pct = isIndeterminate ? 0 : Math.min(100, Math.max(0, ((props.value ?? 0) / max) * 100));

    return html`
      <div class=${isIndeterminate ? 'indeterminate' : ''}>
        <div class="header">
          ${props.label ? html`<label>${props.label}</label>` : nothing}
          ${(props.showPercentage ?? true) && !isIndeterminate
            ? html`<span class="percentage">${Math.round(pct)}%</span>`
            : nothing}
        </div>
        <div class="track" role="progressbar" aria-valuenow=${isIndeterminate ? nothing : pct} aria-valuemin="0" aria-valuemax="100">
          <div class="fill" style=${isIndeterminate ? nothing : `width: ${pct}%`}></div>
        </div>
      </div>
    `;
  }
}

export const A2uiProgressBar = {
  ...ProgressBarApi,
  tagName: 'a2ui-progress-bar',
};
