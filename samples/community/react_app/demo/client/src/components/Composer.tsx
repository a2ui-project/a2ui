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

import {useState, type FormEvent, type KeyboardEvent} from 'react';
import {USE_CASES} from '../use_cases';
import {SendArrow} from './glyphs';

interface ComposerProps {
  busy: boolean;
  /** After the first turn, the suggestions shrink to a row of small chips. */
  compact: boolean;
  onSend: (text: string) => void;
}

/** The prompt box pinned to the bottom of the page. */
export function Composer({busy, compact, onSend}: ComposerProps) {
  const [text, setText] = useState('');

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const prompt = text.trim();
    if (!prompt || busy) {
      return;
    }
    onSend(prompt);
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      submit();
    }
  };

  return (
    <div className="composer-dock">
      <form className="composer" onSubmit={submit}>
        {compact && (
          <div className="chips" aria-label="Suggested prompts">
            {USE_CASES.map(useCase => (
              <button
                key={useCase.id}
                type="button"
                className="chip"
                disabled={busy}
                data-testid={`chip-small-${useCase.id}`}
                onClick={() => onSend(useCase.prompt)}
              >
                {useCase.title}
              </button>
            ))}
          </div>
        )}
        <div className="composer-box">
          <label className="visually-hidden" htmlFor="prompt">
            Ask for an interface
          </label>
          <textarea
            id="prompt"
            rows={1}
            value={text}
            placeholder="Ask for an interface: a calculator, a planner, a chart you can poke…"
            data-testid="prompt-input"
            onChange={event => setText(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="submit"
            className="send"
            disabled={busy || !text.trim()}
            aria-label="Send"
            data-testid="send"
          >
            <SendArrow />
          </button>
        </div>
      </form>
    </div>
  );
}
