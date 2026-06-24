/*
 * Copyright 2026 Google LLC
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

export default async function autoAssign({github, context}) {
  console.log('A2UI Issue Auto-assignment script started');

  let issueNumber;
  let activeAssigneesList;

  // Hardcoded assignee lists
  const issueAssigneesList = ['Varun-S10'];

  // Determine event type
  if (context.payload.issue) {
    issueNumber = context.payload.issue.number;
    activeAssigneesList = issueAssigneesList;
    console.log('Event Type: Issue');
  } else {
    console.log('Not an Issue event. Exiting.');
    return;
  }

  console.log('Target assignees list:', activeAssigneesList);

  if (!activeAssigneesList || activeAssigneesList.length === 0) {
    console.log('No assignees configured for this type.');
    return;
  }

  // Round-robin assignment
  const selection = issueNumber % activeAssigneesList.length;
  const assigneeToAssign = activeAssigneesList[selection];

  console.log(`Assigning #${issueNumber} to: ${assigneeToAssign}`);

  try {
    await github.rest.issues.addAssignees({
      issue_number: issueNumber,
      owner: context.repo.owner,
      repo: context.repo.repo,
      assignees: [assigneeToAssign],
    });
    console.log('Assignment successful');
  } catch (error) {
    console.log('Failed to assign:', error.message);
  }

  console.log('A2UI Issue Auto-assignment script completed');
}
