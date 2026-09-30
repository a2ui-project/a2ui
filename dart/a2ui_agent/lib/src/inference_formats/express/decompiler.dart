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

import 'compiler.dart';
import 'schema_helper.dart';

final RegExp _identifier = RegExp(r'^[a-zA-Z_][a-zA-Z0-9_]*$');
final RegExp _pathText = RegExp(r'^[a-zA-Z0-9_/]*$');
final RegExp _pathSegment = RegExp(r'^[a-zA-Z0-9_]+$');

/// Words the lexer reads as something other than an identifier.
const Set<String> _keywords = {'_', 'null', 'true', 'false'};

/// Writes v0.9 messages in Express notation: the inverse of the compiler.
///
/// Positional arguments follow the property order the catalogs declare, so
/// the decompiler needs the same catalogs the compiler reads with.
///
/// Compiling the output gives back the messages written, with two
/// exceptions that mean the same to a renderer: a data model update that
/// names no path names `/`, and a data model update written beside a
/// `createSurface` follows the `updateComponents` that gives the surface its
/// root.
///
/// A value with no idiomatic notation, such as a function call that states
/// its `returnType`, is written as the map literal that compiles to it. What
/// no Express block can compile to is an error; see [decompile].
class ExpressDecompiler {
  /// The first of [catalogs] is the default for a surface that does not name
  /// its catalog.
  ExpressDecompiler(this.catalogs);

  final List<SchemaCatalog> catalogs;

  late final Map<String, CatalogSchemaHelper> _helpers = {
    for (final SchemaCatalog catalog in catalogs)
      catalog.id: CatalogSchemaHelper(catalog),
  };

  /// Writes [messages] as the content of one `<a2ui>` block, without the
  /// tags.
  ///
  /// Each surface operation is a paragraph opening with its `surface(...)`
  /// line. A `createSurface` is written together with the `updateComponents`
  /// and whole data model `updateDataModel` that follow it for the same
  /// surface, since assigning `root` is how Express creates a surface.
  ///
  /// Throws [A2uiCatalogError] if there are no [catalogs], and
  /// [A2uiValidationError] if a message has no Express notation:
  ///
  /// - a `createSurface` with a theme, with `sendDataModel`, or without an
  ///   `updateComponents` giving the surface its root;
  /// - an `updateComponents` without a `createSurface` that assigns `root`,
  ///   which would create the surface when compiled;
  /// - an `updateDataModel` below the root of the data model, or removing it;
  /// - a component whose id is not an Express identifier, such as
  ///   `main-column`, or which sets a property its catalog shares with every
  ///   component, such as `weight`;
  /// - a check that is not a call to a catalog function, or has no message;
  /// - anything a catalog does not declare, such as an unknown component.
  String decompile(List<AgentToRendererMessage> messages) {
    if (catalogs.isEmpty) {
      throw A2uiCatalogError('Decompiling Express needs at least one catalog.');
    }
    final paragraphs = <String>[];
    final created = <String, CatalogSchemaHelper>{};
    for (var i = 0; i < messages.length; i++) {
      final AgentToRendererMessage message = messages[i];
      switch (message) {
        case CreateSurfaceMessage():
          UpdateComponentsMessage? components;
          UpdateDataModelMessage? data;
          while (i + 1 < messages.length) {
            final AgentToRendererMessage next = messages[i + 1];
            if (next is UpdateComponentsMessage &&
                next.surfaceId == message.surfaceId &&
                components == null) {
              components = next;
            } else if (next is UpdateDataModelMessage &&
                next.surfaceId == message.surfaceId &&
                data == null &&
                _isWholeModel(next)) {
              data = next;
            } else {
              break;
            }
            i++;
          }
          final CatalogSchemaHelper helper = _helper(message.catalogId);
          created[message.surfaceId] = helper;
          paragraphs.add(_create(message, helper, components, data));
        case UpdateComponentsMessage():
          paragraphs.add(_updateComponents(message, created));
        case UpdateDataModelMessage():
          paragraphs.add(_updateData(message, created));
        case DeleteSurfaceMessage():
          paragraphs.add('deleteSurface(${_string(message.surfaceId)})');
        default:
          throw A2uiValidationError(
            'A ${message.runtimeType} has no Express notation.',
            details: message.toJson(),
          );
      }
    }
    return paragraphs.join('\n\n');
  }

