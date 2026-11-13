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

package builder

import (
	"encoding"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"slices"
	"strings"
	"sync"
	"unicode"

	"github.com/a2ui-project/a2ui/go/core"
)

// FlattenOptions customizes component tree flattening and validation behavior.
type FlattenOptions struct {
	// AllowOpenEnums relaxes strict enum checks so forward-compatible enum values pass validation.
	AllowOpenEnums bool
	// ReservedIDs pre-reserves component IDs so auto-allocated IDs skip them without altering explicit IDs.
	ReservedIDs map[string]bool
}

type visitKey struct {
	ptr uintptr
	typ reflect.Type
}

// FlattenContext carries state across the two-pass scan and post-order emit traversal.
type FlattenContext struct {
	prefix         string
	allowOpenEnums bool

	allocator    *IDAllocator
	reserved     map[string]bool
	components   []map[string]any
	assigned     map[uintptr]string
	emittedIDs   map[string]uintptr
	visitedScan  map[uintptr]bool
	activeStack  map[uintptr]bool
	activeValues map[visitKey]bool
}

// Prefix returns the scope prefix (the resolved root ID) used to namespace allocated component IDs.
func (c *FlattenContext) Prefix() string { return c.prefix }

// AllowOpenEnums reports whether strict enum validation is relaxed for forward-compatible values.
func (c *FlattenContext) AllowOpenEnums() bool { return c.allowOpenEnums }

// Scanning reports whether the context is executing Pass 1 (author ID reservation).
func (c *FlattenContext) Scanning() bool {
	return c.allocator == nil
}

// ValidateEnum checks value against enum's allowed literals unless AllowOpenEnums is enabled.
func (c *FlattenContext) ValidateEnum(field string, value string, enum StringEnum) error {
	if c != nil && c.allowOpenEnums {
		return nil
	}
	allowed := enum.EnumValues()
	if slices.Contains(allowed, value) {
		return nil
	}
	return core.NewValidationErrorf("invalid enum value %q for %s (allowed: %v)", value, field, allowed)
}

// IsNilValue reports whether v is an untyped nil or a typed nil pointer.
func IsNilValue(v any) bool {
	if v == nil {
		return true
	}
	rv := reflect.ValueOf(v)
	return rv.Kind() == reflect.Pointer && rv.IsNil()
}

// ValidateFiniteFloat returns a *core.ValidationError if v is NaN or infinite.
func ValidateFiniteFloat(field string, v float64) error {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return core.NewValidationErrorf("%s must be a finite number, got %v", field, v)
	}
	return nil
}

func nodePointerIdentity(node Node) (uintptr, bool) {
	if node == nil {
		return 0, false
	}
	rv := reflect.ValueOf(node)
	if rv.Kind() == reflect.Pointer {
		if rv.IsNil() {
			return 0, false
		}
		return rv.Pointer(), true
	}
	return 0, false
}

func isNilNode(node Node) bool {
	return IsNilValue(node)
}

var (
	nodeInterfaceType        = reflect.TypeFor[Node]()
	componentSerializerType  = reflect.TypeFor[ComponentSerializer]()
	envelopeCarrierType      = reflect.TypeFor[EnvelopeAttributeCarrier]()
	defaultCatalogIDProvType = reflect.TypeFor[DefaultCatalogIDProvider]()
	stringEnumInterfaceType  = reflect.TypeFor[StringEnum]()
	jsonMarshalerType        = reflect.TypeFor[json.Marshaler]()
	textMarshalerType        = reflect.TypeFor[encoding.TextMarshaler]()
)

