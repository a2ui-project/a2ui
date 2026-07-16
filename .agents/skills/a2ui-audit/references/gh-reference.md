# GitHub CLI Reference

This reference provides information about using the GitHub CLI (`gh`) to perform read-only investigations of repository state, and to manage issues and pull requests.

> [!IMPORTANT]
> If the GITHUB_TOKEN environment variable has a dummy value in it, to run the `gh` command-line tool, you must prefix it with `env -u GITHUB_TOKEN` to unset the dummy environment variable (e.g., `env -u GITHUB_TOKEN gh auth status`). Don't do this if the token appears to be a valid token.

---

## Authentication & Setup

Use these commands to verify connection status and configure default contexts.

- `env -u GITHUB_TOKEN gh auth status`
  Check if you are logged in and which permissions/scopes are active.
- `env -u GITHUB_TOKEN gh repo set-default`
  Set the default repository for the current directory so you do not have to pass the `--repo` flag to every command.

---

## Repositories (gh repo)

Use these commands to check repository details, list repositories, or clone code.

- `env -u GITHUB_TOKEN gh repo view`
  View the description, README, and basic stats of the current repository.
- `env -u GITHUB_TOKEN gh repo view owner/repo`
  View details of a specific remote repository.
- `env -u GITHUB_TOKEN gh repo list owner`
  List all repositories owned by a specific user or organization.
- `env -u GITHUB_TOKEN gh repo clone owner/repo`
  Clone a remote repository to your local machine.
- `env -u GITHUB_TOKEN gh repo sync`
  Synchronize a local fork with its upstream repository.

---

## Issues (gh issue)

Use these commands to find, audit, create, and update issues in the repository.

- `env -u GITHUB_TOKEN gh issue list`
  List open issues in the current repository.
- `env -u GITHUB_TOKEN gh issue list --state closed`
  View recently closed issues for historical context.
- `env -u GITHUB_TOKEN gh issue list --assignee @me`
  Find issues assigned to the logged-in user.
- `env -u GITHUB_TOKEN gh issue list --labels "bug,high-priority"`
  Filter issues by specific labels.
- `env -u GITHUB_TOKEN gh issue view 123`
  View the title, description, and metadata of a specific issue.
- `env -u GITHUB_TOKEN gh issue view 123 --comments`
  Read all comments on an issue to understand past discussions.
- `env -u GITHUB_TOKEN gh issue create --title "Title" --body "Body"`
  Create a new issue with a title and description.
- `env -u GITHUB_TOKEN gh issue create --title "Title" --body-file file.md`
  Create an issue using a markdown file's contents for the body.
- `env -u GITHUB_TOKEN gh issue comment 123 --body "My comment"`
  Post a new comment on an issue.
- `env -u GITHUB_TOKEN gh issue edit 123 --add-label "bug" --remove-label "stale"`
  Manage labels on an issue.
- `env -u GITHUB_TOKEN gh issue close 123 --comment "Resolved"`
  Close an issue and post a final explanation comment.
- `env -u GITHUB_TOKEN gh issue reopen 123`
  Reopen a closed issue if the problem persists.
- `env -u GITHUB_TOKEN gh issue status`
  View a summary of issues relevant to you (assigned, mentioned, etc.).

---

## Pull Requests (gh pr)

Use these commands to inspect, create, review, and merge pull requests.

- `env -u GITHUB_TOKEN gh pr list`
  List open pull requests in the repository.
- `env -u GITHUB_TOKEN gh pr list --state merged`
  Find recently merged pull requests.
- `env -u GITHUB_TOKEN gh pr view 123`
  View the details, status, and description of a pull request.
- `env -u GITHUB_TOKEN gh pr view 123 --comments`
  Read the review comments and discussion history of a pull request.
- `env -u GITHUB_TOKEN gh pr checkout 123`
  Pull down and switch to the branch associated with a pull request.
- `env -u GITHUB_TOKEN gh pr diff 123`
  Inspect the code changes introduced by a pull request.
- `env -u GITHUB_TOKEN gh pr checks 123`
  Check the status of CI/CD builds and checks for a pull request.
- `env -u GITHUB_TOKEN gh pr create --title "Title" --body "Description"`
  Create a new pull request for the current branch.
- `env -u GITHUB_TOKEN gh pr create --draft`
  Create a draft pull request that is not yet ready for review.
- `env -u GITHUB_TOKEN gh pr comment 123 --body "Looks good"`
  Post a comment on a pull request.
