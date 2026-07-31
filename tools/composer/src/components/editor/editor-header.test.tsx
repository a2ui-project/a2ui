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
import {render, screen, fireEvent, act} from '@testing-library/react';
import {EditorHeader} from './editor-header';
import {Widget} from '@/types/widget';
import React from 'react';

describe('EditorHeader', () => {
  const mockWidget: Widget = {
    id: 'test-id',
    name: 'Test Widget',
    specVersion: '0.8',
    createdAt: new Date(),
    updatedAt: new Date(),
    root: 'root',
    components: [{id: 'root', component: {Text: {text: {literalString: 'Hello'}}}}],
    dataStates: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    // Mock URL methods
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:url');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('should render widget name', () => {
    render(<EditorHeader widget={mockWidget} />);
    expect(screen.getByText('Test Widget')).toBeInTheDocument();
  });

  it('should copy JSON to clipboard when clicking Copy JSON', async () => {
    render(<EditorHeader widget={mockWidget} />);
    const copyButton = screen.getByText('Copy JSON');

    await act(async () => {
      fireEvent.click(copyButton);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      JSON.stringify(mockWidget.components, null, 2),
    );
    expect(screen.getByText('Copied!')).toBeInTheDocument();
  });

  it('should call createObjectURL when clicking Download', () => {
    // Just verify the URL creation, don't mess with DOM methods that React needs
    render(<EditorHeader widget={mockWidget} />);
    const downloadButton = screen.getByText('Download');

    fireEvent.click(downloadButton);

    expect(global.URL.createObjectURL).toHaveBeenCalled();
  });
});
