#!/bin/bash
# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# This script creates a GitHub issue when a CI workflow fails on the main branch.
# It uses the GitHub CLI (`gh`) to file an issue containing the commit SHA,
# the pull requests merged since the workflow last passed, a link to the failed
# workflow run logs, and a link to the workflow's run history, to see whether
# later runs passed. If an issue for the workflow is still open, it comments
# there instead.
#
# Arguments:
#   $1 - WORKFLOW_NAME: The name of the workflow that failed (e.g., "Evals", "E2E tests").
#   $2 - LABEL_NAME: The label to apply to the newly created issue (e.g., "eval_failure", "e2e_failure").
#   $3 - SUMMARY_FILE: (Optional) Path to a file containing a detailed summary to include in the issue body.
#
# Expected Environment Variables (provided by GitHub Actions):
#   GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_SERVER_URL, GITHUB_RUN_ID, GITHUB_WORKFLOW_REF
#   GH_TOKEN or GITHUB_TOKEN (required for the gh cli to authenticate)

set -e

WORKFLOW_NAME="${1:-Evals}"
LABEL_NAME="${2:-eval_failure}"
SUMMARY_FILE="${3:-}"

# Check required environment variables
if [[ -z "$GITHUB_REPOSITORY" || -z "$GITHUB_SHA" || -z "$GITHUB_SERVER_URL" || -z "$GITHUB_RUN_ID" || -z "$GITHUB_WORKFLOW_REF" ]]; then
  echo "Error: Missing required GitHub Actions environment variables."
  exit 1
fi

if [[ -z "$GH_TOKEN" && -z "$GITHUB_TOKEN" ]]; then
  echo "Error: GH_TOKEN or GITHUB_TOKEN environment variable is required."
  exit 1
fi

# Ensure GH_TOKEN is set for `gh` cli
export GH_TOKEN="${GH_TOKEN:-$GITHUB_TOKEN}"

BRANCH="${GITHUB_REF_NAME:-main}"
SHORT_SHA="${GITHUB_SHA:0:7}"
RUN_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"

# GITHUB_WORKFLOW_REF looks like "owner/repo/.github/workflows/e2e_test.yml@refs/heads/main".
WORKFLOW_FILE=$(basename "${GITHUB_WORKFLOW_REF%@*}")
HISTORY_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/workflows/${WORKFLOW_FILE}?query=branch%3A${BRANCH}"

# Any PR merged since the last passing run can have caused the failure. The PR
# of the failing commit alone is often an unrelated later merge.
echo "Looking up the last passing run of ${WORKFLOW_FILE} on ${BRANCH}..."
LAST_PASS=$(gh run list --repo "$GITHUB_REPOSITORY" --workflow "$WORKFLOW_FILE" \
  --branch "$BRANCH" --status success --limit 1 \
  --json headSha,url --jq '.[0] // empty | "\(.headSha) \(.url)"') || LAST_PASS=""
LAST_PASS_SHA="${LAST_PASS%% *}"
LAST_PASS_URL="${LAST_PASS#* }"

# One line per commit: its SHA and the first line of its message.
COMMIT_SUBJECT='"\(.sha) \(.commit.message | split("\n")[0])"'
COMPARED=false
COMMITS=""
if [[ -n "$LAST_PASS_SHA" ]]; then
  # The commits after the last passing one, up to the failing one. The
  # compare API lists at most 250.
  if COMPARED_COMMITS=$(gh api "repos/$GITHUB_REPOSITORY/compare/${LAST_PASS_SHA}...${GITHUB_SHA}" --jq ".commits[] | $COMMIT_SUBJECT"); then
    COMPARED=true
    COMMITS="$COMPARED_COMMITS"
  fi
fi
if [[ "$COMPARED" != true ]]; then
  COMMITS=$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA" --jq "$COMMIT_SUBJECT") || COMMITS="$GITHUB_SHA"
fi

# The repository only squash-merges, and a squash merge ends its subject with
# the PR number, as in "fix: x (#123)". Reading it from there takes no request
# per commit.
PRS=""
while read -r COMMIT SUBJECT; do
  [[ -z "$COMMIT" ]] && continue
  if [[ "$SUBJECT" =~ \(#([0-9]+)\)$ ]]; then
    PRS="${PRS}
- #${BASH_REMATCH[1]}"
  else
    PRS="${PRS}
- ${COMMIT:0:7} (no PR)"
  fi
done <<< "$COMMITS"

if [[ "$COMPARED" != true ]]; then
  CHANGES="Could not list the changes since the last passing run. The failing commit:${PRS}"
elif [[ -z "$COMMITS" ]]; then
  CHANGES="The last passing run (${LAST_PASS_URL}) tested the same commit, so the failure is flaky or comes from outside the repository, such as the model or its API."
else
  CHANGES="Merged since the last passing run (${LAST_PASS_URL}):${PRS}"
fi

TITLE_PREFIX="${WORKFLOW_NAME} failed on ${BRANCH}"
TITLE="${TITLE_PREFIX} for commit ${SHORT_SHA}"

# Lowercase workflow name for the body
LOWER_WORKFLOW_NAME=$(echo "$WORKFLOW_NAME" | tr '[:upper:]' '[:lower:]')

BODY="The ${LOWER_WORKFLOW_NAME} workflow failed on ${BRANCH} for commit ${GITHUB_SHA}.
See logs: ${RUN_URL}
See run history, to check whether later runs passed: ${HISTORY_URL}

${CHANGES}"

if [[ -n "$SUMMARY_FILE" && -s "$SUMMARY_FILE" ]]; then
  echo "Found summary file at $SUMMARY_FILE. Appending to body..."
  BODY="${BODY}

### Detailed Summary
$(cat "$SUMMARY_FILE")"
fi

# Until the workflow passes again, every failing run is reported on the same
# issue, so one break does not file an issue per night.
echo "Checking for an open issue with label '$LABEL_NAME' and a title starting with '$TITLE_PREFIX'..."
EXISTING_ISSUE=$(gh issue list --label "$LABEL_NAME" --state open --search "\"$TITLE_PREFIX\" in:title" --json number,title \
  | jq -r --arg prefix "$TITLE_PREFIX" 'map(select(.title | startswith($prefix))) | .[0].number // empty')

if [ -n "$EXISTING_ISSUE" ]; then
  echo "Adding this run to the open issue #$EXISTING_ISSUE..."
  gh issue comment "$EXISTING_ISSUE" --body "$BODY"
  exit 0
fi

echo "Creating issue..."
gh issue create \
  --title "$TITLE" \
  --body "$BODY" \
  --label "$LABEL_NAME"

echo "Issue created successfully."
