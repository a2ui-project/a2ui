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

import 'dart:convert';
import 'dart:math' as math;

import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

import 'example.dart';
import 'example_run.dart';
import 'examples.g.dart';

/// The gallery app of the A2UI Flutter renderer.
class ExplorerApp extends StatelessWidget {
  const ExplorerApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'A2UI Explorer',
    theme: ThemeData(colorSchemeSeed: Colors.indigo),
    home: const ExplorerPage(),
  );
}

/// Three columns: the examples, the selected example's surfaces, messages and
/// stepper, and its data models and action log.
///
/// Selecting an example processes all of its messages. Reset starts it over
/// with none processed. Below 1120 logical pixels wide, the columns scroll
/// horizontally.
class ExplorerPage extends StatefulWidget {
  const ExplorerPage({super.key});

  @override
  State<ExplorerPage> createState() => _ExplorerPageState();
}

class _ExplorerPageState extends State<ExplorerPage> {
  ExampleRun _run = ExampleRun(examples.first)..runAll();

  /// Starts [example] over in a new run, with all of its messages processed
  /// when [runAll] is true. The previous run is disposed after the frame that
  /// removes its surfaces.
  void _start(Example example, {bool runAll = false}) {
    final ExampleRun previous = _run;
    final run = ExampleRun(example);
    if (runAll) run.runAll();
    setState(() => _run = run);
    WidgetsBinding.instance.addPostFrameCallback((_) => previous.dispose());
  }

  @override
  void dispose() {
    _run.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SizedBox(
          width: math.max(constraints.maxWidth, 1120),
          height: constraints.maxHeight,
          child: ListenableBuilder(
            listenable: _run,
            builder: (context, _) => Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(width: 280, child: _examplesPane()),
                const VerticalDivider(width: 1),
                Expanded(child: _runPane(context)),
                const VerticalDivider(width: 1),
                SizedBox(width: 360, child: _inspectorPane()),
              ],
            ),
          ),
        ),
      ),
    ),
  );

  Widget _examplesPane() => _Pane(
    title: 'Examples',
    child: ListView.builder(
      key: const Key('examples'),
      itemCount: examples.length,
      itemBuilder: (context, index) {
        final Example example = examples[index];
        return ListTile(
          key: ValueKey(example.fileName),
          title: Text(example.name),
          subtitle: Text(example.description),
          selected: identical(example, _run.example),
          onTap: () => _start(example, runAll: true),
        );
      },
    ),
  );

  Widget _runPane(BuildContext context) {
    final ExampleRun run = _run;
    final List<SurfaceModel<ComponentImplementation>> surfaces = run.surfaces;
    final TextTheme text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: 8,
            children: [
              Text(run.example.name, style: text.titleLarge),
              Text(run.example.description),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  FilledButton(
                    onPressed: run.canAdvance ? run.advance : null,
                    child: const Text('Advance'),
                  ),
                  OutlinedButton(
                    onPressed: run.canAdvance ? run.runAll : null,
                    child: const Text('Run all'),
                  ),
                  TextButton(
                    onPressed: () => _start(run.example),
                    child: const Text('Reset'),
                  ),
                  Text(
                    '${run.processed} of ${run.messages.length} messages '
                    'processed',
                  ),
                ],
              ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          flex: 3,
          child: surfaces.isEmpty
              ? const Center(child: Text('No surface yet.'))
              : A2uiMarkdown(
                  builder: _markdown,
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      spacing: 16,
                      children: [
                        for (final surface in surfaces)
                          A2uiSurface(
                            key: ObjectKey(surface),
                            surface: surface,
                          ),
                      ],
                    ),
                  ),
                ),
        ),
        const Divider(height: 1),
        Expanded(
          flex: 2,
          child: _Pane(
            title: 'Messages',
            child: _JsonList(
              key: const Key('messages'),
              empty: 'No message.',
              children: [
                for (final (int index, Map<String, Object?> message)
                    in run.messages.indexed)
                  _messageCard(index, message),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// The message at [index], numbered and marked processed or pending.
  Widget _messageCard(int index, Map<String, Object?> message) {
    final bool processed = index < _run.processed;
    final String type = message.keys.firstWhere(
      (key) => key != 'version',
      orElse: () => '?',
    );
    return Card.outlined(
      color: processed
          ? Theme.of(context).colorScheme.secondaryContainer
          : null,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: _JsonView(
          heading:
              '${index + 1}. $type (${processed ? 'processed' : 'pending'})',
          json: message,
        ),
      ),
    );
  }

  Widget _inspectorPane() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Expanded(
        child: _Pane(
          title: 'Data Model',
          child: _JsonList(
            key: const Key('data-model'),
            empty: 'No surface yet.',
            children: [
              for (final surface in _run.surfaces)
                _DataModelView(key: ObjectKey(surface), surface: surface),
            ],
          ),
        ),
      ),
      const Divider(height: 1),
      Expanded(
        child: _Pane(
          title: 'Action Log',
          child: _JsonList(
            key: const Key('action-log'),
            empty: 'No action yet.',
            children: [
              for (final LogEntry entry in _run.log.reversed)
                _JsonView(heading: entry.heading, json: entry.details),
            ],
          ),
        ),
      ),
    ],
  );
}

