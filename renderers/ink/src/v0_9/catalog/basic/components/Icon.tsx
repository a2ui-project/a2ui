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

import {Text} from 'ink';
import {createComponentImplementation} from '../../../adapter.js';
import {IconApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Single-cell glyphs for every icon name in the v0.9 basic catalog.
 * Prefers widely supported Unicode symbols over emoji to keep column
 * alignment stable across terminals.
 */
const ICON_GLYPHS: Record<string, string> = {
  accountCircle: '◉',
  add: '+',
  arrowBack: '←',
  arrowForward: '→',
  attachFile: '📎',
  calendarToday: '▦',
  call: '☎',
  camera: '📷',
  check: '✓',
  close: '✕',
  delete: '⌫',
  download: '⇩',
  edit: '✎',
  event: '▦',
  error: '⊗',
  fastForward: '⏩',
  favorite: '♥',
  favoriteOff: '♡',
  folder: '🗀',
  help: '?',
  home: '⌂',
  info: 'ℹ',
  locationOn: '⌖',
  lock: '🔒',
  lockOpen: '🔓',
  mail: '✉',
  menu: '≡',
  moreVert: '⋮',
  moreHoriz: '…',
  notificationsOff: '🔕',
  notifications: '🔔',
  pause: '⏸',
  payment: '💳',
  person: '☺',
  phone: '☎',
  photo: '🖼',
  play: '▶',
  print: '⎙',
  refresh: '↻',
  rewind: '⏪',
  search: '⌕',
  send: '➤',
  settings: '⚙',
  share: '⤴',
  shoppingCart: '🛒',
  skipNext: '⏭',
  skipPrevious: '⏮',
  star: '★',
  starHalf: '⯪',
  starOff: '☆',
  stop: '■',
  upload: '⇧',
  visibility: '👁',
  visibilityOff: '⌀',
  volumeDown: '🔉',
  volumeMute: '🔈',
  volumeOff: '🔇',
  volumeUp: '🔊',
  warning: '⚠',
};

export const Icon = createComponentImplementation(IconApi, ({props}) => {
  const name = props.name;
  if (typeof name === 'object' && name !== null) {
    // Custom SVG paths cannot be rasterized in a terminal.
    return <Text dimColor>[svg]</Text>;
  }
  const key = typeof name === 'string' ? name : '';
  const glyph = ICON_GLYPHS[key];
  if (!glyph) {
    return <Text dimColor>:{key || 'icon'}:</Text>;
  }
  return <Text color="yellow">{glyph}</Text>;
});
