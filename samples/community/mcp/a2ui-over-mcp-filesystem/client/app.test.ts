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
 * Tests for the payload, which is where this sample keeps its behaviour.
 *
 * The MCP server is mocked with responses copied from a real one, so these
 * cover what the sample actually ships: the payload validating against the
 * catalog, the function chains behind its controls turning server text into
 * the data model, and the host running the startup action the payload names.
 *
 * Each control is driven the way the renderer drives it. The test reads the
 * action off the component and resolves it, rather than assembling a call of
 * its own, so what runs is the payload rather than a paraphrase of it.
 */

import {DataContext} from '@a2ui/web_core/v0_9';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {A2uiFilesystemApp, CATALOG_ID} from './app';

/** A real `list_directory_with_sizes` response, including its totals block. */
const LISTING = [
  '[DIR] Documents                      ',
  '[FILE] .bash_profile                       568 B',
  '[FILE] notes with spaces.md               2.39 KB',
  '',
  'Total: 2 files, 1 directories',
  'Combined size: 2.94 KB',
].join('\n');

/** A real `read_text_file` response. */
const FILE_TEXT = 'line one\nline two\nline three';

/** A real `search_files` response. */
const MATCHES = '/Users/ada/a.md\n/Users/ada/notes/b.md';

/**
 * The pattern a directory row carries, which splits the listing its click
 * fetches.
 *
 * A row carries the pattern for its own tool's output, because the row is what
 * knows which tool it will call.
 */
const LISTING_PATTERN = '^\\[(DIR|FILE)\\]\\s+([^.].*?)(?:\\s\\s+([0-9.]+ [A-Za-z]+))?\\s*$';

/** The pattern a file row carries: file text has no columns to pick apart. */
const LINE_PATTERN = '^(.*)$';

/** The rows `LISTING` yields once the dotfile and the totals block are dropped. */
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

/** A search hit, which is a whole path rather than a name within a directory. */
const hit = (name: string) => ({
  name,
  size: '',
  icon: 'attachFile',
  tool: 'read_text_file',
  expr: {path: '/expr/read'},
  pattern: LINE_PATTERN,
});

let mockClient: {
  connect: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  readResource: ReturnType<typeof vi.fn>;
};

