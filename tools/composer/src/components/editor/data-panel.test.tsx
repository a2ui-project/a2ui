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
import {render, screen, fireEvent} from '@testing-library/react';
import {DataPanel} from './data-panel';
import React from 'react';

// Mock Monaco Editor
vi.mock('@monaco-editor/react', () => ({
  default: ({value, onChange}: any) => (
    <textarea data-testid="monaco-mock" value={value} onChange={e => onChange(e.target.value)} />
  ),
}));

// Mock lucide-react to have identifiable elements
vi.mock('lucide-react', () => ({
  Plus: () => <span data-testid="plus-icon" />,
  X: () => <span data-testid="x-icon" />,
}));

describe('DataPanel', () => {
  const mockStates = [
    {name: 'State 1', data: {a: 1}},
    {name: 'State 2', data: {b: 2}},
  ];

  const mockProps = {
    dataStates: mockStates,
    activeIndex: 0,
    onActiveIndexChange: vi.fn(),
    onAddState: vi.fn(),
    onUpdateState: vi.fn(),
    onRenameState: vi.fn(),
    onDeleteState: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all state tabs', () => {
    render(<DataPanel {...mockProps} />);
    expect(screen.getByText('State 1')).toBeInTheDocument();
    expect(screen.getByText('State 2')).toBeInTheDocument();
  });

  it('should call onActiveIndexChange when clicking a tab', () => {
    render(<DataPanel {...mockProps} />);
    fireEvent.click(screen.getByText('State 2'));
    expect(mockProps.onActiveIndexChange).toHaveBeenCalledWith(1);
  });

  it('should call onAddState when clicking the plus button', () => {
    render(<DataPanel {...mockProps} />);
    const plusIcon = screen.getByTestId('plus-icon');
    const addButton = plusIcon.closest('button')!;
    fireEvent.click(addButton);
    expect(mockProps.onAddState).toHaveBeenCalled();
  });

  it('should update state when JSON is edited', () => {
    render(<DataPanel {...mockProps} />);
    const editor = screen.getByTestId('monaco-mock');
    fireEvent.change(editor, {target: {value: '{"new": "data"}'}});
    expect(mockProps.onUpdateState).toHaveBeenCalledWith(0, {new: 'data'});
  });

  it('should call onRenameState when a tab is double clicked', () => {
    global.prompt = vi.fn().mockReturnValue('New Name');
    render(<DataPanel {...mockProps} />);
    fireEvent.doubleClick(screen.getByText('State 1'));
    expect(mockProps.onRenameState).toHaveBeenCalledWith(0, 'New Name');
  });

  it('should call onDeleteState when the X button is clicked', () => {
    render(<DataPanel {...mockProps} />);
    // State 2 (index 1) should have an X button
    const xIcons = screen.getAllByTestId('x-icon');
    // State 1 doesn't have X, State 2 does. So there should be only 1 X icon.
    expect(xIcons.length).toBe(1);
    const firstXIcon = xIcons[0];
    if (firstXIcon) {
      const deleteButton = firstXIcon.closest('button');
      if (deleteButton) {
        fireEvent.click(deleteButton);
      }
    }
    expect(mockProps.onDeleteState).toHaveBeenCalledWith(1);
  });
});
