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

package macros

import (
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"unicode"

	"github.com/a2ui-project/a2ui/go/agent/builder"
	v09 "github.com/a2ui-project/a2ui/go/agent/builder/v09"
	v1 "github.com/a2ui-project/a2ui/go/agent/builder/v1"
	"github.com/a2ui-project/a2ui/go/agent/internal/envelope"
	"github.com/a2ui-project/a2ui/go/core"
)

// DefaultCommonRefPrefix is the canonical $ref prefix for protocol common types in macro schemas.
const DefaultCommonRefPrefix = "common_types.json#/$defs/"

// macroProtocolError marks protocol-level macro violations (mixed versions, reserved "Surface",
// invalid UAX #31 names) that always propagate even when OnError is OnErrorPassthrough.
type macroProtocolError struct {
	*core.ValidationError
}

func (e *macroProtocolError) ErrorCategory() core.ErrorCategory { return core.CategoryValidation }
func (e *macroProtocolError) Unwrap() error                     { return e.ValidationError }

func newMacroProtocolError(msg string) *macroProtocolError {
	return &macroProtocolError{ValidationError: core.NewValidationError(msg)}
}

func newMacroProtocolErrorf(format string, args ...any) *macroProtocolError {
	return newMacroProtocolError(fmt.Sprintf(format, args...))
}

func normalizeVersionFamily(version string) (builder.VersionFamily, error) {
	pv, err := core.ToProtocolVersion(version)
	if err != nil {
		return "", newMacroProtocolErrorf("unsupported macro protocol version %q", version)
	}
	switch pv {
	case core.Version0_9, core.Version0_9_1:
		return builder.VersionFamily0_9, nil
	case core.Version1_0:
		return builder.VersionFamily1_0, nil
	default:
		return "", newMacroProtocolErrorf("unsupported macro protocol version %q", version)
	}
}

// Exact Unicode NFKC character table for all 1,114,112 Unicode code points whose NFKC
// normalization equals one of the ASCII letters in "Surface" ('S','u','r','f','a','c','e').
var nfkcSurfaceRuneMap = map[rune]byte{
	// 'S'
	0x0053: 'S', 0x24C8: 'S', 0xFF33: 'S', 0x1D412: 'S', 0x1D446: 'S', 0x1D47A: 'S',
	0x1D4AE: 'S', 0x1D4E2: 'S', 0x1D516: 'S', 0x1D54A: 'S', 0x1D57E: 'S', 0x1D5B2: 'S',
	0x1D5E6: 'S', 0x1D61A: 'S', 0x1D64E: 'S', 0x1D682: 'S', 0x1F142: 'S',
	// 'u'
	0x0075: 'u', 0x1D58: 'u', 0x1D64: 'u', 0x24E4: 'u', 0xFF55: 'u', 0x1D42E: 'u',
	0x1D462: 'u', 0x1D496: 'u', 0x1D4CA: 'u', 0x1D4FE: 'u', 0x1D532: 'u', 0x1D566: 'u',
	0x1D59A: 'u', 0x1D5CE: 'u', 0x1D602: 'u', 0x1D636: 'u', 0x1D66A: 'u', 0x1D69E: 'u',
	// 'r'
	0x0072: 'r', 0x02B3: 'r', 0x1D63: 'r', 0x24E1: 'r', 0xFF52: 'r', 0x1D42B: 'r',
	0x1D45F: 'r', 0x1D493: 'r', 0x1D4C7: 'r', 0x1D4FB: 'r', 0x1D52F: 'r', 0x1D563: 'r',
	0x1D597: 'r', 0x1D5CB: 'r', 0x1D5FF: 'r', 0x1D633: 'r', 0x1D667: 'r', 0x1D69B: 'r',
	// 'f'
	0x0066: 'f', 0x1DA0: 'f', 0x24D5: 'f', 0xFF46: 'f', 0x1D41F: 'f', 0x1D453: 'f',
	0x1D487: 'f', 0x1D4BB: 'f', 0x1D4EF: 'f', 0x1D523: 'f', 0x1D557: 'f', 0x1D58B: 'f',
	0x1D5BF: 'f', 0x1D5F3: 'f', 0x1D627: 'f', 0x1D65B: 'f', 0x1D68F: 'f',
	// 'a'
	0x0061: 'a', 0x00AA: 'a', 0x1D43: 'a', 0x2090: 'a', 0x24D0: 'a', 0xFF41: 'a',
	0x1D41A: 'a', 0x1D44E: 'a', 0x1D482: 'a', 0x1D4B6: 'a', 0x1D4EA: 'a', 0x1D51E: 'a',
	0x1D552: 'a', 0x1D586: 'a', 0x1D5BA: 'a', 0x1D5EE: 'a', 0x1D622: 'a', 0x1D656: 'a',
	0x1D68A: 'a',
	// 'c'
	0x0063: 'c', 0x1D9C: 'c', 0x217D: 'c', 0x24D2: 'c', 0xFF43: 'c', 0x1D41C: 'c',
	0x1D450: 'c', 0x1D484: 'c', 0x1D4B8: 'c', 0x1D4EC: 'c', 0x1D520: 'c', 0x1D554: 'c',
	0x1D588: 'c', 0x1D5BC: 'c', 0x1D5F0: 'c', 0x1D624: 'c', 0x1D658: 'c', 0x1D68C: 'c',
	// 'e'
	0x0065: 'e', 0x1D49: 'e', 0x2091: 'e', 0x212F: 'e', 0x2147: 'e', 0x24D4: 'e',
	0xFF45: 'e', 0x1D41E: 'e', 0x1D452: 'e', 0x1D486: 'e', 0x1D4EE: 'e', 0x1D522: 'e',
	0x1D556: 'e', 0x1D58A: 'e', 0x1D5BE: 'e', 0x1D5F2: 'e', 0x1D626: 'e', 0x1D65A: 'e',
	0x1D68E: 'e',
}