  String _create(
    CreateSurfaceMessage message,
    CatalogSchemaHelper helper,
    UpdateComponentsMessage? components,
    UpdateDataModelMessage? data,
  ) {
    final String surfaceId = message.surfaceId;
    if (message.theme != null) {
      throw _noNotation("The theme of surface '$surfaceId'", message);
    }
    if (message.sendDataModel) {
      throw _noNotation("'sendDataModel' of surface '$surfaceId'", message);
    }
    if (components == null ||
        !components.components.any((c) => c['id'] == 'root')) {
      throw A2uiValidationError(
        "Surface '$surfaceId' is created without a root. Express creates a "
        "surface by assigning 'root', so a createSurface has Express notation "
        'only beside the updateComponents that gives the surface its root.',
        details: message.toJson(),
      );
    }
    return [
      _surfaceLine(surfaceId, helper),
      if (data != null) ..._dataLines(data.value! as Map),
      ..._componentLines(components, helper),
    ].join('\n');
  }

  String _updateComponents(
    UpdateComponentsMessage message,
    Map<String, CatalogSchemaHelper> created,
  ) {
    if (message.components.any((c) => c['id'] == 'root')) {
      throw A2uiValidationError(
        "The update of surface '${message.surfaceId}' sets 'root' without "
        "creating the surface. Assigning 'root' in Express creates the "
        'surface, so this update has no Express notation.',
        details: message.toJson(),
      );
    }
    final CatalogSchemaHelper helper =
        created[message.surfaceId] ?? _helperDeclaring(message.components);
    return [
      _surfaceLine(message.surfaceId, helper),
      ..._componentLines(message, helper),
    ].join('\n');
  }

  String _updateData(
    UpdateDataModelMessage message,
    Map<String, CatalogSchemaHelper> created,
  ) {
    if (!_isWholeModel(message)) {
      throw A2uiValidationError(
        "The update of path '${message.path}' in the data model of surface "
        "'${message.surfaceId}' has no Express notation. Express writes the "
        'whole data model, from its root, and cannot remove it.',
        details: message.toJson(),
      );
    }
    return [
      _surfaceLine(
        message.surfaceId,
        created[message.surfaceId] ?? _helpers[catalogs.first.id]!,
      ),
      ..._dataLines(message.value! as Map),
    ].join('\n');
  }

  /// Whether [message] replaces the whole data model with a map, which is
  /// what data path assignments compile to.
  bool _isWholeModel(UpdateDataModelMessage message) =>
      (message.path == null || message.path == '/') && message.value is Map;

  CatalogSchemaHelper _helper(String catalogId) =>
      _helpers[catalogId] ??
      (throw A2uiValidationError(
        "Catalog '$catalogId' is not active for this renderer. Active "
        'catalogs: ${_helpers.keys.join(', ')}.',
      ));

  /// The first catalog declaring every component in [components], or the
  /// default catalog if none does.
  CatalogSchemaHelper _helperDeclaring(List<Map<String, Object?>> components) {
    for (final SchemaCatalog catalog in catalogs) {
      final CatalogSchemaHelper helper = _helpers[catalog.id]!;
      if (components.every((c) => helper.isComponent('${c['component']}'))) {
        return helper;
      }
    }
    return _helpers[catalogs.first.id]!;
  }

  String _surfaceLine(String surfaceId, CatalogSchemaHelper helper) {
    final String catalogId = helper.catalog.id;
    return catalogId == catalogs.first.id
        ? 'surface(${_string(surfaceId)})'
        : 'surface(${_string(surfaceId)}, ${_string(catalogId)})';
  }