- `env -u GITHUB_TOKEN gh pr review 123 --approve --body "LGTM"`
  Approve a pull request with a review comment.
- `env -u GITHUB_TOKEN gh pr review 123 --request-changes --body "Fix this"`
  Request changes on a pull request with details.
- `env -u GITHUB_TOKEN gh pr merge 123 --squash --delete-branch`
  Squash-merge a pull request and delete its branch after merge.
- `env -u GITHUB_TOKEN gh pr close 123`
  Close a pull request without merging it.
- `env -u GITHUB_TOKEN gh pr reopen 123`
  Reopen a closed pull request.
- `env -u GITHUB_TOKEN gh pr status`
  Get a summary of your active pull requests.

---

## GitHub Actions Workflows & Runs (gh run & gh workflow)

Use these commands to monitor CI/CD pipelines, inspect run logs, and download build assets.

- `env -u GITHUB_TOKEN gh run list`
  List recent workflow runs in the repository.
- `env -u GITHUB_TOKEN gh run list --workflow "ci.yml"`
  List runs for a specific workflow.
- `env -u GITHUB_TOKEN gh run view 123456`
  View a summary of a specific workflow run's status and jobs.
- `env -u GITHUB_TOKEN gh run view 123456 --log`
  Retrieve the full execution logs for a workflow run to diagnose failures.
- `env -u GITHUB_TOKEN gh run watch 123456`
  Monitor a running workflow in real-time until it completes.
- `env -u GITHUB_TOKEN gh run download 123456 --dir ./artifacts`
  Download build artifacts generated by a workflow run.
- `env -u GITHUB_TOKEN gh workflow list`
  List all active workflows configured in the repository.
- `env -u GITHUB_TOKEN gh workflow view ci.yml --yaml`
  View the YAML definition of a specific workflow.

---

## Projects (gh project)

Use these commands to inspect project boards.

- `env -u GITHUB_TOKEN gh project list`
  List all projects associated with the owner.
- `env -u GITHUB_TOKEN gh project view 123`
  View details and metadata of a specific project.
- `env -u GITHUB_TOKEN gh project item-list 123`
  List all items (issues, PRs) on a project board.

---

## Releases (gh release)

Use these commands to check release history and download release assets.

- `env -u GITHUB_TOKEN gh release list`
  List all releases in the repository.
- `env -u GITHUB_TOKEN gh release view`
  View details of the latest release.
- `env -u GITHUB_TOKEN gh release view v1.0.0`
  View details of a specific release.
- `env -u GITHUB_TOKEN gh release download v1.0.0 --dir ./downloads`
  Download all assets for a specific release to a local directory.

---

## Search (gh search)

Use these commands to search for code, commits, issues, PRs, and repositories across GitHub.

- `env -u GITHUB_TOKEN gh search code "TODO"`
  Search for code containing a specific string or pattern.
- `env -u GITHUB_TOKEN gh search commits "fix bug"`
  Search commit messages matching a string.
- `env -u GITHUB_TOKEN gh search issues "state:open label:bug"`
  Search issues across repositories.
- `env -u GITHUB_TOKEN gh search prs "is:open author:@me"`
  Search pull requests.
- `env -u GITHUB_TOKEN gh search repos "language:python stars:>1000"`
  Search repositories by language and popularity.

---

## Advanced API Requests (gh api)

Use the API command to run custom queries that are not supported by the built-in subcommands.

- `env -u GITHUB_TOKEN gh api /user`
  Retrieve details of the currently authenticated user.
- `env -u GITHUB_TOKEN gh api /repos/owner/repo/pulls/123/reviews`
  Retrieve raw reviews data for a specific pull request.
- `env -u GITHUB_TOKEN gh api graphql -f query='query { viewer { login } }'`
  Run a custom GraphQL query against the GitHub API.

---

## Rulesets (gh ruleset)

Use these commands to inspect branch protection and repository rulesets.

- `env -u GITHUB_TOKEN gh ruleset list`
  List rulesets applied to the repository.
- `env -u GITHUB_TOKEN gh ruleset view 123`
  View details of a specific ruleset.
- `env -u GITHUB_TOKEN gh ruleset check --branch main`
  Check which rulesets apply to a specific branch.

---

## Attestations (gh attestation)

Use these commands to verify build artifacts using Sigstore/GitHub attestations.

- `env -u GITHUB_TOKEN gh attestation verify owner/repo`
  Verify the authenticity of an attestation for a repository.
- `env -u GITHUB_TOKEN gh attestation download owner/repo --artifact-id 123`
  Download an attestation for an artifact.
