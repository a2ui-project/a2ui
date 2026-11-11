/*
 * Copyright 2026 Google LLC
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

interface HeaderProps {
  showInternals: boolean;
  onShowInternalsChange: (value: boolean) => void;
  aboutOpen: boolean;
  onAboutToggle: () => void;
  toolsOpen: boolean;
  onToolsToggle: () => void;
}

export function Header({
  showInternals,
  onShowInternalsChange,
  aboutOpen,
  onAboutToggle,
  toolsOpen,
  onToolsToggle,
}: HeaderProps) {
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <a className="wordmark" href="/" aria-label="Margin, home">
          <span className="wordmark-name">Margin</span>
          <span className="wordmark-tag">apps written in the margin of a chat</span>
        </a>
        <nav className="masthead-actions" aria-label="Demo controls">
          <button
            type="button"
            className="text-button"
            aria-expanded={toolsOpen}
            data-testid="tools-toggle"
            onClick={onToolsToggle}
          >
            Tools &amp; Data
          </button>
          <button
            type="button"
            className="text-button"
            aria-expanded={aboutOpen}
            data-testid="about-toggle"
            onClick={onAboutToggle}
          >
            About<span className="wide-only"> this demo</span>
          </button>
          <label className="switch" data-testid="show-internals">
            <input
              type="checkbox"
              role="switch"
              aria-label="Show internals"
              checked={showInternals}
              onChange={event => onShowInternalsChange(event.target.checked)}
            />
            <span className="switch-track" aria-hidden="true">
              <span className="switch-thumb" />
            </span>
            <span className="switch-label" aria-hidden="true">
              <span className="wide-only">Show </span>internals
            </span>
          </label>
        </nav>
      </div>
    </header>
  );
}