/// [title] over [child], which fills the rest of the pane.
class _Pane extends StatelessWidget {
  const _Pane({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Padding(
        padding: const EdgeInsets.all(16),
        child: Text(title, style: Theme.of(context).textTheme.titleMedium),
      ),
      Expanded(child: child),
    ],
  );
}

/// A selectable, scrolling list of [children], or [empty] when there are
/// none.
class _JsonList extends StatelessWidget {
  const _JsonList({super.key, required this.children, required this.empty});

  final List<Widget> children;
  final String empty;

  @override
  Widget build(BuildContext context) => SelectionArea(
    child: ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      children: children.isEmpty ? [Text(empty)] : children,
    ),
  );
}

/// The data model of [surface], updated as it changes.
class _DataModelView extends StatefulWidget {
  const _DataModelView({super.key, required this.surface});

  final SurfaceModel<ComponentImplementation> surface;

  @override
  State<_DataModelView> createState() => _DataModelViewState();
}

class _DataModelViewState extends State<_DataModelView> {
  late final ReadonlySignal<Object?> _root = widget.surface.dataModel
      .watch<Object?>('/');
  late final void Function() _unsubscribe;

  @override
  void initState() {
    super.initState();
    var primed = false;
    // subscribe calls back with the current value first, which this skips.
    _unsubscribe = _root.subscribe((_) {
      if (primed) {
        runOutsideBuild(() {
          if (mounted) setState(() {});
        });
      }
    });
    primed = true;
  }

  @override
  void dispose() {
    _unsubscribe();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _JsonView(
    heading: widget.surface.id,
    json: widget.surface.dataModel.get('/'),
  );
}

/// [heading] over [json], pretty-printed.
class _JsonView extends StatelessWidget {
  const _JsonView({required this.heading, required this.json});

  static const JsonEncoder _encoder = JsonEncoder.withIndent('  ', _asString);

  static Object? _asString(Object? value) => '$value';

  final String heading;
  final Object? json;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 4,
      children: [
        Text(heading, style: Theme.of(context).textTheme.titleSmall),
        Text(
          _encoder.convert(json),
          style: const TextStyle(
            fontFamily: 'monospace',
            fontFamilyFallback: ['Menlo', 'Courier New'],
            fontSize: 12,
          ),
        ),
      ],
    ),
  );
}

/// Renders a Text's [markdown] with `flutter_markdown_plus`, in [style].
Widget _markdown(BuildContext context, String markdown, TextStyle style) =>
    MarkdownBody(
      data: markdown,
      styleSheet: MarkdownStyleSheet.fromTheme(
        Theme.of(context),
      ).copyWith(p: style),
    );