const reservedSurfaceLiteral = "Surface"

func isNFKCSurface(s string) bool {
	if s == reservedSurfaceLiteral {
		return true
	}
	idx := 0
	for _, r := range s {
		if idx >= len(reservedSurfaceLiteral) {
			return false
		}
		mapped, ok := nfkcSurfaceRuneMap[r]
		if !ok || mapped != reservedSurfaceLiteral[idx] {
			return false
		}
		idx++
	}
	return idx == len(reservedSurfaceLiteral)
}

func validateV1_0MacroName(name string) error {
	if isNFKCSurface(name) {
		return newMacroProtocolError("macro name \"Surface\" is reserved and cannot be used as a component name")
	}
	if !core.IsValidUAX31Identifier(name) {
		return newMacroProtocolErrorf("macro name %q must be a valid Unicode identifier", name)
	}
	return nil
}

var (
	nodeType       = reflect.TypeFor[builder.Node]()
	compRefPtrType = reflect.TypeFor[*builder.ComponentRef]()
	stringEnumType = reflect.TypeFor[builder.StringEnum]()
	versionedType  = reflect.TypeFor[builder.VersionedModel]()
	anyIfaceType   = reflect.TypeFor[any]()

	v1DynStringType     = reflect.TypeFor[v1.DynamicString]()
	v1DynNumberType     = reflect.TypeFor[v1.DynamicNumber]()
	v1DynBoolType       = reflect.TypeFor[v1.DynamicBoolean]()
	v1DynStringListType = reflect.TypeFor[v1.DynamicStringList]()
	v1DynValueType      = reflect.TypeFor[v1.DynamicValue]()
	v1CheckCondType     = reflect.TypeFor[v1.CheckCondition]()
	v1IconNameValType   = reflect.TypeFor[v1.IconNameValue]()
	v1ChildListType     = reflect.TypeFor[v1.ChildList]()
	v1StaticCLType      = reflect.TypeFor[v1.StaticChildList]()
	v1DCLType           = reflect.TypeFor[v1.DynamicChildList]()
	v1BindType          = reflect.TypeFor[v1.DataBinding]()
	v1FuncCallType      = reflect.TypeFor[v1.FunctionCall]()
	v1ActionType        = reflect.TypeFor[v1.Action]()
	v1ActionEventType   = reflect.TypeFor[v1.ActionEvent]()
	v1CheckRuleType     = reflect.TypeFor[v1.CheckRule]()
	v1A11yType          = reflect.TypeFor[v1.AccessibilityAttributes]()
	v1ExtensionsType    = reflect.TypeFor[v1.Extensions]()

	v09DynStringType     = reflect.TypeFor[v09.DynamicString]()
	v09DynNumberType     = reflect.TypeFor[v09.DynamicNumber]()
	v09DynBoolType       = reflect.TypeFor[v09.DynamicBoolean]()
	v09DynStringListType = reflect.TypeFor[v09.DynamicStringList]()
	v09DynValueType      = reflect.TypeFor[v09.DynamicValue]()
	v09IconNameValType   = reflect.TypeFor[v09.IconNameValue]()
	v09ChildListType     = reflect.TypeFor[v09.ChildList]()
	v09StaticCLType      = reflect.TypeFor[v09.StaticChildList]()
	v09DCLType           = reflect.TypeFor[v09.DynamicChildList]()
	v09BindType          = reflect.TypeFor[v09.DataBinding]()
	v09FuncCallType      = reflect.TypeFor[v09.FunctionCall]()
	v09ActionType        = reflect.TypeFor[v09.Action]()
	v09ActionEventType   = reflect.TypeFor[v09.ActionEvent]()
	v09CheckRuleType     = reflect.TypeFor[v09.CheckRule]()
	v09A11yType          = reflect.TypeFor[v09.AccessibilityAttributes]()
)

