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

import 'package:flutter/material.dart';
import 'package:logging/logging.dart';

import 'chat_session.dart';
import 'primitives/app_mode.dart';
import 'primitives/message.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Configure logging for the app.
  Logger.root.level = Level.ALL;
  Logger.root.onRecord.listen((record) {
    debugPrint('${record.level.name}: ${record.time}: ${record.message}');
  });
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    final colorScheme = ColorScheme.fromSeed(seedColor: Colors.blue);
    return MaterialApp(
      title: 'Simple Chat Controller',
      theme: ThemeData(colorScheme: colorScheme),
      darkTheme: ThemeData(
        colorScheme: colorScheme.copyWith(brightness: Brightness.dark),
      ),
      home: const ChatScreen(),
    );
  }
}

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, this.aiClient});

  final AiClient? aiClient;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

const String _defaultUserMessage =
    """I'm into rock climbing. Give me a few climbing locations around Las Vegas. I'm a beginner.""";

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _textController = TextEditingController(
    text: _defaultUserMessage,
  );
  final ScrollController _scrollController = ScrollController();
  late ChatSession _chatSession;
  AppMode _appMode = AppMode.customCatalog;

  @override
  void initState() {
    super.initState();
    _reCreateChatSession(dispose: false);
  }

  void _reCreateChatSession({bool dispose = true}) {
    if (dispose) {
      _chatSession.removeListener(_scrollToBottom);
      _chatSession.dispose();
    }
    _chatSession = ChatSession(aiClient: widget.aiClient, mode: _appMode);
    // Add a listener to scroll to bottom when messages change.
    _chatSession.addListener(_scrollToBottom);
    _textController.text = _defaultUserMessage;
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _chatSession,
      builder: (context, _) {
        return Scaffold(
          appBar: AppBar(
            title: const Text('Chat (Controller + Dartantic)'),
            actions: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8.0),
                child: DropdownButton<AppMode>(
                  value: _appMode,
                  underline: const SizedBox.shrink(),
                  onChanged: (mode) {
                    if (mode == null) return;
                    _changeMode(mode);
                  },
                  items: [
                    for (final mode in AppMode.values)
                      DropdownMenuItem(
                        value: mode,
                        child: Text(mode.displayName),
                      ),
                  ],
                ),
              ),
            ],
          ),

          body: SafeArea(
            child: Column(
              children: [
                Expanded(
                  child: ListView.builder(
                    controller: _scrollController,
                    itemCount: _chatSession.messages.length,
                    itemBuilder: (context, index) {
                      final Message message = _chatSession.messages[index];
                      // Pass the controller as the host.
                      return ListTile(
                        title: MessageView(
                          message,
                          _chatSession.surfaceController,
                        ),
                        tileColor: message.isUser
                            ? Colors.blue.withValues(alpha: 0.1)
                            : null,
                      );
                    },
                  ),
                ),

                if (_chatSession.isProcessing)
                  const Padding(
                    padding: EdgeInsets.all(8.0),
                    child: CircularProgressIndicator(),
                  ),

                Padding(
                  padding: const EdgeInsets.all(8.0),
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _textController,
                          decoration: const InputDecoration(
                            hintText: 'Type your message...',
                          ),
                          enabled: !_chatSession.isProcessing,
                          onSubmitted: (_) => _sendMessage(),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.send),
                        onPressed: _chatSession.isProcessing
                            ? null
                            : _sendMessage,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _changeMode(AppMode mode) {
    if (mode == _appMode) return;
    setState(() {
      _appMode = mode;
      _reCreateChatSession();
    });
  }

  Future<void> _sendMessage() async {
    final String text = _textController.text;
    if (text.isEmpty) return;
    _textController.clear();
    await _chatSession.sendMessage(text);
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  void dispose() {
    _chatSession.dispose();
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }
}
