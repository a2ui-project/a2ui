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
	"math"
	"reflect"
	"slices"

	"github.com/a2ui-project/a2ui/go/agent/builder"
	v09 "github.com/a2ui-project/a2ui/go/agent/builder/v09"
	v1 "github.com/a2ui-project/a2ui/go/agent/builder/v1"
	"github.com/a2ui-project/a2ui/go/core"
)

func fieldByIndexAlloc(v reflect.Value, index []int) reflect.Value {
	for _, x := range index {
		if v.Kind() == reflect.Pointer {
			if v.IsNil() {
				v.Set(reflect.New(v.Type().Elem()))
			}
			v = v.Elem()
		}
		v = v.Field(x)
	}
	return v
}

func toStringAnyMap(raw any) (map[string]any, bool) {
	if raw == nil {
		return nil, false
	}
	if m, ok := raw.(map[string]any); ok {
		if m == nil {
			return nil, false
		}
		return m, true
	}
	rv := reflect.ValueOf(raw)
	if rv.Kind() == reflect.Map && rv.Type().Key().Kind() == reflect.String {
		if rv.IsNil() {
			return nil, false
		}
		out := make(map[string]any, rv.Len())
		iter := rv.MapRange()
		for iter.Next() {
			out[iter.Key().String()] = iter.Value().Interface()
		}
		return out, true
	}
	return nil, false
}

func toAnySlice(raw any) ([]any, bool) {
	if raw == nil {
		return nil, false
	}
	if s, ok := raw.([]any); ok {
		if s == nil {
			return nil, false
		}
		out := make([]any, len(s))
		for i, elem := range s {
			out[i] = core.CloneJSONValue(elem)
		}
		return out, true
	}
	rv := reflect.ValueOf(raw)
	if (rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array) && (rv.Kind() == reflect.Array || !rv.IsNil()) {
		out := make([]any, rv.Len())
		for i := range rv.Len() {
			out[i] = core.CloneJSONValue(rv.Index(i).Interface())
		}
		return out, true
	}
	return nil, false
}

func extractPlainString(raw any) (string, bool) {
	if s, ok := raw.(string); ok {
		return s, true
	}
	rv := reflect.ValueOf(raw)
	if rv.IsValid() && rv.Kind() == reflect.String {
		return rv.String(), true
	}
	return "", false
}

func extractPlainBool(raw any) (bool, bool) {
	if b, ok := raw.(bool); ok {
		return b, true
	}
	rv := reflect.ValueOf(raw)
	if rv.IsValid() && rv.Kind() == reflect.Bool {
		return rv.Bool(), true
	}
	return false, false
}

func coerceStructArgs[Args any](
	rawArgs map[string]any,
	params []macroParam,
	paramMap map[string]macroParam,
	useV1_0 bool,
	macroName string,
) (Args, error) {
	var zero Args
	for k := range rawArgs {
		if _, ok := paramMap[k]; !ok {
			return zero, fmt.Errorf("unexpected parameter %q for macro %q", k, macroName)
		}
	}

	outVal := reflect.New(reflect.TypeFor[Args]()).Elem()
	for _, p := range params {
		raw, present := rawArgs[p.Name]
		if present && raw == nil && p.GoType == anyIfaceType {
			fieldByIndexAlloc(outVal, p.FieldIndex).Set(reflect.Zero(anyIfaceType))
			continue
		}
		if !present || raw == nil {
			if p.HasDefault {
				coerced, err := coerceValue(p.DefaultVal, p.GoType, p.EnumChoices, useV1_0, p.Name, macroName)
				if err != nil {
					return zero, err
				}
				fieldByIndexAlloc(outVal, p.FieldIndex).Set(coerced)
				continue
			}
			if p.Required {
				return zero, fmt.Errorf("missing required parameter %q for macro %q", p.Name, macroName)
			}
			continue
		}
		coerced, err := coerceValue(raw, p.GoType, p.EnumChoices, useV1_0, p.Name, macroName)
		if err != nil {
			return zero, err
		}
		fieldByIndexAlloc(outVal, p.FieldIndex).Set(coerced)
	}
	return outVal.Interface().(Args), nil
}