  /// One assignment per leaf of [model], since the compiler builds nested
  /// maps back up from the paths.
  List<String> _dataLines(Map<Object?, Object?> model) {
    if (model.isEmpty) return [r'$/ = {}'];
    final lines = <String>[];
    void visit(String path, Object? value) {
      if (value is Map && value.isNotEmpty) {
        for (final MapEntry<Object?, Object?> entry in value.entries) {
          final key = '${entry.key}';
          if (!_pathSegment.hasMatch(key)) {
            throw A2uiValidationError(
              "The data model key '$key' at '${path.isEmpty ? '/' : path}' has "
              'no Express notation. A data path is made of letters, digits '
              'and underscores.',
            );
          }
          visit('$path/$key', entry.value);
        }
      } else {
        lines.add('\$$path = ${_literal(value)}');
      }
    }

    visit('', model);
    return lines;
  }

  List<String> _componentLines(
    UpdateComponentsMessage message,
    CatalogSchemaHelper helper,
  ) {
    final Set<String> defined = {
      for (final Map<String, Object?> component in message.components)
        if (component['id'] case final String id) id,
    };
    return [
      for (final Map<String, Object?> component in message.components)
        _Component(helper, defined, component).write(),
    ];
  }
}

/// Writes one component as `id = Type(arguments)`.
class _Component {
  _Component(this.helper, this.defined, this.json);

  final CatalogSchemaHelper helper;

  /// The ids of the components the block defines, which a reference names
  /// as a variable. Any other id is written as a string.
  final Set<String> defined;

  final Map<String, Object?> json;

  String get _id => '${json['id']}';

  String write() {
    final Object? id = json['id'];
    if (id is! String || !_isIdentifier(id)) {
      throw A2uiValidationError(
        "Component id '$id' has no Express notation. In Express the id is the "
        'name of the variable holding the component, so it has to be made of '
        'letters, digits and underscores, and not start with a digit.',
        details: json,
      );
    }
    final Object? type = json['component'];
    if (type is! String || !helper.isComponent(type)) {
      throw A2uiValidationError(
        "Catalog '${helper.catalog.id}' declares no component named '$type'.",
        details: json,
      );
    }
    final List<String> properties = helper.properties(type);
    for (final String key in json.keys) {
      if (key == 'id' || key == 'component' || key == 'checks') continue;
      if (!properties.contains(key)) {
        throw A2uiValidationError(
          "Property '$key' of component '$id' has no Express notation: an "
          'Express call to $type takes only the properties $type declares '
          'itself (${properties.join(', ')}).',
          details: json,
        );
      }
    }

    final arguments = <String>[];
    var skipped = 0;
    for (final property in properties) {
      if (!json.containsKey(property)) {
        skipped++;
        continue;
      }
      final Object? value = json[property];
      if (value == null) {
        throw A2uiValidationError(
          "Property '$property' of component '$id' is null, which Express "
          'cannot write: the compiler leaves a null argument out.',
          details: json,
        );
      }
      arguments
        ..addAll(List.filled(skipped, '_'))
        ..add(_property(value, helper.propertySchema(type, property)));
      skipped = 0;
    }
    if (json['checks'] case final Object checks) arguments.add(_checks(checks));
    return '$id = $type(${arguments.join(', ')})';
  }

  String _property(Object value, Map<String, Object?>? schema) {
    if (isAction(schema)) return _action(value);
    return _value(value, schema);
  }

  String _value(Object? value, Map<String, Object?>? schema) {
    if (isComponentId(schema) && value is String) return _reference(value);
    if (isChildList(schema)) {
      if (value is List && value.every((Object? v) => v is String)) {
        final Iterable<String> ids = value.cast<String>().map(_reference);
        return '[${ids.join(', ')}]';
      }
      if (value case {
        'componentId': final String componentId,
        'path': final String path,
      } when value.length == 2 && _refersToVariable(componentId)) {
        if (_path(path) case final String written) {
          return '_template($written, $componentId)';
        }
      }
    }
    return switch (value) {
      Map() =>
        _binding(value) ??
            _call(value) ??
            _mapLiteral(value, (key) => _propertySchema(schema, key)),
      List() => _list(value, _itemSchema(schema)),
      _ => _literal(value),
    };
  }

  /// A reference to another component: a variable for one this block
  /// defines, and a string for one it does not, which the compiler passes on
  /// as written.
  String _reference(String id) => _refersToVariable(id) ? id : _string(id);

