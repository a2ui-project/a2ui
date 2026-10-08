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

  h1 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    white-space: nowrap;
    color: #f8fafc;
  }

  p.subtitle {
    color: #94a3b8;
    margin: 2px 0 0 0;
    font-size: 0.8rem;
  }

  main {
    flex: 1;
    display: flex;
    overflow: hidden;
    height: 100vh;
  }

  .nav-pane {
    width: 250px;
    background: #1e293b;
    border-right: 1px solid rgba(148, 163, 184, 0.1);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition:
      width 0.25s cubic-bezier(0.4, 0, 0.2, 1),
      min-width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    flex-shrink: 0;
  }

  .nav-pane.collapsed {
    width: 0 !important;
    min-width: 0 !important;
    border-right: none;
    visibility: hidden;
  }

  .nav-header {
    padding: 12px 16px;
    background: #1e293b;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }

  .nav-header h3 {
    margin: 0;
    font-size: 1rem;
    color: #38bdf8;
  }

  .nav-list {
    flex: 1;
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

  .gallery-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: #0f172a;
    overflow: hidden;
  }

  .preview-header {
    padding: 12px 16px;
    background: #1e293b;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .preview-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .app-brand {
    display: flex;
    align-items: center;
  }

  .example-info {
    min-width: 0;
  }

  .example-info h2 {
    margin: 0;
    font-size: 1.05rem;
    color: #f8fafc;
  }

  .agent-controls {
    display: flex;
    gap: 8px;
    align-items: center;
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

  .message-controls {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 0.85rem;
    color: #94a3b8;
  }

  .message-controls button,
  .clear-btn {
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
  .clear-btn:hover {
    background: #7dd3fc;
  }

  .message-controls button:disabled,
  .clear-btn:disabled {
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
    align-items: flex-start;
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
    overflow: hidden;
    transition:
      width 0.25s cubic-bezier(0.4, 0, 0.2, 1),
      min-width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    flex-shrink: 0;
  }

  .inspector-pane.collapsed {
    width: 0 !important;
    min-width: 0 !important;
    border-left: none;
    visibility: hidden;
  }

  .inspector-pane-header {
    padding: 12px 16px;
    background: #1e293b;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    flex-shrink: 0;
  }

  .inspector-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    overflow: hidden;
    min-height: 0;
  }

  .inspector-section.folded {
    flex: 0 0 auto;
  }

  .inspector-header {
    padding: 10px 16px;
    background: #1e293b;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
  }

  .inspector-header h4 {
    margin: 0;
    font-weight: 600;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #94a3b8;
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

  .badge {
    background-color: #064e3b;
    color: #34d399;
    font-size: 0.65rem;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .badge.error-badge {
    background-color: #7f1d1d;
    color: #fca5a5;
  }

  .clear-logs-btn {
    background: none;
    border: 1px solid #334155;
    color: #94a3b8;
    font-size: 0.7rem;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .clear-logs-btn:hover {
    background-color: #334155;
    color: #f8fafc;
  }

  .inspector-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.75rem;
    display: flex;
    flex-direction: column;
  }

  .inspector-body textarea {
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
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    background-color: #0c111b;
    border: 1px solid #1e293b;
    border-radius: 4px;
    padding: 8px;
    color: #94a3b8;
    font-size: 0.7rem;
  }

  .empty-state {
    text-align: center;
    color: #475569;
    margin-top: 24px;
    font-style: italic;
  }
`;