func resolveComponentType(node Node) string {
	if isNilNode(node) {
		return ""
	}
	if ct := node.ComponentType(); ct != "" {
		return ct
	}
	rv := reflect.ValueOf(node)
	if rv.Kind() != reflect.Pointer && reflect.PointerTo(rv.Type()).Implements(nodeInterfaceType) {
		ptr := reflect.New(rv.Type())
		ptr.Elem().Set(rv)
		if ct := ptr.Interface().(Node).ComponentType(); ct != "" {
			return ct
		}
	}
	for rv.Kind() == reflect.Pointer {
		if rv.IsNil() {
			return ""
		}
		rv = rv.Elem()
	}
	if rv.Kind() == reflect.Struct {
		return rv.Type().Name()
	}
	return ""
}

func wrapBuilderValidationError(err error, prefix string) error {
	var valErr *core.ValidationError
	if errors.As(err, &valErr) {
		return err
	}
	var recErr *core.RecursionError
	if errors.As(err, &recErr) {
		return err
	}
	return core.NewValidationErrorf("%s: %v", prefix, err)
}

// EmitChild resolves a child Node to its wire component ID, recursively emitting its subtree
// during Pass 2 so children appear before parents in depth-first post-order.
func (c *FlattenContext) EmitChild(node Node) (string, error) {
	if isNilNode(node) {
		return "", core.NewValidationError("child component node must not be nil")
	}
	if refID, ok := ComponentRefID(node); ok {
		if refID == "" {
			return "", core.NewValidationError("ComponentRef id must not be empty")
		}
		if c != nil && c.Scanning() && c.reserved != nil {
			c.reserved[refID] = true
		}
		return refID, nil
	}

	ptr, hasPtr := nodePointerIdentity(node)
	if hasPtr {
		if c.activeStack[ptr] {
			return "", core.NewRecursionError(
				fmt.Sprintf("cyclic component reference detected on %s (id=%q)", resolveComponentType(node), node.ComponentID()),
			)
		}
	}

	if c.Scanning() {
		if hasPtr {
			if c.visitedScan[ptr] {
				return node.ComponentID(), nil
			}
			c.visitedScan[ptr] = true
			c.activeStack[ptr] = true
			defer delete(c.activeStack, ptr)
		}
		if explicitID := node.ComponentID(); explicitID != "" {
			namespaced := fmt.Sprintf("%s__%s", c.prefix, explicitID)
			if prevPtr, dup := c.emittedIDs[namespaced]; dup && (!hasPtr || prevPtr != ptr) {
				return "", core.NewValidationErrorf("duplicate explicit component ID %q in scope %q", explicitID, c.prefix)
			}
			c.emittedIDs[namespaced] = ptr
			c.reserved[explicitID] = true
			c.reserved[namespaced] = true
		}
		if _, err := c.dumpComponent(node, node.ComponentID()); err != nil {
			return "", err
		}
		return node.ComponentID(), nil
	}

	if hasPtr {
		if existing, ok := c.assigned[ptr]; ok {
			return existing, nil
		}
		c.activeStack[ptr] = true
		defer delete(c.activeStack, ptr)
	}

	compType := resolveComponentType(node)
	if compType == "" {
		return "", core.NewValidationError("component builder node has empty component type")
	}
	allocated := c.allocator.Allocate(compType, node.ComponentID())
	if prevPtr, dup := c.emittedIDs[allocated]; dup && (!hasPtr || prevPtr != ptr) {
		return "", core.NewValidationErrorf("duplicate component ID %q", allocated)
	}
	c.emittedIDs[allocated] = ptr
	if hasPtr {
		c.assigned[ptr] = allocated
	}

	payload, err := c.dumpComponent(node, allocated)
	if err != nil {
		return "", err
	}
	c.components = append(c.components, payload)
	return allocated, nil
}