func directTypeVersionFamily(t reflect.Type) builder.VersionFamily {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t == nodeType || t == compRefPtrType {
		return builder.VersionFamilyUnspecified
	}
	pkg := t.PkgPath()
	if strings.HasSuffix(pkg, "/agent/builder/v1") {
		return builder.VersionFamily1_0
	}
	if strings.HasSuffix(pkg, "/agent/builder/v09") {
		return builder.VersionFamily0_9
	}
	if t.Kind() != reflect.Interface && t.Implements(versionedType) {
		zv := reflect.Zero(t).Interface().(builder.VersionedModel)
		return zv.BuilderVersionFamily()
	}
	if t.Kind() != reflect.Interface && reflect.PointerTo(t).Implements(versionedType) {
		zv := reflect.New(t).Interface().(builder.VersionedModel)
		return zv.BuilderVersionFamily()
	}
	return builder.VersionFamilyUnspecified
}

func collectTypeVersions(t reflect.Type, out map[builder.VersionFamily]bool, seen map[reflect.Type]bool) {
	if t == nil {
		return
	}
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if seen[t] {
		return
	}
	seen[t] = true

	if fam := directTypeVersionFamily(t); fam != builder.VersionFamilyUnspecified {
		out[fam] = true
		return
	}

	switch t.Kind() {
	case reflect.Slice, reflect.Array:
		collectTypeVersions(t.Elem(), out, seen)
	case reflect.Map:
		collectTypeVersions(t.Key(), out, seen)
		collectTypeVersions(t.Elem(), out, seen)
	case reflect.Struct:
		for i := range t.NumField() {
			sf := t.Field(i)
			if sf.IsExported() || sf.Anonymous {
				collectTypeVersions(sf.Type, out, seen)
			}
		}
	}
}

func isSingleChildSlotType(t reflect.Type) bool {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t == nodeType {
		return true
	}
	return t.Implements(nodeType) || reflect.PointerTo(t).Implements(nodeType)
}

func isChildListSlotType(t reflect.Type) bool {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	switch t {
	case v1ChildListType, v1StaticCLType, v1DCLType, v09ChildListType, v09StaticCLType, v09DCLType:
		return true
	}
	if t.Kind() == reflect.Slice && isSingleChildSlotType(t.Elem()) {
		return true
	}
	return false
}

// macroParam describes a single parameter on a Macro.
type macroParam struct {
	Name        string
	FieldIndex  int
	GoType      reflect.Type
	Required    bool
	HasDefault  bool
	DefaultVal  any
	Description string
	EnumChoices []string
}

