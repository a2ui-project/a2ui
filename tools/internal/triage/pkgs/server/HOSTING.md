# Hosting the triage UI

How to host the triage UI for Googlers on Corp Run, which is Cloud Run behind
UberProxy, so that only signed-in Googlers can open it. [README.md](README.md)
explains what the container holds and how the sign-in works.

The steps, once:

1. [Get a Corp Run project](#1-get-a-corp-run-project).
2. [Register the GitHub OAuth App](#2-register-the-github-oauth-app).
3. [Store the secrets](#3-store-the-secrets).
4. [Deploy](#4-deploy).
5. [Check it and share it](#5-check-it-and-share-it).

Then [update](#updating) it when the code changes.

## Before you start

1. Install the Flutter SDK, which has Dart, and run `flutter pub get` in the
   repository root. `deploy.sh` doesn't build locally, but it's handy for
   testing first.
2. Authenticate `gcloud` with your corp account:

   ```bash
   gcloud auth login
   ```

   On a Cloudtop, `gcloud` is `/google/bin/releases/cloud-sdk-build/gcloud.par`.
   `deploy.sh` finds it there.

## 1. Get a Corp Run project

The triage UI needs a Corp Run _environment_: a GCP project with Corp Run's
standard infrastructure, which is:

- the VPC network `cr-infra-vpc-network` and subnet `cr-infra-subnetwork`;
- the load balancer with _dynamic URLs_, so that each service is at
  `https://<service>-<project number>.cr.gclb.goog`;
- `roles/run.invoker` granted only to the UberProxy service accounts, so that
  only Googlers reach the services;
- your team with the `CorpRunAdmin` role.

One environment can host several services, so either:

- **Use an existing environment of your team.** Ask its owners first. The
  triage UI is a separate service, `a2ui-triage`, with its own settings and
  secrets, and doesn't change anything else in the project. Nothing else needs
  to be set up.
- **Create a new one** with the go/corp-run CLI, following go/corp-run-setup.
  It creates the GCP project and the Terraform for the infrastructure above,
  which you send for review and apply as go/corp-run-terraform describes.

Note the project ID. The URL of the triage UI will be
`https://a2ui-triage-<project number>.cr.gclb.goog`. `deploy.sh` prints it.
You need it in the next step. To find the project number:

```bash
gcloud projects describe <project ID> --format='value(projectNumber)'
```

## 2. Register the GitHub OAuth App

Register it under the `a2ui-project` organization rather than a personal
account, so that other owners can manage it: on GitHub, open the
organization's **Settings**, **Developer settings**, **OAuth Apps**, **New OAuth
App**.

- **Application name**: `A2UI triage`
- **Homepage URL**: `https://a2ui-triage-<project number>.cr.gclb.goog`
- **Authorization callback URL**:
  `https://a2ui-triage-<project number>.cr.gclb.goog/auth/callback`
- **Enable Device Flow**: off

Then click **Generate a new client secret**, and copy the client ID and the
secret to the next step. GitHub shows the secret only once.

If an organization restricts third-party access, the app's writes to its
repositories fail until an owner of the organization approves the OAuth App.
The triage UI writes to `a2ui-project/a2ui` and `flutter/genui`, so ask for
approval in both organizations if they need it.

For running the Server on your computer, register a second OAuth App with the
callback URL `http://localhost:8080/auth/callback`.

## 3. Store the secrets

Keep the secrets only in a file that only you can read, outside the
repository. Never put them in the repository, a PR, a bug, or a chat.

```bash
mkdir -p ~/.config/a2ui-triage && chmod 700 ~/.config/a2ui-triage
cat > ~/.config/a2ui-triage/deploy.env <<EOF
SESSION_SECRET=$(openssl rand -hex 32)
GITHUB_OAUTH_CLIENT_ID=<client ID>
GITHUB_OAUTH_CLIENT_SECRET=<client secret>
EOF
chmod 600 ~/.config/a2ui-triage/deploy.env
```

`SESSION_SECRET` encrypts the cookies that hold the triagers' tokens. Without
the OAuth App settings, the triage UI only offers **Use a token**.

If other team members deploy too, share the file with them securely, so that
everyone deploys the same `SESSION_SECRET`. A new one signs everyone out.

## 4. Deploy

Commit your changes first. `deploy.sh` deploys the current commit, not the
uncommitted changes. From the repository root:

```bash
tools/internal/triage/pkgs/server/deploy.sh --project <project ID> --dry-run
tools/internal/triage/pkgs/server/deploy.sh --project <project ID>
```

`--dry-run` prints the commands that change GCP, without running them.
`deploy.sh` then does the following:

1. Enables the Cloud Run, Cloud Build, Artifact Registry and IAM APIs, and
   creates the `cr-images` image repository and the
   `gs://<project ID>_cloudbuild` bucket if needed.
2. Lets the project's default compute service account, which Cloud Build runs
   as, write images to `cr-images`, use the `_cloudbuild` bucket, and write
   logs. It grants the roles on the repository and the bucket, not on the
   project, so that other services in a shared project gain nothing.
3. Copies the committed files to a temporary folder, and runs Cloud Build on
   them with the [Dockerfile](Dockerfile). The build takes a few minutes,
   mostly for `flutter build web`. Cloud Build writes its logs to the
   project's own bucket, because Corp Run admins cannot read the default
   one.
4. Creates the service account `a2ui-triage@<project ID>.iam.gserviceaccount.com`
   if needed, without roles: the Server only calls GitHub, and needs no
   access to GCP.
5. Deploys the image as the Cloud Run service `a2ui-triage`, running as that
   service account, reachable only through UberProxy
   (`--ingress=internal-and-cloud-load-balancing --no-allow-unauthenticated`),
   with 1 CPU, 512 MiB, and 0 to 3 instances. It passes the secrets in a
   temporary file that only you can read, which it deletes afterwards,
   because Corp Run admins cannot grant access to Secret Manager.

Options: `--service` for another service name, which also names its service
account, so it must have 6 to 30 characters, `--region` (default
`us-west1`), `--env-file` for another secrets file, and `--skip-build` to
deploy an image that was built for the current commit before, for example
after changing only the secrets.

Earlier versions of `deploy.sh` granted the default compute service account
`roles/storage.admin` and `roles/artifactregistry.writer` on the whole
project. If you deployed with one of them, and nothing else in the project
needs these roles, remove them:

```bash
for role in roles/storage.admin roles/artifactregistry.writer; do
  gcloud projects remove-iam-policy-binding <project ID> --condition=None \
    --member=serviceAccount:<project number>-compute@developer.gserviceaccount.com \
    --role="${role}"
done
```

## 5. Check it and share it

1. Open `https://a2ui-triage-<project number>.cr.gclb.goog/healthz`. It says
   `ok`.
2. Open `https://a2ui-triage-<project number>.cr.gclb.goog`, click **Sign in
   with GitHub**, and check that the items load.
3. Apply a change to a test item in `a2ui-project/a2ui` and in
   `flutter/genui`, to check that both organizations allow the OAuth App's
   writes.
4. Create the go link go/a2ui-triage-ui with the target
   `https://a2ui-triage-<project number>.cr.gclb.goog/`, with the slash at the
   end. The triage bot's comments link to
   `http://go/a2ui-triage-ui?item=<item URL>`, and the go link passes
   `?item=…` on to the target, so the UI opens the item. Check one such link.

## Updating

To deploy new code, commit it and run `deploy.sh` again. Each deployment is a
new Cloud Run revision. To go back to the previous one:

```bash
gcloud run revisions list --service=a2ui-triage --project=<project ID> --region=us-west1
gcloud run services update-traffic a2ui-triage --to-revisions=<revision>=100 \
  --project=<project ID> --region=us-west1
```

To change a secret, edit `deploy.env` and run `deploy.sh --skip-build`.
A new `SESSION_SECRET` signs everyone out. A new client secret doesn't.

## Troubleshooting

- **`gcloud builds submit` says the user is forbidden from accessing the
  bucket `<project ID>_cloudbuild`.** Cloud Build uploads the source there,
  and `CorpRunAdmin` cannot write to it. Someone with the Editor role on the
  project lets you read the bucket and write its objects:

  ```bash
  for role in roles/storage.legacyBucketReader roles/storage.objectAdmin; do
    gcloud storage buckets add-iam-policy-binding gs://<project ID>_cloudbuild \
      --member=user:<you>@google.com --role="${role}"
  done
  ```

- **`gcloud run deploy` says you lack `iam.serviceAccounts.actAs`.** To
  deploy a service that runs as `a2ui-triage@<project ID>.iam.gserviceaccount.com`,
  you need the Service Account User role on that account. Someone with the
  Owner role on the project grants it:

  ```bash
  gcloud iam service-accounts add-iam-policy-binding \
    a2ui-triage@<project ID>.iam.gserviceaccount.com --project=<project ID> \
    --member=user:<you>@google.com --role=roles/iam.serviceAccountUser
  ```

- **The page says the triager has no access, or shows an UberProxy error.**
  The service must be deployed with `--no-allow-unauthenticated`, and the
  project must grant `roles/run.invoker` to the UberProxy service accounts.
  See step 1.
- **GitHub says `redirect_uri` is not associated with the application.** The
  OAuth App's callback URL must be exactly `<PUBLIC_URL>/auth/callback`.
  `deploy.sh` prints the URL it uses.
- **Reading works, but applying fails with 403 or "Resource not accessible".**
  The organization of the repository hasn't approved the OAuth App. See step 2. A triager can still paste a token with **Use a token**.
- **The logs.** `gcloud run services logs read a2ui-triage --project=<project
ID> --region=us-west1`. The Server logs the method, path and status of each
  request, but no query strings, tokens or cookies.
