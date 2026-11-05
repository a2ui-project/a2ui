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

import type {AgentInfo, MacroInfo} from '../api';

export function MacroLibrary({info, macros}: {info?: AgentInfo; macros: MacroInfo[]}) {
  return (
    <aside className="ln-sidebar" aria-label="About this demo">
      <section>
        <h2>How it works</h2>
        <p>
          The model writes a few high-level <strong>macros</strong> in the Express DSL. The Python
          server expands them into <strong>basic</strong> and <strong>music</strong> catalog
          components, then streams A2UI v1.0 messages to this React client.
        </p>
        {info && (
          <p className="ln-mode" data-testid="mode-badge">
            {info.mode === 'live' ? `Live · ${info.model}` : 'Scripted mode (no API key)'}
          </p>
        )}
      </section>
      <section>
        <h2>Macro library</h2>
        <ul className="ln-macros" data-testid="macro-library">
          {macros.map(m => (
            <li key={m.name}>
              <code>
                {m.name}({m.parameters.join(', ')})
              </code>
              <p>{m.description}</p>
              <div className="ln-macro-uses">
                {m.basicComponents.map(c => (
                  <span key={c} className="ln-use ln-use-basic">
                    {c}
                  </span>
                ))}
                {m.musicComponents.map(c => (
                  <span key={c} className="ln-use ln-use-music">
                    {c}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <p className="ln-legend">
          <span className="ln-use ln-use-basic">basic</span>{' '}
          <span className="ln-use ln-use-music">music</span> catalog components each macro expands
          into.
        </p>
      </section>
    </aside>
  );
}