// SchemaOptions customizes Macro.ToJSONSchema generation.
type SchemaOptions struct {
	// RefPrefix is prepended to common type $refs (defaults to DefaultCommonRefPrefix).
	RefPrefix string
	// IncludeComponentConst adds a required "component" property pinned to the macro name.
	IncludeComponentConst bool
	// Version selects the protocol family whose dynamic value shapes the schema uses.
	// The zero value, VersionFamilyUnspecified, infers it from the macro's TargetVersion.
	Version builder.VersionFamily
}

// Macro represents a registered composite A2UI macro component.
type Macro struct {
	name        string
	description string
	params      []macroParam
	paramMap    map[string]macroParam
	// customEnvelope holds the envelope mixin names (such as accessibility) that the
	// macro declares as parameters. On an instance, those bare keys are macro
	// arguments rather than envelope fields.
	customEnvelope map[string]bool
	targetVersion  builder.VersionFamily
	invoke         func(rawArgs map[string]any, useV1_0 bool) (builder.Node, error)
}

// Name returns the macro's component name.
func (m *Macro) Name() string { return m.name }

// Description returns the macro's optional human-readable description.
func (m *Macro) Description() string { return m.description }

// TargetVersion returns the protocol family inferred from the macro's types, or VersionFamilyUnspecified.
func (m *Macro) TargetVersion() builder.VersionFamily { return m.targetVersion }

// HasParameter reports whether the macro declares paramName on its signature.
func (m *Macro) HasParameter(paramName string) bool {
	_, ok := m.paramMap[paramName]
	return ok
}

// NewMacro creates a typed Macro from a Go parameter struct Args and an expand callback returning (Out, error).
//
// Struct tags supported on Args fields:
//   - json:"name,omitempty": sets the wire parameter name; omitempty marks the parameter optional.
//   - default:"val": marks the parameter optional and supplies a default when omitted.
//   - desc:"...": sets the parameter's JSON Schema description.
//   - enum:"a,b,c": constrains a string parameter to specific literal choices.
func NewMacro[Args any, Out builder.Node](
	name string,
	description string,
	expand func(Args) (Out, error),
) (*Macro, error) {
	if name == "" {
		return nil, newMacroProtocolError("macro name must not be empty")
	}
	if expand == nil {
		return nil, core.NewValidationErrorf("macro %q expand function must not be nil", name)
	}

	argsType := reflect.TypeFor[Args]()
	if argsType.Kind() != reflect.Struct {
		return nil, core.NewValidationErrorf("macro %q Args type %s must be a struct", name, argsType)
	}
	outType := reflect.TypeFor[Out]()

	versions := make(map[builder.VersionFamily]bool)
	seen := make(map[reflect.Type]bool)
	collectTypeVersions(argsType, versions, seen)
	collectTypeVersions(outType, versions, seen)
	if len(versions) > 1 {
		return nil, newMacroProtocolErrorf("macro %q mixes A2UI v0.9 and v1.0 protocol types", name)
	}
	var targetVer builder.VersionFamily
	for v := range versions {
		targetVer = v
	}
	if targetVer == builder.VersionFamily1_0 {
		if err := validateV1_0MacroName(name); err != nil {
			return nil, err
		}
	}

	params, paramMap, err := inspectStructParams(argsType, name)
	if err != nil {
		return nil, err
	}
	customEnvelope := make(map[string]bool)
	for _, mixin := range envelope.MixinNames {
		if _, ok := paramMap[mixin]; ok {
			customEnvelope[mixin] = true
		}
	}

	invoke := func(rawArgs map[string]any, useV1_0 bool) (builder.Node, error) {
		argsVal, err := coerceStructArgs[Args](rawArgs, params, paramMap, useV1_0, name)
		if err != nil {
			return nil, err
		}
		outNode, err := expand(argsVal)
		if err != nil {
			return nil, err
		}
		return outNode, nil
	}

	return &Macro{
		name:           name,
		description:    strings.TrimSpace(description),
		params:         params,
		paramMap:       paramMap,
		customEnvelope: customEnvelope,
		targetVersion:  targetVer,
		invoke:         invoke,
	}, nil
}

