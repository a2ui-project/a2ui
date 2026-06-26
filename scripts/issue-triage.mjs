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

export default async function issueTriage({github, context}) {
  console.log('A2UI Issue Triage script started');

  let issueNumber;

  // Determine event type
  if (context.payload.issue) {
    issueNumber = context.payload.issue.number;
    console.log('Event Type: Issue');
  } else {
    console.log('Not an Issue event. Exiting.');
    return;
  }

  console.log(`Adding 'status: needs triage' label to #${issueNumber}`);

  try {
    await github.rest.issues.addLabels({
      issue_number: issueNumber,
      owner: context.repo.owner,
      repo: context.repo.repo,
      labels: ['status: needs triage'],
    });
    console.log('Label added successfully');
  } catch (error) {
    console.error('Failed to add label:', error);
  }

  console.log('A2UI Issue Triage script completed');
}
