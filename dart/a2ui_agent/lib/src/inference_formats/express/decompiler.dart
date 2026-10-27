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

import '../../utils/catalogs.dart';
import 'compiler.dart';
import 'schema_helper.dart';

final RegExp _xidContinueChar = RegExp(r'^\p{XID_Continue}$', unicode: true);
final RegExp _pathText = RegExp(r'^[a-zA-Z0-9_/]*$');
final RegExp _pathSegment = RegExp(r'^[a-zA-Z0-9_]+$');

/// Words the lexer reads as something other than an identifier.
const Set<String> _keywords = {'_', 'null', 'true', 'false'};

/// The catalog the items of a surface that name none belong to.
///
/// `known` is false for a surface the payload does not create, whose catalog
/// it does not state. `catalogId` is null for a v1.0 surface that names no
/// catalog.
typedef _SurfaceCatalog = ({bool known, String? catalogId});

/// Writes messages of the protocol version the catalogs target in Express
/// notation: the inverse of the compiler.
///
/// Positional arguments follow the property order the catalogs declare, so
/// the decompiler needs the same catalogs the compiler reads with.
///
/// Compiling the output gives back the messages written, with exceptions
/// that mean the same to a renderer: a data model update that names no path
/// names `/`, and a data model update written beside a `createSurface` is
/// part of the surface it creates. Before v1.0 it follows the
/// `updateComponents` that gives the surface its root; from v1.0 the
/// components and the data model are both carried by the `createSurface`.
///
/// From v1.0 a component or function call is written with the catalog it
/// belongs to only when several catalogs are active and looking its name up
/// across them would not find that catalog. With several catalogs a surface
/// names no catalog, so the recompiled `createSurface` names none, and every
/// component and call names its own.
///
/// A value with no idiomatic notation, such as a function call that states
/// its `returnType`, is written as the map literal that compiles to it. What
/// no Express block can compile to is an error; see [decompile].
class ExpressDecompiler {
  /// The first of [catalogs] is the default for a surface that does not name
  /// its catalog.
  ///
  /// [catalogs] are linked with one another, as by [linkCatalogs], so a
  /// cross-catalog `$ref` resolves; the catalogs passed in are not changed.
  ExpressDecompiler(List<CatalogApi> catalogs)
    : catalogs = linkCatalogs(catalogs);

  /// The catalogs this decompiler knows, linked with one another.
  final List<CatalogApi> catalogs;

  late final Map<String, CatalogSchemaHelper> _helpers = {
    for (final CatalogApi catalog in catalogs)
      catalog.id: CatalogSchemaHelper(catalog),
  };

  /// The protocol version [catalogs] target.
  late final A2uiProtocolVersion _version = catalogsProtocolVersion(catalogs);

  bool get _v1 => _version.isAtLeast(A2uiProtocolVersion.v1_0);