// MustNewMacro calls NewMacro and panics if macro registration fails.
func MustNewMacro[Args any, Out builder.Node](
	name string,
	description string,
	expand func(Args) (Out, error),
) *Macro {
	m, err := NewMacro(name, description, expand)
	if err != nil {
		panic(err)
	}
	return m
}

// NewPureMacro creates a typed Macro from an infallible expand function returning Out.
func NewPureMacro[Args any, Out builder.Node](
	name string,
	description string,
	expand func(Args) Out,
) (*Macro, error) {
	if expand == nil {
		return nil, core.NewValidationErrorf("macro %q expand function must not be nil", name)
	}
	return NewMacro(name, description, func(args Args) (Out, error) {
		return expand(args), nil
	})
}

// MustNewPureMacro calls NewPureMacro and panics if macro registration fails.
func MustNewPureMacro[Args any, Out builder.Node](
	name string,
	description string,
	expand func(Args) Out,
) *Macro {
	m, err := NewPureMacro(name, description, expand)
	if err != nil {
		panic(err)
	}
	return m
}

func inspectStructParams(argsType reflect.Type, macroName string) ([]macroParam, map[string]macroParam, error) {
	params := make([]macroParam, 0, argsType.NumField())
	paramMap := make(map[string]macroParam, argsType.NumField())

	for i := range argsType.NumField() {
		sf := argsType.Field(i)
		if !sf.IsExported() {
			continue
		}
		paramName, omitEmpty, skip := parseFieldTag(sf)
		if skip {
			continue
		}
		if _, dup := paramMap[paramName]; dup {
			return nil, nil, core.NewValidationErrorf("duplicate parameter %q on macro %q", paramName, macroName)
		}

		desc := sf.Tag.Get("desc")

		var enumChoices []string
		if enumTag := sf.Tag.Get("enum"); enumTag != "" {
			for _, part := range strings.Split(enumTag, ",") {
				if trimmed := strings.TrimSpace(part); trimmed != "" {
					enumChoices = append(enumChoices, trimmed)
				}
			}
		}

		hasDefault := false
		var defaultVal any
		if defRaw, ok := sf.Tag.Lookup("default"); ok {
			parsedDef, err := parseDefaultTagValue(defRaw, sf.Type)
			if err != nil {
				return nil, nil, core.NewValidationErrorf("invalid default %q on parameter %q of macro %q: %v", defRaw, paramName, macroName, err)
			}
			hasDefault = true
			defaultVal = parsedDef
		}

		isPointer := sf.Type.Kind() == reflect.Pointer && sf.Type != compRefPtrType && !sf.Type.Implements(nodeType)
		required := !omitEmpty && !hasDefault && !isPointer

		mp := macroParam{
			Name:        paramName,
			FieldIndex:  i,
			GoType:      sf.Type,
			Required:    required,
			HasDefault:  hasDefault,
			DefaultVal:  defaultVal,
			Description: strings.TrimSpace(desc),
			EnumChoices: enumChoices,
		}
		params = append(params, mp)
		paramMap[paramName] = mp
	}
	return params, paramMap, nil
}

func parseFieldTag(sf reflect.StructField) (name string, omitEmpty bool, skip bool) {
	tag := sf.Tag.Get("json")
	if tag == "-" {
		return "", false, true
	}
	if tag != "" {
		parts := strings.Split(tag, ",")
		name = parts[0]
		for _, opt := range parts[1:] {
			if opt == "omitempty" {
				omitEmpty = true
			}
		}
	}
	if name == "" {
		runes := []rune(sf.Name)
		runes[0] = unicode.ToLower(runes[0])
		name = string(runes)
	}
	return name, omitEmpty, false
}

func parseDefaultTagValue(raw string, target reflect.Type) (any, error) {
	base := target
	for base.Kind() == reflect.Pointer {
		base = base.Elem()
	}
	switch base.Kind() {
	case reflect.String:
		return raw, nil
	case reflect.Bool:
		return strconv.ParseBool(raw)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return strconv.Atoi(raw)
	case reflect.Float32, reflect.Float64:
		return strconv.ParseFloat(raw, 64)
	default:
		return raw, nil
	}
}