// SerializeValue converts an arbitrary builder field or map/slice element into its wire JSON value,
// resolving any nested Node slots through EmitChild.
func (c *FlattenContext) SerializeValue(val any) (any, error) {
	if val == nil {
		return nil, nil
	}
	if c == nil {
		c = &FlattenContext{activeValues: make(map[visitKey]bool)}
	}
	rv := reflect.ValueOf(val)
	if rv.Kind() == reflect.Pointer && rv.IsNil() {
		return nil, nil
	}

	switch rv.Kind() {
	case reflect.Pointer:
		key := visitKey{ptr: rv.Pointer(), typ: rv.Type()}
		if c.activeValues[key] {
			return nil, core.NewRecursionError(fmt.Sprintf("cyclic pointer value of type %T", val))
		}
		if c.activeValues == nil {
			c.activeValues = make(map[visitKey]bool)
		}
		c.activeValues[key] = true
		defer delete(c.activeValues, key)
	case reflect.Slice, reflect.Map:
		if !rv.IsNil() && rv.Len() > 0 {
			key := visitKey{ptr: rv.Pointer(), typ: rv.Type()}
			if c.activeValues[key] {
				return nil, core.NewRecursionError(fmt.Sprintf("cyclic %s value of type %T", rv.Kind(), val))
			}
			if c.activeValues == nil {
				c.activeValues = make(map[visitKey]bool)
			}
			c.activeValues[key] = true
			defer delete(c.activeValues, key)
		}
	}

	if vs, ok := val.(ValueSerializer); ok {
		return vs.SerializeBuilderValue(c)
	}
	if node, ok := val.(Node); ok {
		return c.EmitChild(node)
	}
	if rv.Kind() != reflect.Pointer && reflect.PointerTo(rv.Type()).Implements(nodeInterfaceType) {
		ptr := reflect.New(rv.Type())
		ptr.Elem().Set(rv)
		return c.EmitChild(ptr.Interface().(Node))
	}

	if rv.Kind() == reflect.String {
		if se, ok := val.(StringEnum); ok {
			s := rv.String()
			if err := c.ValidateEnum(rv.Type().Name(), s, se); err != nil {
				return nil, err
			}
			return s, nil
		}
		if reflect.PointerTo(rv.Type()).Implements(stringEnumInterfaceType) {
			ptr := reflect.New(rv.Type())
			ptr.Elem().Set(rv)
			s := rv.String()
			if err := c.ValidateEnum(rv.Type().Name(), s, ptr.Interface().(StringEnum)); err != nil {
				return nil, err
			}
			return s, nil
		}
	} else if rv.Kind() == reflect.Pointer && rv.Elem().Kind() == reflect.String {
		if se, ok := val.(StringEnum); ok {
			s := rv.Elem().String()
			if err := c.ValidateEnum(rv.Elem().Type().Name(), s, se); err != nil {
				return nil, err
			}
			return s, nil
		}
	}

	if jm, ok := val.(json.Marshaler); ok {
		data, err := jm.MarshalJSON()
		if err != nil {
			return nil, wrapBuilderValidationError(err, fmt.Sprintf("MarshalJSON failed for %T", val))
		}
		parsed, err := core.ParseJSON(data)
		if err != nil {
			return nil, core.NewValidationErrorf("MarshalJSON for %T produced invalid JSON: %v", val, err)
		}
		return parsed, nil
	}
	if rv.Kind() != reflect.Pointer && reflect.PointerTo(rv.Type()).Implements(jsonMarshalerType) {
		ptr := reflect.New(rv.Type())
		ptr.Elem().Set(rv)
		data, err := ptr.Interface().(json.Marshaler).MarshalJSON()
		if err != nil {
			return nil, wrapBuilderValidationError(err, fmt.Sprintf("MarshalJSON failed for %T", val))
		}
		parsed, err := core.ParseJSON(data)
		if err != nil {
			return nil, core.NewValidationErrorf("MarshalJSON for %T produced invalid JSON: %v", val, err)
		}
		return parsed, nil
	}
	if tm, ok := val.(encoding.TextMarshaler); ok {
		txt, err := tm.MarshalText()
		if err != nil {
			return nil, wrapBuilderValidationError(err, fmt.Sprintf("MarshalText failed for %T", val))
		}
		return string(txt), nil
	}
	if rv.Kind() != reflect.Pointer && reflect.PointerTo(rv.Type()).Implements(textMarshalerType) {
		ptr := reflect.New(rv.Type())
		ptr.Elem().Set(rv)
		txt, err := ptr.Interface().(encoding.TextMarshaler).MarshalText()
		if err != nil {
			return nil, wrapBuilderValidationError(err, fmt.Sprintf("MarshalText failed for %T", val))
		}
		return string(txt), nil
	}

	switch rv.Kind() {
	case reflect.Pointer:
		return c.SerializeValue(rv.Elem().Interface())
	case reflect.String:
		return rv.String(), nil
	case reflect.Bool:
		return rv.Bool(), nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return rv.Int(), nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return rv.Uint(), nil
	case reflect.Float32, reflect.Float64:
		f := rv.Float()
		if err := ValidateFiniteFloat("float value", f); err != nil {
			return nil, err
		}
		return f, nil
	case reflect.Slice, reflect.Array:
		if rv.Kind() == reflect.Slice && rv.IsNil() {
			return nil, nil
		}
		elemType := rv.Type().Elem()
		if elemType.Implements(nodeInterfaceType) {
			out := make([]any, 0, rv.Len())
			for i := range rv.Len() {
				ev := rv.Index(i)
				if (ev.Kind() == reflect.Interface || ev.Kind() == reflect.Pointer) && ev.IsNil() {
					return nil, core.NewValidationError("child component node must not be nil")
				}
				id, err := c.EmitChild(ev.Interface().(Node))
				if err != nil {
					return nil, err
				}
				out = append(out, id)
			}
			return out, nil
		}
		if elemType.Kind() != reflect.Interface && reflect.PointerTo(elemType).Implements(nodeInterfaceType) {
			out := make([]any, 0, rv.Len())
			for i := range rv.Len() {
				ptr := reflect.New(elemType)
				ptr.Elem().Set(rv.Index(i))
				id, err := c.EmitChild(ptr.Interface().(Node))
				if err != nil {
					return nil, err
				}
				out = append(out, id)
			}
			return out, nil
		}
		out := make([]any, 0, rv.Len())
		for i := range rv.Len() {
			elem, err := c.SerializeValue(rv.Index(i).Interface())
			if err != nil {
				return nil, err
			}
			out = append(out, elem)
		}
		return out, nil
	case reflect.Map:
		if rv.IsNil() {
			return nil, nil
		}
		if rv.Type().Key().Kind() != reflect.String {
			return nil, core.NewValidationErrorf("unsupported non-string map key type %s", rv.Type().Key())
		}
		out := make(map[string]any, rv.Len())
		iter := rv.MapRange()
		for iter.Next() {
			k := iter.Key().String()
			ser, err := c.SerializeValue(iter.Value().Interface())
			if err != nil {
				return nil, err
			}
			out[k] = ser
		}
		return out, nil
	case reflect.Struct:
		return c.serializeStructFields(rv)
	default:
		return nil, core.NewValidationErrorf("unsupported builder value of type %T", val)
	}
}