  bool _refersToVariable(String id) =>
      defined.contains(id) && _isIdentifier(id);

  /// `Event(name, context)` for an event, the call itself for a local
  /// function, and the map literal otherwise.
  String _action(Object value) {
    switch (value) {
      case {'event': final Map<Object?, Object?> event} when value.length == 1:
        final Object? name = event['name'];
        final Object? context = event['context'];
        final bool isEvent =
            name is String &&
            event.keys.every((k) => k == 'name' || k == 'context') &&
            (context == null || (context is Map && context.isNotEmpty));
        if (isEvent) {
          return context == null
              ? 'Event(${_string(name)})'
              : 'Event(${_string(name)}, ${_value(context, null)})';
        }
      case {'functionCall': final Map<Object?, Object?> call}
          when value.length == 1:
        if (_call(call) case final String written) return written;
    }
    return _value(value, null);
  }

  /// `$path` for a data binding the lexer can read, or null.
  String? _binding(Map<Object?, Object?> value) => switch (value) {
    {'path': final String path} when value.length == 1 => _path(path),
    _ => null,
  };

  /// `name(arguments)` for a call to a catalog function, or null.
  String? _call(Map<Object?, Object?> value) {
    if (value case {
      'call': final String name,
      'args': final Map<Object?, Object?> args,
    } when value.length == 2 && helper.isFunction(name)) {
      final List<String> parameters = helper.parameters(name);
      if (!args.keys.every(parameters.contains)) return null;
      final arguments = <String>[];
      var skipped = 0;
      for (final parameter in parameters) {
        final Object? argument = args[parameter];
        if (argument == null) {
          skipped++;
          continue;
        }
        arguments
          ..addAll(List.filled(skipped, '_'))
          ..add(_value(argument, helper.parameterSchema(name, parameter)));
        skipped = 0;
      }
      return '$name(${arguments.join(', ')})';
    }
    return null;
  }

  String _list(List<Object?> value, Map<String, Object?>? itemSchema) =>
      '[${value.map((Object? v) => _value(v, itemSchema)).join(', ')}]';

  String _mapLiteral(
    Map<Object?, Object?> value,
    Map<String, Object?>? Function(String key) schemaOf,
  ) {
    final List<String> entries = [
      for (final MapEntry<Object?, Object?> entry in value.entries)
        _entry('${entry.key}', _value(entry.value, schemaOf('${entry.key}'))),
    ];
    return '{${entries.join(', ')}}';
  }

  /// The checks of the component, as `?name(arguments, message)` in a list.
  String _checks(Object checks) {
    if (checks is! List || checks.isEmpty) {
      throw A2uiValidationError(
        "The checks of component '$_id' have no Express notation: Express "
        'writes checks as a non-empty list.',
        details: json,
      );
    }
    return '[${checks.map(_check).join(', ')}]';
  }

  String _check(Object? rule) {
    if (rule case {
      'condition': {
        'call': final String name,
        'args': final Map<Object?, Object?> args,
      },
      'message': final String message,
    } when rule.length == 2 && helper.isFunction(name)) {
      final List<String> parameters = helper.parameters(name);
      if (args.keys.every(parameters.contains)) {
        return _checkCall(name, parameters, args, message);
      }
    }
    throw A2uiValidationError(
      "A check of component '$_id' has no Express notation. Express writes a "
      'check as a call to a function of the catalog, with a message.',
      details: rule,
    );
  }

