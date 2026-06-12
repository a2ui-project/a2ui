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
 * A2UI Flashcard Component
 *
 * A flippable card that shows a front (question) and back (answer).
 * This is a custom component for the personalized learning demo.
 */

import {html, css, nothing, LitElement} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {v0_8} from '@a2ui/lit';
import type {StringValue} from './types.js';

type A2UIModelProcessorInstance = InstanceType<typeof v0_8.Data.A2uiMessageProcessor>;

@customElement('a2ui-flashcard')
export class Flashcard extends LitElement {
  @property({attribute: false})
  front: StringValue | null = null;

  @property({attribute: false})
  back: StringValue | null = null;

  @property({attribute: false})
  category: StringValue | null = null;

  @property({attribute: false})
  processor: A2UIModelProcessorInstance | null = null;

  @property({attribute: false})
  component: v0_8.Types.AnyComponentNode | null = null;

  @property({attribute: false})
  surfaceId: string | null = null;

  @state()
  private _flipped = false;

  static styles = css`
    * {
      box-sizing: border-box;
    }

    :host {
      display: block;
      perspective: 1000px;
      width: 100%;
      max-width: 340px;
      min-width: 280px;
      margin-bottom: 12px;
    }

    .flashcard-container {
      width: 100%;
      height: 320px;
      position: relative;
      cursor: pointer;
      transform-style: preserve-3d;
      transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .flashcard-container.flipped {
      transform: rotateY(180deg);
    }

    .flashcard-face {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      backface-visibility: hidden;
      border-radius: 14px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }

    .flashcard-front {
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: white;
    }

    .flashcard-back {
      background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
      color: white;
      transform: rotateY(180deg);
    }

    .flashcard-category {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.8;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .flashcard-category::before {
      content: '';
      width: 8px;
      height: 8px;
      background: currentColor;
      border-radius: 50%;
      opacity: 0.6;
    }

    .flashcard-content {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      text-align: center;
      font-size: 14px;
      line-height: 1.5;
      font-weight: 500;
      overflow-y: auto;
      padding: 8px;
    }

    .flashcard-front .flashcard-content {
      font-size: 16px;
      font-weight: 600;
      align-items: center;
    }

    .flashcard-back .flashcard-content {
      font-size: 13px;
      line-height: 1.45;
      text-align: left;
      align-items: flex-start;
    }

    .flashcard-hint {
      font-size: 11px;
      opacity: 0.7;
      text-align: center;
      margin-top: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    .flashcard-hint .icon {
      font-size: 16px;
    }

    /* Hover effect */
    .flashcard-container:hover {
      transform: scale(1.02);
    }

    .flashcard-container.flipped:hover {
      transform: rotateY(180deg) scale(1.02);
    }

    /* Label badges */
    .label-front,
    .label-back {
      position: absolute;
      top: 12px;
      right: 12px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      background: rgba(255, 255, 255, 0.2);
      padding: 4px 8px;
      border-radius: 4px;
    }
  `;

  private resolveStringValue(value: StringValue | null): string {
    if (!value) return '';

    if (typeof value === 'object') {
      if (
        'literalString' in value &&
        value.literalString !== undefined &&
        value.literalString !== null
      ) {
        return value.literalString as string;
      } else if ('literal' in value && value.literal !== undefined && value.literal !== null) {
        return String(value.literal);
      } else if ('path' in value && value.path) {
        if (!this.processor || !this.component) {
          return '(no processor)';
        }
        const resolved = this.processor.getData(
          this.component,
          value.path,
          this.surfaceId ?? 'default',
        );
        return typeof resolved === 'string' ? resolved : '';
      }
    }

    return '';
  }

  private handleClick() {
    this._flipped = !this._flipped;
  }

  render() {
    const frontText = this.resolveStringValue(this.front);
    const backText = this.resolveStringValue(this.back);
    const categoryText = this.resolveStringValue(this.category);

    return html`
      <div
        class=${classMap({
          'flashcard-container': true,
          flipped: this._flipped,
        })}
        @click=${this.handleClick}
      >
        <div class="flashcard-face flashcard-front">
          <span class="label-front">Q</span>
          ${categoryText ? html`<div class="flashcard-category">${categoryText}</div>` : nothing}
          <div class="flashcard-content">${frontText}</div>
          <div class="flashcard-hint">
            <span class="icon">↻</span>
            Click to reveal answer
          </div>
        </div>
        <div class="flashcard-face flashcard-back">
          <span class="label-back">A</span>
          ${categoryText ? html`<div class="flashcard-category">${categoryText}</div>` : nothing}
          <div class="flashcard-content">${backText}</div>
          <div class="flashcard-hint">
            <span class="icon">↻</span>
            Click to see question
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'a2ui-flashcard': Flashcard;
  }
}
