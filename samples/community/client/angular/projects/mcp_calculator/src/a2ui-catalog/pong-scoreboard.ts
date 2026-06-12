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

import {DynamicComponent} from '@a2ui/angular';
import * as Primitives from '@a2ui/web_core/types/primitives';
import * as Types from '@a2ui/web_core/types/types';
import {ChangeDetectionStrategy, Component, computed, input} from '@angular/core';

@Component({
  selector: 'a2ui-pong-scoreboard',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 1.5rem;
      padding: 1.5rem;
      color: #202124;
      background: #ffffff;
      height: 100%;
      width: 100%;
      position: relative;
      font-family: 'Google Sans', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      box-sizing: border-box;
    }
    .a2ui-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      position: absolute;
      top: 1rem;
      left: 50%;
      transform: translateX(-50%);
      background: #e8eaed;
      color: #5f6368;
      font-size: 0.65rem;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      white-space: nowrap;
      border: 1px solid #dadce0;
    }
    .a2ui-icon {
      font-size: 0.8rem;
      color: #1a73e8;
    }
    .scores-wrapper {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      width: 100%;
      margin-top: 1.5rem;
    }
    .score-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      background: #f8f9fa;
      border-radius: 12px;
      padding: 1rem;
      border: 1px solid #e8eaed;
      transition: all 0.2s ease;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      width: 100%;
      box-sizing: border-box;
    }
    .score-card:hover {
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.08);
      transform: translateY(-2px);
      border-color: #d2e3fc;
    }
    .player-card {
      border-bottom: 3px solid #1a73e8;
    }
    .cpu-card {
      border-bottom: 3px solid #ea4335;
    }
    .score-label {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #5f6368;
      margin-bottom: 0.5rem;
      font-weight: 600;
    }
    .score-value {
      font-size: 3.5rem;
      font-weight: 700;
      color: #202124;
      line-height: 1;
    }
  `,
  template: `
    <div class="a2ui-badge"><span class="a2ui-icon">✦</span> A2UI Native</div>
    <div class="scores-wrapper">
      <div class="score-card player-card">
        <span class="score-label">Player</span>
        <span class="score-value">{{ resolvedPlayerScore() }}</span>
      </div>
      <div class="score-card cpu-card">
        <span class="score-label">CPU</span>
        <span class="score-value">{{ resolvedCpuScore() }}</span>
      </div>
    </div>
  `,
})
export class PongScoreBoard extends DynamicComponent<Types.CustomNode> {
  readonly playerScore = input<Primitives.NumberValue | null>();
  protected readonly resolvedPlayerScore = computed<number>(
    () => super.resolvePrimitive(this.playerScore() ?? null) ?? 0,
  );

  readonly cpuScore = input<Primitives.NumberValue | null>();
  protected readonly resolvedCpuScore = computed<number>(
    () => super.resolvePrimitive(this.cpuScore() ?? null) ?? 0,
  );
}