func (c *FlattenContext) serializeWithComponentSerializer(cs ComponentSerializer, compType, componentID string) (map[string]any, error) {
	props, err := cs.SerializeComponent(c)
	if err != nil {
		return nil, err
	}
	out := make(map[string]any, len(props)+2)
	out["component"] = compType
	out["id"] = componentID
	for k, v := range props {
		if k == "component" || k == "id" {
			continue
		}
		out[k] = v
	}
	return out, nil
}

func (c *FlattenContext) dumpComponent(node Node, componentID string) (map[string]any, error) {
	compType := resolveComponentType(node)
	if compType == "" {
		return nil, core.NewValidationError("component builder node has empty component type")
	}
	if cs, ok := node.(ComponentSerializer); ok {
		return c.serializeWithComponentSerializer(cs, compType, componentID)
	}
	if rv := reflect.ValueOf(node); rv.IsValid() && rv.Kind() != reflect.Pointer && reflect.PointerTo(rv.Type()).Implements(componentSerializerType) {
		ptr := reflect.New(rv.Type())
		ptr.Elem().Set(rv)
		return c.serializeWithComponentSerializer(ptr.Interface().(ComponentSerializer), compType, componentID)
	}
	return c.dumpReflectedNode(node, componentID)
}

func (c *FlattenContext) dumpReflectedNode(node Node, componentID string) (map[string]any, error) {
	rv := reflect.ValueOf(node)
	for rv.Kind() == reflect.Pointer {
		rv = rv.Elem()
	}
	if rv.Kind() != reflect.Struct {
		return nil, core.NewValidationErrorf("custom Node %T must be a struct or implement ComponentSerializer", node)
	}

	compType := resolveComponentType(node)
	if compType == "" {
		return nil, core.NewValidationError("component builder node has empty component type")
	}
	out := map[string]any{
		"component": compType,
		"id":        componentID,
	}

	defaultCID := ""
	if provider, ok := node.(DefaultCatalogIDProvider); ok {
		defaultCID = provider.DefaultCatalogID()
	} else if reflect.PointerTo(rv.Type()).Implements(defaultCatalogIDProvType) {
		ptr := reflect.New(rv.Type())
		ptr.Elem().Set(rv)
		defaultCID = ptr.Interface().(DefaultCatalogIDProvider).DefaultCatalogID()
	}

	if carrier, ok := node.(EnvelopeAttributeCarrier); ok {
		if err := carrier.SerializeEnvelopeAttributes(c, out, defaultCID); err != nil {
			return nil, err
		}
	} else if reflect.PointerTo(rv.Type()).Implements(envelopeCarrierType) {
		ptr := reflect.New(rv.Type())
		ptr.Elem().Set(rv)
		if err := ptr.Interface().(EnvelopeAttributeCarrier).SerializeEnvelopeAttributes(c, out, defaultCID); err != nil {
			return nil, err
		}
	} else if defaultCID != "" && node.BuilderVersionFamily() != VersionFamily0_9 {
		out["@catalogId"] = defaultCID
	}

	fields, err := c.serializeCustomNodeStructFields(rv)
	if err != nil {
		return nil, err
	}
	for k, v := range fields {
		if k == "component" || k == "id" {
			continue
		}
		out[k] = v
	}
	return out, nil
}

