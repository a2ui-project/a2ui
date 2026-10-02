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

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';

import 'src/scenarios.dart';

void main() {
  runApp(const A2uiExplorerApp());
}

/// The reference A2UI Explorer and debugging application.
class A2uiExplorerApp extends StatelessWidget {
  const A2uiExplorerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'A2UI Explorer',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1A73E8),
          brightness: Brightness.light,
        ),
      ),
      home: const A2uiExplorerScreen(),
    );
  }
}

class A2uiExplorerScreen extends StatefulWidget {
  const A2uiExplorerScreen({super.key});

  @override
  State<A2uiExplorerScreen> createState() => _A2uiExplorerScreenState();
}

class _A2uiExplorerScreenState extends State<A2uiExplorerScreen> {
  ExplorerScenario _selectedScenario = standardScenarios.first;
  int _currentMessageIndex = 0;

  late Catalog<FlutterComponentImplementation, FunctionImplementation> _catalog;
  late MessageProcessor<FlutterComponentImplementation> _processor;
  SurfaceModel<FlutterComponentImplementation>? _surface;

  final List<A2uiClientAction> _actionLogs = <A2uiClientAction>[];
  Map<String, dynamic> _dataModelSnapshot = const {};
  void Function()? _dataModelUnsubscribe;

  @override
  void dispose() {
    _dataModelUnsubscribe?.call();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _loadScenario(_selectedScenario);
  }

  void _loadScenario(ExplorerScenario scenario, {bool advanceToEnd = true}) {
    _dataModelUnsubscribe?.call();
    _dataModelUnsubscribe = null;
    _surface = null;
    _catalog = createBasicCatalog();
    _processor = MessageProcessor<FlutterComponentImplementation>(
      catalogs: [_catalog],
      protocolVersion: A2uiProtocolVersion.v0_9,
      validationConfig: ValidationConfig.relaxed,
    );

    _processor.groupModel.onSurfaceCreated.addListener((surface) {
      _surface = surface;
      _surface!.onAction.addListener((action) {
        if (mounted) {
          setState(() {
            _actionLogs.insert(0, action);
            _refreshDataModelSnapshot();
          });
        }
      });

      _dataModelUnsubscribe?.call();
      _dataModelUnsubscribe = _surface!.dataModel.watch<Object?>('/').subscribe(
        (_) {
          if (mounted) {
            setState(_refreshDataModelSnapshot);
          }
        },
      );
    });

    _actionLogs.clear();
    setState(() {
      _selectedScenario = scenario;
      _currentMessageIndex = 0;
      _dataModelSnapshot = const {};
    });

    if (advanceToEnd) {
      _playAllMessages();
    } else {
      _advanceMessage();
    }
  }

  void _refreshDataModelSnapshot() {
    if (_surface != null) {
      final Object? raw = _surface!.dataModel.get('/');
      if (raw is Map<String, dynamic>) {
        _dataModelSnapshot = raw;
      } else {
        _dataModelSnapshot = <String, dynamic>{'/': raw};
      }
    }
  }

  void _advanceMessage() {
    if (_currentMessageIndex >= _selectedScenario.rawMessages.length) return;

    final Map<String, dynamic> rawMessage =
        _selectedScenario.rawMessages[_currentMessageIndex];
    final payload = AgentToRendererMessagePayload.fromJson(
      rawMessage,
      protocolVersion: A2uiProtocolVersion.v0_9,
    );

    _processor.processMessages(payload);

    setState(() {
      _currentMessageIndex++;
      _refreshDataModelSnapshot();
    });
  }

  void _playAllMessages() {
    while (_currentMessageIndex < _selectedScenario.rawMessages.length) {
      _advanceMessage();
    }
  }

