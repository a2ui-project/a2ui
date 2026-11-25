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

/** Picks the assignees the pickers offer, so a repo with many assignable users stays scannable. */

import type {GhIssue, GhUser} from '../github/types.js';

/** Most users a picker lists. */
export const MAX_PICKER_ASSIGNEES = 8;

/**
 * Returns the assignable users ranked by how many open issues they are
 * assigned to, at most `MAX_PICKER_ASSIGNEES`, plus the logins in `keep`
 * (such as the current or suggested assignee) when they are assignable.
 */
export function pickerAssignees(
  assignees: readonly GhUser[],
  issues: readonly GhIssue[],
  keep: readonly string[] = [],
): GhUser[] {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    for (const user of issue.assignees) counts.set(user.login, (counts.get(user.login) ?? 0) + 1);
  }
  const ranked = [...assignees]
    .filter(user => counts.has(user.login))
    .sort(
      (a, b) =>
        (counts.get(b.login) ?? 0) - (counts.get(a.login) ?? 0) || a.login.localeCompare(b.login),
    );
  const top = (ranked.length > 0 ? ranked : [...assignees]).slice(0, MAX_PICKER_ASSIGNEES);
  const extra = assignees.filter(user => keep.includes(user.login) && !top.includes(user));
  return [...top, ...extra].sort((a, b) =>
    a.login.localeCompare(b.login, 'en', {sensitivity: 'base'}),
  );
}