type structFieldInfo struct {
	name      string
	index     []int
	omitEmpty bool
	tagged    bool
}

type typeFieldsKey struct {
	rt                   reflect.Type
	skipEnvelopeCarriers bool
}

var typeFieldsCache sync.Map // map[typeFieldsKey][]structFieldInfo

func cachedTypeFields(rt reflect.Type, skipEnvelopeCarriers bool) []structFieldInfo {
	key := typeFieldsKey{rt: rt, skipEnvelopeCarriers: skipEnvelopeCarriers}
	if cached, ok := typeFieldsCache.Load(key); ok {
		return cached.([]structFieldInfo)
	}
	fields := typeFields(rt, skipEnvelopeCarriers)
	typeFieldsCache.Store(key, fields)
	return fields
}

// typeFields resolves exported struct fields using encoding/json's breadth-first dominance rules.
func typeFields(rt reflect.Type, skipEnvelopeCarriers bool) []structFieldInfo {
	type fieldScan struct {
		typ   reflect.Type
		index []int
	}

	var current []fieldScan
	next := []fieldScan{{typ: rt}}
	var nextCount map[reflect.Type]int
	visited := make(map[reflect.Type]bool)

	var candidates []structFieldInfo
	for len(next) > 0 {
		current, next = next, current[:0]
		count := nextCount
		nextCount = nil

		for _, scan := range current {
			if visited[scan.typ] {
				continue
			}
			visited[scan.typ] = true

			for i := range scan.typ.NumField() {
				sf := scan.typ.Field(i)
				if sf.Anonymous {
					t := sf.Type
					if t.Kind() == reflect.Pointer {
						t = t.Elem()
					}
					if !sf.IsExported() && t.Kind() != reflect.Struct {
						continue
					}
				} else if !sf.IsExported() {
					continue
				}

				explicitName, omitEmpty, skip := parseJSONTag(sf)
				if skip {
					continue
				}

				idx := make([]int, len(scan.index)+1)
				copy(idx, scan.index)
				idx[len(scan.index)] = i

				ft := sf.Type
				if ft.Kind() == reflect.Pointer {
					ft = ft.Elem()
				}

				if explicitName == "" && sf.Anonymous && ft.Kind() == reflect.Struct {
					if skipEnvelopeCarriers &&
						(sf.Type.Implements(envelopeCarrierType) || reflect.PointerTo(sf.Type).Implements(envelopeCarrierType)) &&
						ft.Name() == "ComponentNode" {
						continue
					}
					if !visited[ft] {
						if nextCount == nil {
							nextCount = make(map[reflect.Type]int)
						}
						nextCount[ft]++
						if nextCount[ft] == 1 {
							next = append(next, fieldScan{typ: ft, index: idx})
						}
					}
					continue
				}

				wireName := explicitName
				tagged := explicitName != ""
				if wireName == "" {
					wireName = lowerFirst(sf.Name)
				}
				if count[scan.typ] > 1 {
					// Duplicate anonymous struct reached via multiple diamond paths at this depth;
					// record twice so un-tagged duplicates cancel out unless resolved by tag.
					candidates = append(candidates,
						structFieldInfo{name: wireName, index: idx, omitEmpty: omitEmpty, tagged: tagged},
						structFieldInfo{name: wireName, index: idx, omitEmpty: omitEmpty, tagged: tagged},
					)
				} else {
					candidates = append(candidates, structFieldInfo{
						name:      wireName,
						index:     idx,
						omitEmpty: omitEmpty,
						tagged:    tagged,
					})
				}
			}
		}
	}

	byName := make(map[string][]structFieldInfo, len(candidates))
	var order []string
	for _, c := range candidates {
		if _, exists := byName[c.name]; !exists {
			order = append(order, c.name)
		}
		byName[c.name] = append(byName[c.name], c)
	}

	resolved := make([]structFieldInfo, 0, len(order))
	for _, name := range order {
		group := byName[name]
		if win, ok := dominantField(group); ok {
			resolved = append(resolved, win)
		}
	}
	return resolved
}