/** Text the mocked server answers with, by tool name. */
let responses: Record<string, string>;

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function () {
    return mockClient;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

/** Runs the connect-and-bootstrap lifecycle the way Lit would. */
const bootstrap = (app: A2uiFilesystemApp) => (app as any).firstUpdated();

/** Every `tools/call` the mocked server has received, in order. */
const toolCalls = () => mockClient.request.mock.calls.map(call => call[0].params);

/** Reads a data model path off the live surface. */
const read = (app: A2uiFilesystemApp, path: string) => app.surface!.dataModel.get(path);

/**
 * Runs the action a control declares, in the scope the renderer gives it.
 *
 * A failure inside an action is reported to the surface rather than thrown, so
 * the error check is what keeps a broken chain from passing as a no-op.
 */
async function press(app: A2uiFilesystemApp, componentId: string, scope = '/') {
  const component = app.surface!.componentsModel.get(componentId);
  expect(component, `the payload declares no ${componentId}`).toBeDefined();

  await new DataContext(app.surface!, scope).resolveDynamicValue(
    component!.properties['action'].functionCall,
  );

  expect((app as any).error, `${componentId} dispatched a surface error`).toBe('');
}

/**
 * Clicks one row of the entries list.
 *
 * The row template reads `name`, `tool`, `expr`, and `pattern` relative to the
 * entry it renders, so its action runs scoped to that entry rather than to the
 * surface root.
 */
const pressRow = (app: A2uiFilesystemApp, index: number) =>
  press(app, 'entry_button', `/entries/${index}`);

describe('the filesystem payload', () => {
  let app: A2uiFilesystemApp;

  beforeEach(() => {
    vi.clearAllMocks();
    responses = {
      list_directory_with_sizes: LISTING,
      read_text_file: FILE_TEXT,
      search_files: MATCHES,
    };

    mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({tools: []}),
      readResource: vi.fn().mockResolvedValue({contents: []}),
      request: vi.fn().mockImplementation(async (request: any) => ({
        content: [{type: 'text', text: responses[request.params.name] ?? ''}],
      })),
    };

    app = new A2uiFilesystemApp();
  });

  it('validates against the catalog it names', async () => {
    await bootstrap(app);

    expect(app.processor.getClientCapabilities()['v0.9']?.supportedCatalogIds).toContain(
      CATALOG_ID,
    );
    expect(app.surface).toBeDefined();
    expect(app.surface!.componentsModel.get('entry_row')).toBeDefined();
    expect((app as any).error).toBe('');
  });

  it('runs the startup action the payload declares, listing the home directory', async () => {
    await bootstrap(app);

    expect(toolCalls()).toEqual([{name: 'list_directory_with_sizes', arguments: {path: '~'}}]);
  });

  it('turns a directory listing into rows the row template binds to, hiding dotfiles', async () => {
    await bootstrap(app);

    expect(read(app, '/entries')).toEqual(HOME_ENTRIES);
    expect(read(app, '/entries_title')).toBe('2 entries');
    expect(read(app, '/dir')).toBe('~');
    // Every row builds its path by prepending this, so the trailing slash is
    // part of the contract rather than cosmetic.
    expect(read(app, '/row_base')).toBe('~/');
    expect(read(app, '/viewer_title')).toBe('Home Directory (~)');
  });

  it('counts a single entry in the singular', async () => {
    responses['list_directory_with_sizes'] = '[DIR] Documents                      ';

    await bootstrap(app);

    expect(read(app, '/entries')).toHaveLength(1);
    expect(read(app, '/entries_title')).toBe('1 entry');
  });

  it('issues exactly one tool call for a row click', async () => {
    await bootstrap(app);
    mockClient.request.mockClear();

    await pressRow(app, 0);

    // The chain nests the call under several functions, and a duplicated
    // subtree would double-call without changing any of the data it produces.
    expect(toolCalls()).toEqual([
      {name: 'list_directory_with_sizes', arguments: {path: '~/Documents'}},
    ]);
  });

  it('opens a file row at the path its row base and name build', async () => {
    await bootstrap(app);

    await pressRow(app, 1);

    expect(toolCalls().at(-1)).toEqual({
      name: 'read_text_file',
      arguments: {path: '~/notes with spaces.md'},
    });
    expect(read(app, '/viewer_body')).toBe('```\nline one\nline two\nline three\n```');
    expect(read(app, '/viewer_title')).toBe('~/notes with spaces.md');
    // Reading a file leaves the listing alone, so the pane the user came from
    // still shows the directory they are in.
    expect(read(app, '/dir')).toBe('~');
    expect(read(app, '/entries')).toEqual(HOME_ENTRIES);
  });

  it('walks into a directory row, and keeps walking from there', async () => {
    await bootstrap(app);

    await pressRow(app, 0);

    expect(toolCalls().at(-1)).toEqual({
      name: 'list_directory_with_sizes',
      arguments: {path: '~/Documents'},
    });
    expect(read(app, '/dir')).toBe('~/Documents');
    expect(read(app, '/row_base')).toBe('~/Documents/');
    expect(read(app, '/viewer_title')).toBe('~/Documents');
    expect(read(app, '/entries_title')).toBe('2 entries');

    await pressRow(app, 0);

    expect(toolCalls().at(-1)).toEqual({
      name: 'list_directory_with_sizes',
      arguments: {path: '~/Documents/Documents'},
    });
    expect(read(app, '/dir')).toBe('~/Documents/Documents');
    expect(read(app, '/row_base')).toBe('~/Documents/Documents/');
  });

  it('lists the directory typed into the field', async () => {
    await bootstrap(app);

    // The Directory field binds straight to `/dir`, so typing is a write.
    app.surface!.dataModel.set('/dir', '~/Documents/projects');
    await press(app, 'open_button');

    expect(toolCalls().at(-1)).toEqual({
      name: 'list_directory_with_sizes',
      arguments: {path: '~/Documents/projects'},
    });
    expect(read(app, '/dir')).toBe('~/Documents/projects');
    expect(read(app, '/row_base')).toBe('~/Documents/projects/');
    expect(read(app, '/viewer_title')).toBe('~/Documents/projects');
  });

  it('walks up to the parent directory', async () => {
    await bootstrap(app);
    await pressRow(app, 0);

    await press(app, 'parent_button');

    expect(toolCalls().at(-1)).toEqual({
      name: 'list_directory_with_sizes',
      arguments: {path: '~'},
    });
    expect(read(app, '/dir')).toBe('~');
    expect(read(app, '/row_base')).toBe('~/');
  });

  it('treats the parent of the home directory as itself', async () => {
    await bootstrap(app);

    await press(app, 'parent_button');

    // `~` has no separator to strip, so the user cannot walk off the top.
    expect(toolCalls().at(-1)).toEqual({
      name: 'list_directory_with_sizes',
      arguments: {path: '~'},
    });
    expect(read(app, '/dir')).toBe('~');
  });

  it('returns home from a nested directory', async () => {
    await bootstrap(app);
    await pressRow(app, 0);

    await press(app, 'home_button');

    expect(toolCalls().at(-1)).toEqual({
      name: 'list_directory_with_sizes',
      arguments: {path: '~'},
    });
    expect(read(app, '/dir')).toBe('~');
    expect(read(app, '/viewer_title')).toBe('Home Directory (~)');
  });

  it('turns search output into a result list in the entries pane', async () => {
    await bootstrap(app);

    await press(app, 'search_button');

    expect(toolCalls().at(-1)).toEqual({
      name: 'search_files',
      arguments: {path: '~', pattern: '**/*.md'},
    });
    expect(read(app, '/entries')).toEqual([hit('/Users/ada/a.md'), hit('/Users/ada/notes/b.md')]);
    // A hit is already absolute, so a row must prepend nothing to it.
    expect(read(app, '/row_base')).toBe('');
    expect(read(app, '/entries_title')).toBe('Search: 2 matches in `~`');
    expect(read(app, '/viewer_title')).toBe('Search in ~');
    expect(read(app, '/viewer_body')).toBe(
      'Found 2 matches for glob `**/*.md` in `~`. Select a file on the left to read it.',
    );
  });

  it('words a single search hit in the singular', async () => {
    responses['search_files'] = '/Users/ada/a.md';
    await bootstrap(app);

    await press(app, 'search_button');

    expect(read(app, '/entries')).toEqual([hit('/Users/ada/a.md')]);
    expect(read(app, '/entries_title')).toBe('Search: 1 match in `~`');
    expect(read(app, '/viewer_body')).toBe(
      'Found 1 match for glob `**/*.md` in `~`. Select a file on the left to read it.',
    );
  });

  it('opens a search hit at its own absolute path', async () => {
    await bootstrap(app);
    await press(app, 'search_button');

    await pressRow(app, 0);

    expect(toolCalls().at(-1)).toEqual({
      name: 'read_text_file',
      arguments: {path: '/Users/ada/a.md'},
    });
    expect(read(app, '/viewer_title')).toBe('/Users/ada/a.md');
  });

  it('empties the result list when nothing matches', async () => {
    await bootstrap(app);
    responses['search_files'] = 'No matches found';

    // The glob field binds straight to `/search_pattern`, as the Directory
    // field does to `/dir`.
    app.surface!.dataModel.set('/search_pattern', '**/*.js');
    await press(app, 'search_button');

    expect(toolCalls().at(-1)).toEqual({
      name: 'search_files',
      arguments: {path: '~', pattern: '**/*.js'},
    });
    expect(read(app, '/entries')).toEqual([]);
    expect(read(app, '/entries_title')).toBe('Search: 0 matches in `~`');
    expect(read(app, '/viewer_body')).toBe('No matches found for glob `**/*.js` in `~`.');
  });

  it('reports a transport failure instead of rendering an empty surface', async () => {
    mockClient.connect.mockRejectedValue(new Error('Network error'));

    await bootstrap(app);

    expect(app.surface).toBeUndefined();
    expect((app as any).error).toBe('Network error');
  });
});
