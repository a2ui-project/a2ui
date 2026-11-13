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

package v1

import (
	"github.com/a2ui-project/a2ui/go/agent/builder"
	"github.com/a2ui-project/a2ui/go/core"
)

// DynamicString represents a v1.0 string value, @path DataBinding, or @call FunctionCall.
type DynamicString interface {
	builder.ValueSerializer
	builder.VersionedModel
	isV1DynamicString()
}

// DynamicNumber represents a v1.0 numeric value, @path DataBinding, or @call FunctionCall.
type DynamicNumber interface {
	builder.ValueSerializer
	builder.VersionedModel
	isV1DynamicNumber()
}

// DynamicBoolean represents a v1.0 boolean value, @path DataBinding, or @call FunctionCall.
type DynamicBoolean interface {
	builder.ValueSerializer
	builder.VersionedModel
	isV1DynamicBoolean()
}

// DynamicStringList represents a v1.0 string slice, @path DataBinding, or @call FunctionCall.
type DynamicStringList interface {
	builder.ValueSerializer
	builder.VersionedModel
	isV1DynamicStringList()
}

// DynamicValue represents any v1.0 literal scalar, array, non-directive object, DataBinding, or FunctionCall.
type DynamicValue interface {
	builder.ValueSerializer
	builder.VersionedModel
	isV1DynamicValue()
}

// CheckCondition represents a v1.0 CheckRule condition (DataBinding or FunctionCall).
type CheckCondition interface {
	builder.ValueSerializer
	builder.VersionedModel
	isV1CheckCondition()
}

// IconNameValue represents an Icon name property (IconName enum, IconNameSVGPath, DataBinding, or FunctionCall).
type IconNameValue interface {
	builder.ValueSerializer
	builder.VersionedModel
	isV1IconNameValue()
}

// ChildList represents either a static sequence of child Nodes or a DynamicChildList template.
type ChildList interface {
	builder.ValueSerializer
	builder.VersionedModel
	isV1ChildList()
}

// StringLiteral is a static string implementing DynamicString and DynamicValue.
type StringLiteral string

// Str wraps a plain string as a v1.0 StringLiteral.
func Str(s string) StringLiteral { return StringLiteral(s) }

// BuilderVersionFamily returns VersionFamily1_0.
func (StringLiteral) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// SerializeBuilderValue returns the underlying string.
func (s StringLiteral) SerializeBuilderValue(_ *builder.FlattenContext) (any, error) {
	return string(s), nil
}

func (StringLiteral) isV1DynamicString() {}
func (StringLiteral) isV1DynamicValue()  {}

// IntLiteral is a static 64-bit integer implementing DynamicNumber and DynamicValue.
type IntLiteral int64

// Int wraps an int as a v1.0 IntLiteral.
func Int(v int) IntLiteral { return IntLiteral(v) }

// Int64 wraps an int64 as a v1.0 IntLiteral.
func Int64(v int64) IntLiteral { return IntLiteral(v) }

// BuilderVersionFamily returns VersionFamily1_0.
func (IntLiteral) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// SerializeBuilderValue returns the underlying int64.
func (n IntLiteral) SerializeBuilderValue(_ *builder.FlattenContext) (any, error) {
	return int64(n), nil
}

func (IntLiteral) isV1DynamicNumber() {}
func (IntLiteral) isV1DynamicValue()  {}

// NumberLiteral is a static float64 implementing DynamicNumber and DynamicValue.
type NumberLiteral float64

// Num wraps a float64 as a v1.0 NumberLiteral.
func Num(v float64) NumberLiteral { return NumberLiteral(v) }

// BuilderVersionFamily returns VersionFamily1_0.
func (NumberLiteral) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// SerializeBuilderValue validates finiteness and returns the underlying float64.
func (n NumberLiteral) SerializeBuilderValue(_ *builder.FlattenContext) (any, error) {
	if err := builder.ValidateFiniteFloat("NumberLiteral", float64(n)); err != nil {
		return nil, err
	}
	return float64(n), nil
}

func (NumberLiteral) isV1DynamicNumber() {}
func (NumberLiteral) isV1DynamicValue()  {}

