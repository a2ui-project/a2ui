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

import {Component, useLayoutEffect, type ComponentType, type ReactNode} from 'react';

/** What the error card shows. */
export interface ErrorCardProps {
  readonly title: string;
  readonly heading: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly source?: string;
}

/** The lines around `line` (1-based), with a marker under the column. */
export function codeFrame(source: string, line: number, column?: number): string {
  const lines = source.split('\n');
  const start = Math.max(1, line - 2);
  const end = Math.min(lines.length, line + 2);
  const width = String(end).length;
  const out: string[] = [];
  for (let n = start; n <= end; n++) {
    out.push(`${n === line ? '>' : ' '} ${String(n).padStart(width)} | ${lines[n - 1]}`);
    if (n === line && column !== undefined) {
      out.push(`  ${' '.repeat(width)} | ${' '.repeat(Math.max(0, column - 1))}^`);
    }
  }
  return out.join('\n');
}

/** The card shown in place of the app when it fails to compile, load or render. */
export function ErrorCard(props: ErrorCardProps) {
  const {title, heading, message, line, source} = props;
  return (
    <div className="a2ui-error-card" role="alert">
      <h3>{title}</h3>
      <p>
        <strong>{heading}</strong>
      </p>
      <pre>{message}</pre>
      {source !== undefined && line !== undefined && (
        <pre>{codeFrame(source, line, props.column)}</pre>
      )}
    </div>
  );
}

interface BoundaryProps {
  readonly title: string;
  readonly onError: (error: Error) => void;
  readonly children: ReactNode;
}

/** Catches render errors of the app and shows the error card instead. */
export class AppErrorBoundary extends Component<BoundaryProps, {error: Error | null}> {
  override state: {error: Error | null} = {error: null};

  static getDerivedStateFromError(error: unknown) {
    return {error: error instanceof Error ? error : new Error(String(error))};
  }

  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  override render() {
    if (this.state.error) {
      return (
        <ErrorCard
          title={this.props.title}
          heading="The app stopped with an error."
          message={this.state.error.message}
        />
      );
    }
    return this.props.children;
  }
}

/** Renders the app and reports its first commit; the probe's layout effect runs after the app's. */
export function AppRoot(props: {
  readonly app: ComponentType;
  readonly title: string;
  readonly onError: (error: Error) => void;
  readonly onCommit: () => void;
}) {
  const {app: App, title, onError, onCommit} = props;
  return (
    <AppErrorBoundary title={title} onError={onError}>
      <App />
      <CommitProbe onCommit={onCommit} />
    </AppErrorBoundary>
  );
}

function CommitProbe({onCommit}: {readonly onCommit: () => void}) {
  useLayoutEffect(() => {
    onCommit();
    // Only the first commit counts.
  }, []);
  return null;
}
