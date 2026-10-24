/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Surface test for `a2ui_filesystem.json`.
 *
 * Drives the payload the way a user would, through the component ids and data
 * model paths it declares, against a stub filesystem MCP server. No renderer
 * or host application is involved: the test checks what the payload itself
 * does, which tools it calls, and what lands in the data model.
 */

import {stubMcp} from '@a2ui/catalog-mcp/testing';
import {createSurfaceHarness, type SurfaceHarness} from '@a2ui/testing';
import type {A2uiMessage} from '@a2ui/web_core/v0_9';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import surface from './a2ui_filesystem.json';
import {JmespathImplementation} from './client/functions/jmespath.js';
import {RegexCaptureImplementation} from './client/functions/regexCapture.js';
import {RegexReplaceImplementation} from './client/functions/regexReplace.js';
import {SplitImplementation} from './client/functions/split.js';
import {UpdateDataModelImplementation} from './client/functions/updateDataModel.js';

/** The sample's data transformation functions, registered next to `callMcpTool`. */
const SAMPLE_FUNCTIONS = [
  JmespathImplementation,
  SplitImplementation,
  RegexCaptureImplementation,
  RegexReplaceImplementation,
  UpdateDataModelImplementation,
];

/** Response of `list_directory_with_sizes`, as the reference server formats it. */
const LISTING = [
  '[DIR] Documents                      ',
  '[FILE] .bash_profile                       568 B',
  '[FILE] notes with spaces.md               2.39 KB',
  '',
  'Total: 2 files, 1 directories',
  'Combined size: 2.94 KB',
].join('\n');

/** Response of `read_text_file`. */
const FILE_TEXT = 'line one\nline two\nline three';

/** Response of `search_files`. */
const MATCHES = '/Users/ada/a.md\n/Users/ada/notes/b.md';

const LISTING_PATTERN = '^\\[(DIR|FILE)\\]\\s+([^.].*?)(?:\\s\\s+([0-9.]+ [A-Za-z]+))?\\s*$';
const LINE_PATTERN = '^(.*)$';

/** The rows `/expr/list` builds from `LISTING`: no dotfiles, no summary lines. */
const HOME_ENTRIES = [
  {
    name: 'Documents',
    size: '',
    icon: 'folder',
    tool: 'list_directory_with_sizes',
    expr: {path: '/expr/list'},
    pattern: LISTING_PATTERN,
  },
  {
    name: 'notes with spaces.md',
    size: '2.39 KB',
    icon: 'attachFile',
    tool: 'read_text_file',
    expr: {path: '/expr/read'},
    pattern: LINE_PATTERN,
  },
];

/** The row `/expr/search` builds for one hit. */
const hit = (name: string) => ({
  name,
  size: '',
  icon: 'attachFile',
  tool: 'read_text_file',
  expr: {path: '/expr/read'},
  pattern: LINE_PATTERN,
});