// BoolLiteral is a static boolean implementing DynamicBoolean and DynamicValue.
type BoolLiteral bool

// Bool wraps a bool as a v1.0 BoolLiteral.
func Bool(v bool) BoolLiteral { return BoolLiteral(v) }

// BuilderVersionFamily returns VersionFamily1_0.
func (BoolLiteral) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// SerializeBuilderValue returns the underlying bool.
func (b BoolLiteral) SerializeBuilderValue(_ *builder.FlattenContext) (any, error) {
	return bool(b), nil
}

func (BoolLiteral) isV1DynamicBoolean() {}
func (BoolLiteral) isV1DynamicValue()   {}

// StringListLiteral is a static string slice implementing DynamicStringList and DynamicValue.
type StringListLiteral []string

// Strs wraps string arguments as a v1.0 StringListLiteral.
func Strs(items ...string) StringListLiteral {
	if items == nil {
		return StringListLiteral{}
	}
	return StringListLiteral(items)
}

// BuilderVersionFamily returns VersionFamily1_0.
func (StringListLiteral) BuilderVersionFamily() builder.VersionFamily {
	return builder.VersionFamily1_0
}

// SerializeBuilderValue returns the string slice as []any for uniform JSON-value comparison.
func (l StringListLiteral) SerializeBuilderValue(_ *builder.FlattenContext) (any, error) {
	out := make([]any, len(l))
	for i, s := range l {
		out[i] = s
	}
	return out, nil
}

func (StringListLiteral) isV1DynamicStringList() {}
func (StringListLiteral) isV1DynamicValue()      {}

// ArrayLiteral is a literal array implementing DynamicValue.
type ArrayLiteral []any

// Arr wraps items as a v1.0 ArrayLiteral.
func Arr(items ...any) ArrayLiteral {
	if items == nil {
		return ArrayLiteral{}
	}
	return ArrayLiteral(items)
}

// BuilderVersionFamily returns VersionFamily1_0.
func (ArrayLiteral) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// SerializeBuilderValue serializes each array element.
func (a ArrayLiteral) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	out := make([]any, len(a))
	for i, item := range a {
		ser, err := ctx.SerializeValue(item)
		if err != nil {
			return nil, err
		}
		out[i] = ser
	}
	return out, nil
}

func (ArrayLiteral) isV1DynamicValue() {}

// ObjectLiteral is a literal non-directive JSON object implementing DynamicValue.
// Per v1.0 common_types.json, literal objects must not contain "@path", "@call", or "@"-prefixed keys.
type ObjectLiteral map[string]any

// Obj wraps a map as a v1.0 ObjectLiteral.
func Obj(m map[string]any) ObjectLiteral {
	if m == nil {
		return ObjectLiteral{}
	}
	return ObjectLiteral(m)
}

// BuilderVersionFamily returns VersionFamily1_0.
func (ObjectLiteral) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// Validate reports an error when o uses a reserved v1.0 "@" directive key such as "@path" or "@call".
func (o ObjectLiteral) Validate() error {
	if _, hasPath := o["@path"]; hasPath {
		return core.NewValidationError("v1.0 literal object must not contain reserved '@path' key")
	}
	if _, hasCall := o["@call"]; hasCall {
		return core.NewValidationError("v1.0 literal object must not contain reserved '@call' key")
	}
	for k := range o {
		if len(k) > 0 && k[0] == '@' && (len(k) == 1 || k[1] != '@') {
			return core.NewValidationErrorf("v1.0 literal object key %q must not start with '@'", k)
		}
	}
	return nil
}

// SerializeBuilderValue validates and serializes the literal object's entries.
func (o ObjectLiteral) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	if err := o.Validate(); err != nil {
		return nil, err
	}
	out := make(map[string]any, len(o))
	for k, v := range o {
		ser, err := ctx.SerializeValue(v)
		if err != nil {
			return nil, err
		}
		out[k] = ser
	}
	return out, nil
}

func (ObjectLiteral) isV1DynamicValue() {}

// DataBinding binds a property dynamically to a client data model JSON Pointer path via "@path".
type DataBinding struct {
	Path string
}

