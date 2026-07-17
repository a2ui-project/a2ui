/**
 * Copyright 2026 kokoro-ele
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

import React from 'react';
import {render} from 'ink';
import {ExplorerApp} from './App.js';

const arg = process.argv[2];
if (arg === '--help' || arg === '-h') {
  console.log(`Usage: yarn explorer [example-id]

Interactive gallery for the Ink renderer (terminal counterpart of
renderers/react/a2ui_explorer).

  yarn explorer                 # browse all official examples
  yarn explorer 32_advanced     # open a matching example immediately

Keys (list):   ↑/↓  Enter  / filter  q quit
Keys (preview): Tab/Enter interact with UI
               Ctrl+S step next message
               Ctrl+X reset (no messages)
               Ctrl+R apply all messages
               Ctrl+D toggle data model
               Ctrl+A toggle action log
               Ctrl+L back to list
`);
  process.exit(0);
}

render(<ExplorerApp initialId={arg} />);