  /// Writes [messages] as the content of one `<a2ui>` block, without the
  /// tags.
  ///
  /// Each surface operation is a paragraph opening with its `surface(...)`
  /// line. A `createSurface` is written together with the `updateComponents`
  /// and whole data model `updateDataModel` that follow it for the same
  /// surface, unless it carries components or a data model of its own, since
  /// assigning `root` is how Express creates a surface. A v1.0
  /// `callRendererFunction` is written as the function call it makes, as a
  /// statement of its own.
  ///
  /// Throws [A2uiCatalogError] if there are no [catalogs] or they target
  /// different versions, and [A2uiValidationError] if a message has no
  /// Express notation:
  ///
  /// - a `createSurface` with a theme, with `sendDataModel`, with metadata,
  ///   or without the components that give the surface its root;
  /// - an `updateComponents` without a `createSurface` that assigns `root`,
  ///   which would create the surface when compiled;
  /// - an `updateDataModel` below the root of the data model, or removing it;
  /// - from v1.0, a component whose id is not a UAX 31 identifier, such as
  ///   `main-column`, or a component that sets a property its catalog does not
  ///   declare for it, such as `metadata`;
  /// - a check that is not a call to a catalog function, or has no message;
  /// - a `callRendererFunction` naming a surface, or a function call that
  ///   cannot be written as a call;
  /// - an `agentFunctionResponse`;
  /// - anything a catalog does not declare, such as an unknown component.
  String decompile(List<AgentToRendererMessage> messages) {
    if (catalogs.isEmpty) {
      throw A2uiCatalogError('Decompiling Express needs at least one catalog.');
    }
    final bool v1 = _v1;
    final paragraphs = <String>[];
    final created = <String, String?>{};
    var calls = 0;
    for (var i = 0; i < messages.length; i++) {
      final AgentToRendererMessage message = messages[i];
      switch (message) {
        case CreateSurfaceMessage():
          List<Map<String, Object?>>? components = message.components;
          Object? data = message.dataModel;
          while (i + 1 < messages.length) {
            final AgentToRendererMessage next = messages[i + 1];
            if (next is UpdateComponentsMessage &&
                next.surfaceId == message.surfaceId &&
                components == null) {
              components = next.components;
            } else if (next is UpdateDataModelMessage &&
                next.surfaceId == message.surfaceId &&
                data == null &&
                _isWholeModel(next)) {
              data = next.value;
            } else {
              break;
            }
            i++;
          }
          final String? catalogId = _surfaceCatalog(message);
          created[message.surfaceId] = catalogId;
          paragraphs.add(
            _create(
              message,
              (known: true, catalogId: catalogId),
              components,
              data as Map<Object?, Object?>?,
            ),
          );
        case UpdateComponentsMessage():
          paragraphs.add(_updateComponents(message, created));
        case UpdateDataModelMessage():
          paragraphs.add(_updateData(message, created));
        case DeleteSurfaceMessage():
          paragraphs.add('deleteSurface(${_string(message.surfaceId)})');
        case CallRendererFunctionMessage() when v1:
          paragraphs.add(_rendererCall(message, ++calls));
        default:
          throw A2uiValidationError(
            'A ${message.runtimeType} has no Express notation.',
          );
      }
    }
    return paragraphs.join('\n\n');
  }

  /// The catalog of the surface [message] creates.
  ///
  /// Before v1.0 the message names it, as the Express format requires. From
  /// v1.0 a single catalog is the catalog of every surface, and with several
  /// a surface has the catalog it names, or none.
  ///
  /// Throws [A2uiValidationError] if the message names a catalog that is not
  /// active, or names none before v1.0.
  String? _surfaceCatalog(CreateSurfaceMessage message) {
    final String? catalogId = message.catalogId;
    if (catalogId != null) _helper(catalogId);
    if (!_v1) {
      return catalogId ??
          (throw A2uiValidationError(
            "Surface '${message.surfaceId}' names no catalogId, which the "
            'Express format requires.',
          ));
    }
    return catalogs.length == 1 ? catalogs.single.id : catalogId;
  }

  String _create(
    CreateSurfaceMessage message,
    _SurfaceCatalog surface,
    List<Map<String, Object?>>? components,
    Map<Object?, Object?>? data,
  ) {
    final String surfaceId = message.surfaceId;
    if (message.theme != null) {
      throw _noNotation("The theme of surface '$surfaceId'");
    }
    if (message.sendDataModel) {
      throw _noNotation("'sendDataModel' of surface '$surfaceId'");
    }
    if (message.metadata != null) {
      throw _noNotation("The metadata of surface '$surfaceId'");
    }
    if (components == null || !components.any((c) => c['id'] == 'root')) {
      throw A2uiValidationError(
        "Surface '$surfaceId' is created without a root. Express creates a "
        "surface by assigning 'root', so a createSurface has Express notation "
        'only together with the components that give the surface its root.',
      );
    }
    return [
      _surfaceLine(surfaceId, surface.catalogId),
      if (data != null) ..._dataLines(data),
      ..._componentLines(components, surface),
    ].join('\n');
  }