// ToJSONSchema synthesizes the A2UI component JSON Schema definition for this Macro.
func (m *Macro) ToJSONSchema(opts SchemaOptions) map[string]any {
	refPrefix := opts.RefPrefix
	if refPrefix == "" {
		refPrefix = DefaultCommonRefPrefix
	}
	version := opts.Version
	if version == builder.VersionFamilyUnspecified {
		version = m.targetVersion
	}
	useV1_0 := version == builder.VersionFamily1_0

	props := make(map[string]any, len(m.params)+1)
	var required []string
	if opts.IncludeComponentConst {
		props["component"] = map[string]any{"const": m.name}
		required = append(required, "component")
	}

	for _, p := range m.params {
		propSchema := mapGoTypeToSchema(p.GoType, p.Description, p.EnumChoices, refPrefix, useV1_0, make(map[reflect.Type]bool))
		props[p.Name] = propSchema
		if p.Required {
			required = append(required, p.Name)
		}
	}

	schema := map[string]any{
		"type":       "object",
		"properties": props,
	}
	if len(required) > 0 {
		reqAny := make([]any, len(required))
		for i, r := range required {
			reqAny[i] = r
		}
		schema["required"] = reqAny
	}
	if m.description != "" {
		schema["description"] = m.description
	}
	return schema
}

func withOptionalDescription(schema map[string]any, desc string) map[string]any {
	if desc != "" {
		schema["description"] = desc
	}
	return schema
}

func stringsToAnySlice(items []string) []any {
	out := make([]any, len(items))
	for i, s := range items {
		out[i] = s
	}
	return out
}

