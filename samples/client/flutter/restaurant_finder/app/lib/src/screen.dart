// Copyright 2025 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import 'package:flutter/material.dart';
import 'package:genui/genui.dart';

import 'primitives.dart';
import 'session.dart';

class RestaurantScreen extends StatefulWidget {
  const RestaurantScreen({
    super.key,
    required this.onToggleTheme,
    required this.themeMode,
  });

  final VoidCallback onToggleTheme;
  final ThemeMode themeMode;

  @override
  State<RestaurantScreen> createState() => _RestaurantScreenState();
}

class _RestaurantScreenState extends State<RestaurantScreen> {
  final TextEditingController _textController = TextEditingController(
    text: 'Find me 3 Chinese restaurants in New York.',
  );
  final ScrollController _scrollController = ScrollController();
  late final RestaurantSession _session;

  @override
  void initState() {
    super.initState();
    _session = RestaurantSession();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _session,
      builder: (context, _) => Scaffold(
        body: SafeArea(
          child: Stack(
            children: [
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 640),
                  child: _buildContent(),
                ),
              ),
              Positioned(
                top: 8,
                right: 16,
                child: ThemeToggleButton(
                  themeMode: widget.themeMode,
                  onToggle: widget.onToggleTheme,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildContent() {
    if (_session.isRequesting) {
      return Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(
            _session.loadingText,
            style: Theme.of(context).textTheme.bodyLarge,
          ),
        ],
      );
    }

    if (!_session.hasSentMessage) {
      return _buildForm();
    }

    return _buildSurfaces();
  }

  Widget _buildForm() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 48, 16, 16),
      child: Column(
        children: [
          const Icon(Icons.restaurant, size: 80, color: Colors.orange),
          const SizedBox(height: 16),
          Text(
            'Restaurant Finder',
            style: Theme.of(
              context,
            ).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 32),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _textController,
                  decoration: InputDecoration(
                    hintText: 'Find me 3 Italian restaurants in New York.',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(32),
                    ),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 24,
                      vertical: 16,
                    ),
                  ),
                  onSubmitted: _session.isRequesting
                      ? null
                      : (_) => _sendMessage(),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: _session.isRequesting ? null : _sendMessage,
                style: FilledButton.styleFrom(
                  shape: const CircleBorder(),
                  padding: const EdgeInsets.all(16),
                ),
                child: const Icon(Icons.send),
              ),
            ],
          ),
          if (_session.error != null) ...[
            const SizedBox(height: 16),
            ErrorBanner(message: _session.error!),
          ],
        ],
      ),
    );
  }

  Widget _buildSurfaces() {
    final List<String> surfaceIds = _session.activeSurfaceIds.toList();
    return Column(
      children: [
        if (_session.error != null) ErrorBanner(message: _session.error!),
        Expanded(
          child: surfaceIds.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.all(12),
                  itemCount: surfaceIds.length,
                  itemBuilder: (context, i) => Surface(
                    surfaceContext: _session.surfaceHost.contextFor(
                      surfaceIds[i],
                    ),
                  ),
                ),
        ),
      ],
    );
  }

  Future<void> _sendMessage() async {
    final String text = _textController.text.trim();
    if (text.isEmpty) return;
    await _session.sendMessage(text);
  }

  @override
  void dispose() {
    _session.dispose();
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }
}
