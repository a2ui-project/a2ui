/* eslint-disable @typescript-eslint/no-explicit-any */ // TODO: remediate legacy any types
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

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, act} from '@testing-library/react';
import {WidgetEditor} from './widget-editor';
import {useWidgets} from '@/contexts/widgets-context';
import type {Widget} from '@/types/widget';
import {useFrontendTool} from '@copilotkit/react-core/v2';
import React from 'react';

// Mock child components
vi.mock('./editor-header', () => ({
  EditorHeader: () => <div data-testid="editor-header" />,
}));
vi.mock('./code-editor', () => ({
  CodeEditor: ({value, onChange}: any) => (
    <textarea data-testid="code-editor" value={value} onChange={e => onChange(e.target.value)} />
  ),
}));
vi.mock('./preview-pane', () => ({
  PreviewPane: () => <div data-testid="preview-pane" />,
}));
vi.mock('./data-panel', () => ({
  DataPanel: () => <div data-testid="data-panel" />,
}));

// Mock CopilotKit hooks
vi.mock('@copilotkit/react-core/v2', () => ({
  useAgentContext: vi.fn(),
  useFrontendTool: vi.fn(),
  CopilotChat: () => <div data-testid="copilot-chat" />,
}));

// Mock Resizable components
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({children}: any) => <div>{children}</div>,
  ResizablePanel: ({children}: any) => <div>{children}</div>,
  ResizableHandle: () => <div>Handle</div>,
}));

// Mock WidgetsContext
vi.mock('@/contexts/widgets-context', () => ({
  useWidgets: vi.fn(),
}));

describe('WidgetEditor', () => {
  const mockWidget: Widget = {
    id: '1',
    name: 'Test Widget',
    specVersion: '0.8',
    root: 'root',
    components: [],
    dataStates: [{name: 'default', data: {}}],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUpdateWidget = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useWidgets).mockReturnValue({
      updateWidget: mockUpdateWidget,
    } as any);
  });

  it('should render all editor components', () => {
    render(<WidgetEditor widget={mockWidget} />);
    expect(screen.getByTestId('editor-header')).toBeInTheDocument();
    expect(screen.getByTestId('code-editor')).toBeInTheDocument();
    expect(screen.getByTestId('preview-pane')).toBeInTheDocument();
    expect(screen.getByTestId('data-panel')).toBeInTheDocument();
    expect(screen.getByTestId('copilot-chat')).toBeInTheDocument();
  });

  it('should register the editWidget tool', () => {
    render(<WidgetEditor widget={mockWidget} />);
    expect(useFrontendTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'editWidget',
      }),
    );
  });

  it('should update components when code editor changes', async () => {
    render(<WidgetEditor widget={mockWidget} />);
    const editor = screen.getByTestId('code-editor');

    await act(async () => {
      fireEvent.change(editor, {target: {value: '[{"id": "new"}]'}});
    });

    expect(mockUpdateWidget).toHaveBeenCalledWith('1', {components: [{id: 'new'}]});
  });

  it('should handle editWidget tool calls', async () => {
    let toolHandler: any;
    vi.mocked(useFrontendTool).mockImplementation((config: any) => {
      toolHandler = config.handler;
      return {} as any;
    });

    render(<WidgetEditor widget={mockWidget} />);

    const result = await act(async () => {
      return await toolHandler({data: '{"foo": "bar"}', components: '[{"id": "root"}]'});
    });

    expect(result.success).toBe(true);
    expect(mockUpdateWidget).toHaveBeenCalledWith('1', {components: [{id: 'root'}]});
  });
});

// Helper for fireEvent
import {fireEvent} from '@testing-library/react';