  String _updateComponents(
    UpdateComponentsMessage message,
    Map<String, String?> created,
  ) {
    final String surfaceId = message.surfaceId;
    if (message.components.any((c) => c['id'] == 'root')) {
      throw A2uiValidationError(
        "The update of surface '$surfaceId' sets 'root' without creating the "
        "surface. Assigning 'root' in Express creates the surface, so this "
        'update has no Express notation.',
      );
    }
    final _SurfaceCatalog surface = created.containsKey(surfaceId)
        ? (known: true, catalogId: created[surfaceId])
        : _v1
        ? (known: catalogs.length == 1, catalogId: catalogs.first.id)
        : (known: true, catalogId: _catalogDeclaring(message.components));
    return [
      _surfaceLine(surfaceId, surface.catalogId),
      ..._componentLines(message.components, surface),
    ].join('\n');
  }

  String _updateData(
    UpdateDataModelMessage message,
    Map<String, String?> created,
  ) {
    final String? path = message.path;
    final Object? value = message.value;
    final bool atRoot = path == null || path == '/';
    if (atRoot ? value is! Map : value == null || !_isDataPath(path)) {
      throw A2uiValidationError(
        "The update of path '${path ?? '/'}' in the data model of surface "
        "'${message.surfaceId}' has no Express notation. Express assigns a "
        'value to a data path, and cannot remove one or replace the root '
        'with anything but a map.',
      );
    }
    // Below the root the value is assigned at its path, which compiles to an
    // update of the root holding it.
    return [
      _surfaceLine(
        message.surfaceId,
        created[message.surfaceId] ?? catalogs.first.id,
      ),
      ..._dataLines(value, at: atRoot ? '' : path),
    ].join('\n');
  }

