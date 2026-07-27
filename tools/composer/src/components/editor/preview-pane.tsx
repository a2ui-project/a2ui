/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use client';

import {useState, Component, type ReactNode} from 'react';
import {Moon, Sun, AlertTriangle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {A2UIViewer} from '@/lib/a2ui';
import type {A2UIComponent, SpecVersion} from '@/types/widget';

/**
 * Error boundary for the A2UI preview.
 * Catches render errors (e.g. invalid component references, Zod validation)
 * and shows a fallback instead of crashing the entire editor.
 */
class PreviewErrorBoundary extends Component<
  {children: ReactNode; resetKey: string},
  {error: Error | null}
> {
  state: {error: Error | null} = {error: null};

  static getDerivedStateFromError(error: Error) {
    return {error};
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('A2UI Preview Error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: {resetKey: string}) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({error: null});
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-muted-foreground">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium">Preview unavailable</p>
          <p className="text-xs text-center max-w-xs">
            {this.state.error.message.length > 200
              ? this.state.error.message.substring(0, 200) + '...'
              : this.state.error.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

interface PreviewPaneProps {
  root: string;
  components: A2UIComponent[];
  data: Record<string, unknown>;
  specVersion?: SpecVersion;
}

export function PreviewPane({root, components, data, specVersion}: PreviewPaneProps) {
  const [isDark, setIsDark] = useState(false);

  // Reset key changes when components change, clearing the error boundary
  const resetKey = JSON.stringify(components);

  return (
    <div
      className={`flex h-full flex-col border-l border-border ${isDark ? 'bg-neutral-900' : 'bg-neutral-50'}`}
    >
      <div className="flex justify-end p-2">
        <Button
          variant="ghost"
          size="icon"
          className={`h-8 w-8 rounded-lg ${isDark ? 'bg-neutral-800 hover:bg-neutral-700' : 'bg-white hover:bg-neutral-100 border border-neutral-200'}`}
          onClick={() => setIsDark(!isDark)}
        >
          {isDark ? (
            <Sun className="h-4 w-4 text-neutral-400" />
          ) : (
            <Moon className="h-4 w-4 text-neutral-400" />
          )}
        </Button>
      </div>
      <div className="flex flex-1 items-start justify-center p-8 overflow-auto">
        <PreviewErrorBoundary resetKey={resetKey}>
          <A2UIViewer
            root={root}
            components={components}
            data={data}
            specVersion={specVersion}
            onAction={action => console.log('Widget action:', action)}
          />
        </PreviewErrorBoundary>
      </div>
    </div>
  );
}