// Bind creates a v1.0 DataBinding preserving relative and absolute paths verbatim.
func Bind(path string) DataBinding {
	return DataBinding{Path: path}
}

// BuilderVersionFamily returns VersionFamily1_0.
func (DataBinding) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// SerializeBuilderValue emits {"@path": Path}.
func (b DataBinding) SerializeBuilderValue(_ *builder.FlattenContext) (any, error) {
	return map[string]any{"@path": b.Path}, nil
}

func (DataBinding) isV1DynamicString()     {}
func (DataBinding) isV1DynamicNumber()     {}
func (DataBinding) isV1DynamicBoolean()    {}
func (DataBinding) isV1DynamicStringList() {}
func (DataBinding) isV1DynamicValue()      {}
func (DataBinding) isV1CheckCondition()    {}
func (DataBinding) isV1IconNameValue()     {}

// FunctionCall invokes a catalog or system function via "@call".
type FunctionCall struct {
	Call      string
	Args      map[string]any
	CatalogID string
}

// NewFunctionCall constructs a v1.0 FunctionCall descriptor.
func NewFunctionCall(call string, args map[string]any) FunctionCall {
	return FunctionCall{Call: call, Args: args}
}

// WithCatalogID returns a copy of the FunctionCall stamped with catalogID.
func (f FunctionCall) WithCatalogID(catalogID string) FunctionCall {
	f.CatalogID = catalogID
	return f
}

// BuilderVersionFamily returns VersionFamily1_0.
func (FunctionCall) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// SerializeBuilderValue emits {"@call": Call, "args"?: ..., "catalogId"?: ...}.
func (f FunctionCall) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	if f.Call == "" {
		return nil, core.NewValidationError("FunctionCall '@call' name must not be empty")
	}
	out := map[string]any{
		"@call": f.Call,
	}
	if f.CatalogID != "" {
		out["catalogId"] = f.CatalogID
	}
	if len(f.Args) > 0 {
		argsOut := make(map[string]any, len(f.Args))
		for k, v := range f.Args {
			ser, err := ctx.SerializeValue(v)
			if err != nil {
				return nil, err
			}
			argsOut[k] = ser
		}
		out["args"] = argsOut
	}
	return out, nil
}

func (FunctionCall) isV1DynamicString()     {}
func (FunctionCall) isV1DynamicNumber()     {}
func (FunctionCall) isV1DynamicBoolean()    {}
func (FunctionCall) isV1DynamicStringList() {}
func (FunctionCall) isV1DynamicValue()      {}
func (FunctionCall) isV1CheckCondition()    {}
func (FunctionCall) isV1IconNameValue()     {}

// StaticChildList holds an ordered slice of child builder Nodes.
type StaticChildList []builder.Node

// Children constructs a StaticChildList from variadic child builder Nodes.
func Children(nodes ...builder.Node) StaticChildList {
	if nodes == nil {
		return StaticChildList{}
	}
	return StaticChildList(nodes)
}

// BuilderVersionFamily returns VersionFamily1_0.
func (StaticChildList) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// SerializeBuilderValue emits each child subtree and returns the slice of allocated component IDs.
func (l StaticChildList) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	ids := make([]any, 0, len(l))
	for _, child := range l {
		id, err := ctx.EmitChild(child)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func (StaticChildList) isV1ChildList() {}

// DynamicChildList repeats Template for each item in the data model collection at Path.
type DynamicChildList struct {
	Path     string
	Template builder.Node
}

// NewDynamicChildList constructs a DynamicChildList binding Path to Template.
func NewDynamicChildList(path string, template builder.Node) DynamicChildList {
	return DynamicChildList{Path: path, Template: template}
}

// BuilderVersionFamily returns VersionFamily1_0.
func (DynamicChildList) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily1_0 }

// SerializeBuilderValue emits Template as a sibling component and returns {"path": Path, "componentId": id}.
func (d DynamicChildList) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	if builder.IsNilValue(d.Template) {
		return nil, core.NewValidationError("DynamicChildList template must not be nil")
	}
	compID, err := ctx.EmitChild(d.Template)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"path":        d.Path,
		"componentId": compID,
	}, nil
}

func (DynamicChildList) isV1ChildList() {}
