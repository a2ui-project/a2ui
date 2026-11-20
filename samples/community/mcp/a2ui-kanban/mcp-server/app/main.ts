/*
 * Copyright 2024 Google LLC
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

/** Browser entry of the board app: renders into `#board` and connects to the host. */

import {createBoardApp} from './board.js';

const root = document.getElementById('board');
if (!root) {
  throw new Error('The board app needs a #board element.');
}
const boardApp = createBoardApp(root);
boardApp.connect().catch(error => {
  console.error('[kanban-app] Failed to connect to the host:', error);
});
