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

package v09

import (
	"github.com/a2ui-project/a2ui/go/agent/builder"
	"github.com/a2ui-project/a2ui/go/core"
)

// DynamicString represents a v0.9 string value, DataBinding, or FunctionCall.
type DynamicString interface {
	builder.ValueSerializer
	builder.VersionedModel
	isV09DynamicString()
}

// DynamicNumber represents a v0.9 numeric value, DataBinding, or FunctionCall.
type DynamicNumber interface {
	builder.ValueSerializer
	builder.VersionedModel
	isV09DynamicNumber()
}

// DynamicBoolean represents a v0.9 boolean value, DataBinding, or FunctionCall.
type DynamicBoolean interface {
	builder.ValueSerializer
	builder.VersionedModel
	isV09DynamicBoolean()
}

// DynamicStringList represents a v0.9 string slice, DataBinding, or FunctionCall.
type DynamicStringList interface {
	builder.ValueSerializer
	builder.VersionedModel
	isV09DynamicStringList()
}

// DynamicValue represents a v0.9 scalar, array, DataBinding, or FunctionCall.
type DynamicValue interface {
	builder.ValueSerializer
	builder.VersionedModel
	isV09DynamicValue()
}

// IconNameValue represents a v0.9 Icon name property (IconName, IconNameSVGPath, DataBinding, or FunctionCall).
type IconNameValue interface {
	builder.ValueSerializer
	builder.VersionedModel
	isV09IconNameValue()
}

// ChildList represents either a static sequence of child Nodes or a DynamicChildList template.
type ChildList interface {
	builder.ValueSerializer
	builder.VersionedModel
	isV09ChildList()
}

// StringLiteral is a static string implementing DynamicString and DynamicValue.
type StringLiteral string

// Str wraps a plain string as a v0.9 StringLiteral.
func Str(s string) StringLiteral { return StringLiteral(s) }

// BuilderVersionFamily returns VersionFamily0_9.
func (StringLiteral) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily0_9 }

// SerializeBuilderValue returns the underlying string.
func (s StringLiteral) SerializeBuilderValue(_ *builder.FlattenContext) (any, error) {
	return string(s), nil
}

func (StringLiteral) isV09DynamicString() {}
func (StringLiteral) isV09DynamicValue()  {}

// IntLiteral is a static 64-bit integer implementing DynamicNumber and DynamicValue.
type IntLiteral int64

// Int wraps an int as a v0.9 IntLiteral.
func Int(v int) IntLiteral { return IntLiteral(v) }

// Int64 wraps an int64 as a v0.9 IntLiteral.
func Int64(v int64) IntLiteral { return IntLiteral(v) }

// BuilderVersionFamily returns VersionFamily0_9.
func (IntLiteral) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily0_9 }

// SerializeBuilderValue returns the underlying int64.
func (n IntLiteral) SerializeBuilderValue(_ *builder.FlattenContext) (any, error) {
	return int64(n), nil
}

func (IntLiteral) isV09DynamicNumber() {}
func (IntLiteral) isV09DynamicValue()  {}

// NumberLiteral is a static float64 implementing DynamicNumber and DynamicValue.
type NumberLiteral float64

// Num wraps a float64 as a v0.9 NumberLiteral.
func Num(v float64) NumberLiteral { return NumberLiteral(v) }

// BuilderVersionFamily returns VersionFamily0_9.
func (NumberLiteral) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily0_9 }

// SerializeBuilderValue validates finiteness and returns the underlying float64.
func (n NumberLiteral) SerializeBuilderValue(_ *builder.FlattenContext) (any, error) {
	if err := builder.ValidateFiniteFloat("NumberLiteral", float64(n)); err != nil {
		return nil, err
	}
	return float64(n), nil
}

func (NumberLiteral) isV09DynamicNumber() {}
func (NumberLiteral) isV09DynamicValue()  {}

// BoolLiteral is a static boolean implementing DynamicBoolean and DynamicValue.
type BoolLiteral bool

// Bool wraps a bool as a v0.9 BoolLiteral.
func Bool(v bool) BoolLiteral { return BoolLiteral(v) }

// BuilderVersionFamily returns VersionFamily0_9.
func (BoolLiteral) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily0_9 }

// SerializeBuilderValue returns the underlying bool.
func (b BoolLiteral) SerializeBuilderValue(_ *builder.FlattenContext) (any, error) {
	return bool(b), nil
}

func (BoolLiteral) isV09DynamicBoolean() {}
func (BoolLiteral) isV09DynamicValue()   {}

// StringListLiteral is a static string slice implementing DynamicStringList and DynamicValue.
type StringListLiteral []string

