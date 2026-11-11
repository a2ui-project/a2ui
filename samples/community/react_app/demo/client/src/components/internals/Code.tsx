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

import type {ReactNode} from 'react';
import type {Token} from '../../services/highlight';

/** Renders highlighted tokens; `renderToken` can replace any token (used to fold code). */
export function Code({
  tokens,
  lineNumbers = false,
  renderToken,
  testId,
}: {
  tokens: readonly Token[];
  lineNumbers?: boolean;
  renderToken?: (token: Token, index: number) => ReactNode | undefined;
  testId?: string;
}) {
  const body = tokens.map(
    (token, index) =>
      renderToken?.(token, index) ?? (
        <span key={index} className={`tok tok-${token.kind}`}>
          {token.text}
        </span>
      ),
  );
  if (!lineNumbers) {
    return (
      <pre className="code" data-testid={testId}>
        {body}
      </pre>
    );
  }
  const lines = tokens.reduce((count, token) => count + (token.text.match(/\n/g)?.length ?? 0), 1);
  return (
    <pre className="code code-numbered" data-testid={testId}>
      <span className="code-gutter" aria-hidden="true">
        {Array.from({length: lines}, (_, index) => `${index + 1}\n`).join('')}
      </span>
      <span className="code-body">{body}</span>
    </pre>
  );
}

/** What a tab shows before the turn has the data it needs. */
export function TabEmpty({children}: {children: ReactNode}) {
  return <p className="tab-empty">{children}</p>;
}
