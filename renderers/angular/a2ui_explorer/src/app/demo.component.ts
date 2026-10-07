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

import {
  ChangeDetectorRef,
  Component,
  OnInit,
  inject,
  OnDestroy,
  effect,
  signal,
  computed,
  HostListener,
  ElementRef,
  InjectionToken,
} from '@angular/core';
import {CommonModule} from '@angular/common';
import {
  A2uiRendererService,
  A2UI_RENDERER_CONFIG,
  AngularCatalog,
  SurfaceComponent as SurfaceComponentV09,
} from '@a2ui/angular/v0_9';
import {AgentStubService} from './agent-stub.service';
import {AgentStubV08Service} from './agent-stub-v08.service';
import {AgentStubV09Service} from './agent-stub-v09.service';
import {provideMarkdownRenderer, Surface as SurfaceV08} from '@a2ui/angular/v0_8';
import {DemoCatalog, DemoCatalogV10} from './demo-catalog';
import {A2uiClientAction, A2uiMessage} from '@a2ui/web_core/v0_9';
import {ServerToClientMessage} from 'src/v0_8/types';
import {A2uiExample, A2UI_VERSION, A2UI_EXAMPLES, Version} from './types';
import {EXAMPLES_V08, EXAMPLES_V09, EXAMPLES_V10} from './generated/examples-bundle';
import {ActionDispatcher} from './action-dispatcher.service';
import {Catalog as CatalogV08, DEFAULT_CATALOG as DEFAULT_CATALOG_V08} from '@a2ui/angular/v0_8';

/**
 * Dependency injection token for enabling universal components in the explorer (used by tests only).
 */
export const A2UI_USE_UNIVERSAL_COMPONENTS = new InjectionToken<boolean>(
  'A2UI_USE_UNIVERSAL_COMPONENTS',
  {
    providedIn: 'root',
    factory: () => false,
  },
);

function getUseUniversalComponents(): boolean {
  if (typeof window !== 'undefined' && window.location) {
    const params = new URLSearchParams(window.location.search);
    const val = params.get('useUniversalComponents');
    return val === 'true' || val === '1';
  }
  return false;
}

/**
 * Main dashboard component for A2UI v0.8 / v0.9 / v1.0 Angular Renderer.
 * It provides a sidebar of examples, a canvas for rendering,
 * and inspector tools for state auditing.
 */
