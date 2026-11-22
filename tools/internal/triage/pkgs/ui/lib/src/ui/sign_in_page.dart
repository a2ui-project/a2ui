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

import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../github/github_access.dart';
import 'triage_scope.dart';

/// Shows the sign-in until the triager is signed in to GitHub, and then
/// [child], and starts loading the items. Used on the web only.
class SignInGate extends StatefulWidget {
  const SignInGate({super.key, required this.access, required this.child});

  final GitHubAccess access;
  final Widget child;

  @override
  State<SignInGate> createState() => _SignInGateState();
}

class _SignInGateState extends State<SignInGate> {
  bool _started = false;

  @override
  void initState() {
    super.initState();
    widget.access.addListener(_changed);
    _startIfSignedIn();
  }

  @override
  void dispose() {
    widget.access.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    _startIfSignedIn();
    setState(() {});
  }

  void _startIfSignedIn() {
    if (!_started && widget.access.state == SignInState.signedIn) {
      _started = true;
      unawaited(TriageScope.read(context).start());
    }
  }

  @override
  Widget build(BuildContext context) => switch (widget.access.state) {
    SignInState.checking => const Scaffold(
      body: Center(child: CircularProgressIndicator()),
    ),
    SignInState.signedOut => SignInPage(access: widget.access),
    SignInState.serverUnavailable => Scaffold(
      appBar: AppBar(title: const Text('A2UI triage')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          spacing: 16,
          children: [
            SelectionArea(child: Text(widget.access.error ?? '')),
            Tooltip(
              message: 'Ask the server again whether you are signed in',
              child: FilledButton(
                onPressed: () => unawaited(widget.access.check()),
                child: const Text('Try again'),
              ),
            ),
          ],
        ),
      ),
    ),
    SignInState.signedIn => widget.child,
  };
}

/// "Sign in with GitHub", when the server offers it, and "Use a token".
class SignInPage extends StatefulWidget {
  const SignInPage({super.key, required this.access});

  final GitHubAccess access;

  @override
  State<SignInPage> createState() => _SignInPageState();
}

class _SignInPageState extends State<SignInPage> {
  final TextEditingController _token = TextEditingController();

  @override
  void dispose() {
    _token.dispose();
    super.dispose();
  }

  void _useToken() => unawaited(widget.access.useToken(_token.text));

  @override
  Widget build(BuildContext context) {
    final GitHubAccess access = widget.access;
    final TextTheme text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('A2UI triage')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: SelectionArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              spacing: 16,
              children: [
                Text('Sign in to GitHub', style: text.headlineSmall),
                const Text(
                  'The triage UI reads and changes GitHub items as you. '
                  'Replies, labels and assignees are posted from your '
                  'account.',
                ),
                if (access.canSignInWithGitHub) ...[
                  Tooltip(
                    message: 'Go to GitHub to sign in, and come back here',
                    child: FilledButton.icon(
                      icon: const Icon(Icons.login),
                      onPressed: access.signInWithGitHub,
                      label: const Text('Sign in with GitHub'),
                    ),
                  ),
                  const Text('Or use a token:'),
                ],
                const Text(
                  'Run "gh auth token" in a terminal and paste the token, or '
                  'paste a personal access token with the public_repo scope.',
                ),
                TextField(
                  controller: _token,
                  obscureText: true,
                  autocorrect: false,
                  enableSuggestions: false,
                  decoration: const InputDecoration(
                    labelText: 'GitHub token',
                    border: OutlineInputBorder(),
                  ),
                  onSubmitted: (_) => _useToken(),
                ),
                Text(
                  access.hasServer
                      ? 'The server keeps the token in an encrypted cookie '
                            'of this browser.'
                      : "This browser keeps the token in the page's "
                            'local storage, until you sign out.',
                  style: text.bodySmall,
                ),
                if (access.error case final String error)
                  Text(
                    error,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                Tooltip(
                  message: 'Check the token with GitHub, and sign in with it',
                  child: OutlinedButton(
                    onPressed: access.busy ? null : _useToken,
                    child: const Text('Use token'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