  String _checkCall(
    String name,
    List<String> parameters,
    Map<Object?, Object?> args,
    String message,
  ) {
    // The compiler passes the component's bound value to a check whose first
    // parameter is `value`, unless the first argument written is a path.
    final Object? bound = json['value'];
    var first = 0;
    if (parameters.first == 'value' && _binding(_asMap(bound)) != null) {
      final int next = parameters.indexWhere(args.containsKey, 1);
      final bool nextIsPath =
          next > 0 && _binding(_asMap(args[parameters[next]])) != null;
      if (_equal(args['value'], bound) && !nextIsPath) {
        first = 1;
      } else if (_binding(_asMap(args['value'])) == null) {
        throw A2uiValidationError(
          "Check '?$name' of component '$_id' tests a value other than the "
          "component's own, and not a data binding, which Express cannot "
          'write.',
          details: json,
        );
      }
    }
    final arguments = <String>[];
    var skipped = 0;
    for (final String parameter in parameters.skip(first)) {
      final Object? argument = args[parameter];
      if (argument == null) {
        skipped++;
        continue;
      }
      arguments
        ..addAll(List.filled(skipped, '_'))
        ..add(_value(argument, helper.parameterSchema(name, parameter)));
      skipped = 0;
    }
    if (message != defaultCheckMessage(name)) {
      // A string after every parameter is the message.
      arguments
        ..addAll(List.filled(skipped, '_'))
        ..add(_string(message));
    }
    return arguments.isEmpty ? '?$name' : '?$name(${arguments.join(', ')})';
  }
}

/// `$path` for [path], or null if the lexer cannot read it.
String? _path(String path) => _pathText.hasMatch(path) ? '\$$path' : null;

/// [value] as a literal, with maps written as map literals.
String _literal(Object? value) => switch (value) {
  null => 'null',
  bool() => '$value',
  int() => '$value',
  double() => _double(value),
  String() => _string(value),
  List() => '[${value.map(_literal).join(', ')}]',
  Map() => _mapOfLiterals(value),
  _ => throw A2uiValidationError(
    'The value $value has no Express notation.',
    details: value,
  ),
};

String _mapOfLiterals(Map<Object?, Object?> value) {
  final List<String> entries = [
    for (final MapEntry<Object?, Object?> entry in value.entries)
      _entry('${entry.key}', _literal(entry.value)),
  ];
  return '{${entries.join(', ')}}';
}

String _double(double value) {
  final text = '$value';
  if (!RegExp(r'^-?[0-9]+\.[0-9]+$').hasMatch(text)) {
    throw A2uiValidationError(
      'The number $value has no Express notation, which writes numbers as '
      'plain decimals.',
    );
  }
  return text;
}

/// A string literal: raw when that keeps backslashes single, and escaped
/// otherwise.
String _string(String value) {
  final bool hasBackslash = value.contains(r'\');
  if (hasBackslash && !value.contains(RegExp('["\n\r]'))) return 'r"$value"';
  final String escaped = value
      .replaceAll(r'\', r'\\')
      .replaceAll('"', r'\"')
      .replaceAll('\n', r'\n')
      .replaceAll('\r', r'\r')
      .replaceAll('\t', r'\t');
  return '"$escaped"';
}

/// One entry of a map literal.
String _entry(String key, String value) => '${_key(key)}: $value';

/// A map key: bare when it is an identifier, and quoted otherwise.
String _key(String key) => _isIdentifier(key) ? key : _string(key);

bool _isIdentifier(String name) =>
    _identifier.hasMatch(name) && !_keywords.contains(name);

Map<Object?, Object?> _asMap(Object? value) => value is Map ? value : const {};

bool _equal(Object? a, Object? b) => switch ((a, b)) {
  (final Map<Object?, Object?> x, final Map<Object?, Object?> y) =>
    x.length == y.length &&
        x.keys.every((k) => y.containsKey(k) && _equal(x[k], y[k])),
  (final List<Object?> x, final List<Object?> y) =>
    x.length == y.length &&
        [for (var i = 0; i < x.length; i++) i].every((i) => _equal(x[i], y[i])),
  _ => a == b,
};

Map<String, Object?>? _propertySchema(
  Map<String, Object?>? schema,
  String key,
) {
  if (schema == null) return null;
  if (schema['properties'] case final Map<Object?, Object?> properties) {
    if (properties[key] case final Map<Object?, Object?> property) {
      return property.cast<String, Object?>();
    }
  }
  return null;
}

Map<String, Object?>? _itemSchema(Map<String, Object?>? schema) =>
    switch (schema?['items']) {
      final Map<Object?, Object?> items => items.cast<String, Object?>(),
      _ => null,
    };

A2uiValidationError _noNotation(String what, AgentToRendererMessage message) =>
    A2uiValidationError(
      '$what has no Express notation.',
      details: message.toJson(),
    );