@Component({
  selector: 'a2ui-v0-9-demo',
  standalone: true,
  imports: [CommonModule, SurfaceComponentV09, SurfaceV08],
  template: `
    <div class="dashboard">
      <!-- Sidebar Navigation -->
      <div class="sidebar" [class.collapsed]="isLeftSidebarCollapsed">
        <div class="sidebar-header">
          <h3>Examples</h3>
          <div class="header-actions">
            <button
              class="icon-btn collapse-left-btn"
              (click)="toggleLeftSidebar()"
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
          </div>
        </div>
        <ul class="example-list">
          <li
            *ngFor="let ex of examples"
            (click)="selectExample(ex)"
            [class.active]="ex === selectedExample"
          >
            <div class="ex-name">{{ ex.name }}</div>
            <div class="ex-desc">{{ ex.filename || ex.description }}</div>
          </li>
        </ul>
      </div>

      <!-- Main Canvas Area -->
      <div class="canvas-area">
        <div class="canvas-header">
          <div class="canvas-header-left">
            <button
              *ngIf="isLeftSidebarCollapsed"
              class="icon-btn expand-left-btn"
              (click)="toggleLeftSidebar()"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
            <div class="app-brand">
              <h1>A2UI Angular Explorer</h1>
            </div>
            <div class="header-divider"></div>
            <div *ngIf="selectedExample" class="title-details">
              <h2>{{ selectedExample.name }}</h2>
              <p class="subtitle">{{ selectedExample.description }}</p>
            </div>
          </div>
          <div class="canvas-header-right agent-controls">
            <fieldset class="version-controls">
              <legend>Spec version</legend>
              <div class="version-selector" role="group" aria-label="Specification version">
                <button
                  class="version-btn"
                  [class.active]="version === Version.V0_8"
                  data-version="0.8"
                  (click)="setVersion(Version.V0_8)"
                >
                  v0.8
                </button>
                <button
                  class="version-btn"
                  [class.active]="version === Version.V0_9"
                  data-version="0.9"
                  (click)="setVersion(Version.V0_9)"
                >
                  v0.9
                </button>
                <button
                  class="version-btn"
                  [class.active]="version === Version.V1_0"
                  data-version="1.0"
                  (click)="setVersion(Version.V1_0)"
                >
                  v1.0
                </button>
              </div>
            </fieldset>
            <fieldset class="message-controls">
              <legend>Messages: {{ processedMessageCount }} / {{ totalMessageCount }}</legend>
              <button (click)="resetSurface()">Reset</button>
              <button (click)="advanceMessages(false)" [disabled]="!canAdvance">+1 Message</button>
              <button (click)="advanceMessages(true)" [disabled]="!canAdvance">All Messages</button>
            </fieldset>
            <fieldset *ngIf="version !== Version.V0_8" class="theme-controls">
              <legend>Primary color</legend>
              <div class="color-input-group">
                <input
                  type="color"
                  [value]="primaryColor || '#1177ee'"
                  (input)="onColorInput($event)"
                  class="color-input"
                  aria-label="Primary color"
                />
                <button (click)="clearColor()" class="clear-color-btn">Clear</button>
              </div>
            </fieldset>
            <button
              *ngIf="isRightSidebarCollapsed"
              class="icon-btn expand-right-btn"
              (click)="toggleRightSidebar()"
              title="Expand inspector"
              aria-label="Expand inspector"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
          </div>
        </div>
        <div class="canvas-frame">
          <div class="rendered-content" [class.protocol-version-08]="version === Version.V0_8">
            <ng-container *ngIf="surfaceId()">
              <a2ui-v09-surface
                *ngIf="version === Version.V0_9 || version === Version.V1_0"
                [surfaceId]="surfaceId()"
              ></a2ui-v09-surface>
              <a2ui-surface
                *ngIf="version === Version.V0_8"
                [surfaceId]="surfaceId()"
              ></a2ui-surface>
            </ng-container>
            <div *ngIf="!surfaceId()" class="empty-canvas">
              Surface not initialized. Click '+1 Message' to begin.
            </div>
          </div>
        </div>
      </div>

      <!-- Inspect Panel -->
      <div class="inspect-area" [class.collapsed]="isRightSidebarCollapsed">
        <div class="inspect-header">
          <h4>Inspector</h4>
          <button
            class="icon-btn collapse-right-btn"
            (click)="toggleRightSidebar()"
            title="Collapse inspector"
            aria-label="Collapse inspector"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
        <div class="inspect-section surface-section" [class.folded]="isSurfaceMessageFolded">
          <div
            class="section-header"
            (click)="toggleSurfaceMessage()"
            (keydown.enter)="toggleSurfaceMessage()"
            (keydown.space)="toggleSurfaceMessage(); $event.preventDefault()"
            style="cursor: pointer;"
            role="button"
            tabindex="0"
            [attr.aria-expanded]="!isSurfaceMessageFolded"
          >
            <div class="header-left">
              <span class="toggle-icon" [class.expanded]="!isSurfaceMessageFolded">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </span>
              <h4>Create Surface Message</h4>
            </div>
            <div>
              <span class="badge" *ngIf="!messageError">Live</span>
              <span class="badge error-badge" *ngIf="messageError">Invalid</span>
            </div>
          </div>
          <div class="section-content" *ngIf="!isSurfaceMessageFolded">
            <div *ngIf="messageError" class="error-message">
              <span class="error-icon">⚠️</span>
              <span>{{ messageError }}</span>
            </div>
            <textarea
              [value]="currentCreateSurfaceMessageJson"
              (input)="onSurfaceMessageChange($event)"
              (blur)="onSurfaceMessageBlur()"
              (focus)="onSurfaceMessageFocus()"
              aria-label="Create Surface Message JSON"
            ></textarea>
          </div>
        </div>

        <div class="inspect-section data-section" [class.folded]="isDataModelFolded">
          <div
            class="section-header"
            (click)="toggleDataModel()"
            (keydown.enter)="toggleDataModel()"
            (keydown.space)="toggleDataModel(); $event.preventDefault()"
            style="cursor: pointer;"
            role="button"
            tabindex="0"
            [attr.aria-expanded]="!isDataModelFolded"
          >
            <div class="header-left">
              <span class="toggle-icon" [class.expanded]="!isDataModelFolded">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </span>
              <h4>Data Model</h4>
            </div>
            <div>
              <span class="badge" *ngIf="!dataModelError">Live</span>
              <span class="badge error-badge" *ngIf="dataModelError">Invalid</span>
            </div>
          </div>
          <div class="section-content" *ngIf="!isDataModelFolded">
            <div *ngIf="dataModelError" class="error-message">
              <span class="error-icon">⚠️</span>
              <span>{{ dataModelError }}</span>
            </div>
            <textarea
              [value]="currentDataModelJson"
              (input)="onDataModelChange($event)"
              (blur)="onDataModelBlur()"
              (focus)="onDataModelFocus()"
              aria-label="Data Model JSON"
            ></textarea>
          </div>
        </div>

        <div class="inspect-section events-section" [class.folded]="isEventsLogFolded">
          <div
            class="section-header"
            (click)="toggleEventsLog()"
            (keydown.enter)="toggleEventsLog()"
            (keydown.space)="toggleEventsLog(); $event.preventDefault()"
            style="cursor: pointer;"
            role="button"
            tabindex="0"
            [attr.aria-expanded]="!isEventsLogFolded"
          >
            <div class="header-left">
              <span class="toggle-icon" [class.expanded]="!isEventsLogFolded">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </span>
              <h4>Action Logs</h4>
            </div>
            <div>
              <button class="clear-btn" (click)="clearEventsLog(); $event.stopPropagation()">
                Clear
              </button>
            </div>
          </div>
          <div class="section-content" *ngIf="!isEventsLogFolded">
            <div *ngFor="let ev of eventsLog" class="log-item">
              <div class="log-header">
                <span class="log-time">{{ ev.timestamp | date: 'HH:mm:ss.SSS' }}</span>
                <span class="log-type">{{ getActionType(ev.action) }}</span>
              </div>
              <pre class="log-details">{{ ev.action | json }}</pre>
            </div>
            <div *ngIf="eventsLog.length === 0" class="empty-state">No actions logged...</div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .dashboard {
        display: flex;
        height: 100vh;
        width: 100vw;
        font-family: system-ui, sans-serif;
        background-color: #0f172a;
        color: #f1f5f9;
        overflow: hidden;
      }

      /* Sidebar */
      .sidebar {
        width: 250px;
        background-color: #1e293b;
        border-right: 1px solid rgba(148, 163, 184, 0.1);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition:
          width 0.25s cubic-bezier(0.4, 0, 0.2, 1),
          min-width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        flex-shrink: 0;
      }
      .sidebar.collapsed {
        width: 0 !important;
        min-width: 0 !important;
        border-right: none;
        visibility: hidden;
      }
      .sidebar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        background-color: #1e293b;
        flex-shrink: 0;
      }
      .sidebar-header h3 {
        margin: 0;
        color: #38bdf8;
        font-size: 1rem;
      }
      .header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .icon-btn {
        background: transparent;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 4px;
        color: #94a3b8;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        line-height: 1;
        transition: all 0.2s;
      }
      .icon-btn:hover {
        background-color: #334155;
        color: #f8fafc;
        border-color: #475569;
      }
      .icon-btn svg {
        display: block;
      }
      .example-list {
        list-style: none;
        padding: 0;
        margin: 0;
        flex: 1;
        overflow-y: auto;
      }
      .example-list li {
        padding: 16px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.05);
        cursor: pointer;
        transition: background 0.2s;
      }
      .example-list li:hover {
        background: rgba(255, 255, 255, 0.05);
      }
      .example-list li.active {
        background: rgba(56, 189, 248, 0.1);
        border-left: 4px solid #38bdf8;
      }
      .ex-name {
        font-weight: 500;
        color: #f1f5f9;
        font-size: 0.95rem;
        margin-bottom: 4px;
      }
      .ex-desc {
        font-size: 0.8rem;
        color: #94a3b8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Canvas Area */
      .canvas-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        background-color: #0f172a;
        overflow: hidden;
      }
      .canvas-header {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background-color: #1e293b;
        border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        gap: 12px;
        flex-shrink: 0;
        flex-wrap: wrap;
      }
      .canvas-header-left {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }
      .app-brand h1 {
        margin: 0;
        font-size: 1.15rem;
        font-weight: 700;
        white-space: nowrap;
        color: #f8fafc;
      }
      .header-divider {
        width: 1px;
        height: 28px;
        background: #334155;
        flex-shrink: 0;
      }
      .canvas-header-right {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .agent-controls fieldset {
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 8px;
        padding: 4px 8px 6px;
        margin: 0;
      }
      .agent-controls legend {
        font-size: 0.75rem;
        color: #94a3b8;
        padding: 0 4px;
      }
      .version-controls {
        display: flex;
        align-items: center;
      }
      .version-selector {
        display: flex;
        gap: 4px;
      }
      .version-btn {
        background: transparent;
        color: #94a3b8;
        border: none;
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }
      .version-btn:hover {
        color: #f1f5f9;
        background: rgba(255, 255, 255, 0.08);
      }
      .version-btn.active {
        background: #38bdf8;
        color: #0f172a;
      }
      .message-controls {
        display: flex;
        gap: 6px;
        align-items: center;
        font-size: 0.85rem;
        color: #94a3b8;
      }
      .theme-controls {
        font-size: 0.85rem;
        color: #94a3b8;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
      }
      .color-input-group {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .color-input {
        border: none;
        padding: 0;
        width: 24px;
        height: 24px;
        cursor: pointer;
        background: none;
      }
      .message-controls button,
      .clear-color-btn {
        background: #38bdf8;
        color: #0f172a;
        border: none;
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
      }
      .message-controls button:hover,
      .clear-color-btn:hover {
        background: #7dd3fc;
      }
      .message-controls button:disabled,
      .clear-color-btn:disabled {
        background: #475569;
        color: #94a3b8;
        cursor: not-allowed;
      }
      .canvas-header h2 {
        margin: 0;
        font-size: 1.05rem;
        color: #f8fafc;
      }
      .subtitle {
        margin: 2px 0 0;
        font-size: 0.8rem;
        color: #94a3b8;
      }
      .canvas-frame {
        flex: 1;
        padding: 24px;
        overflow-y: auto;
        display: flex;
        justify-content: center;
        align-items: flex-start;
      }
      .rendered-content {
        width: 100%;
        max-width: 600px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 8px;
        padding: 24px;
      }
      .rendered-content.protocol-version-08 {
        --a2ui-color-surface: #1e1e1e;
        background-color: var(--a2ui-color-surface);
        color: #e0e0e0;
      }
      .empty-canvas {
        text-align: center;
        color: #64748b;
      }

      /* Inspect Panel */
      .inspect-area {
        width: 400px;
        background-color: #020617;
        border-left: 1px solid rgba(148, 163, 184, 0.1);
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        transition:
          width 0.25s cubic-bezier(0.4, 0, 0.2, 1),
          min-width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        flex-shrink: 0;
      }
      .inspect-area.collapsed {
        width: 0 !important;
        min-width: 0 !important;
        border-left: none;
        visibility: hidden;
      }
      .inspect-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background-color: #1e293b;
        border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        flex-shrink: 0;
      }
      .inspect-header h4 {
        margin: 0;
        font-size: 0.9rem;
        color: #94a3b8;
        text-transform: uppercase;
        font-weight: 600;
      }
      .inspect-section {
        flex: 1;
        display: flex;
        flex-direction: column;
        border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        overflow: hidden;
        min-height: 0;
      }
      .inspect-section.folded {
        flex: 0 0 auto;
      }
      textarea {
        width: 100%;
        flex: 1;
        min-height: 100px;
        box-sizing: border-box;
        background-color: #0c111b;
        color: #a7f3d0;
        border: 1px solid #1e293b;
        border-radius: 4px;
        font-family: inherit;
        font-size: inherit;
        padding: 8px;
        resize: vertical;
      }

      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        background-color: #1e293b;
        user-select: none;
        flex-shrink: 0;
      }
      .header-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .toggle-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #94a3b8;
        transition: transform 0.2s ease;
      }
      .toggle-icon.expanded {
        transform: rotate(90deg);
      }
      .section-header h4 {
        margin: 0;
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #94a3b8;
      }
      .section-content {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 0.75rem;
        display: flex;
        flex-direction: column;
      }

      .badge {
        background-color: #064e3b;
        color: #34d399;
        font-size: 0.65rem;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 600;
        text-transform: uppercase;
      }
      .error-badge {
        background-color: #7f1d1d;
        color: #fca5a5;
      }
      .error-message {
        color: #fca5a5;
        font-size: 0.75rem;
        margin: 0 0 8px 0;
        font-family: inherit;
        background-color: #7f1d1d;
        border: 1px solid #b91c1c;
        border-radius: 6px;
        padding: 8px 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        box-sizing: border-box;
      }
      .error-icon {
        font-size: 0.9rem;
      }
      .clear-btn {
        background: none;
        border: 1px solid #334155;
        color: #94a3b8;
        font-size: 0.7rem;
        padding: 2px 8px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .clear-btn:hover {
        background-color: #334155;
        color: #f8fafc;
      }

      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-all;
        color: #a7f3d0;
        background-color: #0c111b;
        padding: 8px;
        border-radius: 4px;
        border: 1px solid #1e293b;
        line-height: 1.4;
      }
      .log-item {
        margin-bottom: 12px;
        padding-bottom: 10px;
        border-bottom: 1px solid #1e293b;
      }
      .log-header {
        display: flex;
        justify-content: space-between;
        font-size: 0.7rem;
        color: #64748b;
        margin-bottom: 6px;
      }
      .log-time {
        color: #38bdf8;
        font-weight: 500;
      }
      .log-type {
        padding: 1px 4px;
        background-color: #064e3b;
        color: #6ee7b7;
        border-radius: 2px;
      }
      .log-details {
        background-color: #0c111b;
        border-color: #1e293b;
        color: #94a3b8;
        font-size: 0.7rem;
      }
      .empty-state {
        text-align: center;
        color: #475569;
        margin-top: 24px;
        font-style: italic;
      }
    `,
  ],
  providers: [
    A2uiRendererService,
    {provide: AngularCatalog, useClass: DemoCatalog},
    DemoCatalogV10,
    {provide: CatalogV08, useValue: DEFAULT_CATALOG_V08},
    provideMarkdownRenderer(),
    ActionDispatcher,
    {
      provide: AgentStubService,
      useFactory: (v09: AgentStubV09Service, v08: AgentStubV08Service, version: Version) => {
        return version === Version.V0_8 ? v08 : v09;
      },
      deps: [AgentStubV09Service, AgentStubV08Service, A2UI_VERSION],
    },
    AgentStubV08Service,
    AgentStubV09Service,
    {
      provide: A2UI_RENDERER_CONFIG,
      useFactory: (
        catalog: AngularCatalog,
        catalogV10: DemoCatalogV10,
        dispatcher: ActionDispatcher,
        injectedUniversal: boolean,
      ) => ({
        catalogs: [catalog, catalogV10],
        useUniversalComponents: getUseUniversalComponents() || injectedUniversal,
        actionHandler: (action: A2uiClientAction) => dispatcher.dispatch(action),
      }),
      deps: [AngularCatalog, DemoCatalogV10, ActionDispatcher, A2UI_USE_UNIVERSAL_COMPONENTS],
    },
  ],
})
export class DemoComponent implements OnInit, OnDestroy {
  readonly Version = Version;
  private rendererService = inject(A2uiRendererService);
  private agentStubV09 = inject(AgentStubV09Service);
  private agentStubV08 = inject(AgentStubV08Service);
  private cdr = inject(ChangeDetectorRef);

