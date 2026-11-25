# server

The server of the hosted [triage UI](../ui/): a small Dart program that serves
the web app, signs the triager in to GitHub, and passes the app's GitHub calls
through with the triager's token. [HOSTING.md](HOSTING.md) explains how to
host it.

The macOS app and `flutter run -d chrome` do not need it. They call GitHub
directly, as described in the [ui README](../ui/README.md#github-access).

## What the container hosts

The Cloud Run container runs one process, the **Server**. The **App** is not a
separate program there: it is a folder of static files in the same image,
which the **Server** sends to the **Browser**.

```text
container image
├── /app/server          ← the Server: compiled Dart binary, the only thing running
└── /app/web/            ← the App: output of `flutter build web`, just files
    ├── index.html
    ├── main.dart.js
    ├── flutter_bootstrap.js
    └── assets/…
```

The **Server** listens on port 8080 and routes by path:

| Path                              | What the Server does                                               |
| --------------------------------- | ------------------------------------------------------------------ |
| `/`, `/main.dart.js`, `/assets/…` | Returns the file from `/app/web/` (the **App**)                    |
| `/auth/…`                         | Sign-in with GitHub, a pasted token, sign-out, status              |
| `/github/…`                       | Adds the triager's token and forwards [the App's calls](#the-github-proxy) to `api.github.com` |
| `/healthz`                        | Answers `ok`                                                       |

Once the **Browser** has the App's files, the **App** runs in the **Browser**,
not in the container. After that, the container only answers `/auth/…` and
`/github/…` calls.

The image is built in two stages by the [Dockerfile](Dockerfile), which Cloud
Build runs:

1. **Build stage**, an image with Flutter: `flutter build web` makes the
   App's files, and `dart compile exe` makes the Server binary.
2. **Run stage**, a small Debian image: only the binary, the `web/` folder,
   and the CA certificates for HTTPS to GitHub. No Flutter or Dart SDK.

The Cloud Run service keeps no data between requests and scales to zero when
nobody uses it.

## Actors

| Actor              | What it is                                                                                              | Where it runs                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Triager**        | The Googler who uses the tool                                                                           | —                                                                |
| **Browser**        | The triager's browser                                                                                   | Triager's computer                                               |
| **UberProxy**      | Google's corp gateway, which only lets signed-in Googlers through                                       | Google                                                           |
| **App**            | The Flutter web app ([`pkgs/ui`](../ui/)), compiled to JavaScript                                       | In the **Browser**                                               |
| **Server**         | This package: serves the **App**'s files, signs the triager in, and passes GitHub calls through         | Cloud Run, or the triager's computer when run locally            |
| **GitHub sign-in** | GitHub's OAuth pages and token endpoint                                                                 | `github.com`                                                     |
| **GitHub API**     | GitHub's REST and GraphQL API                                                                           | `api.github.com`                                                 |
| **OAuth App**      | The app's registration on GitHub: a client ID and a client secret. Only the **Server** knows the secret | Registered on GitHub; the secret is in the **Server**'s settings |

## Signing in

### A. Sign in with GitHub (hosted)

1. **Triager** opens the hosted URL in the **Browser**.
2. **UberProxy** checks that the **Triager** is a Googler, and passes the
   request to the **Server**.
3. **Server** sends the **App**'s files to the **Browser**, which starts the
   **App**.
4. **App** asks **Server** `GET /auth/status`. **Server** finds no session
   cookie, and answers "not signed in".
5. **App** shows **Sign in with GitHub** and **Use a token**.
6. **Triager** clicks **Sign in with GitHub**. **App** sends the **Browser**
   to **Server** `/auth/login?return=/?item=…`, so that the item in the URL
   is kept.
7. **Server** makes a random `state` and a PKCE verifier, and puts them, with
   the return path, in a short-lived encrypted cookie (10 minutes). It
   redirects the **Browser** to **GitHub sign-in**, with the **OAuth App**'s
   client ID, the callback URL, `scope=public_repo`, the `state`, and the
   PKCE challenge.
8. **GitHub sign-in** asks the **Triager**, the first time only, to authorize
   the **OAuth App**. The **Triager** agrees.
9. **GitHub sign-in** redirects the **Browser** to **Server**
   `/auth/callback?code=…&state=…`, through **UberProxy** again.
10. **Server** checks that `state` matches the cookie, which proves that the
    sign-in started in this **Browser**, not on another site. Only then does
    it show an error that GitHub sent, so that a link from another site
    cannot put its own text on the page.
11. **Server** sends the code, the **OAuth App**'s client secret and the PKCE
    verifier to **GitHub sign-in**, which returns the **Triager**'s token.
12. **Server** asks **GitHub API** `GET /user` with the token, and learns the
    **Triager**'s login.
13. **Server** encrypts the token and the login into the session cookie
    (`HttpOnly; Secure; SameSite=Lax`, 30 days), deletes the short-lived
    cookie, and redirects the **Browser** back to the return path. Over
    HTTPS, the cookie names start with `__Host-`, so that another service on
    the same domain, such as `cr.gclb.goog`, cannot set a cookie with the
    same name. If the **Browser** sends several cookies with the name anyway,
    **Server** uses the one it can decrypt.
14. **App** starts again, asks `GET /auth/status`, gets "signed in as
    `<login>`", and loads the items.

Working after the sign-in:

15. **App** sends each GitHub call to **Server** `/github/…`, with the
    `X-Requested-With` header. The **Browser** attaches the session cookie by
    itself.
16. **Server** decrypts the cookie, checks the header, which a page on
    another site cannot add, checks that the **App** makes such calls, and
    forwards the call to **GitHub API** with `Authorization: Bearer <token>`.
17. **GitHub API** answers. **Server** passes the answer back to the **App**,
    and rewrites the pagination links to point at the **Server**.
18. GitHub records every comment, label and assignee as made by the
    **Triager**, within the **Triager**'s rate limit. The **App**'s JavaScript
    never sees the token.

Ending the session:

19. **Triager** clicks **Sign out** in the menu. **Server** revokes the
    token with **GitHub API** (`DELETE /applications/<client ID>/token`), so
    that a copy of the cookie stops working too, and deletes the cookie. The
    **OAuth App** stays authorized on GitHub, so the next sign-in skips step 8.
20. If the token stops working, for example because the **Triager** revoked
    it on GitHub, **GitHub API** answers 401. **Server** passes the answer on
    and deletes the cookie, and after a reload the **App** shows the sign-in
    again.

### B. Use a token (hosted)

1. Steps A.1 to A.5.
2. **Triager** runs `gh auth token` in a terminal, clicks into **GitHub
   token**, pastes the token, and clicks **Use token**.
3. **App** sends the token once to **Server** `POST /auth/token`.
4. **Server** checks it with **GitHub API** `GET /user`, and stores it in the
   same encrypted cookie as in step A.13.
5. From there, steps A.14 to A.20. **GitHub sign-in** and the **OAuth App**
   are not involved.

On **Sign out**, **Server** deletes the cookie but does not revoke the token,
which is the **Triager**'s own, such as the one of `gh`. A copy of the cookie
works until it expires, 30 days after the sign-in, or until the **Triager**
revokes the token on GitHub.

### C. Locally, without the Server

With `flutter run -d chrome`, Flutter's development server serves the **App**,
and there is no **Server**:

1. **App** asks `/auth/status`, gets no answer from a **Server**, and shows
   only **Use a token**. The App does this only when it was built without
   `--dart-define=TRIAGE_SERVER=true`, which the hosted build sets. With `--dart-define=GITHUB_TOKEN=<token>`, it skips
   this and uses that token.
2. **Triager** pastes a token. **App** keeps it in the **Browser**'s local
   storage, until **Sign out**.
3. **App** calls **GitHub API** directly with the token.

The macOS app has no **Browser**, **UberProxy** or **Server**. It uses the
token in `GITHUB_TOKEN` or `GH_TOKEN`, or else the one that `gh auth token`
prints. Without one, it shows only **Use a token** and keeps the pasted token
until the **Triager** quits it. It calls **GitHub API**
directly.

### D. Locally, with the Server

To try the sign-in, the **Triager** runs the **Server** on their computer, as
in [Running locally](#running-locally), with a development **OAuth App** whose
callback URL is `http://localhost:8080/auth/callback`. Everything then
follows A and B, without **UberProxy**.

## Settings

The Server reads its settings from environment variables:

| Variable                                               | Meaning                                                                                        | Default                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `PORT`                                                 | The port to listen on                                                                          | `8080`                                      |
| `PUBLIC_URL`                                           | The URL the **Browser** opens. GitHub sends the triager back to `<PUBLIC_URL>/auth/callback`   | `http://localhost:<PORT>`                   |
| `WEB_DIR`                                              | The folder with the output of `flutter build web`                                              | `../ui/build/web` (`/app/web` in the image) |
| `SESSION_SECRET`                                       | The secret that the cookie encryption key is made from. Changing it signs everyone out. Required on Cloud Run, where each instance would make its own | Random, so a restart signs everyone out     |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | The **OAuth App**. Without them, **Sign in with GitHub** is off and only **Use a token** works | Not set                                     |

The Server listens on all network interfaces on Cloud Run, which sets
`K_SERVICE`, and only on localhost elsewhere. Cookies are `Secure` when
`PUBLIC_URL` is `https`.

## The GitHub proxy

The triager's token can do much more than triage, for example when it is the
one of `gh`. So `/github/` passes on only the calls that the **App** makes,
and answers 403 to others:

| Call                                                           | What the **App** does with it |
| -------------------------------------------------------------- | ----------------------------- |
| `POST /graphql`                                                | Reads items, and closes them  |
| `PATCH /repos/<repository>/issues/<number>`                    | Sets or removes the milestone |
| `POST /repos/<repository>/issues/<number>/comments`            | Posts the reply               |
| `POST /repos/<repository>/issues/<number>/labels`              | Adds labels                   |
| `DELETE /repos/<repository>/issues/<number>/labels/<label>`    | Removes a label               |
| `POST`, `DELETE /repos/<repository>/issues/<number>/assignees` | Assigns and unassigns people  |

`<repository>` is `a2ui-project/a2ui` or `flutter/genui`. GraphQL queries
change nothing, and the only mutations it passes on are `closeIssue` and
`closePullRequest`. When the **App** starts making another call, add it to
`lib/src/server/github_proxy.dart`.

## Running locally

In the repository root, run `flutter pub get`. Then, in this folder:

```bash
(cd ../ui && flutter build web --dart-define=TRIAGE_SERVER=true)
dart run bin/server.dart
```

`TRIAGE_SERVER=true` tells the **App** that a **Server** serves it. Then, if
`/auth/status` fails, the **App** shows an error with **Try again**, rather
than taking the **Server** for Flutter's development server and keeping a
pasted token in the **Browser**'s local storage.

and open `http://localhost:8080`. This offers only **Use a token**. To also
sign in with GitHub, register a development **OAuth App** as in
[HOSTING.md](HOSTING.md#2-register-the-github-oauth-app), with the callback URL
`http://localhost:8080/auth/callback`, and start the Server with its client
ID and secret:

```bash
GITHUB_OAUTH_CLIENT_ID=… GITHUB_OAUTH_CLIENT_SECRET=… dart run bin/server.dart
```

## Code

- `bin/server.dart`: reads the settings, and starts the Server.
- `lib/src/server/handler.dart`: routes the requests.
- `lib/src/server/auth.dart`: `/auth/`, the steps above.
- `lib/src/server/github_proxy.dart`: `/github/`, with the calls it passes
  on. `graphql_mutations.dart` finds the mutations in a GraphQL request.
- `lib/src/server/cookies.dart` and `sealer.dart`: the encrypted cookies
  (AES-256-GCM).
- `lib/src/server/config.dart`: the settings.
- [Dockerfile](Dockerfile) and [deploy.sh](deploy.sh): the image, and the
  deployment to Corp Run.

## Testing

```bash
dart test
```

The tests replace GitHub with a fake, in `test/server/handler_test.dart`.