  /// A v1.0 `callRendererFunction`, the [index]th of the payload, as the
  /// function call it makes.
  ///
  /// The call names the catalog of its function, which the compiler writes
  /// back, so it is written with the catalog only when a lookup by name would
  /// not find it. A `functionCallId` other than `call_<index>`, the id the
  /// compiler gives the call, is written as a `functionCallId` argument.
  String _rendererCall(CallRendererFunctionMessage message, int index) {
    final String id = message.functionCallId;
    if (message.surfaceId case final String surfaceId) {
      throw _noNotation(
        "The surface '$surfaceId' of function call '$id', which runs against "
        'the data model of a surface,',
      );
    }
    final String call =
        _Component(
          this,
          (known: false, catalogId: null),
          const {},
          const {},
        )._call({'args': const <String, Object?>{}, ...message.callFunction}) ??
        (throw _noNotation("Function call '$id'"));
    if (id == 'call_$index') return call;
    final separator = call.endsWith('()') ? '' : ', ';
    return '${call.substring(0, call.length - 1)}$separator'
        'functionCallId=${_string(id)})';
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
  String _catalogDeclaring(List<Map<String, Object?>> components) {
    for (final CatalogApi catalog in catalogs) {
      final CatalogSchemaHelper helper = _helpers[catalog.id]!;
      if (components.every((c) => helper.isComponent('${c['component']}'))) {
        return catalog.id;
      }
    }
    return catalogs.first.id;
  }

  /// The catalog a component, or a function when [component] is false,
  /// named [name] belongs to, and the catalog to write it with, or null.
  ///
  /// The catalog is the one [named] names, else the surface's, else, for a
  /// v1.0 surface the payload does not create, the first catalog declaring
  /// [name]. Before v1.0 an item always belongs to its surface's catalog. It
  /// is written only from v1.0, with several catalogs, when a lookup of
  /// [name] across them would not find that catalog alone, which is what the
  /// compiler does with an item that names none.
  ///
  /// Throws [A2uiValidationError] if the item names no catalog on a surface
  /// that names none, names one that is not active, or its catalog does not
  /// declare [name].
  (CatalogSchemaHelper, String?) _resolve(
    String name,
    Object? named,
    _SurfaceCatalog surface, {
    required bool component,
    required String subject,
  }) {
    final kind = component ? 'component' : 'function';
    bool declares(CatalogSchemaHelper helper) =>
        component ? helper.isComponent(name) : helper.isFunction(name);
    final Iterable<CatalogSchemaHelper> declaring = _helpers.values.where(
      declares,
    );
    final String catalogId;
    if (!_v1 || named == null) {
      catalogId = surface.known || !_v1
          ? surface.catalogId ??
                (throw A2uiValidationError(
                  '$subject names no catalogId, and its surface names no '
                  'catalog.',
                ))
          : declaring.firstOrNull?.catalog.id ?? catalogs.first.id;
    } else if (named is String) {
      catalogId = named;
    } else {
      throw A2uiValidationError("$subject has a non-string 'catalogId'.");
    }
    final CatalogSchemaHelper helper = _helper(catalogId);
    if (!declares(helper)) {
      throw A2uiValidationError(
        "Catalog '$catalogId' declares no $kind named '$name'.",
      );
    }
    // The compiler reads a call to a name some catalog declares as a
    // component as that component, unless the call names its catalog.
    final bool found =
        declaring.length == 1 &&
        identical(declaring.single, helper) &&
        (component || !_helpers.values.any((h) => h.isComponent(name)));
    return (helper, !_v1 || catalogs.length == 1 || found ? null : catalogId);
  }

  /// The `surface(...)` line, which names the surface's catalog before v1.0
  /// when it is not the default. From v1.0 a surface of a single catalog has
  /// that catalog, and one of several names none.
  String _surfaceLine(String surfaceId, String? catalogId) =>
      _v1 || catalogId == catalogs.first.id
      ? 'surface(${_string(surfaceId)})'
      : 'surface(${_string(surfaceId)}, ${_string(catalogId!)})';

  /// One assignment per leaf of [model], since the compiler builds nested
  /// maps back up from the paths.
  List<String> _dataLines(Object? model, {String at = ''}) {
    if (at.isEmpty && model is Map && model.isEmpty) return [r'$/ = {}'];
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

    visit(at, model);
    return lines;
  }

  /// Whether [path] is a data path Express can assign at, such as
  /// `/user/name`: one naming map keys, since the assignment compiles to an
  /// update of the root that holds a map along the path, and so not one
  /// naming an item of a list.
  bool _isDataPath(String path) =>
      path.startsWith('/') &&
      path
          .substring(1)
          .split('/')
          .every((s) => _pathSegment.hasMatch(s) && int.tryParse(s) == null);

  List<String> _componentLines(
    List<Map<String, Object?>> components,
    _SurfaceCatalog surface,
  ) {
    final ids = <String>[];
    for (final component in components) {
      final Object? id = component['id'];
      if (id is! String || id.isEmpty) {
        throw A2uiValidationError(
          "Component id '$id' has no Express notation.",
        );
      }
      ids.add(id);
    }
    if (_v1) {
      final List<A2uiErrorDetail> details = [
        for (final String id in ids)
          if (!isValidUax31Identifier(id))
            A2uiErrorDetail(
              path: 'components.$id.id',
              code: 'invalid_identifier',
              message: "Component id '$id' must be a valid UAX #31 identifier",
            ),
      ];
      if (details.isNotEmpty) {
        throw A2uiValidationError(
          details.first.message,
          path: details.first.path,
          errors: details,
        );
      }
    }
    final Map<String, String> variables = _assignVariableNames(ids);
    return [
      for (final Map<String, Object?> component in components)
        _Component(this, surface, variables, component).write(),
    ];
  }
}

/// Writes one component as `varName = Type(arguments)`, and the values in it.
class _Component {
  _Component(this.decompiler, this.surface, this.variables, this.json);

  final ExpressDecompiler decompiler;

  /// The catalog of the component's surface, which its calls that name none
  /// belong to.
  final _SurfaceCatalog surface;

  /// The variable name each component of the block is written under, keyed by
  /// its component id.
  final Map<String, String> variables;

