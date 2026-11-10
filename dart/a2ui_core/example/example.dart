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

import 'dart:io';

import 'package:a2ui_core/a2ui_core.dart';

void main() {
  // The data model a surface binds to, as an agent's `updateDataModel`
  // message leaves it.
  final model = DataModel(<String, Object?>{
    'user': <String, Object?>{'name': 'Ada'},
    'cart': <Object?>[],
  });

  // A binding watches a path and sees every change made to it.
  final ReadonlySignal<Object?> name = model.watch<Object?>('/user/name');
  stdout.writeln(name.value); // Ada

  model.set('/user/name', 'Grace');
  stdout.writeln(name.value); // Grace

  // Writing an index past the end of a list grows the list.
  model.set('/cart/0', <String, Object?>{'item': 'Keyboard', 'qty': 1});
  stdout.writeln(model.get('/cart/0/item')); // Keyboard
}
