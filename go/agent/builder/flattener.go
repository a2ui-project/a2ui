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
	"fmt"
	"reflect"
	"slices"
	"strings"
	"unicode"

	"github.com/a2ui-project/a2ui/go/core"
)

// FlattenOptions customizes component tree flattening and validation behavior.
type FlattenOptions struct {
	// AllowOpenEnums relaxes strict enum checks so forward-compatible enum values pass validation.
	AllowOpenEnums bool
}

// FlattenContext carries state across the two-pass scan and post-order emit traversal.
type FlattenContext struct {
	prefix         string
	allowOpenEnums bool

	allocator   *IDAllocator
	reserved    map[string]bool
	components  []map[string]any
	assigned    map[uintptr]string
	emittedIDs  map[string]uintptr
	visitedScan map[uintptr]bool
	activeStack map[uintptr]bool
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
	if node == nil {
		return true
	}
	rv := reflect.ValueOf(node)
	return rv.Kind() == reflect.Pointer && rv.IsNil()
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
		return refID, nil
	}

	ptr, hasPtr := nodePointerIdentity(node)
	if hasPtr {
		if c.activeStack[ptr] {
			return "", core.NewRecursionError(
				fmt.Sprintf("cyclic component reference detected on %s (id=%q)", node.ComponentType(), node.ComponentID()),
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

	compType := node.ComponentType()
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
	if vs, ok := val.(ValueSerializer); ok {
		rv := reflect.ValueOf(val)
		if rv.Kind() == reflect.Pointer && rv.IsNil() {
			return nil, nil
		}
		return vs.SerializeBuilderValue(c)
	}
	if node, ok := val.(Node); ok {
		if isNilNode(node) {
			return nil, nil
		}
		return c.EmitChild(node)
	}
	if se, ok := val.(StringEnum); ok {
		rv := reflect.ValueOf(val)
		if rv.Kind() == reflect.String {
			s := rv.String()
			if err := c.ValidateEnum(rv.Type().Name(), s, se); err != nil {
				return nil, err
			}
			return s, nil
		}
	}

	rv := reflect.ValueOf(val)
	switch rv.Kind() {
	case reflect.Pointer:
		if rv.IsNil() {
			return nil, nil
		}
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
		return rv.Float(), nil
	case reflect.Slice, reflect.Array:
		if rv.Kind() == reflect.Slice && rv.IsNil() {
			return nil, nil
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

func (c *FlattenContext) dumpComponent(node Node, componentID string) (map[string]any, error) {
	if cs, ok := node.(ComponentSerializer); ok {
		props, err := cs.SerializeComponent(c)
		if err != nil {
			return nil, err
		}
		out := make(map[string]any, len(props)+2)
		out["component"] = node.ComponentType()
		out["id"] = componentID
		for k, v := range props {
			if k == "component" || k == "id" {
				continue
			}
			out[k] = v
		}
		return out, nil
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

	compType := node.ComponentType()
	if compType == "" {
		compType = rv.Type().Name()
	}
	out := map[string]any{
		"component": compType,
		"id":        componentID,
	}

	defaultCID := ""
	if provider, ok := node.(DefaultCatalogIDProvider); ok {
		defaultCID = provider.DefaultCatalogID()
	}
	if carrier, ok := node.(EnvelopeAttributeCarrier); ok {
		if err := carrier.SerializeEnvelopeAttributes(c, out, defaultCID); err != nil {
			return nil, err
		}
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

var envelopeCarrierType = reflect.TypeFor[EnvelopeAttributeCarrier]()

func (c *FlattenContext) serializeCustomNodeStructFields(rv reflect.Value) (map[string]any, error) {
	return c.serializeReflectedStructFields(rv, true)
}

func (c *FlattenContext) serializeStructFields(rv reflect.Value) (map[string]any, error) {
	return c.serializeReflectedStructFields(rv, false)
}

func (c *FlattenContext) serializeReflectedStructFields(rv reflect.Value, skipEnvelopeCarriers bool) (map[string]any, error) {
	rt := rv.Type()
	direct := make(map[string]any, rt.NumField())
	var embeddedMaps []map[string]any

	for i := range rt.NumField() {
		sf := rt.Field(i)
		if !sf.IsExported() && !sf.Anonymous {
			continue
		}
		explicitName, omitEmpty, skip := parseJSONTag(sf)
		if skip {
			continue
		}
		fv := rv.Field(i)
		if sf.Anonymous && explicitName == "" {
			sfElem := sf.Type
			if sfElem.Kind() == reflect.Pointer {
				sfElem = sfElem.Elem()
			}
			if sfElem.Kind() == reflect.Struct {
				nestedRV := fv
				if nestedRV.Kind() == reflect.Pointer {
					if nestedRV.IsNil() {
						continue
					}
					nestedRV = nestedRV.Elem()
				}
				if skipEnvelopeCarriers &&
					(sf.Type.Implements(envelopeCarrierType) || reflect.PointerTo(sf.Type).Implements(envelopeCarrierType)) &&
					nestedRV.Type().Name() == "ComponentNode" {
					// Envelope attributes on embedded ComponentNode were already serialized via EnvelopeAttributeCarrier.
					continue
				}
				sub, err := c.serializeReflectedStructFields(nestedRV, skipEnvelopeCarriers)
				if err != nil {
					return nil, err
				}
				if len(sub) > 0 {
					embeddedMaps = append(embeddedMaps, sub)
				}
				continue
			}
		}
		if !sf.IsExported() {
			continue
		}
		wireName := explicitName
		if wireName == "" {
			wireName = lowerFirst(sf.Name)
		}
		if isOmittedFieldValue(fv, omitEmpty) {
			continue
		}
		ser, err := c.SerializeValue(fv.Interface())
		if err != nil {
			return nil, err
		}
		if ser == nil {
			continue
		}
		direct[wireName] = ser
	}

	if len(embeddedMaps) == 0 {
		return direct, nil
	}
	counts := make(map[string]int)
	for _, sub := range embeddedMaps {
		for k := range sub {
			counts[k]++
		}
	}
	out := make(map[string]any, len(counts)+len(direct))
	for _, sub := range embeddedMaps {
		for k, v := range sub {
			if counts[k] == 1 {
				out[k] = v
			}
		}
	}
	for k, v := range direct {
		out[k] = v
	}
	return out, nil
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

	// Pass 1: Scan the tree to reserve all author-supplied explicit IDs and detect cycles/duplicates.
	scan := &FlattenContext{
		prefix:         prefix,
		allowOpenEnums: opts.AllowOpenEnums,
		reserved:       make(map[string]bool),
		emittedIDs:     make(map[string]uintptr),
		visitedScan:    make(map[uintptr]bool),
		activeStack:    make(map[uintptr]bool),
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
	}

	compType := root.ComponentType()
	if compType == "" {
		rv := reflect.ValueOf(root)
		for rv.Kind() == reflect.Pointer {
			rv = rv.Elem()
		}
		if rv.Kind() == reflect.Struct {
			compType = rv.Type().Name()
		}
	}
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
	seenGlobalIDs := make(map[string]bool, len(roots))
	for idx, item := range roots {
		itemRootID := ""
		if rootID != "" {
			itemRootID = fmt.Sprintf("%s_%d", rootID, idx)
		}
		flat, err := FlattenComponentTreeWithOptions(item, itemRootID, opts)
		if err != nil {
			return nil, err
		}
		for _, comp := range flat {
			if cid, ok := comp["id"].(string); ok && cid != "" {
				if seenGlobalIDs[cid] {
					return nil, core.NewValidationErrorf("duplicate component ID %q across component forest", cid)
				}
				seenGlobalIDs[cid] = true
			}
		}
		out = append(out, flat...)
	}
	return out, nil
}
