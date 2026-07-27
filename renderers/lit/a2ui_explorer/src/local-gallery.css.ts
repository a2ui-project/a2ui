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

import {css} from 'lit';

/**
 * Styles for the LocalGallery component.
 *
 * Defines the layout, theme colors, and component specific styles for the
 * explorer application.
 */
export const appStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background: #0f172a;
    color: #f1f5f9;
    font-family: system-ui, sans-serif;
  }

  header {
    padding: 16px 24px;
    background: rgba(15, 23, 42, 0.8);
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
  }
  p.subtitle {
    color: #94a3b8;
    margin: 4px 0 0 0;
    font-size: 0.9rem;
  }

  main {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .nav-pane {
    width: 250px;
    background: #1e293b;
    border-right: 1px solid rgba(148, 163, 184, 0.1);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .nav-item {
    padding: 16px;
    cursor: pointer;
    border-bottom: 1px solid rgba(148, 163, 184, 0.05);
    transition: background 0.2s;
  }

  .nav-item:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .nav-item.active {
    background: rgba(56, 189, 248, 0.1);
    border-left: 4px solid #38bdf8;
  }

  .nav-title {
    margin: 0 0 4px 0;
    font-size: 0.95rem;
    font-weight: 500;
  }
  .nav-desc {
    margin: 0;
    font-size: 0.8rem;
    color: #94a3b8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .gallery-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: #0f172a;
    overflow: hidden;
  }

  .preview-header {
    padding: 16px;
    background: #1e293b;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;

    h2 {
      margin: 0;
    }
  }

  .agent-controls {
    display: flex;
    gap: 8px;
    justify-content: space-between;

    fieldset {
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 8px;
    }

    .theme-controls {
      font-size: 0.9rem;
      margin-right: 8px;
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

    .message-controls {
      display: flex;
      gap: 8px;
      align-items: center;
      font-size: 0.9rem;
      color: #94a3b8;
    }
  }

  button {
    background: #38bdf8;
    color: #0f172a;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover {
    background: #7dd3fc;
  }
  button:disabled {
    background: #475569;
    color: #94a3b8;
    cursor: not-allowed;
  }

  .preview-content {
    flex: 1;
    padding: 24px;
    overflow-y: auto;
    display: flex;
    justify-content: center;
  }

  .surface-container {
    width: 100%;
    max-width: 600px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    padding: 24px;
  }

  .inspector-pane {
    width: 400px;
    display: flex;
    flex-direction: column;
    border-left: 1px solid rgba(148, 163, 184, 0.1);
    background: #020617;
  }

  .inspector-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    overflow: hidden;
  }

  .inspector-header {
    padding: 12px 16px;
    background: #1e293b;
    font-weight: bold;
    font-size: 0.8rem;
    text-transform: uppercase;
    color: #94a3b8;
  }

  .inspector-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.8rem;
    white-space: pre-wrap;
  }

  .log-list {
    display: flex;
    flex-direction: column-reverse;
    gap: 8px;
  }

  .log-entry {
    padding: 8px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 4px;
    border-left: 2px solid #38bdf8;
  }
`;
