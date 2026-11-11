// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/// The GraphQL queries of the triage UI.
library;

/// The fields of an issue or a pull request that the triage UI shows, and
/// that tell whether its suggestion is current. See
/// `blueprints/features/triage_bot.blueprint.md`.
const String _itemFragments = r'''
fragment Comments on IssueComment {
  author { login __typename }
  authorAssociation
  body
  createdAt
  lastEditedAt
  url
}

fragment IssueFields on Issue {
  id number title url createdAt updatedAt lastEditedAt state
  author { login }
  labels(first: 50) { nodes { name } }
  assignees(first: 20) { nodes { login } }
  milestone { title }
  comments(last: 100) { nodes { ...Comments } }
  closedByPullRequestsReferences(first: 10, includeClosedPrs: false) {
    nodes { number }
  }
  timelineItems(
    last: 100
    itemTypes: [
      LABELED_EVENT, UNLABELED_EVENT, ASSIGNED_EVENT, UNASSIGNED_EVENT,
      CLOSED_EVENT, REOPENED_EVENT, RENAMED_TITLE_EVENT
    ]
  ) {
    nodes { __typename ...Events }
  }
}

fragment PullRequestFields on PullRequest {
  id number title url createdAt updatedAt lastEditedAt state
  author { login }
  labels(first: 50) { nodes { name } }
  assignees(first: 20) { nodes { login } }
  milestone { title }
  comments(last: 100) { nodes { ...Comments } }
  closingIssuesReferences(first: 10) { nodes { number } }
  reviews(last: 50) { nodes { submittedAt } }
  timelineItems(
    last: 100
    itemTypes: [
      LABELED_EVENT, UNLABELED_EVENT, ASSIGNED_EVENT, UNASSIGNED_EVENT,
      CLOSED_EVENT, REOPENED_EVENT, RENAMED_TITLE_EVENT, PULL_REQUEST_COMMIT
    ]
  ) {
    nodes {
      __typename
      ...Events
      ... on PullRequestCommit { commit { committedDate } }
    }
  }
}

fragment Events on IssueTimelineItems {
  ... on LabeledEvent { createdAt label { name } }
  ... on UnlabeledEvent { createdAt label { name } }
  ... on AssignedEvent { createdAt }
  ... on UnassignedEvent { createdAt }
  ... on ClosedEvent { createdAt }
  ... on ReopenedEvent { createdAt }
  ... on RenamedTitleEvent { createdAt }
}
''';

/// A page of the open items that match a search query.
const String searchQuery =
    r'''
query($query: String!, $cursor: String) {
  search(query: $query, type: ISSUE, first: 25, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { __typename ...IssueFields ...PullRequestFields }
  }
}
''' +
    _itemFragments;

/// One item, by number.
const String itemQuery =
    r'''
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename ...IssueFields ...PullRequestFields
    }
  }
}
''' +
    _itemFragments;

/// The labels of the repository, its open milestones and the people who
/// can be assigned.
const String repositoryQuery = r'''
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    labels(first: 100, orderBy: {field: NAME, direction: ASC}) {
      nodes { name color }
    }
    milestones(
      first: 100, states: OPEN, orderBy: {field: DUE_DATE, direction: ASC}
    ) {
      nodes { number title }
    }
    assignableUsers(first: 100) { nodes { login } }
  }
}
''';

/// The node id of an issue, by number.
const String issueIdQuery = r'''
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) { id }
  }
}
''';

const String closeIssueMutation = r'''
mutation($id: ID!, $reason: IssueClosedStateReason!, $duplicateOf: ID) {
  closeIssue(input: {
    issueId: $id, stateReason: $reason, duplicateIssueId: $duplicateOf
  }) {
    issue { state }
  }
}
''';

const String closePullRequestMutation = r'''
mutation($id: ID!) {
  closePullRequest(input: {pullRequestId: $id}) { pullRequest { state } }
}
''';