func dominantField(group []structFieldInfo) (structFieldInfo, bool) {
	if len(group) == 1 {
		return group[0], true
	}
	minDepth := len(group[0].index)
	for _, f := range group[1:] {
		if len(f.index) < minDepth {
			minDepth = len(f.index)
		}
	}
	var shallowest []structFieldInfo
	for _, f := range group {
		if len(f.index) == minDepth {
			shallowest = append(shallowest, f)
		}
	}
	if len(shallowest) == 1 {
		return shallowest[0], true
	}
	var tagged []structFieldInfo
	for _, f := range shallowest {
		if f.tagged {
			tagged = append(tagged, f)
		}
	}
	if len(tagged) == 1 {
		return tagged[0], true
	}
	return structFieldInfo{}, false
}

func (c *FlattenContext) serializeCustomNodeStructFields(rv reflect.Value) (map[string]any, error) {
	return c.serializeReflectedStructFields(rv, true)
}

func (c *FlattenContext) serializeStructFields(rv reflect.Value) (map[string]any, error) {
	return c.serializeReflectedStructFields(rv, false)
}

func (c *FlattenContext) serializeReflectedStructFields(rv reflect.Value, skipEnvelopeCarriers bool) (map[string]any, error) {
	fields := cachedTypeFields(rv.Type(), skipEnvelopeCarriers)
	out := make(map[string]any, len(fields))
	for _, f := range fields {
		fv, ok := fieldByIndexExisting(rv, f.index)
		if !ok || isOmittedFieldValue(fv, f.omitEmpty) {
			continue
		}
		ser, err := c.SerializeValue(fv.Interface())
		if err != nil {
			return nil, err
		}
		if ser == nil {
			continue
		}
		out[f.name] = ser
	}
	return out, nil
}

