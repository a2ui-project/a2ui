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

import {describe, expect, it} from 'vitest';

import {ISSUES, USERS} from '../testing/synthetic_snapshot.js';
import {MAX_PICKER_ASSIGNEES, pickerAssignees} from './assignees.js';

describe('pickerAssignees', () => {
  it('keeps users assigned to open issues, plus the kept logins', () => {
    const many = Array.from({length: 30}, (_, index) => ({login: `user${index}`, avatarUrl: ''}));
    const users = [USERS.alice, USERS.bob, ...many];
    expect(pickerAssignees(users, ISSUES).map(user => user.login)).toEqual(['bob-maintainer']);
    expect(
      pickerAssignees(users, ISSUES, ['alice-dev', 'mallory']).map(user => user.login),
    ).toEqual(['alice-dev', 'bob-maintainer']);
  });

  it('falls back to the first users when nobody is assigned', () => {
    const many = Array.from({length: 30}, (_, index) => ({login: `user${index}`, avatarUrl: ''}));
    expect(pickerAssignees(many, [])).toHaveLength(MAX_PICKER_ASSIGNEES);
  });
});