// Strs wraps string arguments as a v0.9 StringListLiteral.
func Strs(items ...string) StringListLiteral {
	if items == nil {
		return StringListLiteral{}
	}
	return StringListLiteral(items)
}

// BuilderVersionFamily returns VersionFamily0_9.
func (StringListLiteral) BuilderVersionFamily() builder.VersionFamily {
	return builder.VersionFamily0_9
}

// SerializeBuilderValue returns the string slice as []any.
func (l StringListLiteral) SerializeBuilderValue(_ *builder.FlattenContext) (any, error) {
	out := make([]any, len(l))
	for i, s := range l {
		out[i] = s
	}
	return out, nil
}

func (StringListLiteral) isV09DynamicStringList() {}
func (StringListLiteral) isV09DynamicValue()      {}

// ArrayLiteral is a literal array implementing DynamicValue.
type ArrayLiteral []any

// Arr wraps items as a v0.9 ArrayLiteral.
func Arr(items ...any) ArrayLiteral {
	if items == nil {
		return ArrayLiteral{}
	}
	return ArrayLiteral(items)
}

// BuilderVersionFamily returns VersionFamily0_9.
func (ArrayLiteral) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily0_9 }

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

func (ArrayLiteral) isV09DynamicValue() {}

// DataBinding binds a property dynamically to a client data model JSON Pointer path via "path".
type DataBinding struct {
	Path string
}

// Bind creates a v0.9 DataBinding preserving relative and absolute paths verbatim.
func Bind(path string) DataBinding {
	return DataBinding{Path: path}
}

// BuilderVersionFamily returns VersionFamily0_9.
func (DataBinding) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily0_9 }

// SerializeBuilderValue emits {"path": Path}.
func (b DataBinding) SerializeBuilderValue(_ *builder.FlattenContext) (any, error) {
	return map[string]any{"path": b.Path}, nil
}

func (DataBinding) isV09DynamicString()     {}
func (DataBinding) isV09DynamicNumber()     {}
func (DataBinding) isV09DynamicBoolean()    {}
func (DataBinding) isV09DynamicStringList() {}
func (DataBinding) isV09DynamicValue()      {}
func (DataBinding) isV09IconNameValue()     {}

// FunctionCall invokes a client catalog function via "call".
type FunctionCall struct {
	Call       string
	Args       map[string]any
	ReturnType string
}

// NewFunctionCall constructs a v0.9 FunctionCall descriptor.
func NewFunctionCall(call string, args map[string]any) FunctionCall {
	return FunctionCall{Call: call, Args: args}
}

// WithReturnType returns a copy of the FunctionCall with an explicit returnType annotation.
func (f FunctionCall) WithReturnType(returnType string) FunctionCall {
	f.ReturnType = returnType
	return f
}

// BuilderVersionFamily returns VersionFamily0_9.
func (FunctionCall) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily0_9 }

// SerializeBuilderValue emits {"call": Call, "args"?: ..., "returnType"?: ...}.
func (f FunctionCall) SerializeBuilderValue(ctx *builder.FlattenContext) (any, error) {
	if f.Call == "" {
		return nil, core.NewValidationError("FunctionCall 'call' name must not be empty")
	}
	out := map[string]any{
		"call": f.Call,
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
	if f.ReturnType != "" {
		out["returnType"] = f.ReturnType
	}
	return out, nil
}

func (FunctionCall) isV09DynamicString()     {}
func (FunctionCall) isV09DynamicNumber()     {}
func (FunctionCall) isV09DynamicBoolean()    {}
func (FunctionCall) isV09DynamicStringList() {}
func (FunctionCall) isV09DynamicValue()      {}
func (FunctionCall) isV09IconNameValue()     {}

// StaticChildList holds an ordered slice of child builder Nodes.
type StaticChildList []builder.Node

// Children constructs a StaticChildList from variadic child builder Nodes.
func Children(nodes ...builder.Node) StaticChildList {
	if nodes == nil {
		return StaticChildList{}
	}
	return StaticChildList(nodes)
}

// BuilderVersionFamily returns VersionFamily0_9.
func (StaticChildList) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily0_9 }

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

func (StaticChildList) isV09ChildList() {}

// DynamicChildList repeats Template for each item in the data model collection at Path.
type DynamicChildList struct {
	Path     string
	Template builder.Node
}

// NewDynamicChildList constructs a v0.9 DynamicChildList binding Path to Template.
func NewDynamicChildList(path string, template builder.Node) DynamicChildList {
	return DynamicChildList{Path: path, Template: template}
}

// BuilderVersionFamily returns VersionFamily0_9.
func (DynamicChildList) BuilderVersionFamily() builder.VersionFamily { return builder.VersionFamily0_9 }

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

func (DynamicChildList) isV09ChildList() {}
