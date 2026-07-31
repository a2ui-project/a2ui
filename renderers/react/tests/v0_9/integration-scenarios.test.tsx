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

import {describe, it, expect} from 'vitest';
import {render, screen, act, fireEvent} from '@testing-library/react';
import React from 'react';
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {A2uiSurface, basicCatalog} from '@a2ui/react/v0_9';

import exMarkdown from '../../../../specification/v0_9/catalogs/basic/examples/35_markdown-text.json';
import exTaskCard from '../../../../specification/v0_9/catalogs/basic/examples/07_task-card.json';
import exLoginForm from '../../../../specification/v0_9/catalogs/basic/examples/09_login-form.json';

describe('Gallery Integration Tests', () => {
  it('renders Markdown Text -> "Markdown Rendering"', async () => {
    const processor = new MessageProcessor([basicCatalog as any], async () => {});
    processor.processMessages(exMarkdown.messages as any[]);

    const surface = processor.model.getSurface('gallery-markdown-text');
    expect(surface).toBeDefined();

    render(
      <React.StrictMode>
        <A2uiSurface surface={surface as any} />
      </React.StrictMode>,
    );

    expect(screen.getByText('Markdown Rendering')).toBeInTheDocument();
  });

  it('renders Task Card -> content visibility', async () => {
    const processor = new MessageProcessor([basicCatalog as any], async () => {});
    processor.processMessages(exTaskCard.messages as any[]);

    const surface = processor.model.getSurface('gallery-task-card');
    expect(surface).toBeDefined();

    render(
      <React.StrictMode>
        <A2uiSurface surface={surface as any} />
      </React.StrictMode>,
    );

    expect(screen.getByText('Review pull request')).toBeInTheDocument();
    expect(screen.getByText('Backend')).toBeInTheDocument();
  });

  it('handles Login form -> input updates data model', async () => {
    const processor = new MessageProcessor([basicCatalog as any], async () => {});
    processor.processMessages(exLoginForm.messages as any[]);

    const surface = processor.model.getSurface('gallery-login-form');
    expect(surface).toBeDefined();

    render(
      <React.StrictMode>
        <A2uiSurface surface={surface as any} />
      </React.StrictMode>,
    );

    const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
    expect(emailInput).toBeDefined();

    await act(async () => {
      fireEvent.change(emailInput, {target: {value: 'alice@example.com'}});
    });

    expect(surface!.dataModel.get('/email')).toBe('alice@example.com');
  });
});