  void _resetScenario() {
    _loadScenario(_selectedScenario, advanceToEnd: false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            const Icon(Icons.hub_outlined, color: Colors.blueAccent),
            const SizedBox(width: 8),
            const Text(
              'A2UI Explorer',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
            ),
            const SizedBox(width: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.blue.shade50,
                borderRadius: BorderRadius.circular(4),
                border: Border.all(color: Colors.blue.shade200),
              ),
              child: const Text(
                'v0.9 Flutter Adapter',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: Colors.blue,
                ),
              ),
            ),
          ],
        ),
        elevation: 1,
      ),
      body: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 1. Left Column: Scenario Navigation
          SizedBox(width: 280, child: _buildScenarioList()),
          const VerticalDivider(width: 1),

          // 2. Center Column: Surface Preview & Interactive Stepper
          Expanded(flex: 3, child: _buildCenterColumn()),
          const VerticalDivider(width: 1),

          // 3. Right Column: Live DataModel & Action Logs
          SizedBox(width: 320, child: _buildRightInspectionColumn()),
        ],
      ),
    );
  }

  Widget _buildScenarioList() {
    return Material(
      color: Colors.grey.shade50,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            color: Colors.grey.shade100,
            child: const Text(
              'SAMPLE SCENARIOS',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.bold,
                color: Colors.black54,
                letterSpacing: 1.1,
              ),
            ),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: standardScenarios.length,
              itemBuilder: (context, index) {
                final ExplorerScenario scenario = standardScenarios[index];
                final isSelected = scenario.id == _selectedScenario.id;

                return ListTile(
                  dense: true,
                  selected: isSelected,
                  selectedTileColor: Colors.blue.shade50,
                  title: Text(
                    scenario.title,
                    style: TextStyle(
                      fontWeight: isSelected
                          ? FontWeight.bold
                          : FontWeight.w500,
                      color: isSelected ? Colors.blue.shade800 : Colors.black87,
                    ),
                  ),
                  subtitle: Text(
                    scenario.description,
                    style: const TextStyle(fontSize: 11),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  onTap: () => _loadScenario(scenario),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCenterColumn() {
    final int totalMessages = _selectedScenario.rawMessages.length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Stepper Toolbar
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          color: Colors.white,
          child: Row(
            children: [
              IconButton.filledTonal(
                icon: const Icon(Icons.refresh, size: 20),
                tooltip: 'Reset Scenario',
                onPressed: _resetScenario,
              ),
              const SizedBox(width: 8),
              FilledButton.icon(
                icon: const Icon(Icons.skip_next, size: 20),
                label: const Text('Advance 1 Message'),
                onPressed: _currentMessageIndex < totalMessages
                    ? _advanceMessage
                    : null,
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                icon: const Icon(Icons.fast_forward, size: 20),
                label: const Text('Play All'),
                onPressed: _currentMessageIndex < totalMessages
                    ? _playAllMessages
                    : null,
              ),
              const Spacer(),
              Text(
                'Processed: $_currentMessageIndex / $totalMessages',
                style: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                  color: Colors.black87,
                ),
              ),
            ],
          ),
        ),
        const Divider(height: 1),

        // Surface Preview Host
        Expanded(
          flex: 3,
          child: Container(
            color: const Color(0xFFF8F9FA),
            padding: const EdgeInsets.all(16),
            child: Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
                side: BorderSide(color: Colors.grey.shade300),
              ),
              color: Colors.white,
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: _surface != null
                    ? A2uiSurface(
                        key: ValueKey(_surface!.id),
                        surface: _surface!,
                      )
                    : const Center(
                        child: Text(
                          'No active surface. Click "Advance" or "Play All".',
                        ),
                      ),
              ),
            ),
          ),
        ),
        const Divider(height: 1),

        // JSON Message Stream view
        Expanded(flex: 2, child: _buildMessageStream()),
      ],
    );
  }

  Widget _buildMessageStream() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          color: Colors.grey.shade100,
          child: const Text(
            'JSON MESSAGE STREAM',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.bold,
              color: Colors.black54,
              letterSpacing: 1.1,
            ),
          ),
        ),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(8),
            itemCount: _selectedScenario.rawMessages.length,
            itemBuilder: (context, index) {
              final Map<String, dynamic> raw =
                  _selectedScenario.rawMessages[index];
              final bool isApplied = index < _currentMessageIndex;
              final isNext = index == _currentMessageIndex;

              final String jsonStr = const JsonEncoder.withIndent(
                '  ',
              ).convert(raw);

              final Color borderColor = isApplied
                  ? Colors.green.shade300
                  : (isNext ? Colors.blue.shade400 : Colors.grey.shade300);

              final Color headerColor = isApplied
                  ? Colors.green.shade50
                  : (isNext ? Colors.blue.shade100 : Colors.grey.shade100);

              return Container(
                margin: const EdgeInsets.only(bottom: 8),
                decoration: BoxDecoration(
                  color: isApplied
                      ? Colors.grey.shade50
                      : (isNext ? Colors.blue.shade50 : Colors.white),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: borderColor, width: isNext ? 2 : 1),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      color: headerColor,
                      child: Row(
                        children: [
                          Icon(
                            isApplied
                                ? Icons.check_circle
                                : (isNext
                                      ? Icons.play_arrow
                                      : Icons.radio_button_unchecked),
                            size: 14,
                            color: isApplied
                                ? Colors.green.shade700
                                : (isNext ? Colors.blue.shade700 : Colors.grey),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            'Message #${index + 1}: ${_messageType(raw)}',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: isApplied
                                  ? Colors.green.shade900
                                  : (isNext
                                        ? Colors.blue.shade900
                                        : Colors.black54),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(8.0),
                      child: SelectableText(
                        jsonStr,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 11,
                        ),
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildRightInspectionColumn() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Live Data Model Inspector
        Container(
          padding: const EdgeInsets.all(12),
          color: Colors.grey.shade100,
          child: const Text(
            'DATA MODEL INSPECTOR',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.bold,
              color: Colors.black54,
              letterSpacing: 1.1,
            ),
          ),
        ),
        Expanded(
          flex: 1,
          child: Container(
            color: Colors.white,
            padding: const EdgeInsets.all(12),
            child: SingleChildScrollView(
              child: SelectableText(
                const JsonEncoder.withIndent('  ').convert(_dataModelSnapshot),
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: Color(0xFF1E88E5),
                ),
              ),
            ),
          ),
        ),
        const Divider(height: 1),

        // Action Logs Pane
        Container(
          padding: const EdgeInsets.all(12),
          color: Colors.grey.shade100,
          child: Row(
            children: [
              const Text(
                'ACTION LOGS',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: Colors.black54,
                  letterSpacing: 1.1,
                ),
              ),
              const Spacer(),
              if (_actionLogs.isNotEmpty)
                IconButton(
                  icon: const Icon(Icons.delete_outline, size: 16),
                  visualDensity: VisualDensity.compact,
                  onPressed: () => setState(_actionLogs.clear),
                ),
            ],
          ),
        ),
        Expanded(
          flex: 1,
          child: _actionLogs.isEmpty
              ? const Center(
                  child: Text(
                    'No actions dispatched yet.',
                    style: TextStyle(fontSize: 12, color: Colors.grey),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(8),
                  itemCount: _actionLogs.length,
                  itemBuilder: (context, index) {
                    final A2uiClientAction action = _actionLogs[index];
                    final String h = action.timestamp.hour.toString().padLeft(
                      2,
                      '0',
                    );
                    final String m = action.timestamp.minute.toString().padLeft(
                      2,
                      '0',
                    );
                    final String s = action.timestamp.second.toString().padLeft(
                      2,
                      '0',
                    );
                    final timeStr = '$h:$m:$s';
                    return Card(
                      elevation: 0,
                      color: Colors.blue.shade50.withValues(alpha: 0.5),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(6),
                        side: BorderSide(color: Colors.blue.shade200),
                      ),
                      margin: const EdgeInsets.only(bottom: 6),
                      child: Padding(
                        padding: const EdgeInsets.all(8.0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Text(
                                  action.name,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 12,
                                    color: Colors.blueAccent,
                                  ),
                                ),
                                const Spacer(),
                                Text(
                                  timeStr,
                                  style: const TextStyle(
                                    fontSize: 10,
                                    color: Colors.grey,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            SelectableText(
                              const JsonEncoder.withIndent(
                                '  ',
                              ).convert(action.context),
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 10,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  String _messageType(Map<String, dynamic> raw) {
    return raw.keys.firstWhere((k) => k != 'version', orElse: () => 'message');
  }
}