func coerceValue(
	raw any,
	target reflect.Type,
	enumChoices []string,
	useV1_0 bool,
	paramName string,
	macroName string,
) (reflect.Value, error) {
	if raw == nil {
		if target == anyIfaceType {
			return reflect.Zero(target), nil
		}
		if target.Kind() == reflect.Pointer && target != compRefPtrType && !target.Implements(nodeType) {
			return reflect.Zero(target), nil
		}
		if !target.Implements(nodeType) && (target.Kind() == reflect.Map || target.Kind() == reflect.Slice) {
			return reflect.Zero(target), nil
		}
		return reflect.Value{}, fmt.Errorf("parameter %q of macro %q cannot be null", paramName, macroName)
	}

	rawRV := reflect.ValueOf(raw)
	if rawRV.Kind() == reflect.Pointer && rawRV.IsNil() {
		if target == anyIfaceType {
			return reflect.Zero(target), nil
		}
		if target.Kind() == reflect.Pointer && target != compRefPtrType && !target.Implements(nodeType) {
			return reflect.Zero(target), nil
		}
		return reflect.Value{}, fmt.Errorf("parameter %q of macro %q cannot be nil", paramName, macroName)
	}

	// Pointer unwrap (excluding *builder.ComponentRef and concrete pointer Node types).
	if target.Kind() == reflect.Pointer && target != compRefPtrType && !target.Implements(nodeType) {
		elemVal, err := coerceValue(raw, target.Elem(), enumChoices, useV1_0, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		ptr := reflect.New(target.Elem())
		ptr.Elem().Set(elemVal)
		return ptr, nil
	}

	// 1. Single child slot: string ID -> ComponentRef (or programmatic *ComponentRef / Node).
	if target == nodeType || target == compRefPtrType {
		if s, ok := extractPlainString(raw); ok {
			if s == "" {
				return reflect.Value{}, fmt.Errorf("parameter %q of macro %q component ID must not be empty", paramName, macroName)
			}
			return reflect.ValueOf(builder.NewComponentRef(s)), nil
		}
		if ref, ok := raw.(*builder.ComponentRef); ok {
			if ref == nil || ref.ID == "" {
				return reflect.Value{}, fmt.Errorf("parameter %q of macro %q ComponentRef ID must not be empty", paramName, macroName)
			}
			return reflect.ValueOf(ref), nil
		}
		if n, ok := raw.(builder.Node); ok {
			if builder.IsNilValue(n) {
				return reflect.Value{}, fmt.Errorf("parameter %q of macro %q child node must not be nil", paramName, macroName)
			}
			if target == nodeType {
				return reflect.ValueOf(n), nil
			}
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects component ID reference (*builder.ComponentRef), got %T", paramName, macroName, raw)
		}
		return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects component ID string, got %T", paramName, macroName, raw)
	}

	// 2. ChildList / DynamicChildList / []builder.Node / []*builder.ComponentRef.
	if isChildListSlotType(target) {
		return coerceChildListValue(raw, target, useV1_0, paramName, macroName)
	}

	// 3. Dedicated protocol types (DataBinding, FunctionCall, Dynamic*, Action, CheckRule, Accessibility, Extensions).
	switch target {
	case v1BindType:
		db, err := coerceV1DataBinding(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(db), nil
	case v09BindType:
		db, err := coerceV09DataBinding(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(db), nil
	case v1FuncCallType:
		fc, err := coerceV1FunctionCall(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(fc), nil
	case v09FuncCallType:
		fc, err := coerceV09FunctionCall(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(fc), nil
	case v1DynStringType:
		ds, err := coerceV1DynamicString(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(ds), nil
	case v09DynStringType:
		ds, err := coerceV09DynamicString(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(ds), nil
	case v1DynNumberType:
		dn, err := coerceV1DynamicNumber(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(dn), nil
	case v09DynNumberType:
		dn, err := coerceV09DynamicNumber(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(dn), nil
	case v1DynBoolType:
		db, err := coerceV1DynamicBoolean(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(db), nil
	case v09DynBoolType:
		db, err := coerceV09DynamicBoolean(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(db), nil
	case v1DynStringListType:
		dl, err := coerceV1DynamicStringList(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(dl), nil
	case v09DynStringListType:
		dl, err := coerceV09DynamicStringList(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(dl), nil
	case v1DynValueType:
		dv, err := coerceV1DynamicValue(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(dv), nil
	case v09DynValueType:
		dv, err := coerceV09DynamicValue(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(dv), nil
	case v1CheckCondType:
		cc, err := coerceV1CheckCondition(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(cc), nil
	case v1IconNameValType:
		iv, err := coerceV1IconName(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(iv), nil
	case v09IconNameValType:
		iv, err := coerceV09IconName(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(iv), nil
	case v1ActionType:
		act, err := coerceV1Action(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(act), nil
	case v09ActionType:
		act, err := coerceV09Action(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(act), nil
	case v1ActionEventType:
		ev, err := coerceV1ActionEventMap(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(ev), nil
	case v09ActionEventType:
		ev, err := coerceV09ActionEventMap(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(ev), nil
	case v1CheckRuleType:
		cr, err := coerceV1CheckRule(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(cr), nil
	case v09CheckRuleType:
		cr, err := coerceV09CheckRule(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(cr), nil
	case v1A11yType:
		a, err := coerceV1A11y(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(a), nil
	case v09A11yType:
		a, err := coerceV09A11y(raw, paramName, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(a), nil
	case v1ExtensionsType:
		m, ok := toStringAnyMap(raw)
		if !ok {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects Extensions map, got %T", paramName, macroName, raw)
		}
		cloned, _ := core.CloneJSONValue(m).(map[string]any)
		ext := v1.Extensions(cloned)
		if err := ext.Validate(); err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(ext), nil
	}

	if target == anyIfaceType {
		return coerceAnyDynamic(raw, useV1_0), nil
	}

	// 4. Primitives & enums (strictly reject dicts/bindings!).
	switch target.Kind() {
	case reflect.String:
		s, ok := extractPlainString(raw)
		if !ok {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects string, got %T", paramName, macroName, raw)
		}
		if len(enumChoices) > 0 && !slices.Contains(enumChoices, s) {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q got %q, expected one of %v", paramName, macroName, s, enumChoices)
		}
		out := reflect.New(target).Elem()
		out.SetString(s)
		if target.Implements(stringEnumType) {
			se := out.Interface().(builder.StringEnum)
			if !slices.Contains(se.EnumValues(), s) {
				return reflect.Value{}, fmt.Errorf("parameter %q of macro %q got %q, expected one of %v", paramName, macroName, s, se.EnumValues())
			}
		} else if reflect.PointerTo(target).Implements(stringEnumType) {
			ptr := reflect.New(target)
			ptr.Elem().Set(out)
			se := ptr.Interface().(builder.StringEnum)
			if !slices.Contains(se.EnumValues(), s) {
				return reflect.Value{}, fmt.Errorf("parameter %q of macro %q got %q, expected one of %v", paramName, macroName, s, se.EnumValues())
			}
		}
		return out, nil

	case reflect.Bool:
		b, ok := extractPlainBool(raw)
		if !ok {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects bool, got %T", paramName, macroName, raw)
		}
		out := reflect.New(target).Elem()
		out.SetBool(b)
		return out, nil

	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		iv, ok := extractStrictInt(raw)
		if !ok {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects integer, got %T", paramName, macroName, raw)
		}
		out := reflect.New(target).Elem()
		if out.OverflowInt(iv) {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q value %d overflows %s", paramName, macroName, iv, target)
		}
		out.SetInt(iv)
		return out, nil

	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		uv, ok := extractStrictUint(raw)
		if !ok {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects unsigned integer, got %T", paramName, macroName, raw)
		}
		out := reflect.New(target).Elem()
		if out.OverflowUint(uv) {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q value %d overflows %s", paramName, macroName, uv, target)
		}
		out.SetUint(uv)
		return out, nil

	case reflect.Float32, reflect.Float64:
		fv, ok := extractStrictFloat(raw)
		if !ok {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects number, got %T", paramName, macroName, raw)
		}
		out := reflect.New(target).Elem()
		if out.OverflowFloat(fv) {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q value %g overflows %s", paramName, macroName, fv, target)
		}
		out.SetFloat(fv)
		return out, nil

	case reflect.Slice:
		rv := reflect.ValueOf(raw)
		if rv.Kind() != reflect.Slice && rv.Kind() != reflect.Array {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects slice, got %T", paramName, macroName, raw)
		}
		sliceOut := reflect.MakeSlice(target, rv.Len(), rv.Len())
		for i := range rv.Len() {
			elemVal, err := coerceValue(rv.Index(i).Interface(), target.Elem(), enumChoices, useV1_0, fmt.Sprintf("%s[%d]", paramName, i), macroName)
			if err != nil {
				return reflect.Value{}, err
			}
			sliceOut.Index(i).Set(elemVal)
		}
		return sliceOut, nil

	case reflect.Array:
		rv := reflect.ValueOf(raw)
		if rv.Kind() != reflect.Slice && rv.Kind() != reflect.Array {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects array of length %d, got %T", paramName, macroName, target.Len(), raw)
		}
		if rv.Len() != target.Len() {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects %d items, got %d", paramName, macroName, target.Len(), rv.Len())
		}
		arrOut := reflect.New(target).Elem()
		for i := range rv.Len() {
			elemVal, err := coerceValue(rv.Index(i).Interface(), target.Elem(), enumChoices, useV1_0, fmt.Sprintf("%s[%d]", paramName, i), macroName)
			if err != nil {
				return reflect.Value{}, err
			}
			arrOut.Index(i).Set(elemVal)
		}
		return arrOut, nil

	case reflect.Map:
		m, ok := toStringAnyMap(raw)
		if !ok || target.Key().Kind() != reflect.String {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects object map, got %T", paramName, macroName, raw)
		}
		mapOut := reflect.MakeMapWithSize(target, len(m))
		for k, v := range m {
			keyVal := reflect.ValueOf(k).Convert(target.Key())
			if target.Elem() == anyIfaceType {
				if v == nil {
					mapOut.SetMapIndex(keyVal, reflect.Zero(anyIfaceType))
				} else {
					mapOut.SetMapIndex(keyVal, reflect.ValueOf(v))
				}
				continue
			}
			valCoerced, err := coerceValue(v, target.Elem(), nil, useV1_0, fmt.Sprintf("%s[%q]", paramName, k), macroName)
			if err != nil {
				return reflect.Value{}, err
			}
			mapOut.SetMapIndex(keyVal, valCoerced)
		}
		return mapOut, nil

	case reflect.Struct:
		if rawRV.Type() == target {
			return rawRV, nil
		}
		if rawRV.Kind() == reflect.Pointer && !rawRV.IsNil() && rawRV.Elem().Type() == target {
			return rawRV.Elem(), nil
		}
		m, ok := toStringAnyMap(raw)
		if !ok {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects object for %s, got %T", paramName, macroName, target.Name(), raw)
		}
		return coerceNestedStruct(m, target, useV1_0, paramName, macroName)
	}

	return reflect.Value{}, fmt.Errorf("unsupported parameter %q type %s on macro %q", paramName, target, macroName)
}

func coerceNestedStruct(
	m map[string]any,
	target reflect.Type,
	useV1_0 bool,
	paramName string,
	macroName string,
) (reflect.Value, error) {
	params, paramMap, err := inspectStructParams(target, macroName, useV1_0)
	if err != nil {
		return reflect.Value{}, err
	}
	for k := range m {
		if _, ok := paramMap[k]; !ok {
			return reflect.Value{}, fmt.Errorf("unexpected field %q in %s on macro %q", k, paramName, macroName)
		}
	}
	outVal := reflect.New(target).Elem()
	for _, p := range params {
		raw, present := m[p.Name]
		if present && raw == nil && p.GoType == anyIfaceType {
			fieldByIndexAlloc(outVal, p.FieldIndex).Set(reflect.Zero(anyIfaceType))
			continue
		}
		if !present || raw == nil {
			if p.HasDefault {
				cv, err := coerceValue(p.DefaultVal, p.GoType, p.EnumChoices, useV1_0, paramName+"."+p.Name, macroName)
				if err != nil {
					return reflect.Value{}, err
				}
				fieldByIndexAlloc(outVal, p.FieldIndex).Set(cv)
				continue
			}
			if p.Required {
				return reflect.Value{}, fmt.Errorf("missing required field %q in %s on macro %q", p.Name, paramName, macroName)
			}
			continue
		}
		cv, err := coerceValue(raw, p.GoType, p.EnumChoices, useV1_0, paramName+"."+p.Name, macroName)
		if err != nil {
			return reflect.Value{}, err
		}
		fieldByIndexAlloc(outVal, p.FieldIndex).Set(cv)
	}
	return outVal, nil
}

func coerceChildListValue(
	raw any,
	target reflect.Type,
	useV1_0 bool,
	paramName string,
	macroName string,
) (reflect.Value, error) {
	if dcl, ok := raw.(v1.DynamicChildList); ok {
		if target != v1ChildListType && target != v1DCLType {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q does not admit v1.0 DynamicChildList", paramName, macroName)
		}
		if builder.IsNilValue(dcl.Template) {
			return reflect.Value{}, fmt.Errorf("DynamicChildList template must not be nil on %q of macro %q", paramName, macroName)
		}
		return reflect.ValueOf(dcl), nil
	}
	if dclPtr, ok := raw.(*v1.DynamicChildList); ok && dclPtr != nil {
		return coerceChildListValue(*dclPtr, target, useV1_0, paramName, macroName)
	}
	if dcl, ok := raw.(v09.DynamicChildList); ok {
		if target != v09ChildListType && target != v09DCLType {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q does not admit v0.9 DynamicChildList", paramName, macroName)
		}
		if builder.IsNilValue(dcl.Template) {
			return reflect.Value{}, fmt.Errorf("DynamicChildList template must not be nil on %q of macro %q", paramName, macroName)
		}
		return reflect.ValueOf(dcl), nil
	}
	if dclPtr, ok := raw.(*v09.DynamicChildList); ok && dclPtr != nil {
		return coerceChildListValue(*dclPtr, target, useV1_0, paramName, macroName)
	}

	if m, ok := toStringAnyMap(raw); ok {
		admitsDCL := target == v1ChildListType || target == v1DCLType || target == v09ChildListType || target == v09DCLType
		if !admitsDCL {
			return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects static child list, got map", paramName, macroName)
		}
		path, okPath := extractPlainString(m["path"])
		tmplKey := "componentId"
		if _, hasCID := m["componentId"]; !hasCID {
			tmplKey = "template"
		}
		tmplID, okTmpl := extractPlainString(m[tmplKey])
		if !okPath || !okTmpl || path == "" || tmplID == "" || len(m) != 2 {
			return reflect.Value{}, fmt.Errorf("invalid DynamicChildList map on parameter %q of macro %q", paramName, macroName)
		}
		ref := builder.NewComponentRef(tmplID)
		if useV1_0 || target == v1ChildListType || target == v1DCLType {
			return reflect.ValueOf(v1.NewDynamicChildList(path, ref)), nil
		}
		return reflect.ValueOf(v09.NewDynamicChildList(path, ref)), nil
	}

	rv := reflect.ValueOf(raw)
	if rv.Kind() != reflect.Slice && rv.Kind() != reflect.Array {
		return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects child ID list, got %T", paramName, macroName, raw)
	}
	if target == v1DCLType || target == v09DCLType {
		return reflect.Value{}, fmt.Errorf("parameter %q of macro %q expects DynamicChildList map, got slice", paramName, macroName)
	}

	nodes := make([]builder.Node, 0, rv.Len())
	for i := range rv.Len() {
		elem := rv.Index(i).Interface()
		if s, ok := extractPlainString(elem); ok {
			if s == "" {
				return reflect.Value{}, fmt.Errorf("parameter %q[%d] of macro %q component ID must not be empty", paramName, i, macroName)
			}
			nodes = append(nodes, builder.NewComponentRef(s))
		} else if n, ok := elem.(builder.Node); ok {
			if builder.IsNilValue(n) {
				return reflect.Value{}, fmt.Errorf("parameter %q[%d] of macro %q child node must not be nil", paramName, i, macroName)
			}
			nodes = append(nodes, n)
		} else {
			return reflect.Value{}, fmt.Errorf("parameter %q[%d] of macro %q expects component ID string, got %T", paramName, i, macroName, elem)
		}
	}

	switch target {
	case v1ChildListType, v1StaticCLType:
		return reflect.ValueOf(v1.Children(nodes...)), nil
	case v09ChildListType, v09StaticCLType:
		return reflect.ValueOf(v09.Children(nodes...)), nil
	default:
		sliceOut := reflect.MakeSlice(target, len(nodes), len(nodes))
		elemType := target.Elem()
		for i, n := range nodes {
			if elemType == compRefPtrType {
				ref, ok := n.(*builder.ComponentRef)
				if !ok {
					return reflect.Value{}, fmt.Errorf("parameter %q[%d] of macro %q expects component ID reference (*builder.ComponentRef), got %T", paramName, i, macroName, n)
				}
				sliceOut.Index(i).Set(reflect.ValueOf(ref))
			} else {
				sliceOut.Index(i).Set(reflect.ValueOf(n))
			}
		}
		return sliceOut, nil
	}
}

const (
	maxInt64PlusOneFloat  = 9223372036854775808.0  // 2^63
	minInt64Float         = -9223372036854775808.0 // -2^63
	maxUint64PlusOneFloat = 18446744073709551616.0 // 2^64
)

func extractExactInt64(raw any) (int64, bool) {
	rv := reflect.ValueOf(raw)
	if !rv.IsValid() {
		return 0, false
	}
	switch rv.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return rv.Int(), true
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		uv := rv.Uint()
		if uv > math.MaxInt64 {
			return 0, false
		}
		return int64(uv), true
	default:
		return 0, false
	}
}

func extractStrictInt(raw any) (int64, bool) {
	if iv, ok := extractExactInt64(raw); ok {
		return iv, true
	}
	rv := reflect.ValueOf(raw)
	if !rv.IsValid() {
		return 0, false
	}
	switch rv.Kind() {
	case reflect.Float32, reflect.Float64:
		fv := rv.Float()
		if !math.IsNaN(fv) && !math.IsInf(fv, 0) && math.Trunc(fv) == fv && fv >= minInt64Float && fv < maxInt64PlusOneFloat {
			return int64(fv), true
		}
		return 0, false
	default:
		return 0, false
	}
}

func extractStrictUint(raw any) (uint64, bool) {
	rv := reflect.ValueOf(raw)
	if !rv.IsValid() {
		return 0, false
	}
	switch rv.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		iv := rv.Int()
		if iv < 0 {
			return 0, false
		}
		return uint64(iv), true
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return rv.Uint(), true
	case reflect.Float32, reflect.Float64:
		fv := rv.Float()
		if !math.IsNaN(fv) && !math.IsInf(fv, 0) && math.Trunc(fv) == fv && fv >= 0 && fv < maxUint64PlusOneFloat {
			return uint64(fv), true
		}
		return 0, false
	default:
		return 0, false
	}
}

func extractStrictFloat(raw any) (float64, bool) {
	rv := reflect.ValueOf(raw)
	if !rv.IsValid() {
		return 0, false
	}
	switch rv.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return float64(rv.Int()), true
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return float64(rv.Uint()), true
	case reflect.Float32, reflect.Float64:
		fv := rv.Float()
		return fv, !math.IsNaN(fv) && !math.IsInf(fv, 0)
	default:
		return 0, false
	}
}

// --- v1.0 wire coercions ---

func isV1BindingMap(m map[string]any) (string, bool) {
	if len(m) != 1 {
		return "", false
	}
	p, ok := extractPlainString(m["@path"])
	return p, ok
}

func coerceV1DataBinding(raw any, paramName, macroName string) (v1.DataBinding, error) {
	if db, ok := raw.(v1.DataBinding); ok {
		return db, nil
	}
	m, ok := toStringAnyMap(raw)
	if !ok {
		return v1.DataBinding{}, fmt.Errorf("parameter %q of macro %q expects v1.0 DataBinding, got %T", paramName, macroName, raw)
	}
	p, ok := isV1BindingMap(m)
	if !ok {
		return v1.DataBinding{}, fmt.Errorf("invalid v1.0 DataBinding on %q of macro %q", paramName, macroName)
	}
	return v1.Bind(p), nil
}

func coerceV1FunctionCall(raw any, paramName, macroName string) (v1.FunctionCall, error) {
	if fc, ok := raw.(v1.FunctionCall); ok {
		return fc, nil
	}
	m, ok := toStringAnyMap(raw)
	if !ok {
		return v1.FunctionCall{}, fmt.Errorf("parameter %q of macro %q expects v1.0 FunctionCall, got %T", paramName, macroName, raw)
	}
	callName, ok := extractPlainString(m["@call"])
	if !ok || callName == "" {
		return v1.FunctionCall{}, fmt.Errorf("invalid v1.0 FunctionCall '@call' on %q of macro %q", paramName, macroName)
	}
	for k := range m {
		if k != "@call" && k != "args" && k != "catalogId" {
			return v1.FunctionCall{}, fmt.Errorf("unknown key %q on v1.0 FunctionCall in %q of macro %q", k, paramName, macroName)
		}
	}
	var args map[string]any
	if rawArgs, hasArgs := m["args"]; hasArgs && rawArgs != nil {
		argsMap, ok := toStringAnyMap(rawArgs)
		if !ok {
			return v1.FunctionCall{}, fmt.Errorf("FunctionCall args must be map in %q of macro %q", paramName, macroName)
		}
		args = make(map[string]any, len(argsMap))
		for k, v := range argsMap {
			if v == nil {
				args[k] = nil
				continue
			}
			dv, err := coerceV1DynamicValue(v, paramName+".args."+k, macroName)
			if err != nil {
				return v1.FunctionCall{}, err
			}
			args[k] = dv
		}
	}
	fc := v1.NewFunctionCall(callName, args)
	if cid, ok := extractPlainString(m["catalogId"]); ok && cid != "" {
		fc = fc.WithCatalogID(cid)
	}
	return fc, nil
}

func coerceV1DynamicString(raw any, paramName, macroName string) (v1.DynamicString, error) {
	if ds, ok := raw.(v1.DynamicString); ok && !builder.IsNilValue(ds) {
		return ds, nil
	}
	if s, ok := extractPlainString(raw); ok {
		return v1.Str(s), nil
	}
	if m, ok := toStringAnyMap(raw); ok {
		if p, ok := isV1BindingMap(m); ok {
			return v1.Bind(p), nil
		}
		if _, hasCall := m["@call"]; hasCall {
			return coerceV1FunctionCall(m, paramName, macroName)
		}
	}
	return nil, fmt.Errorf("parameter %q of macro %q expects v1.0 DynamicString, got %T", paramName, macroName, raw)
}

func coerceV1DynamicNumber(raw any, paramName, macroName string) (v1.DynamicNumber, error) {
	if dn, ok := raw.(v1.DynamicNumber); ok && !builder.IsNilValue(dn) {
		return dn, nil
	}
	if iv, ok := extractExactInt64(raw); ok {
		return v1.Int64(iv), nil
	}
	if fv, ok := extractStrictFloat(raw); ok {
		return v1.Num(fv), nil
	}
	if m, ok := toStringAnyMap(raw); ok {
		if p, ok := isV1BindingMap(m); ok {
			return v1.Bind(p), nil
		}
		if _, hasCall := m["@call"]; hasCall {
			return coerceV1FunctionCall(m, paramName, macroName)
		}
	}
	return nil, fmt.Errorf("parameter %q of macro %q expects v1.0 DynamicNumber, got %T", paramName, macroName, raw)
}

func coerceV1DynamicBoolean(raw any, paramName, macroName string) (v1.DynamicBoolean, error) {
	if db, ok := raw.(v1.DynamicBoolean); ok && !builder.IsNilValue(db) {
		return db, nil
	}
	if b, ok := extractPlainBool(raw); ok {
		return v1.Bool(b), nil
	}
	if m, ok := toStringAnyMap(raw); ok {
		if p, ok := isV1BindingMap(m); ok {
			return v1.Bind(p), nil
		}
		if _, hasCall := m["@call"]; hasCall {
			return coerceV1FunctionCall(m, paramName, macroName)
		}
	}
	return nil, fmt.Errorf("parameter %q of macro %q expects v1.0 DynamicBoolean, got %T", paramName, macroName, raw)
}

func coerceV1DynamicStringList(raw any, paramName, macroName string) (v1.DynamicStringList, error) {
	if dl, ok := raw.(v1.DynamicStringList); ok && !builder.IsNilValue(dl) {
		return dl, nil
	}
	if m, ok := toStringAnyMap(raw); ok {
		if p, ok := isV1BindingMap(m); ok {
			return v1.Bind(p), nil
		}
		if _, hasCall := m["@call"]; hasCall {
			return coerceV1FunctionCall(m, paramName, macroName)
		}
		return nil, fmt.Errorf("invalid v1.0 DynamicStringList object on %q of macro %q", paramName, macroName)
	}
	rv := reflect.ValueOf(raw)
	if rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array {
		strs := make([]string, 0, rv.Len())
		for i := range rv.Len() {
			s, ok := extractPlainString(rv.Index(i).Interface())
			if !ok {
				return nil, fmt.Errorf("parameter %q[%d] of macro %q expects string, got %T", paramName, i, macroName, rv.Index(i).Interface())
			}
			strs = append(strs, s)
		}
		return v1.Strs(strs...), nil
	}
	return nil, fmt.Errorf("parameter %q of macro %q expects v1.0 DynamicStringList, got %T", paramName, macroName, raw)
}

func coerceV1DynamicValue(raw any, paramName, macroName string) (v1.DynamicValue, error) {
	if dv, ok := raw.(v1.DynamicValue); ok && !builder.IsNilValue(dv) {
		return dv, nil
	}
	if s, ok := extractPlainString(raw); ok {
		return v1.Str(s), nil
	}
	if b, ok := extractPlainBool(raw); ok {
		return v1.Bool(b), nil
	}
	if iv, ok := extractExactInt64(raw); ok {
		return v1.Int64(iv), nil
	}
	if fv, ok := extractStrictFloat(raw); ok {
		return v1.Num(fv), nil
	}
	if m, ok := toStringAnyMap(raw); ok {
		if p, ok := isV1BindingMap(m); ok {
			return v1.Bind(p), nil
		}
		if _, hasCall := m["@call"]; hasCall {
			return coerceV1FunctionCall(m, paramName, macroName)
		}
		// Plain objects without "@path"/"@call"/"@*" keys remain LiteralObject values in v1.0!
		if err := v1.ObjectLiteral(m).Validate(); err != nil {
			return nil, err
		}
		obj := make(map[string]any, len(m))
		for k, v := range m {
			if v == nil {
				obj[k] = nil
				continue
			}
			sub, err := coerceV1DynamicValue(v, paramName+"."+k, macroName)
			if err != nil {
				return nil, err
			}
			obj[k] = sub
		}
		return v1.Obj(obj), nil
	}
	rv := reflect.ValueOf(raw)
	if rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array {
		items := make([]any, 0, rv.Len())
		for i := range rv.Len() {
			elem := rv.Index(i).Interface()
			if elem == nil {
				items = append(items, nil)
				continue
			}
			sub, err := coerceV1DynamicValue(elem, fmt.Sprintf("%s[%d]", paramName, i), macroName)
			if err != nil {
				return nil, err
			}
			items = append(items, sub)
		}
		return v1.Arr(items...), nil
	}
	return nil, fmt.Errorf("parameter %q of macro %q expects v1.0 DynamicValue, got %T", paramName, macroName, raw)
}

func coerceV1CheckCondition(raw any, paramName, macroName string) (v1.CheckCondition, error) {
	if cc, ok := raw.(v1.CheckCondition); ok && !builder.IsNilValue(cc) {
		return cc, nil
	}
	m, ok := toStringAnyMap(raw)
	if !ok {
		return nil, fmt.Errorf("v1.0 CheckRule condition on %q of macro %q must be DataBinding or FunctionCall", paramName, macroName)
	}
	if p, ok := isV1BindingMap(m); ok {
		return v1.Bind(p), nil
	}
	return coerceV1FunctionCall(m, paramName, macroName)
}

func coerceV1IconName(raw any, paramName, macroName string) (v1.IconNameValue, error) {
	if iv, ok := raw.(v1.IconNameValue); ok && !builder.IsNilValue(iv) {
		if in, isEnum := iv.(v1.IconName); isEnum && !slices.Contains(in.EnumValues(), string(in)) {
			return nil, fmt.Errorf("invalid IconName %q on %q of macro %q", in, paramName, macroName)
		}
		return iv, nil
	}
	if s, ok := extractPlainString(raw); ok {
		icon := v1.IconName(s)
		if !slices.Contains(icon.EnumValues(), s) {
			return nil, fmt.Errorf("invalid IconName %q on %q of macro %q", s, paramName, macroName)
		}
		return icon, nil
	}
	if m, ok := toStringAnyMap(raw); ok {
		if p, ok := isV1BindingMap(m); ok {
			return v1.Bind(p), nil
		}
		if _, hasCall := m["@call"]; hasCall {
			return coerceV1FunctionCall(m, paramName, macroName)
		}
		if svgRaw, hasSVG := m["svgPath"]; hasSVG && len(m) == 1 {
			ds, err := coerceV1DynamicString(svgRaw, paramName+".svgPath", macroName)
			if err != nil {
				return nil, err
			}
			return v1.NewIconNameSVGPath(ds), nil
		}
	}
	return nil, fmt.Errorf("invalid v1.0 IconNameValue on %q of macro %q", paramName, macroName)
}

func coerceV1ActionEventMap(raw any, paramName, macroName string) (v1.ActionEvent, error) {
	if ev, ok := raw.(v1.ActionEvent); ok {
		if ev.Name == "" {
			return v1.ActionEvent{}, fmt.Errorf("v1.0 ActionEvent requires non-empty name on %q of macro %q", paramName, macroName)
		}
		return ev, nil
	}
	if evPtr, ok := raw.(*v1.ActionEvent); ok && evPtr != nil {
		return coerceV1ActionEventMap(*evPtr, paramName, macroName)
	}
	m, ok := toStringAnyMap(raw)
	if !ok {
		return v1.ActionEvent{}, fmt.Errorf("ActionEvent on %q of macro %q must be object", paramName, macroName)
	}
	for k := range m {
		if k != "name" && k != "userMessage" && k != "user_message" && k != "context" {
			return v1.ActionEvent{}, fmt.Errorf("unknown field %q on v1.0 ActionEvent in %q of macro %q", k, paramName, macroName)
		}
	}
	name, ok := extractPlainString(m["name"])
	if !ok || name == "" {
		return v1.ActionEvent{}, fmt.Errorf("v1.0 ActionEvent requires non-empty name on %q of macro %q", paramName, macroName)
	}
	ev := v1.ActionEvent{Name: name}
	umRaw, hasUM := m["userMessage"]
	if !hasUM {
		umRaw, hasUM = m["user_message"]
	}
	if hasUM && umRaw != nil {
		um, err := coerceV1DynamicString(umRaw, paramName+".userMessage", macroName)
		if err != nil {
			return v1.ActionEvent{}, err
		}
		ev.UserMessage = um
	}
	if ctxRaw, hasCtx := m["context"]; hasCtx && ctxRaw != nil {
		ctxMap, ok := toStringAnyMap(ctxRaw)
		if !ok {
			return v1.ActionEvent{}, fmt.Errorf("ActionEvent.context must be map on %q of macro %q", paramName, macroName)
		}
		ev.Context = make(map[string]v1.DynamicValue, len(ctxMap))
		for k, v := range ctxMap {
			dv, err := coerceV1DynamicValue(v, paramName+".context."+k, macroName)
			if err != nil {
				return v1.ActionEvent{}, err
			}
			ev.Context[k] = dv
		}
	}
	return ev, nil
}

func coerceV1Action(raw any, paramName, macroName string) (v1.Action, error) {
	if act, ok := raw.(v1.Action); ok {
		return act, act.Validate()
	}
	if actPtr, ok := raw.(*v1.Action); ok && actPtr != nil {
		return *actPtr, actPtr.Validate()
	}
	if s, ok := extractPlainString(raw); ok {
		if s == "" {
			return v1.Action{}, fmt.Errorf("v1.0 Action event name must not be empty on %q of macro %q", paramName, macroName)
		}
		return v1.EventAction(s, nil), nil
	}
	m, ok := toStringAnyMap(raw)
	if !ok {
		return v1.Action{}, fmt.Errorf("parameter %q of macro %q expects Action string or object, got %T", paramName, macroName, raw)
	}
	_, hasEv := m["event"]
	fcRaw, hasFC := m["functionCall"]
	if !hasFC {
		fcRaw, hasFC = m["function_call"]
	}

	if hasEv && !hasFC {
		if evName, isStr := extractPlainString(m["event"]); isStr {
			evPayload := make(map[string]any, len(m))
			for k, v := range m {
				if k != "event" {
					evPayload[k] = v
				}
			}
			evPayload["name"] = evName
			ev, err := coerceV1ActionEventMap(evPayload, paramName+".event", macroName)
			if err != nil {
				return v1.Action{}, err
			}
			return v1.Action{Event: &ev}, nil
		}
	}
	if !hasEv && !hasFC {
		if _, hasCall := m["@call"]; hasCall {
			fc, err := coerceV1FunctionCall(m, paramName, macroName)
			if err != nil {
				return v1.Action{}, err
			}
			return v1.FunctionAction(fc), nil
		}
		ev, err := coerceV1ActionEventMap(m, paramName, macroName)
		if err != nil {
			return v1.Action{}, err
		}
		return v1.Action{Event: &ev}, nil
	}

	for k := range m {
		if k != "event" && k != "functionCall" && k != "function_call" {
			return v1.Action{}, fmt.Errorf("unknown field %q on v1.0 Action in %q of macro %q", k, paramName, macroName)
		}
	}
	if hasEv == hasFC {
		return v1.Action{}, core.NewValidationError("Action requires exactly one of 'event' or 'functionCall'")
	}
	if hasEv {
		ev, err := coerceV1ActionEventMap(m["event"], paramName+".event", macroName)
		if err != nil {
			return v1.Action{}, err
		}
		return v1.Action{Event: &ev}, nil
	}
	fc, err := coerceV1FunctionCall(fcRaw, paramName+".functionCall", macroName)
	if err != nil {
		return v1.Action{}, err
	}
	return v1.FunctionAction(fc), nil
}

func coerceV1CheckRule(raw any, paramName, macroName string) (v1.CheckRule, error) {
	if cr, ok := raw.(v1.CheckRule); ok {
		if builder.IsNilValue(cr.Condition) {
			return v1.CheckRule{}, fmt.Errorf("CheckRule condition must not be nil on %q of macro %q", paramName, macroName)
		}
		return cr, nil
	}
	if crPtr, ok := raw.(*v1.CheckRule); ok && crPtr != nil {
		return coerceV1CheckRule(*crPtr, paramName, macroName)
	}
	m, ok := toStringAnyMap(raw)
	if !ok {
		return v1.CheckRule{}, fmt.Errorf("CheckRule on %q of macro %q must be object", paramName, macroName)
	}
	for k := range m {
		if k != "condition" && k != "message" {
			return v1.CheckRule{}, fmt.Errorf("unknown field %q on v1.0 CheckRule in %q of macro %q", k, paramName, macroName)
		}
	}
	cond, err := coerceV1CheckCondition(m["condition"], paramName+".condition", macroName)
	if err != nil {
		return v1.CheckRule{}, err
	}
	var msg string
	if msgRaw, hasMsg := m["message"]; hasMsg && msgRaw != nil {
		s, ok := extractPlainString(msgRaw)
		if !ok {
			return v1.CheckRule{}, fmt.Errorf("CheckRule.message must be string on %q of macro %q", paramName, macroName)
		}
		msg = s
	}
	return v1.NewCheckRule(cond, msg), nil
}

func coerceV1A11y(raw any, paramName, macroName string) (v1.AccessibilityAttributes, error) {
	if a, ok := raw.(v1.AccessibilityAttributes); ok {
		return a, nil
	}
	if aPtr, ok := raw.(*v1.AccessibilityAttributes); ok && aPtr != nil {
		return *aPtr, nil
	}
	m, ok := toStringAnyMap(raw)
	if !ok {
		return v1.AccessibilityAttributes{}, fmt.Errorf("AccessibilityAttributes on %q of macro %q must be object", paramName, macroName)
	}
	for k := range m {
		if k != "label" && k != "description" && k != "live" && k != "hidden" {
			return v1.AccessibilityAttributes{}, fmt.Errorf("unknown field %q on v1.0 AccessibilityAttributes in %q of macro %q", k, paramName, macroName)
		}
	}
	var out v1.AccessibilityAttributes
	if v, has := m["label"]; has && v != nil {
		ds, err := coerceV1DynamicString(v, paramName+".label", macroName)
		if err != nil {
			return out, err
		}
		out.Label = ds
	}
	if v, has := m["description"]; has && v != nil {
		ds, err := coerceV1DynamicString(v, paramName+".description", macroName)
		if err != nil {
			return out, err
		}
		out.Description = ds
	}
	if v, has := m["live"]; has && v != nil {
		s, ok := extractPlainString(v)
		if !ok {
			return out, fmt.Errorf("AccessibilityAttributes.live must be string")
		}
		lv := v1.AccessibilityLive(s)
		if !slices.Contains(lv.EnumValues(), s) {
			return out, fmt.Errorf("invalid AccessibilityAttributes.live %q", s)
		}
		out.Live = lv
	}
	if v, has := m["hidden"]; has && v != nil {
		db, err := coerceV1DynamicBoolean(v, paramName+".hidden", macroName)
		if err != nil {
			return out, err
		}
		out.Hidden = db
	}
	return out, nil
}

// --- v0.9 wire coercions ---

func isV09BindingMap(m map[string]any) (string, bool) {
	if len(m) != 1 {
		return "", false
	}
	p, ok := extractPlainString(m["path"])
	return p, ok
}

func coerceV09DataBinding(raw any, paramName, macroName string) (v09.DataBinding, error) {
	if db, ok := raw.(v09.DataBinding); ok {
		return db, nil
	}
	m, ok := toStringAnyMap(raw)
	if !ok {
		return v09.DataBinding{}, fmt.Errorf("parameter %q of macro %q expects v0.9 DataBinding, got %T", paramName, macroName, raw)
	}
	p, ok := isV09BindingMap(m)
	if !ok {
		return v09.DataBinding{}, fmt.Errorf("invalid v0.9 DataBinding on %q of macro %q", paramName, macroName)
	}
	return v09.Bind(p), nil
}

func coerceV09FunctionCall(raw any, paramName, macroName string) (v09.FunctionCall, error) {
	if fc, ok := raw.(v09.FunctionCall); ok {
		return fc, nil
	}
	m, ok := toStringAnyMap(raw)
	if !ok {
		return v09.FunctionCall{}, fmt.Errorf("parameter %q of macro %q expects v0.9 FunctionCall, got %T", paramName, macroName, raw)
	}
	callName, ok := extractPlainString(m["call"])
	if !ok || callName == "" {
		return v09.FunctionCall{}, fmt.Errorf("invalid v0.9 FunctionCall 'call' on %q of macro %q", paramName, macroName)
	}
	for k := range m {
		if k != "call" && k != "args" && k != "returnType" && k != "return_type" {
			return v09.FunctionCall{}, fmt.Errorf("unknown key %q on v0.9 FunctionCall in %q of macro %q", k, paramName, macroName)
		}
	}
	var args map[string]any
	if rawArgs, hasArgs := m["args"]; hasArgs && rawArgs != nil {
		argsMap, ok := toStringAnyMap(rawArgs)
		if !ok {
			return v09.FunctionCall{}, fmt.Errorf("FunctionCall args must be map in %q of macro %q", paramName, macroName)
		}
		args = make(map[string]any, len(argsMap))
		for k, v := range argsMap {
			if v == nil {
				args[k] = nil
				continue
			}
			if subMap, isMap := toStringAnyMap(v); isMap {
				if p, ok := isV09BindingMap(subMap); ok {
					args[k] = v09.Bind(p)
					continue
				}
				if _, hasCall := subMap["call"]; hasCall {
					subFC, err := coerceV09FunctionCall(subMap, paramName+".args."+k, macroName)
					if err != nil {
						return v09.FunctionCall{}, err
					}
					args[k] = subFC
					continue
				}
				args[k] = core.CloneJSONValue(subMap)
				continue
			}
			dv, err := coerceV09DynamicValue(v, paramName+".args."+k, macroName)
			if err != nil {
				return v09.FunctionCall{}, err
			}
			args[k] = dv
		}
	}
	fc := v09.NewFunctionCall(callName, args)
	if rt, ok := extractPlainString(m["returnType"]); ok && rt != "" {
		fc = fc.WithReturnType(rt)
	} else if rt, ok := extractPlainString(m["return_type"]); ok && rt != "" {
		fc = fc.WithReturnType(rt)
	}
	return fc, nil
}

func coerceV09DynamicString(raw any, paramName, macroName string) (v09.DynamicString, error) {
	if ds, ok := raw.(v09.DynamicString); ok && !builder.IsNilValue(ds) {
		return ds, nil
	}
	if s, ok := extractPlainString(raw); ok {
		return v09.Str(s), nil
	}
	if m, ok := toStringAnyMap(raw); ok {
		if p, ok := isV09BindingMap(m); ok {
			return v09.Bind(p), nil
		}
		if _, hasCall := m["call"]; hasCall {
			return coerceV09FunctionCall(m, paramName, macroName)
		}
	}
	return nil, fmt.Errorf("parameter %q of macro %q expects v0.9 DynamicString, got %T", paramName, macroName, raw)
}

func coerceV09DynamicNumber(raw any, paramName, macroName string) (v09.DynamicNumber, error) {
	if dn, ok := raw.(v09.DynamicNumber); ok && !builder.IsNilValue(dn) {
		return dn, nil
	}
	if iv, ok := extractExactInt64(raw); ok {
		return v09.Int64(iv), nil
	}
	if fv, ok := extractStrictFloat(raw); ok {
		return v09.Num(fv), nil
	}
	if m, ok := toStringAnyMap(raw); ok {
		if p, ok := isV09BindingMap(m); ok {
			return v09.Bind(p), nil
		}
		if _, hasCall := m["call"]; hasCall {
			return coerceV09FunctionCall(m, paramName, macroName)
		}
	}
	return nil, fmt.Errorf("parameter %q of macro %q expects v0.9 DynamicNumber, got %T", paramName, macroName, raw)
}

func coerceV09DynamicBoolean(raw any, paramName, macroName string) (v09.DynamicBoolean, error) {
	if db, ok := raw.(v09.DynamicBoolean); ok && !builder.IsNilValue(db) {
		return db, nil
	}
	if b, ok := extractPlainBool(raw); ok {
		return v09.Bool(b), nil
	}
	if m, ok := toStringAnyMap(raw); ok {
		if p, ok := isV09BindingMap(m); ok {
			return v09.Bind(p), nil
		}
		if _, hasCall := m["call"]; hasCall {
			return coerceV09FunctionCall(m, paramName, macroName)
		}
	}
	return nil, fmt.Errorf("parameter %q of macro %q expects v0.9 DynamicBoolean, got %T", paramName, macroName, raw)
}

func coerceV09DynamicStringList(raw any, paramName, macroName string) (v09.DynamicStringList, error) {
	if dl, ok := raw.(v09.DynamicStringList); ok && !builder.IsNilValue(dl) {
		return dl, nil
	}
	if m, ok := toStringAnyMap(raw); ok {
		if p, ok := isV09BindingMap(m); ok {
			return v09.Bind(p), nil
		}
		if _, hasCall := m["call"]; hasCall {
			return coerceV09FunctionCall(m, paramName, macroName)
		}
		return nil, fmt.Errorf("invalid v0.9 DynamicStringList object on %q of macro %q", paramName, macroName)
	}
	rv := reflect.ValueOf(raw)
	if rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array {
		strs := make([]string, 0, rv.Len())
		for i := range rv.Len() {
			s, ok := extractPlainString(rv.Index(i).Interface())
			if !ok {
				return nil, fmt.Errorf("parameter %q[%d] of macro %q expects string, got %T", paramName, i, macroName, rv.Index(i).Interface())
			}
			strs = append(strs, s)
		}
		return v09.Strs(strs...), nil
	}
	return nil, fmt.Errorf("parameter %q of macro %q expects v0.9 DynamicStringList, got %T", paramName, macroName, raw)
}

func coerceV09DynamicValue(raw any, paramName, macroName string) (v09.DynamicValue, error) {
	if dv, ok := raw.(v09.DynamicValue); ok && !builder.IsNilValue(dv) {
		return dv, nil
	}
	if s, ok := extractPlainString(raw); ok {
		return v09.Str(s), nil
	}
	if b, ok := extractPlainBool(raw); ok {
		return v09.Bool(b), nil
	}
	if iv, ok := extractExactInt64(raw); ok {
		return v09.Int64(iv), nil
	}
	if fv, ok := extractStrictFloat(raw); ok {
		return v09.Num(fv), nil
	}
	if m, ok := toStringAnyMap(raw); ok {
		if p, ok := isV09BindingMap(m); ok {
			return v09.Bind(p), nil
		}
		if _, hasCall := m["call"]; hasCall {
			return coerceV09FunctionCall(m, paramName, macroName)
		}
		return nil, fmt.Errorf("v0.9 DynamicValue does not admit arbitrary object on %q of macro %q", paramName, macroName)
	}
	rv := reflect.ValueOf(raw)
	if rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array {
		items := make([]any, 0, rv.Len())
		for i := range rv.Len() {
			elem := rv.Index(i).Interface()
			if elem == nil {
				items = append(items, nil)
				continue
			}
			sub, err := coerceV09DynamicValue(elem, fmt.Sprintf("%s[%d]", paramName, i), macroName)
			if err != nil {
				return nil, err
			}
			items = append(items, sub)
		}
		return v09.Arr(items...), nil
	}
	return nil, fmt.Errorf("parameter %q of macro %q expects v0.9 DynamicValue, got %T", paramName, macroName, raw)
}

func coerceV09IconName(raw any, paramName, macroName string) (v09.IconNameValue, error) {
	if iv, ok := raw.(v09.IconNameValue); ok && !builder.IsNilValue(iv) {
		if in, isEnum := iv.(v09.IconName); isEnum && !slices.Contains(in.EnumValues(), string(in)) {
			return nil, fmt.Errorf("invalid IconName %q on %q of macro %q", in, paramName, macroName)
		}
		return iv, nil
	}
	if s, ok := extractPlainString(raw); ok {
		icon := v09.IconName(s)
		if !slices.Contains(icon.EnumValues(), s) {
			return nil, fmt.Errorf("invalid IconName %q on %q of macro %q", s, paramName, macroName)
		}
		return icon, nil
	}
	if m, ok := toStringAnyMap(raw); ok {
		if p, ok := isV09BindingMap(m); ok {
			return v09.Bind(p), nil
		}
		if _, hasCall := m["call"]; hasCall {
			return coerceV09FunctionCall(m, paramName, macroName)
		}
		if svg, ok := extractPlainString(m["svgPath"]); ok && len(m) == 1 {
			return v09.NewIconNameSVGPath(svg), nil
		}
	}
	return nil, fmt.Errorf("invalid v0.9 IconNameValue on %q of macro %q", paramName, macroName)
}

func coerceV09ActionEventMap(raw any, paramName, macroName string) (v09.ActionEvent, error) {
	if ev, ok := raw.(v09.ActionEvent); ok {
		if ev.Name == "" {
			return v09.ActionEvent{}, fmt.Errorf("v0.9 ActionEvent requires non-empty name on %q of macro %q", paramName, macroName)
		}
		return ev, nil
	}
	if evPtr, ok := raw.(*v09.ActionEvent); ok && evPtr != nil {
		return coerceV09ActionEventMap(*evPtr, paramName, macroName)
	}
	m, ok := toStringAnyMap(raw)
	if !ok {
		return v09.ActionEvent{}, fmt.Errorf("ActionEvent on %q of macro %q must be object", paramName, macroName)
	}
	for k := range m {
		if k != "name" && k != "context" {
			return v09.ActionEvent{}, fmt.Errorf("unknown field %q on v0.9 ActionEvent in %q of macro %q", k, paramName, macroName)
		}
	}
	name, ok := extractPlainString(m["name"])
	if !ok || name == "" {
		return v09.ActionEvent{}, fmt.Errorf("v0.9 ActionEvent requires non-empty name on %q of macro %q", paramName, macroName)
	}
	ev := v09.ActionEvent{Name: name}
	if ctxRaw, hasCtx := m["context"]; hasCtx && ctxRaw != nil {
		ctxMap, ok := toStringAnyMap(ctxRaw)
		if !ok {
			return v09.ActionEvent{}, fmt.Errorf("ActionEvent.context must be map on %q of macro %q", paramName, macroName)
		}
		ev.Context = make(map[string]v09.DynamicValue, len(ctxMap))
		for k, v := range ctxMap {
			dv, err := coerceV09DynamicValue(v, paramName+".context."+k, macroName)
			if err != nil {
				return v09.ActionEvent{}, err
			}
			ev.Context[k] = dv
		}
	}
	return ev, nil
}

func coerceV09Action(raw any, paramName, macroName string) (v09.Action, error) {
	if act, ok := raw.(v09.Action); ok {
		return act, act.Validate()
	}
	if actPtr, ok := raw.(*v09.Action); ok && actPtr != nil {
		return *actPtr, actPtr.Validate()
	}
	if s, ok := extractPlainString(raw); ok {
		if s == "" {
			return v09.Action{}, fmt.Errorf("v0.9 Action event name must not be empty on %q of macro %q", paramName, macroName)
		}
		return v09.EventAction(s, nil), nil
	}
	m, ok := toStringAnyMap(raw)
	if !ok {
		return v09.Action{}, fmt.Errorf("parameter %q of macro %q expects Action string or object, got %T", paramName, macroName, raw)
	}
	_, hasEv := m["event"]
	fcRaw, hasFC := m["functionCall"]
	if !hasFC {
		fcRaw, hasFC = m["function_call"]
	}

	if hasEv && !hasFC {
		if evName, isStr := extractPlainString(m["event"]); isStr {
			evPayload := make(map[string]any, len(m))
			for k, v := range m {
				if k != "event" {
					evPayload[k] = v
				}
			}
			evPayload["name"] = evName
			ev, err := coerceV09ActionEventMap(evPayload, paramName+".event", macroName)
			if err != nil {
				return v09.Action{}, err
			}
			return v09.Action{Event: &ev}, nil
		}
	}
	if !hasEv && !hasFC {
		if _, hasCall := m["call"]; hasCall {
			fc, err := coerceV09FunctionCall(m, paramName, macroName)
			if err != nil {
				return v09.Action{}, err
			}
			return v09.FunctionAction(fc), nil
		}
		ev, err := coerceV09ActionEventMap(m, paramName, macroName)
		if err != nil {
			return v09.Action{}, err
		}
		return v09.Action{Event: &ev}, nil
	}

	for k := range m {
		if k != "event" && k != "functionCall" && k != "function_call" {
			return v09.Action{}, fmt.Errorf("unknown field %q on v0.9 Action in %q of macro %q", k, paramName, macroName)
		}
	}
	if hasEv == hasFC {
		return v09.Action{}, core.NewValidationError("Action requires exactly one of 'event' or 'functionCall'")
	}
	if hasEv {
		ev, err := coerceV09ActionEventMap(m["event"], paramName+".event", macroName)
		if err != nil {
			return v09.Action{}, err
		}
		return v09.Action{Event: &ev}, nil
	}
	fc, err := coerceV09FunctionCall(fcRaw, paramName+".functionCall", macroName)
	if err != nil {
		return v09.Action{}, err
	}
	return v09.FunctionAction(fc), nil
}

func coerceV09CheckRule(raw any, paramName, macroName string) (v09.CheckRule, error) {
	if cr, ok := raw.(v09.CheckRule); ok {
		if builder.IsNilValue(cr.Condition) || cr.Message == "" {
			return v09.CheckRule{}, fmt.Errorf("v0.9 CheckRule requires condition and non-empty message on %q of macro %q", paramName, macroName)
		}
		return cr, nil
	}
	if crPtr, ok := raw.(*v09.CheckRule); ok && crPtr != nil {
		return coerceV09CheckRule(*crPtr, paramName, macroName)
	}
	m, ok := toStringAnyMap(raw)
	if !ok {
		return v09.CheckRule{}, fmt.Errorf("CheckRule on %q of macro %q must be object", paramName, macroName)
	}
	for k := range m {
		if k != "condition" && k != "message" {
			return v09.CheckRule{}, fmt.Errorf("unknown field %q on v0.9 CheckRule in %q of macro %q", k, paramName, macroName)
		}
	}
	cond, err := coerceV09DynamicBoolean(m["condition"], paramName+".condition", macroName)
	if err != nil {
		return v09.CheckRule{}, err
	}
	msg, ok := extractPlainString(m["message"])
	if !ok || msg == "" {
		return v09.CheckRule{}, fmt.Errorf("v0.9 CheckRule requires non-empty message on %q of macro %q", paramName, macroName)
	}
	return v09.NewCheckRule(cond, msg), nil
}

func coerceV09A11y(raw any, paramName, macroName string) (v09.AccessibilityAttributes, error) {
	if a, ok := raw.(v09.AccessibilityAttributes); ok {
		return a, nil
	}
	if aPtr, ok := raw.(*v09.AccessibilityAttributes); ok && aPtr != nil {
		return *aPtr, nil
	}
	m, ok := toStringAnyMap(raw)
	if !ok {
		return v09.AccessibilityAttributes{}, fmt.Errorf("AccessibilityAttributes on %q of macro %q must be object", paramName, macroName)
	}
	for k := range m {
		if k != "label" && k != "description" {
			return v09.AccessibilityAttributes{}, fmt.Errorf("unknown field %q on v0.9 AccessibilityAttributes in %q of macro %q", k, paramName, macroName)
		}
	}
	var out v09.AccessibilityAttributes
	if v, has := m["label"]; has && v != nil {
		ds, err := coerceV09DynamicString(v, paramName+".label", macroName)
		if err != nil {
			return out, err
		}
		out.Label = ds
	}
	if v, has := m["description"]; has && v != nil {
		ds, err := coerceV09DynamicString(v, paramName+".description", macroName)
		if err != nil {
			return out, err
		}
		out.Description = ds
	}
	return out, nil
}

func coerceAnyDynamic(raw any, useV1_0 bool) reflect.Value {
	if raw == nil {
		return reflect.Zero(anyIfaceType)
	}
	if m, ok := toStringAnyMap(raw); ok {
		if useV1_0 {
			if p, ok := isV1BindingMap(m); ok {
				return reflect.ValueOf(v1.Bind(p))
			}
			if _, hasCall := m["@call"]; hasCall {
				if fc, err := coerceV1FunctionCall(m, "any", "macro"); err == nil {
					return reflect.ValueOf(fc)
				}
			}
			if path, okP := extractPlainString(m["path"]); okP && len(m) == 2 {
				if cid, okC := extractPlainString(m["componentId"]); okC && path != "" && cid != "" {
					return reflect.ValueOf(v1.NewDynamicChildList(path, builder.NewComponentRef(cid)))
				}
			}
		} else {
			if p, ok := isV09BindingMap(m); ok {
				return reflect.ValueOf(v09.Bind(p))
			}
			if _, hasCall := m["call"]; hasCall {
				if fc, err := coerceV09FunctionCall(m, "any", "macro"); err == nil {
					return reflect.ValueOf(fc)
				}
			}
			if path, okP := extractPlainString(m["path"]); okP && len(m) == 2 {
				if tmpl, okT := extractPlainString(m["template"]); okT && path != "" && tmpl != "" {
					return reflect.ValueOf(v09.NewDynamicChildList(path, builder.NewComponentRef(tmpl)))
				}
			}
		}
	}
	return reflect.ValueOf(raw)
}

func collectReturnedNodeVersions(val any, out map[builder.VersionFamily]bool, seen map[uintptr]bool) {
	if val == nil {
		return
	}
	collectReturnedNodeVersionsValue(reflect.ValueOf(val), out, seen)
}

func collectReturnedNodeVersionsValue(rv reflect.Value, out map[builder.VersionFamily]bool, seen map[uintptr]bool) {
	if !rv.IsValid() {
		return
	}
	if rv.Kind() == reflect.Interface {
		if rv.IsNil() {
			return
		}
		collectReturnedNodeVersionsValue(rv.Elem(), out, seen)
		return
	}
	if (rv.Kind() == reflect.Pointer || rv.Kind() == reflect.Slice || rv.Kind() == reflect.Map) && rv.IsNil() {
		return
	}

	if rv.CanInterface() {
		val := rv.Interface()
		if node, ok := val.(builder.Node); ok {
			if _, isRef := builder.ComponentRefID(node); isRef {
				return
			}
			if fam := node.BuilderVersionFamily(); fam != builder.VersionFamilyUnspecified {
				out[fam] = true
			}
		} else if vm, ok := val.(builder.VersionedModel); ok {
			if fam := vm.BuilderVersionFamily(); fam != builder.VersionFamilyUnspecified {
				out[fam] = true
			}
		}
	} else {
		if rv.Type() == compRefPtrType || rv.Type() == compRefPtrType.Elem() {
			return
		}
		if fam := directTypeVersionFamily(rv.Type()); fam != builder.VersionFamilyUnspecified {
			out[fam] = true
		}
	}

	switch rv.Kind() {
	case reflect.Pointer:
		ptr := rv.Pointer()
		if seen[ptr] {
			return
		}
		seen[ptr] = true
		collectReturnedNodeVersionsValue(rv.Elem(), out, seen)
	case reflect.Struct:
		rt := rv.Type()
		for i := range rv.NumField() {
			sf := rt.Field(i)
			if sf.IsExported() || sf.Anonymous {
				collectReturnedNodeVersionsValue(rv.Field(i), out, seen)
			}
		}
	case reflect.Slice, reflect.Array:
		for i := range rv.Len() {
			collectReturnedNodeVersionsValue(rv.Index(i), out, seen)
		}
	case reflect.Map:
		iter := rv.MapRange()
		for iter.Next() {
			collectReturnedNodeVersionsValue(iter.Value(), out, seen)
		}
	}
}