func mapGoTypeToSchema(
	t reflect.Type,
	desc string,
	enumChoices []string,
	refPrefix string,
	useV1_0 bool,
	seen map[reflect.Type]bool,
) map[string]any {
	for t.Kind() == reflect.Pointer && t != compRefPtrType && !t.Implements(nodeType) {
		t = t.Elem()
	}

	childRefName := "ComponentId"
	if useV1_0 {
		childRefName = "Child"
	}

	if len(enumChoices) > 0 {
		return withOptionalDescription(map[string]any{
			"type": "string",
			"enum": stringsToAnySlice(enumChoices),
		}, desc)
	}

	switch t {
	case v1DynValueType, v09DynValueType:
		return withOptionalDescription(map[string]any{"$ref": refPrefix + "DynamicValue"}, desc)
	case v1DynStringListType, v09DynStringListType:
		return withOptionalDescription(map[string]any{"$ref": refPrefix + "DynamicStringList"}, desc)
	case v1DynStringType, v09DynStringType:
		return withOptionalDescription(map[string]any{"$ref": refPrefix + "DynamicString"}, desc)
	case v1DynNumberType, v09DynNumberType:
		return withOptionalDescription(map[string]any{"$ref": refPrefix + "DynamicNumber"}, desc)
	case v1DynBoolType, v09DynBoolType:
		return withOptionalDescription(map[string]any{"$ref": refPrefix + "DynamicBoolean"}, desc)
	case v1BindType, v09BindType:
		return withOptionalDescription(map[string]any{"$ref": refPrefix + "DataBinding"}, desc)
	case v1FuncCallType, v09FuncCallType:
		return withOptionalDescription(map[string]any{"$ref": refPrefix + "FunctionCall"}, desc)
	case v1ActionType, v09ActionType:
		return withOptionalDescription(map[string]any{"$ref": refPrefix + "Action"}, desc)
	case v1CheckRuleType, v09CheckRuleType:
		return withOptionalDescription(map[string]any{"$ref": refPrefix + "CheckRule"}, desc)
	case v1A11yType, v09A11yType:
		return withOptionalDescription(map[string]any{"$ref": refPrefix + "AccessibilityAttributes"}, desc)
	case v1ExtensionsType:
		return withOptionalDescription(map[string]any{"$ref": refPrefix + "Extensions"}, desc)
	case v1CheckCondType:
		return withOptionalDescription(map[string]any{
			"oneOf": []any{
				map[string]any{"$ref": refPrefix + "DataBinding"},
				map[string]any{"$ref": refPrefix + "FunctionCall"},
			},
		}, desc)
	case v1IconNameValType, v09IconNameValType:
		var svgSchema map[string]any
		if t == v1IconNameValType {
			svgSchema = mapGoTypeToSchema(reflect.TypeFor[v1.IconNameSVGPath](), "", nil, refPrefix, true, seen)
		} else {
			svgSchema = mapGoTypeToSchema(reflect.TypeFor[v09.IconNameSVGPath](), "", nil, refPrefix, false, seen)
		}
		return withOptionalDescription(map[string]any{
			"oneOf": []any{
				mapGoTypeToSchema(reflect.TypeFor[v1.IconName](), "", nil, refPrefix, useV1_0, seen),
				svgSchema,
				map[string]any{"$ref": refPrefix + "DataBinding"},
				map[string]any{"$ref": refPrefix + "FunctionCall"},
			},
		}, desc)
	}

	if isChildListSlotType(t) {
		return withOptionalDescription(map[string]any{"$ref": refPrefix + "ChildList"}, desc)
	}
	if isSingleChildSlotType(t) {
		return withOptionalDescription(map[string]any{"$ref": refPrefix + childRefName}, desc)
	}

	if t.Kind() != reflect.Interface && t.Implements(stringEnumType) {
		se := reflect.Zero(t).Interface().(builder.StringEnum)
		return withOptionalDescription(map[string]any{
			"type": "string",
			"enum": stringsToAnySlice(se.EnumValues()),
		}, desc)
	}

	if t == anyIfaceType {
		return withOptionalDescription(map[string]any{}, desc)
	}

	switch t.Kind() {
	case reflect.String:
		return withOptionalDescription(map[string]any{"type": "string"}, desc)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return withOptionalDescription(map[string]any{"type": "integer"}, desc)
	case reflect.Float32, reflect.Float64:
		return withOptionalDescription(map[string]any{"type": "number"}, desc)
	case reflect.Bool:
		return withOptionalDescription(map[string]any{"type": "boolean"}, desc)
	case reflect.Slice, reflect.Array:
		itemSchema := mapGoTypeToSchema(t.Elem(), "", nil, refPrefix, useV1_0, seen)
		return withOptionalDescription(map[string]any{
			"type":  "array",
			"items": itemSchema,
		}, desc)
	case reflect.Map:
		schema := map[string]any{"type": "object"}
		if t.Key().Kind() == reflect.String && t.Elem() != anyIfaceType {
			schema["additionalProperties"] = mapGoTypeToSchema(t.Elem(), "", nil, refPrefix, useV1_0, seen)
		}
		return withOptionalDescription(schema, desc)
	case reflect.Struct:
		if seen[t] {
			return withOptionalDescription(map[string]any{"type": "object"}, desc)
		}
		nextSeen := make(map[reflect.Type]bool, len(seen)+1)
		for k, v := range seen {
			nextSeen[k] = v
		}
		nextSeen[t] = true

		subProps := make(map[string]any)
		var subReq []any
		for i := range t.NumField() {
			sf := t.Field(i)
			if !sf.IsExported() {
				continue
			}
			fName, omitEmpty, skip := parseFieldTag(sf)
			if skip {
				continue
			}
			fDesc := sf.Tag.Get("desc")
			if fDesc == "" {
				fDesc = sf.Tag.Get("description")
			}
			subProps[fName] = mapGoTypeToSchema(sf.Type, fDesc, nil, refPrefix, useV1_0, nextSeen)
			isPtr := sf.Type.Kind() == reflect.Pointer && sf.Type != compRefPtrType && !sf.Type.Implements(nodeType)
			if !omitEmpty && !isPtr {
				subReq = append(subReq, fName)
			}
		}
		modelSchema := map[string]any{
			"type":                 "object",
			"properties":           subProps,
			"additionalProperties": false,
		}
		if len(subReq) > 0 {
			modelSchema["required"] = subReq
		}
		return withOptionalDescription(modelSchema, desc)
	default:
		return withOptionalDescription(map[string]any{"type": "string"}, desc)
	}
}
