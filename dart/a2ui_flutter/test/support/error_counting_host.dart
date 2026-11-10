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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
// ignore: deprecated_member_use, see https://github.com/a2ui-project/a2ui/issues/3235
import 'package:flutter/material.dart';

/// Counts [surface]'s errors with a plain `setState`, as an app would.
class ErrorCountingHost extends StatefulWidget {
  const ErrorCountingHost(this.surface, {super.key});

  final SurfaceModel<ComponentImplementation> surface;

  @override
  State<ErrorCountingHost> createState() => _ErrorCountingHostState();
}

class _ErrorCountingHostState extends State<ErrorCountingHost> {
  int _errors = 0;
  late final Subscription _subscription;

  @override
  void initState() {
    super.initState();
    _subscription = widget.surface.onError.subscribe(
      (_) => setState(() => _errors++),
    );
  }

  @override
  void dispose() {
    _subscription.unsubscribe();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Column(
      children: [
        Text('errors: $_errors'),
        A2uiSurface(surface: widget.surface),
      ],
    ),
  );
}