describe('a2ui_filesystem.json', () => {
  let responses: Record<string, string>;
  let mcp: ReturnType<typeof stubMcp>;
  let h: SurfaceHarness;

  /** Builds the surface against the stub server. The payload lists `~` on mount. */
  async function open() {
    mcp = stubMcp({
      tools: {
        list_directory_with_sizes: () => responses['list_directory_with_sizes'],
        read_text_file: () => responses['read_text_file'],
        search_files: () => responses['search_files'],
      },
    });
    h = await createSurfaceHarness({
      messages: surface as unknown as A2uiMessage[],
      plugins: [mcp],
      functions: SAMPLE_FUNCTIONS,
    });
  }

  /** Clicks the row button bound to `/entries/<index>`. */
  const clickRow = (index: number) => h.click('entry_button', {scope: `/entries/${index}`});

  beforeEach(() => {
    responses = {
      list_directory_with_sizes: LISTING,
      read_text_file: FILE_TEXT,
      search_files: MATCHES,
    };
  });

  afterEach(() => h?.dispose());

  describe('startup', () => {
    it('lists the home directory as soon as the surface mounts', async () => {
      await open();

      expect(mcp.calls).toEqual([{name: 'list_directory_with_sizes', arguments: {path: '~'}}]);
      expect(h.errors).toEqual([]);
    });

    it('turns the listing into rows, hiding dotfiles and summary lines', async () => {
      await open();

      expect(h.data('/entries')).toEqual(HOME_ENTRIES);
      expect(h.data('/dir')).toBe('~');
      // Every row prepends this to its name, so the trailing slash is contract.
      expect(h.data('/row_base')).toBe('~/');
      expect(h.prop('entries_title', 'text')).toBe('2 entries');
      expect(h.prop('viewer_title', 'text')).toBe('Home Directory (~)');
    });

    it('renders one row per entry, each showing its own name and size', async () => {
      await open();

      expect(h.children('entries_list')).toEqual([
        {id: 'entry_row', scope: '/entries/0'},
        {id: 'entry_row', scope: '/entries/1'},
      ]);
      expect(h.prop('entry_name', 'text', {scope: '/entries/0'})).toBe('Documents');
      expect(h.prop('entry_icon', 'name', {scope: '/entries/0'})).toBe('folder');
      expect(h.prop('entry_name', 'text', {scope: '/entries/1'})).toBe('notes with spaces.md');
      expect(h.prop('entry_size', 'text', {scope: '/entries/1'})).toBe('2.39 KB');
      expect(h.rendered('entry_button', {scope: '/entries/1'})).toBe(true);
    });

    it('counts a single entry in the singular', async () => {
      responses['list_directory_with_sizes'] = '[DIR] Documents                      ';

      await open();

      expect(h.data('/entries')).toHaveLength(1);
      expect(h.prop('entries_title', 'text')).toBe('1 entry');
    });
  });

  describe('rows', () => {
    it('issues exactly one tool call for a row click', async () => {
      await open();
      mcp.calls.length = 0;

      await clickRow(0);

      // The chain nests the call under several functions; a duplicated subtree
      // would double-call without changing the data it produces.
      expect(mcp.calls).toEqual([
        {name: 'list_directory_with_sizes', arguments: {path: '~/Documents'}},
      ]);
    });

    it('walks into a directory row, and keeps walking from there', async () => {
      await open();

      await clickRow(0);

      expect(h.data('/dir')).toBe('~/Documents');
      expect(h.data('/row_base')).toBe('~/Documents/');
      expect(h.prop('viewer_title', 'text')).toBe('~/Documents');

      await clickRow(0);

      expect(mcp.calls.at(-1)).toEqual({
        name: 'list_directory_with_sizes',
        arguments: {path: '~/Documents/Documents'},
      });
      expect(h.data('/dir')).toBe('~/Documents/Documents');
    });

    it('opens a file row in the viewer without disturbing the listing', async () => {
      await open();

      await clickRow(1);

      expect(mcp.calls.at(-1)).toEqual({
        name: 'read_text_file',
        arguments: {path: '~/notes with spaces.md'},
      });
      expect(h.prop('viewer_title', 'text')).toBe('~/notes with spaces.md');
      expect(h.prop('viewer_body', 'text')).toBe('```\nline one\nline two\nline three\n```');
      expect(h.data('/dir')).toBe('~');
      expect(h.data('/entries')).toEqual(HOME_ENTRIES);
    });
  });

  describe('navigation controls', () => {
    it('lists the directory typed into the field', async () => {
      await open();

      await h.setValue('path_field', '~/Documents/projects');
      await h.click('open_button');

      expect(mcp.calls.at(-1)).toEqual({
        name: 'list_directory_with_sizes',
        arguments: {path: '~/Documents/projects'},
      });
      expect(h.data('/row_base')).toBe('~/Documents/projects/');
      expect(h.prop('viewer_title', 'text')).toBe('~/Documents/projects');
    });

    it('walks up to the parent directory, and no further than home', async () => {
      await open();
      await clickRow(0);

      await h.click('parent_button');
      expect(mcp.calls.at(-1)).toEqual({
        name: 'list_directory_with_sizes',
        arguments: {path: '~'},
      });
      expect(h.data('/dir')).toBe('~');

      await h.click('parent_button');
      // `~` has no separator to strip, so the user cannot walk off the top.
      expect(h.data('/dir')).toBe('~');
    });

    it('returns home from a nested directory', async () => {
      await open();
      await clickRow(0);

      await h.click('home_button');

      expect(h.data('/dir')).toBe('~');
      expect(h.prop('viewer_title', 'text')).toBe('Home Directory (~)');
    });
  });

  describe('search', () => {
    it('turns search output into a result list with absolute paths', async () => {
      await open();

      await h.click('search_button');

      expect(mcp.calls.at(-1)).toEqual({
        name: 'search_files',
        arguments: {path: '~', pattern: '**/*.md'},
      });
      expect(h.data('/entries')).toEqual([hit('/Users/ada/a.md'), hit('/Users/ada/notes/b.md')]);
      // A hit is already absolute, so a row must prepend nothing to it.
      expect(h.data('/row_base')).toBe('');
      expect(h.prop('entries_title', 'text')).toBe('Search: 2 matches in `~`');
      expect(h.prop('viewer_body', 'text')).toBe(
        'Found 2 matches for glob `**/*.md` in `~`. Select a file on the left to read it.',
      );
    });

    it('opens a search hit at its own absolute path', async () => {
      await open();
      await h.click('search_button');

      await clickRow(0);

      expect(mcp.calls.at(-1)).toEqual({
        name: 'read_text_file',
        arguments: {path: '/Users/ada/a.md'},
      });
      expect(h.prop('viewer_title', 'text')).toBe('/Users/ada/a.md');
    });

    it('empties the list when nothing matches the typed glob', async () => {
      await open();
      responses['search_files'] = 'No matches found';

      await h.setValue('search_field', '**/*.js');
      await h.click('search_button');

      expect(mcp.calls.at(-1)).toEqual({
        name: 'search_files',
        arguments: {path: '~', pattern: '**/*.js'},
      });
      expect(h.data('/entries')).toEqual([]);
      expect(h.children('entries_list')).toEqual([]);
      expect(h.prop('entries_title', 'text')).toBe('Search: 0 matches in `~`');
      expect(h.prop('viewer_body', 'text')).toBe('No matches found for glob `**/*.js` in `~`.');
    });
  });

  describe('failures', () => {
    it('fails the step whose tool the server does not serve', async () => {
      await open();
      // Drop search_files after startup, as a server without that tool would.
      mcp = stubMcp({tools: {list_directory_with_sizes: () => LISTING}});
      h.dispose();
      h = await createSurfaceHarness({
        messages: surface as unknown as A2uiMessage[],
        plugins: [mcp],
        functions: SAMPLE_FUNCTIONS,
      });

      await expect(h.click('search_button')).rejects.toThrow(
        /click\('search_button'\)[\s\S]*Unstubbed MCP tool 'search_files'/,
      );
      expect(h.errors).toHaveLength(1);
      expect(h.errors[0].code).toBe('EXPRESSION_ERROR');
      // The failed step left the listing as it was.
      expect(h.data('/entries')).toEqual(HOME_ENTRIES);
    });
  });
});