func fieldByIndexExisting(rv reflect.Value, index []int) (reflect.Value, bool) {
	v := rv
	for _, idx := range index {
		if v.Kind() == reflect.Pointer {
			if v.IsNil() {
				return reflect.Value{}, false
			}
			v = v.Elem()
		}
		v = v.Field(idx)
	}
	return v, true
}

func parseJSONTag(sf reflect.StructField) (explicitName string, omitEmpty bool, skip bool) {
	tag := sf.Tag.Get("json")
	if tag == "-" {
		return "", false, true
	}
	if tag != "" {
		parts := strings.Split(tag, ",")
		explicitName = parts[0]
		for _, opt := range parts[1:] {
			if opt == "omitempty" {
				omitEmpty = true
			}
		}
	}
	return explicitName, omitEmpty, false
}

func lowerFirst(s string) string {
	if s == "" {
		return ""
	}
	runes := []rune(s)
	runes[0] = unicode.ToLower(runes[0])
	return string(runes)
}

func isOmittedFieldValue(fv reflect.Value, omitEmpty bool) bool {
	switch fv.Kind() {
	case reflect.Interface, reflect.Pointer, reflect.Map, reflect.Slice:
		if fv.IsNil() {
			return true
		}
		if omitEmpty && (fv.Kind() == reflect.Map || fv.Kind() == reflect.Slice) && fv.Len() == 0 {
			return true
		}
		return false
	case reflect.Array:
		return omitEmpty && fv.Len() == 0
	default:
		if omitEmpty && fv.IsZero() {
			return true
		}
		return false
	}
}

// FlattenComponentTree flattens a nested component builder subtree into depth-first
// post-order A2UI wire component maps, reserving explicit IDs in Pass 1 and allocating
// deterministic scoped IDs in Pass 2.
func FlattenComponentTree(root Node, rootID string) ([]map[string]any, error) {
	return FlattenComponentTreeWithOptions(root, rootID, FlattenOptions{})
}

