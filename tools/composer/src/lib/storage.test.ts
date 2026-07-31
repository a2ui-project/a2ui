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
import localforage from 'localforage';
import {getWidgets, saveWidget, deleteWidget} from './storage';
import {Widget} from '@/types/widget';

vi.mock('localforage', () => ({
  default: {
    config: vi.fn(),
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
}));

describe('storage', () => {
  const mockWidget: Widget = {
    id: '1',
    name: 'Test Widget',
    specVersion: '0.8',
    createdAt: new Date(),
    updatedAt: new Date(),
    root: 'root',
    components: [],
    dataStates: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getWidgets', () => {
    it('should return empty array if no widgets in storage', async () => {
      vi.mocked(localforage.getItem).mockResolvedValue(null);
      const widgets = await getWidgets();
      expect(widgets).toEqual([]);
    });

    it('should return widgets from storage', async () => {
      vi.mocked(localforage.getItem).mockResolvedValue([mockWidget]);
      const widgets = await getWidgets();
      expect(widgets).toEqual([mockWidget]);
    });
  });

  describe('saveWidget', () => {
    it('should add new widget if not exists', async () => {
      vi.mocked(localforage.getItem).mockResolvedValue([]);
      await saveWidget(mockWidget);
      expect(localforage.setItem).toHaveBeenCalledWith('widgets', [mockWidget]);
    });

    it('should update existing widget', async () => {
      const existingWidget = {...mockWidget, name: 'Old Name'};
      vi.mocked(localforage.getItem).mockResolvedValue([existingWidget]);

      const updatedWidget = {...mockWidget, name: 'New Name'};
      await saveWidget(updatedWidget);

      expect(localforage.setItem).toHaveBeenCalledWith('widgets', [updatedWidget]);
    });
  });

  describe('deleteWidget', () => {
    it('should remove widget from storage', async () => {
      vi.mocked(localforage.getItem).mockResolvedValue([mockWidget]);
      await deleteWidget('1');
      expect(localforage.setItem).toHaveBeenCalledWith('widgets', []);
    });
  });
});
