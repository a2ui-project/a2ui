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

import {useState, type FormEvent} from 'react';

export function PromptChips({
  prompts,
  disabled,
  onPick,
  large = false,
}: {
  prompts: string[];
  disabled: boolean;
  onPick: (prompt: string) => void;
  large?: boolean;
}) {
  return (
    <div className={large ? 'ln-chips ln-chips-large' : 'ln-chips'} aria-label="Example prompts">
      {prompts.map(prompt => (
        <button
          key={prompt}
          className="ln-chip"
          data-testid="prompt-chip"
          disabled={disabled}
          onClick={() => onPick(prompt)}
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}

export function Composer({disabled, onSend}: {disabled: boolean; onSend: (text: string) => void}) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const prompt = text.trim();
    if (!prompt || disabled) return;
    onSend(prompt);
    setText('');
  };
  return (
    <form className="ln-composer" onSubmit={submit}>
      <input
        aria-label="Ask about an artist"
        placeholder="Ask about an artist, an album or a tour…"
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <button type="submit" disabled={disabled || !text.trim()}>
        Ask
      </button>
    </form>
  );
}