  private activeVersion = signal<Version>(inject(A2UI_VERSION));
  get version(): Version {
    return this.activeVersion();
  }
  set version(v: Version) {
    this.activeVersion.set(v);
  }

  examples: Array<A2uiExample> = inject(A2UI_EXAMPLES);
  selectedExample: A2uiExample | undefined = undefined;

  private get activeStub(): AgentStubService {
    return this.activeVersion() === Version.V0_8 ? this.agentStubV08 : this.agentStubV09;
  }

  readonly surfaceId = computed(() => this.activeStub.surfaceId());

  processedMessageCount = 0;
  primaryColor = '#1177ee';
  private customMessages: Array<A2uiMessage | ServerToClientMessage> | null = null;

  get totalMessageCount(): number {
    return this.getActiveMessages().length;
  }

  get canAdvance(): boolean {
    return this.processedMessageCount < this.totalMessageCount;
  }

  get eventsLog() {
    return this.activeStub.eventsLog();
  }
  clearEventsLog() {
    this.activeStub.eventsLog.set([]);
  }
  currentCreateSurfaceMessageJson: string = '';
  messageError: string | null = null;
  currentDataModelJson: string = '';
  dataModelError: string | null = null;
  jsonInputFocused = signal(false);

  constructor() {
    effect(() => {
      if (this.jsonInputFocused()) {
        return;
      }
      const data = this.activeStub.dataModel();
      this.currentDataModelJson = JSON.stringify(data, null, 2);
      this.cdr.detectChanges();
    });

    effect(() => {
      if (this.jsonInputFocused()) {
        return;
      }
      const msg = this.activeStub.currentCreateSurfaceMessage();
      this.currentCreateSurfaceMessageJson = msg ? JSON.stringify(msg, null, 2) : '';
      this.cdr.detectChanges();
    });
  }