  final Map<String, Object?> json;

  bool get _v1 => decompiler._v1;

  /// The key of a data binding: `@path` from v1.0 and `path` before.
  String get _pathKey => _v1 ? '@path' : 'path';

  /// The key of a function call: `@call` from v1.0 and `call` before.
  String get _callKey => _v1 ? '@call' : 'call';

  String get _id => '${json['id']}';

  String write() {
    final id = json['id']! as String;
    final String varName = variables[id]!;
    final Object? type = json['component'];
    if (type is! String) {
      throw A2uiValidationError("Component '$id' names no component type.");
    }
    final (CatalogSchemaHelper helper, String? catalogId) = decompiler._resolve(
      type,
      json['catalogId'],
      surface,
      component: true,
      subject: "Component '$id'",
    );
    final List<String> properties = helper.properties(type);
    for (final String key in json.keys) {
      if (key == 'id' || key == 'component' || key == 'checks') continue;
      if (_v1 && key == 'catalogId') continue;
      if (!properties.contains(key)) {
        throw A2uiValidationError(
          "Property '$key' of component '$id' has no Express notation: an "
          'Express call to $type takes only the properties $type declares '
          'itself (${properties.join(', ')}).',
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
        );
      }
      arguments
        ..addAll(List.filled(skipped, '_'))
        ..add(_property(value, helper.propertySchema(type, property)));
      skipped = 0;
    }
    if (json['checks'] case final Object checks) arguments.add(_checks(checks));
    if (catalogId != null) arguments.add('catalogId=${_string(catalogId)}');
    if (varName != id) arguments.add('id=${_string(id)}');
    return '$varName = $type(${arguments.join(', ')})';
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
      } when value.length == 2 && variables.containsKey(componentId)) {
        if (_path(path) case final String written) {
          return '_template($written, ${variables[componentId]!})';
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

  /// A reference to another component: its variable name for one this block
  /// defines, and a string for one it does not, which the compiler passes on
  /// as written.
  String _reference(String id) => variables[id] ?? _string(id);

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
  String? _binding(Map<Object?, Object?> value) => switch (value[_pathKey]) {
    final String path when value.length == 1 => _path(path),
    _ => null,
  };

  /// The function a call that names [name] and, from v1.0, [catalogId]
  /// belongs to, and the catalog to write it with, or, before v1.0, null if
  /// it belongs to no active catalog.
  ///
  /// Throws [A2uiValidationError] from v1.0 if it belongs to no active
  /// catalog, since the map the call would be written as instead does not
  /// compile.
  (CatalogSchemaHelper, String?)? _function(String name, Object? catalogId) {
    try {
      return decompiler._resolve(
        name,
        catalogId,
        surface,
        component: false,
        subject: "Function call '$name'",
      );
    } on A2uiValidationError {
      if (_v1) rethrow;
      return null;
    }
  }

  /// `name(arguments)` for a call to a catalog function, or null.
  String? _call(Map<Object?, Object?> value) {
    final Object? name = value[_callKey];
    final Object? args = value['args'];
    final bool written = value.keys.every(
      (k) => k == _callKey || k == 'args' || (_v1 && k == 'catalogId'),
    );
    if (name is! String || args is! Map || !written) return null;
    final (CatalogSchemaHelper, String?)? function = _function(
      name,
      value['catalogId'],
    );
    if (function == null) return null;
    final (CatalogSchemaHelper helper, String? catalogId) = function;
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
    if (catalogId != null) arguments.add('catalogId=${_string(catalogId)}');
    return '$name(${arguments.join(', ')})';
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

  /// The checks of the component, as `?name(arguments, message)`: one on its
  /// own, and several in a list.
  String _checks(Object checks) {
    if (checks is! List || checks.isEmpty) {
      throw A2uiValidationError(
        "The checks of component '$_id' have no Express notation: Express "
        'writes checks as a non-empty list.',
      );
    }
    if (checks.length == 1) return _check(checks.single);
    return '[${checks.map(_check).join(', ')}]';
  }

  String _check(Object? rule) {
    if (rule case {
      'condition': final Map<Object?, Object?> condition,
      'message': final String message,
    } when rule.length == 2) {
      final Object? name = condition[_callKey];
      final Object? args = condition['args'];
      final bool written = condition.keys.every(
        (k) => k == _callKey || k == 'args' || (_v1 && k == 'catalogId'),
      );
      if (name is String && args is Map && written) {
        if (_function(name, condition['catalogId']) case (
          final CatalogSchemaHelper helper,
          final String? catalogId,
        ) when args.keys.every(helper.parameters(name).contains)) {
          return _checkCall(name, helper, args, message, catalogId);
        }
      }
    }
    throw A2uiValidationError(
      "A check of component '$_id' has no Express notation. Express writes a "
      'check as a call to a function of the catalog, with a message.',
    );
  }

  /// A check calling [name] of [helper]'s catalog, written with that catalog
  /// as a `{catalogId: ...}` argument when [catalogId] is not null.
  String _checkCall(
    String name,
    CatalogSchemaHelper helper,
    Map<Object?, Object?> args,
    String message,
    String? catalogId,
  ) {
    final List<String> parameters = helper.parameters(name);
    // The compiler passes the component's bound value to a check whose first
    // parameter is `value`, unless the first argument written is a path.
    final Object? bound = json['value'];
    var first = 0;
    if (parameters.firstOrNull == 'value' && _binding(_asMap(bound)) != null) {
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
    if (catalogId != null) arguments.add('{catalogId: ${_string(catalogId)}}');
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
  _ => throw A2uiValidationError('The value $value has no Express notation.'),
};

String _mapOfLiterals(Map<Object?, Object?> value) {
  final List<String> entries = [
    for (final MapEntry<Object?, Object?> entry in value.entries)
      _entry('${entry.key}', _literal(entry.value)),
  ];
  return '{${entries.join(', ')}}';
}

/// [value] as Express writes doubles: the form of ECMAScript
/// `Number.prototype.toString`, which Dart's `toString` already produces
/// (`0.000015`, `1e-7`, `1e+21`), with a `.0` suffix on integral doubles.
String _double(double value) {
  if (!value.isFinite) {
    throw A2uiValidationError('The number $value has no Express notation.');
  }
  return '$value';
}

/// A string literal: raw when that keeps backslashes single, and escaped
/// otherwise.
String _string(String value) {
  final bool hasBackslash = value.contains(r'\');
  if (hasBackslash && !value.contains(RegExp('["\n\r]'))) return 'r"$value"';
  // Across lines a raw string is triple-quoted, and ends at the first `"""`.
  if (hasBackslash &&
      value.contains('\n') &&
      !value.contains('\r') &&
      !value.contains('"""') &&
      !value.endsWith('"')) {
    return 'r"""$value"""';
  }
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
    isValidUax31Identifier(name) && !_keywords.contains(name);

String _deriveVariableName(String id) {
  String base = id.runes
      .map(String.fromCharCode)
      .map((String ch) => _xidContinueChar.hasMatch(ch) ? ch : '_')
      .join();
  while (!_isIdentifier(base)) {
    base = '_$base';
  }
  return base;
}

Map<String, String> _assignVariableNames(Iterable<String> componentIds) {
  final names = <String, String>{
    for (final String id in componentIds)
      if (_isIdentifier(id)) id: id,
  };
  final Set<String> taken = names.values.toSet();
  for (final id in componentIds) {
    if (names.containsKey(id)) continue;
    final String base = _deriveVariableName(id);
    var name = base;
    var suffix = 2;
    while (taken.contains(name)) {
      name = '${base}_$suffix';
      suffix++;
    }
    names[id] = name;
    taken.add(name);
  }
  return names;
}

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

A2uiValidationError _noNotation(String what) =>
    A2uiValidationError('$what has no Express notation.');
