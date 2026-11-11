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

const STAGES = [
  {name: 'Model', detail: 'gemini-3.5-flash streams Express text', side: 'agent'},
  {name: 'Express stream', detail: 'compiles statements to A2UI as they close', side: 'agent'},
  {name: 'ReactAppTransformer', detail: 'checks each ReactApp; one retry on errors', side: 'agent'},
  {name: 'A2UI over SSE', detail: 'one event per message, plus timing and debug', side: 'wire'},
  {name: 'Renderer', detail: 'MessageProcessor and @a2ui/react paint natives', side: 'page'},
  {name: 'Sandbox', detail: 'proxy frame, then an opaque app frame', side: 'page'},
  {name: 'ReactApp', detail: 'runtime transpiles the TSX and renders it', side: 'frame'},
] as const;

const DOCS = [
  ['README.md', 'Overview and integration guide'],
  ['docs/bridge_protocol.md', 'The postMessage bridge, normative'],
  ['docs/use_cases.md', 'The three use cases, traced step by step'],
  ['catalog/v1/catalog.json', 'The ReactApp component'],
] as const;

/** A one-screen explanation of the system, opened from the header. */
export function AboutPanel({onClose}: {onClose: () => void}) {
  return (
    <section className="about" data-testid="about-panel" aria-label="About this demo">
      <div className="about-inner">
        <div className="about-head">
          <h2>How a turn becomes a working interface</h2>
          <button type="button" className="text-button" onClick={onClose}>
            Close
          </button>
        </div>
        <ol className="pipeline">
          {STAGES.map((stage, index) => (
            <li key={stage.name} className={`stage stage-${stage.side}`}>
              <span className="stage-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="stage-name">{stage.name}</span>
              <span className="stage-detail">{stage.detail}</span>
            </li>
          ))}
        </ol>
        <div className="loops">
          <p>
            <span className="loop-label">Bridge</span>
            The app talks JSON-RPC over <code>postMessage</code>: it reads and writes data model
            paths (<code>data/get</code>, <code>data/set</code>, <code>data/changed</code>), calls
            functions (<code>function/call</code>) and reports <code>ui/rendered</code>. Native
            components bound to the same paths update with it.
          </p>
          <p>
            <span className="loop-label">Agent functions</span>A call the catalogs don&apos;t
            implement in the browser goes back to the agent as <code>callAgentFunction</code>, and
            the answer comes back as <code>agentFunctionResponse</code>.
          </p>
        </div>
        <p className="about-docs-title">Read more in samples/community/react_app/</p>
        <ul className="about-docs">
          {DOCS.map(([path, label]) => (
            <li key={path}>
              <code>{path}</code>
              <span>{label}</span>
            </li>
          ))}
        </ul>
        <p className="about-hint">
          Under every answer, <em>How this was built</em> shows the raw model output, the A2UI
          messages, the app&apos;s source, the live bridge traffic, the data model and the timings.
        </p>
      </div>
    </section>
  );
}
