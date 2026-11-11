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

import {USE_CASES} from '../use_cases';
import {UseCaseGlyph} from './glyphs';

/** The first screen: what the demo does, and the three use cases as suggested prompts. */
export function EmptyState({onPick}: {onPick: (prompt: string) => void}) {
  return (
    <section className="empty" data-testid="empty-state">
      <p className="eyebrow">A2UI · ReactApp prototype</p>
      <h1 className="empty-title">
        Ask for an interface, <em>get one that works.</em>
      </h1>
      <p className="empty-lede">
        The agent answers with native A2UI components, and writes a small React app for the part
        they can't express. The app runs sandboxed next to them and shares their data.
      </p>
      <ul className="use-cases" aria-label="Suggested prompts">
        {USE_CASES.map(useCase => (
          <li key={useCase.id}>
            <button
              type="button"
              className="use-case"
              data-testid={`chip-${useCase.id}`}
              onClick={() => onPick(useCase.prompt)}
            >
              <UseCaseGlyph id={useCase.id} />
              <span className="use-case-title">{useCase.title}</span>
              <span className="use-case-blurb">{useCase.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
