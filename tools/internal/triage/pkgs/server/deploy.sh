#!/usr/bin/env bash
# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Builds the hosted triage UI with Cloud Build and deploys it to Corp Run
# (Cloud Run behind UberProxy). See HOSTING.md.
#
# Usage:
#   tools/internal/triage/pkgs/server/deploy.sh --project <id> [options]
#
# Options:
#   --project <id>      The Corp Run GCP project (or $CORPRUN_PROJECT_ID).
#   --region <region>   The Cloud Run region (default: us-west1).
#   --service <name>    The Cloud Run service (default: a2ui-triage).
#   --env-file <path>   The secrets (default: ~/.config/a2ui-triage/deploy.env).
#   --skip-build        Deploy the image of the current commit, built before.
#   --dry-run           Print the commands that change GCP, without running them.
#   -h, --help          Show this help.

set -euo pipefail

project="${CORPRUN_PROJECT_ID:-}"
region="us-west1"
service="a2ui-triage"
env_file="${HOME}/.config/a2ui-triage/deploy.env"
skip_build=0
dry_run=0

usage() { sed -n '/^# Builds/,/^#   -h, --help/p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project="$2"; shift 2 ;;
    --region) region="$2"; shift 2 ;;
    --service) service="$2"; shift 2 ;;
    --env-file) env_file="$2"; shift 2 ;;
    --skip-build) skip_build=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "${project}" ]]; then
  echo "Pass --project <Corp Run project ID>." >&2
  exit 2
fi

if command -v gcloud >/dev/null 2>&1; then
  gcloud_bin="$(command -v gcloud)"
elif [[ -x /google/bin/releases/cloud-sdk-build/gcloud.par ]]; then
  gcloud_bin=/google/bin/releases/cloud-sdk-build/gcloud.par
else
  echo "Cannot find gcloud." >&2
  exit 1
fi

if [[ ! -f "${env_file}" ]]; then
  echo "Missing ${env_file}. See HOSTING.md, step 3." >&2
  exit 1
fi
# Read the secrets without printing them.
set -a
# shellcheck disable=SC1090
source "${env_file}"
set +a
if [[ -z "${SESSION_SECRET:-}" ]]; then
  echo "${env_file} must set SESSION_SECRET." >&2
  exit 1
fi
if [[ -n "${GITHUB_OAUTH_CLIENT_ID:-}" && -z "${GITHUB_OAUTH_CLIENT_SECRET:-}" ]] ||
   [[ -z "${GITHUB_OAUTH_CLIENT_ID:-}" && -n "${GITHUB_OAUTH_CLIENT_SECRET:-}" ]]; then
  echo "Set both GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET, or neither." >&2
  exit 1
fi

# A YAML string with the value of $1.
yaml_string() {
  local value="${1//\\/\\\\}"
  printf '"%s"' "${value//\"/\\\"}"
}

run() {
  if [[ "${dry_run}" -eq 1 ]]; then
    printf '[dry-run] '; printf '%q ' "$@"; printf '\n'
  else
    "$@"
  fi
}

repo_root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
commit="$(git -C "${repo_root}" rev-parse --short=12 HEAD)"
if [[ -n "$(git -C "${repo_root}" status --porcelain)" ]]; then
  echo "Warning: uncommitted changes are not deployed; commit ${commit} is." >&2
fi

project_number="$("${gcloud_bin}" projects describe "${project}" --format='value(projectNumber)')"
public_url="${PUBLIC_URL:-https://${service}-${project_number}.cr.gclb.goog}"
image="${region}-docker.pkg.dev/${project}/cr-images/${service}:${commit}"

echo "Project:      ${project} (${project_number}), ${region}"
echo "Service:      ${service}"
echo "Image:        ${image}"
echo "Public URL:   ${public_url}"
echo "Callback URL: ${public_url}/auth/callback"
echo "Sign in with GitHub: $([[ -n "${GITHUB_OAUTH_CLIENT_ID:-}" ]] && echo on || echo off)"
echo

if [[ "${skip_build}" -eq 0 ]]; then
  echo "--> Enabling the APIs"
  run "${gcloud_bin}" services enable run.googleapis.com \
    cloudbuild.googleapis.com artifactregistry.googleapis.com \
    --project="${project}"

  echo "--> Creating the image repository, if it does not exist"
  if ! "${gcloud_bin}" artifacts repositories describe cr-images \
      --project="${project}" --location="${region}" >/dev/null 2>&1; then
    run "${gcloud_bin}" artifacts repositories create cr-images \
      --project="${project}" --location="${region}" \
      --repository-format=docker
  fi

  echo "--> Letting Cloud Build write logs and images"
  compute_sa="${project_number}-compute@developer.gserviceaccount.com"
  for role in roles/storage.admin roles/logging.logWriter roles/artifactregistry.writer; do
    run "${gcloud_bin}" projects add-iam-policy-binding "${project}" \
      --member="serviceAccount:${compute_sa}" --role="${role}" \
      --condition=None --format=none
  done

  echo "--> Building the image with Cloud Build"
  # Only the committed files, so the build is the same as the commit. The
  # Dockerfile goes to the root, where Cloud Build looks for it.
  stage="$(mktemp -d)"
  git -C "${repo_root}" archive --format=tar HEAD | tar -x -C "${stage}"
  cp "${repo_root}/tools/internal/triage/pkgs/server/Dockerfile" "${stage}/Dockerfile"
  # The project's own bucket for the logs: Corp Run admins cannot read the
  # default Cloud Build logs bucket.
  run "${gcloud_bin}" builds submit "${stage}" \
    --project="${project}" --tag="${image}" \
    --gcs-log-dir="gs://${project}_cloudbuild/logs"
  rm -rf "${stage}"
fi

echo "--> Deploying to Cloud Run"
# The secrets go in a file only this user can read, so they are not on the
# command line. Corp Run admins cannot grant access to Secret Manager.
env_yaml="$(mktemp -t a2ui-triage-env.XXXXXX.yaml)"
trap 'rm -f "${env_yaml}"' EXIT
chmod 600 "${env_yaml}"
{
  echo "PUBLIC_URL: $(yaml_string "${public_url}")"
  echo "SESSION_SECRET: $(yaml_string "${SESSION_SECRET}")"
  if [[ -n "${GITHUB_OAUTH_CLIENT_ID:-}" ]]; then
    echo "GITHUB_OAUTH_CLIENT_ID: $(yaml_string "${GITHUB_OAUTH_CLIENT_ID}")"
    echo "GITHUB_OAUTH_CLIENT_SECRET: $(yaml_string "${GITHUB_OAUTH_CLIENT_SECRET}")"
  fi
} > "${env_yaml}"

# Only UberProxy may call the service (--no-allow-unauthenticated and the
# project's run.invoker binding), so only Googlers reach it.
run "${gcloud_bin}" run deploy "${service}" \
  --project="${project}" \
  --region="${region}" \
  --image="${image}" \
  --ingress=internal-and-cloud-load-balancing \
  --no-allow-unauthenticated \
  --network=cr-infra-vpc-network \
  --subnet=cr-infra-subnetwork \
  --vpc-egress=private-ranges-only \
  --cpu=1 \
  --memory=512Mi \
  --min-instances=0 \
  --max-instances=3 \
  --port=8080 \
  --env-vars-file="${env_yaml}"

echo
if [[ "${dry_run}" -eq 0 ]]; then
  echo "Deployed. Open ${public_url}"
fi
