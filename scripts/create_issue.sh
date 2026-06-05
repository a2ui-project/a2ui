#!/bin/bash
# Copyright 2026 Google LLC
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
# a link to any associated pull request, and a link to the failed workflow run logs.
#
# Arguments:
#   $1 - WORKFLOW_NAME: The name of the workflow that failed (e.g., "Evals", "E2E tests").
#   $2 - LABEL_NAME: The label to apply to the newly created issue (e.g., "eval_failure", "e2e_failure").
#
# Expected Environment Variables (provided by GitHub Actions):
#   GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_SERVER_URL, GITHUB_RUN_ID
#   GH_TOKEN or GITHUB_TOKEN (required for the gh cli to authenticate)

set -e

WORKFLOW_NAME="${1:-Evals}"
LABEL_NAME="${2:-eval_failure}"

# Check required environment variables
if [[ -z "$GITHUB_REPOSITORY" || -z "$GITHUB_SHA" || -z "$GITHUB_SERVER_URL" || -z "$GITHUB_RUN_ID" ]]; then
  echo "Error: Missing required GitHub Actions environment variables."
  exit 1
fi

if [[ -z "$GH_TOKEN" && -z "$GITHUB_TOKEN" ]]; then
  echo "Error: GH_TOKEN or GITHUB_TOKEN environment variable is required."
  exit 1
fi

# Ensure GH_TOKEN is set for `gh` cli
export GH_TOKEN="${GH_TOKEN:-$GITHUB_TOKEN}"

echo "Checking for associated PRs for commit ${GITHUB_SHA}..."
PR_NUMBER=$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/pulls" --jq '.[0].number')

SHORT_SHA="${GITHUB_SHA:0:7}"

if [[ -n "$PR_NUMBER" && "$PR_NUMBER" != "null" ]]; then
  PR_LINK="Associated PR: #${PR_NUMBER}"
  TITLE="${WORKFLOW_NAME} failed on ${GITHUB_REF_NAME:-main} (PR #${PR_NUMBER})"
else
  PR_LINK="No associated PR found"
  TITLE="${WORKFLOW_NAME} failed on main for commit ${SHORT_SHA}"
fi

# Lowercase workflow name for the body
LOWER_WORKFLOW_NAME=$(echo "$WORKFLOW_NAME" | tr '[:upper:]' '[:lower:]')

BODY="The ${LOWER_WORKFLOW_NAME} workflow failed on main for commit ${GITHUB_SHA}.
${PR_LINK}
See logs: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"

echo "Checking for existing open issues with label '$LABEL_NAME' and title '$TITLE'..."
EXISTING_ISSUE=$(gh issue list --label "$LABEL_NAME" --state open --search "\"$TITLE\" in:title" --json url,title --jq ".[] | select(.title == \"$TITLE\") | .url" | head -n 1)

if [ -n "$EXISTING_ISSUE" ]; then
  echo "An open issue with the title '$TITLE' and label '$LABEL_NAME' already exists: $EXISTING_ISSUE"
  echo "Skipping issue creation."
  exit 0
fi

echo "Creating issue..."
gh issue create \
  --title "$TITLE" \
  --body "$BODY" \
  --label "$LABEL_NAME"

echo "Issue created successfully."