  private readonly elementRef = inject(ElementRef);

  isDataModelFolded = false;
  isSurfaceMessageFolded = false;
  isEventsLogFolded = false;
  isLeftSidebarCollapsed = false;
  isRightSidebarCollapsed = false;

  private getLocalStorage(key: string): string | null {
    try {
      return typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }

  private setLocalStorage(key: string, value: string) {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(key, value);
      }
    } catch {
      // Ignore localStorage errors in restricted environments
    }
  }

  toggleLeftSidebar() {
    this.isLeftSidebarCollapsed = !this.isLeftSidebarCollapsed;
    this.setLocalStorage('isLeftSidebarCollapsed', String(this.isLeftSidebarCollapsed));
  }

  toggleRightSidebar() {
    this.isRightSidebarCollapsed = !this.isRightSidebarCollapsed;
    this.setLocalStorage('isRightSidebarCollapsed', String(this.isRightSidebarCollapsed));
  }

  toggleDataModel() {
    this.isDataModelFolded = !this.isDataModelFolded;
    this.setLocalStorage('isDataModelFolded', String(this.isDataModelFolded));
  }

  toggleSurfaceMessage() {
    this.isSurfaceMessageFolded = !this.isSurfaceMessageFolded;
    this.setLocalStorage('isSurfaceMessageFolded', String(this.isSurfaceMessageFolded));
  }

  toggleEventsLog() {
    this.isEventsLogFolded = !this.isEventsLogFolded;
    this.setLocalStorage('isEventsLogFolded', String(this.isEventsLogFolded));
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    const activeEl =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const targetEl = event.target as HTMLElement | null;
    const focusedEl = (activeEl && activeEl.isConnected ? activeEl : null) || targetEl;

    if (
      focusedEl &&
      (focusedEl.tagName === 'INPUT' ||
        focusedEl.tagName === 'TEXTAREA' ||
        focusedEl.tagName === 'SELECT' ||
        focusedEl.isContentEditable)
    ) {
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }

    if (event.key === 'j') {
      this.selectNextExample();
      event.preventDefault();
    } else if (event.key === 'k') {
      this.selectPrevExample();
      event.preventDefault();
    }
  }

  selectNextExample() {
    if (!this.examples || this.examples.length === 0) return;
    const currentIndex = this.selectedExample
      ? this.examples.findIndex(ex => ex === this.selectedExample)
      : -1;
    const nextIndex = currentIndex < this.examples.length - 1 ? currentIndex + 1 : 0;
    this.selectExample(this.examples[nextIndex]);
  }

  selectPrevExample() {
    if (!this.examples || this.examples.length === 0) return;
    const currentIndex = this.selectedExample
      ? this.examples.findIndex(ex => ex === this.selectedExample)
      : -1;
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : this.examples.length - 1;
    this.selectExample(this.examples[prevIndex]);
  }

  ngOnInit(): void {
    this.isDataModelFolded = this.getLocalStorage('isDataModelFolded') === 'true';
    this.isSurfaceMessageFolded = this.getLocalStorage('isSurfaceMessageFolded') === 'true';
    this.isEventsLogFolded = this.getLocalStorage('isEventsLogFolded') === 'true';
    this.isLeftSidebarCollapsed = this.getLocalStorage('isLeftSidebarCollapsed') === 'true';
    this.isRightSidebarCollapsed = this.getLocalStorage('isRightSidebarCollapsed') === 'true';
    this.selectExampleFromUrl();
  }

  /**
   * Switches the active specification version in-place without a full page reload.
   */
  setVersion(newVersion: Version) {
    if (this.version === newVersion) return;
    const prevFilename = this.selectedExample?.filename;
    const prevName = this.selectedExample?.name;

    this.activeStub.resetSurface(
      this.getActiveMessages() as A2uiMessage[] | ServerToClientMessage[],
    );
    this.version = newVersion;
    this.examples =
      newVersion === Version.V1_0
        ? EXAMPLES_V10
        : newVersion === Version.V0_9
          ? EXAMPLES_V09
          : EXAMPLES_V08;

    const matched =
      this.examples.find(
        ex => (prevFilename && ex.filename === prevFilename) || ex.name === prevName,
      ) ?? this.examples[0];
    if (matched) {
      this.selectExample(matched);
    }
    this.syncUrl();
  }

  private syncUrl() {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('version', this.version);
      if (this.selectedExample) {
        url.hash = this.slugify(this.selectedExample.name);
      }
      window.history.replaceState(null, '', url.toString());
    } catch {
      // Ignore URL update errors in test environments
    }
  }

  private getActiveMessages(): Array<A2uiMessage | ServerToClientMessage> {
    if (this.customMessages) {
      return this.customMessages;
    }
    return (this.selectedExample?.messages ?? []) as Array<A2uiMessage | ServerToClientMessage>;
  }

  private applyPrimaryColor(
    messages: Array<A2uiMessage | ServerToClientMessage>,
  ): Array<A2uiMessage | ServerToClientMessage> {
    if (!this.primaryColor || this.version !== Version.V0_9) {
      return messages;
    }
    return messages.map(msg => {
      if (
        'createSurface' in msg &&
        (msg as {version?: string}).version !== 'v1.0' &&
        msg.createSurface
      ) {
        return {
          ...msg,
          createSurface: {
            ...msg.createSurface,
            theme: {
              ...msg.createSurface.theme,
              primaryColor: this.primaryColor,
            },
          },
        };
      }
      return msg;
    });
  }

  selectExample(example: A2uiExample) {
    this.selectedExample = example;
    this.customMessages = null;
    this.messageError = null;
    this.dataModelError = null;
    if (typeof window !== 'undefined') {
      window.location.hash = this.slugify(example.name);
    }

    const activeMessages = this.applyPrimaryColor(
      example.messages as Array<A2uiMessage | ServerToClientMessage>,
    );
    this.processedMessageCount = activeMessages.length;
    this.activeStub.initializeDemo(activeMessages as A2uiMessage[] | ServerToClientMessage[]);
    this.cdr.detectChanges();
    this.scrollToActiveExample();
  }

  resetSurface() {
    this.processedMessageCount = 0;
    this.activeStub.resetSurface(
      this.getActiveMessages() as A2uiMessage[] | ServerToClientMessage[],
    );
    this.cdr.detectChanges();
  }

  advanceMessages(all: boolean) {
    const messages = this.getActiveMessages();
    if (messages.length === 0) return;

    const toProcess = all
      ? messages.slice(this.processedMessageCount)
      : messages.slice(this.processedMessageCount, this.processedMessageCount + 1);
    if (toProcess.length === 0) return;

    const modifiedToProcess = this.applyPrimaryColor(toProcess);
    this.activeStub.processIncrementalMessages(
      modifiedToProcess as A2uiMessage[] | ServerToClientMessage[],
    );
    this.processedMessageCount += toProcess.length;
    this.cdr.detectChanges();
  }

  onColorInput(event: Event) {
    const input = event.target as HTMLInputElement;
    this.primaryColor = input.value;
    this.reloadActiveExample();
  }

  clearColor() {
    this.primaryColor = '';
    this.reloadActiveExample();
  }

  private reloadActiveExample() {
    const messages = this.applyPrimaryColor(this.getActiveMessages());
    this.processedMessageCount = messages.length;
    this.activeStub.initializeDemo(messages as A2uiMessage[] | ServerToClientMessage[]);
    this.cdr.detectChanges();
  }

  private scrollToActiveExample() {
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        const activeEl = this.elementRef.nativeElement.querySelector('.example-list li.active');
        activeEl?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
      }, 0);
    }
  }

  /** Gets a display string for the action type. */
  getActionType(action: A2uiClientAction): string {
    return action.name || 'Action';
  }

  /**
   * Handles user input in the message editor.
   * Reloads the UI live on every valid input.
   */
  onSurfaceMessageChange(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    const newValue = textarea.value;
    this.currentCreateSurfaceMessageJson = newValue;

    try {
      const parsed = JSON.parse(newValue);
      this.messageError = null;

      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        !('createSurface' in parsed) ||
        !this.selectedExample
      ) {
        return;
      }

      const updatedMessages = this.getActiveMessages().map(m =>
        'createSurface' in m ? parsed : m,
      );
      this.customMessages = updatedMessages;
      this.processedMessageCount = updatedMessages.length;

      // Re-initialize the demo with the updated messages
      this.activeStub.initializeDemo(updatedMessages as A2uiMessage[] | ServerToClientMessage[]);
      this.cdr.detectChanges();
    } catch (e) {
      this.messageError = e instanceof Error ? e.message : 'Invalid JSON';
      console.error(e);
    }
  }

  onSurfaceMessageFocus() {
    this.jsonInputFocused.set(true);
  }

  onSurfaceMessageBlur() {
    this.jsonInputFocused.set(false);
    try {
      const parsed = JSON.parse(this.currentCreateSurfaceMessageJson);
      this.currentCreateSurfaceMessageJson = JSON.stringify(parsed, null, 2);
    } catch {
      // Ignore if invalid, don't format
    }
  }

  /**
   * Handles user input in the data model editor.
   * Updates the surface data model live.
   */
  onDataModelChange(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    const newValue = textarea.value;
    this.currentDataModelJson = newValue;

    try {
      const parsed = JSON.parse(newValue);
      this.dataModelError = null;
      const surface = this.rendererService.surfaceGroup?.getSurface(this.surfaceId());
      surface?.dataModel.set('/', parsed);
    } catch (e) {
      this.dataModelError = e instanceof Error ? e.message : 'Invalid JSON';
      console.error(e);
    }
  }
  onDataModelFocus() {
    this.jsonInputFocused.set(true);
  }

  onDataModelBlur() {
    this.jsonInputFocused.set(false);
    try {
      const parsed = JSON.parse(this.currentDataModelJson);
      this.currentDataModelJson = JSON.stringify(parsed, null, 2);
    } catch {
      // Ignore if invalid, don't format
    }
  }

  ngOnDestroy(): void {}

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private selectExampleFromUrl(): void {
    const hash = window.location.hash.substring(1) || '';
    const example: A2uiExample | undefined =
      this.examples.find(
        ex =>
          this.slugify(ex.name) === hash ||
          ex.filename === hash ||
          ex.filename?.replace('.json', '') === hash,
      ) || this.examples[0];
    if (!example) return;
    this.selectExample(example);
  }
}