// FlattenComponentTreeWithOptions flattens a nested component subtree with custom FlattenOptions.
func FlattenComponentTreeWithOptions(root Node, rootID string, opts FlattenOptions) ([]map[string]any, error) {
	if isNilNode(root) {
		return nil, core.NewValidationError("root component node must not be nil")
	}
	if _, isRef := ComponentRefID(root); isRef {
		return []map[string]any{}, nil
	}

	prefix := rootID
	if prefix == "" {
		prefix = root.ComponentID()
	}
	if prefix == "" {
		prefix = "root"
	}

	rootPtr, hasRootPtr := nodePointerIdentity(root)
	reserved := make(map[string]bool, len(opts.ReservedIDs)+4)
	for id, ok := range opts.ReservedIDs {
		if ok {
			reserved[id] = true
		}
	}

	// Pass 1: Scan the tree to reserve all author-supplied explicit IDs and detect cycles/duplicates.
	scan := &FlattenContext{
		prefix:         prefix,
		allowOpenEnums: opts.AllowOpenEnums,
		reserved:       reserved,
		emittedIDs:     make(map[string]uintptr),
		visitedScan:    make(map[uintptr]bool),
		activeStack:    make(map[uintptr]bool),
		activeValues:   make(map[visitKey]bool),
	}
	if rootID != "" {
		scan.reserved[rootID] = true
		scan.emittedIDs[rootID] = rootPtr
	} else if explicitRootID := root.ComponentID(); explicitRootID != "" {
		scan.reserved[explicitRootID] = true
		scan.reserved[fmt.Sprintf("%s__%s", prefix, explicitRootID)] = true
		scan.emittedIDs[explicitRootID] = rootPtr
	}
	if hasRootPtr {
		scan.visitedScan[rootPtr] = true
		scan.activeStack[rootPtr] = true
	}
	if _, err := scan.dumpComponent(root, prefix); err != nil {
		return nil, err
	}
	if hasRootPtr {
		delete(scan.activeStack, rootPtr)
	}

	// Pass 2: Allocate deterministic IDs and emit children before parents in post-order.
	emit := &FlattenContext{
		prefix:         prefix,
		allowOpenEnums: opts.AllowOpenEnums,
		allocator:      NewIDAllocator(prefix, scan.reserved),
		reserved:       scan.reserved,
		assigned:       make(map[uintptr]string),
		emittedIDs:     make(map[string]uintptr),
		activeStack:    make(map[uintptr]bool),
		activeValues:   make(map[visitKey]bool),
	}

	compType := resolveComponentType(root)
	if compType == "" {
		return nil, core.NewValidationError("root component node has empty component type")
	}

	resolvedRootID := rootID
	if resolvedRootID == "" {
		resolvedRootID = root.ComponentID()
	}
	if resolvedRootID == "" {
		resolvedRootID = emit.allocator.Allocate(compType, "")
	}
	emit.emittedIDs[resolvedRootID] = rootPtr
	if hasRootPtr {
		emit.assigned[rootPtr] = resolvedRootID
		emit.activeStack[rootPtr] = true
	}

	payload, err := emit.dumpComponent(root, resolvedRootID)
	if hasRootPtr {
		delete(emit.activeStack, rootPtr)
	}
	if err != nil {
		return nil, err
	}
	emit.components = append(emit.components, payload)
	return emit.components, nil
}

// FlattenComponentForest flattens a sequence of independent root subtrees in order.
// When rootID is non-empty, each root i receives scope "{rootID}_{i}".
func FlattenComponentForest(roots []Node, rootID string) ([]map[string]any, error) {
	return FlattenComponentForestWithOptions(roots, rootID, FlattenOptions{})
}

// FlattenComponentForestWithOptions flattens a sequence of root subtrees with custom FlattenOptions.
func FlattenComponentForestWithOptions(roots []Node, rootID string, opts FlattenOptions) ([]map[string]any, error) {
	out := make([]map[string]any, 0, len(roots))
	mergedReserved := make(map[string]bool, len(opts.ReservedIDs)+len(roots))
	for id, ok := range opts.ReservedIDs {
		if ok {
			mergedReserved[id] = true
		}
	}
	if rootID == "" {
		for _, item := range roots {
			if isNilNode(item) {
				continue
			}
			if cid := item.ComponentID(); cid != "" {
				mergedReserved[cid] = true
			}
		}
	}
	seenGlobalIDs := make(map[string]bool, len(roots))
	for idx, item := range roots {
		itemRootID := ""
		if rootID != "" {
			itemRootID = fmt.Sprintf("%s_%d", rootID, idx)
		}
		itemOpts := opts
		itemOpts.ReservedIDs = mergedReserved
		flat, err := FlattenComponentTreeWithOptions(item, itemRootID, itemOpts)
		if err != nil {
			return nil, err
		}
		for _, comp := range flat {
			if cid, ok := comp["id"].(string); ok && cid != "" {
				if seenGlobalIDs[cid] {
					return nil, core.NewValidationErrorf("duplicate component ID %q across component forest", cid)
				}
				seenGlobalIDs[cid] = true
				mergedReserved[cid] = true
			}
		}
		out = append(out, flat...)
	}
	return out, nil
}
