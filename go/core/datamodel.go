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

package core

import (
	"reflect"
	"strings"
)

// MaxDataModelArrayIndex is the maximum supported list index during path traversal and mutation.
const MaxDataModelArrayIndex = 10000

var forbiddenPointerSegments = map[string]bool{
	"__proto__":   true,
	"constructor": true,
	"prototype":   true,
}

type dataWatcher struct {
	id       uint64
	active   bool
	normPath string
	tokens   []string
	callback func(val any)
}

// DataModel stores reactive JSON state for a SurfaceModel addressed via RFC 6901 JSON Pointers.
type DataModel struct {
	root     any
	disposed bool
	nextID   uint64
	watchers []*dataWatcher
}

// NewDataModel creates a DataModel initialized with an optional root map.
func NewDataModel(initial map[string]any) *DataModel {
	root := map[string]any{}
	if initial != nil {
		if copied, ok := CloneJSONValue(initial).(map[string]any); ok && copied != nil {
			root = copied
		}
	}
	return &DataModel{root: root}
}

// NewDataModelFromAny creates a DataModel initialized with an arbitrary JSON value (defaulting nil to {}).
func NewDataModelFromAny(initial any) *DataModel {
	norm := CloneJSONValue(initial)
	if norm == nil {
		return &DataModel{root: map[string]any{}}
	}
	return &DataModel{root: norm}
}

func parseDataPointer(path string) ([]string, error) {
	if path == "" || path == "/" {
		return nil, nil
	}
	parts := strings.Split(path, "/")
	var tokens []string
	for _, seg := range parts {
		if seg == "" {
			continue
		}
		unescaped := unescapeJSONPointerToken(seg)
		if forbiddenPointerSegments[unescaped] {
			return nil, NewDataErrorf("Forbidden path segment '%s' in path '%s'.", unescaped, path)
		}
		tokens = append(tokens, unescaped)
	}
	return tokens, nil
}

func buildDataPointer(tokens []string) string {
	if len(tokens) == 0 {
		return "/"
	}
	escaped := make([]string, len(tokens))
	for i, t := range tokens {
		escaped[i] = escapeJSONPointerToken(t)
	}
	return "/" + strings.Join(escaped, "/")
}

// HasPath reports whether pointer physically exists in the data model hierarchy.
func (d *DataModel) HasPath(pointer string) (bool, error) {
	tokens, err := parseDataPointer(pointer)
	if err != nil {
		return false, err
	}
	if len(tokens) == 0 {
		return true, nil
	}
	cur := d.root
	for _, tok := range tokens {
		switch container := cur.(type) {
		case map[string]any:
			val, exists := container[tok]
			if !exists {
				return false, nil
			}
			cur = val
		case []any:
			idx, ok := parseCanonicalArrayIndex(tok)
			if !ok || idx < 0 || idx >= len(container) {
				return false, nil
			}
			cur = container[idx]
		default:
			return false, nil
		}
	}
	return true, nil
}

// Get reads the JSON value at the given RFC 6901 pointer, returning (value, exists, error).
// Sparse nil array slots and missing keys return (nil, false, nil); an explicit nil map value returns (nil, true, nil).
func (d *DataModel) Get(pointer string) (any, bool, error) {
	tokens, err := parseDataPointer(pointer)
	if err != nil {
		return nil, false, err
	}
	if len(tokens) == 0 {
		return CloneJSONValue(d.root), true, nil
	}
	cur := d.root
	for i, tok := range tokens {
		isLast := i == len(tokens)-1
		switch container := cur.(type) {
		case map[string]any:
			val, exists := container[tok]
			if !exists {
				return nil, false, nil
			}
			cur = val
		case []any:
			idx, ok := parseCanonicalArrayIndex(tok)
			if !ok || idx < 0 || idx >= len(container) {
				return nil, false, nil
			}
			val := container[idx]
			if isLast && val == nil {
				// Padded / deleted list positions resolve as absent on read.
				return nil, false, nil
			}
			cur = val
		default:
			return nil, false, nil
		}
	}
	return CloneJSONValue(cur), true, nil
}

// Set writes val at pointer, auto-vivifying intermediate containers, or deletes the key when val is nil.
func (d *DataModel) Set(pointer string, val any) error {
	tokens, err := parseDataPointer(pointer)
	if err != nil {
		return err
	}
	normVal := CloneJSONValue(val)
	if normVal == nil && len(tokens) > 0 {
		exists, err := d.HasPath(pointer)
		if err != nil {
			return err
		}
		if !exists {
			// Still validate intermediate container types / array index syntax if parent exists!
			if err := d.validateDeletePath(pointer, tokens); err != nil {
				return err
			}
			return nil
		}
	}

	var snapshots map[string]snapEntry
	if !d.disposed && len(d.watchers) > 0 {
		snapshots = make(map[string]snapEntry, len(d.watchers))
		for _, w := range d.watchers {
			if _, ok := snapshots[w.normPath]; !ok {
				v, ex, _ := d.Get(w.normPath)
				snapshots[w.normPath] = snapEntry{val: v, exists: ex}
			}
		}
	}

	if len(tokens) == 0 {
		if normVal == nil {
			d.root = map[string]any{}
		} else {
			d.root = normVal
		}
		d.notifyCascade(tokens, snapshots)
		return nil
	}

	if d.root == nil {
		d.root = map[string]any{}
	}
	switch d.root.(type) {
	case map[string]any, []any:
	default:
		err := NewDataErrorf("Cannot set path '%s': the data model root is a primitive value.", pointer)
		err.Path = pointer
		return err
	}

	// Pre-validate the entire path before mutating so failed writes leave state untouched!
	if err := d.validateWritePath(pointer, tokens); err != nil {
		return err
	}

	cur := d.root
	for i := 0; i < len(tokens)-1; i++ {
		tok := tokens[i]
		nextTok := tokens[i+1]
		_, nextIsNumeric := parseCanonicalArrayIndex(nextTok)

		switch container := cur.(type) {
		case map[string]any:
			existing, ok := container[tok]
			if !ok || existing == nil {
				if nextIsNumeric {
					container[tok] = []any{}
				} else {
					container[tok] = map[string]any{}
				}
			}
			cur = container[tok]
		case []any:
			idx, _ := parseCanonicalArrayIndex(tok)
			for len(container) <= idx {
				container = append(container, nil)
			}
			// Reassign grown slice into parent slot!
			d.assignSliceAt(tokens[:i], container)
			if container[idx] == nil {
				if nextIsNumeric {
					container[idx] = []any{}
				} else {
					container[idx] = map[string]any{}
				}
			}
			cur = container[idx]
		}
	}

	lastTok := tokens[len(tokens)-1]
	switch container := cur.(type) {
	case map[string]any:
		if normVal == nil {
			delete(container, lastTok)
		} else {
			container[lastTok] = normVal
		}
	case []any:
		idx, _ := parseCanonicalArrayIndex(lastTok)
		if normVal == nil {
			if idx < len(container) {
				container[idx] = nil
			}
		} else {
			for len(container) <= idx {
				container = append(container, nil)
			}
			container[idx] = normVal
			d.assignSliceAt(tokens[:len(tokens)-1], container)
		}
	}

	d.notifyCascade(tokens, snapshots)
	return nil
}

func (d *DataModel) validateDeletePath(pointer string, tokens []string) error {
	cur := d.root
	for _, tok := range tokens {
		switch container := cur.(type) {
		case map[string]any:
			next, exists := container[tok]
			if !exists || next == nil {
				return nil
			}
			cur = next
		case []any:
			idx, ok := parseCanonicalArrayIndex(tok)
			if !ok {
				err := NewDataErrorf("Cannot use non-numeric segment '%s' on an array in path '%s'.", tok, pointer)
				err.Path = pointer
				return err
			}
			if idx > MaxDataModelArrayIndex {
				err := NewDataErrorf("Cannot set path '%s': array index '%s' exceeds maximum supported index (%d).", pointer, tok, MaxDataModelArrayIndex)
				err.Path = pointer
				return err
			}
			if idx >= len(container) || container[idx] == nil {
				return nil
			}
			cur = container[idx]
		default:
			err := NewDataErrorf("Cannot set path '%s': segment is a primitive value.", pointer)
			err.Path = pointer
			return err
		}
	}
	return nil
}

func (d *DataModel) validateWritePath(pointer string, tokens []string) error {
	cur := d.root
	virtualIsList := false
	inVirtual := false

	for i, tok := range tokens {
		isLast := i == len(tokens)-1
		var nextIsNumeric bool
		if !isLast {
			_, nextIsNumeric = parseCanonicalArrayIndex(tokens[i+1])
		}

		if inVirtual {
			if virtualIsList {
				idx, ok := parseCanonicalArrayIndex(tok)
				if !ok {
					err := NewDataErrorf("Cannot use non-numeric segment '%s' on an array in path '%s'.", tok, pointer)
					err.Path = pointer
					return err
				}
				if idx > MaxDataModelArrayIndex {
					err := NewDataErrorf("Cannot set path '%s': array index '%s' exceeds maximum supported index (%d).", pointer, tok, MaxDataModelArrayIndex)
					err.Path = pointer
					return err
				}
			}
			virtualIsList = nextIsNumeric
			continue
		}

		switch container := cur.(type) {
		case map[string]any:
			existing, ok := container[tok]
			if !ok || existing == nil {
				inVirtual = true
				virtualIsList = nextIsNumeric
				continue
			}
			if !isLast && !isContainerValue(existing) {
				err := NewDataErrorf("Cannot set path '%s': segment '%s' is a primitive value.", pointer, tok)
				err.Path = pointer
				return err
			}
			cur = existing
		case []any:
			idx, ok := parseCanonicalArrayIndex(tok)
			if !ok {
				err := NewDataErrorf("Cannot use non-numeric segment '%s' on an array in path '%s'.", tok, pointer)
				err.Path = pointer
				return err
			}
			if idx > MaxDataModelArrayIndex {
				err := NewDataErrorf("Cannot set path '%s': array index '%s' exceeds maximum supported index (%d).", pointer, tok, MaxDataModelArrayIndex)
				err.Path = pointer
				return err
			}
			if idx >= len(container) || container[idx] == nil {
				inVirtual = true
				virtualIsList = nextIsNumeric
				continue
			}
			existing := container[idx]
			if !isLast && !isContainerValue(existing) {
				err := NewDataErrorf("Cannot set path '%s': segment '%s' is a primitive value.", pointer, tok)
				err.Path = pointer
				return err
			}
			cur = existing
		default:
			err := NewDataErrorf("Cannot set path '%s': segment '%s' is a primitive value.", pointer, tok)
			err.Path = pointer
			return err
		}
	}
	return nil
}

func isContainerValue(v any) bool {
	switch v.(type) {
	case map[string]any, []any:
		return true
	default:
		return false
	}
}

func (d *DataModel) assignSliceAt(parentTokens []string, updated []any) {
	if len(parentTokens) == 0 {
		d.root = updated
		return
	}
	cur := d.root
	for i := 0; i < len(parentTokens)-1; i++ {
		tok := parentTokens[i]
		switch c := cur.(type) {
		case map[string]any:
			cur = c[tok]
		case []any:
			idx, _ := parseCanonicalArrayIndex(tok)
			cur = c[idx]
		}
	}
	last := parentTokens[len(parentTokens)-1]
	switch c := cur.(type) {
	case map[string]any:
		c[last] = updated
	case []any:
		idx, _ := parseCanonicalArrayIndex(last)
		c[idx] = updated
	}
}

type snapEntry struct {
	val    any
	exists bool
}

func (d *DataModel) notifyCascade(mutatedTokens []string, snapshots map[string]snapEntry) {
	if d.disposed || len(d.watchers) == 0 || len(snapshots) == 0 {
		return
	}
	active := append([]*dataWatcher(nil), d.watchers...)
	for _, w := range active {
		if d.disposed {
			break
		}
		if !w.active || w.callback == nil {
			continue
		}
		if !tokensRelated(w.tokens, mutatedTokens) {
			continue
		}
		oldSnap := snapshots[w.normPath]
		newVal, newExists, _ := d.Get(w.normPath)
		if oldSnap.exists == newExists && reflect.DeepEqual(oldSnap.val, newVal) {
			continue
		}
		w.callback(newVal)
	}
}

func tokensRelated(a, b []string) bool {
	minLen := len(a)
	if len(b) < minLen {
		minLen = len(b)
	}
	for i := 0; i < minLen; i++ {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// Delete removes the entry at pointer.
func (d *DataModel) Delete(pointer string) error {
	return d.Set(pointer, nil)
}

// Watch subscribes callback to changes affecting pointer and returns an unsubscribe function.
func (d *DataModel) Watch(pointer string, callback func(val any)) (func(), error) {
	tokens, err := parseDataPointer(pointer)
	if err != nil {
		return nil, err
	}
	normPath := buildDataPointer(tokens)
	if d.disposed {
		return func() {}, nil
	}
	d.nextID++
	id := d.nextID
	w := &dataWatcher{
		id:       id,
		active:   true,
		normPath: normPath,
		tokens:   tokens,
		callback: callback,
	}
	d.watchers = append(d.watchers, w)
	return func() {
		w.active = false
		for i, existing := range d.watchers {
			if existing.id == id {
				d.watchers = append(d.watchers[:i], d.watchers[i+1:]...)
				break
			}
		}
	}, nil
}

// Dispose releases all watchers on the DataModel.
func (d *DataModel) Dispose() {
	d.disposed = true
	for _, w := range d.watchers {
		w.active = false
	}
	d.watchers = nil
}

// DataContext represents an evaluation scope (root or collection template item) over a DataModel.
type DataContext struct {
	Model           *DataModel
	ContextPath     string
	IterationIndex  *int
	Parent          *DataContext
	Surface         *SurfaceModel
	ActiveCatalog   *Catalog
	ActiveCatalogID string
	IsUserActivated bool
	InAction        bool
}

// NewDataContext creates a root or scoped DataContext for surf (or model).
func NewDataContext(surf *SurfaceModel, contextPath string) *DataContext {
	var model *DataModel
	if surf != nil {
		model = surf.DataModel
	} else {
		model = NewDataModel(nil)
	}
	if contextPath == "" {
		contextPath = "/"
	}
	return &DataContext{
		Model:       model,
		ContextPath: contextPath,
		Surface:     surf,
	}
}

// Nested creates a child DataContext for a relative or absolute path and optional list iteration index.
func (c *DataContext) Nested(relOrAbsPath string, iterationIndex *int) *DataContext {
	resolved, _ := c.ResolvePath(relOrAbsPath)
	return &DataContext{
		Model:           c.Model,
		ContextPath:     resolved,
		IterationIndex:  iterationIndex,
		Parent:          c,
		Surface:         c.Surface,
		ActiveCatalog:   c.ActiveCatalog,
		ActiveCatalogID: c.ActiveCatalogID,
		IsUserActivated: c.IsUserActivated,
		InAction:        c.InAction,
	}
}

// WithActiveCatalog returns a shallow copy of DataContext scoped to catalogID and cat.
func (c *DataContext) WithActiveCatalog(catalogID string, cat *Catalog) *DataContext {
	if c == nil {
		return nil
	}
	cp := *c
	cp.ActiveCatalogID = catalogID
	cp.ActiveCatalog = cat
	return &cp
}

// ResolvePath resolves relOrAbsPath against ContextPath into a canonical JSON Pointer.
func (c *DataContext) ResolvePath(relOrAbsPath string) (string, error) {
	base := "/"
	if c != nil && c.ContextPath != "" {
		base = c.ContextPath
	}
	if len(base) > 1 {
		base = strings.TrimRight(base, "/")
		if base == "" {
			base = "/"
		}
	}
	if relOrAbsPath == "" || relOrAbsPath == "." {
		return base, nil
	}
	if strings.HasPrefix(relOrAbsPath, "/") {
		return relOrAbsPath, nil
	}
	if base == "/" {
		return "/" + relOrAbsPath, nil
	}
	return base + "/" + relOrAbsPath, nil
}

// EffectiveIndex returns the nearest non-nil IterationIndex in this DataContext chain.
func (c *DataContext) EffectiveIndex() (int, bool) {
	for cur := c; cur != nil; cur = cur.Parent {
		if cur.IterationIndex != nil {
			return *cur.IterationIndex, true
		}
	}
	return 0, false
}

// EffectiveUserActivated reports whether this DataContext or an ancestor runs under user activation.
func (c *DataContext) EffectiveUserActivated() bool {
	for cur := c; cur != nil; cur = cur.Parent {
		if cur.IsUserActivated {
			return true
		}
	}
	return false
}

func isSingleAtKey(key string) bool {
	return strings.HasPrefix(key, "@") && !strings.HasPrefix(key, "@@")
}

func unescapeAtKey(key string) string {
	if strings.HasPrefix(key, "@@") {
		return key[1:]
	}
	return key
}

func validateReservedDirectives(keys []string, version ProtocolVersion) error {
	if !IsAtLeastVersion(string(version), Version1_0) {
		return nil
	}
	for _, k := range keys {
		if isSingleAtKey(k) && k != "@path" && k != "@call" {
			msg := "Unrecognized reserved protocol directive '" + k + "' in v1.0 dynamic object. Reserved keys must be in @call, @path, or escaped with prefix doubling (e.g. '@" + k + "')."
			err := NewValidationError(msg, ErrorDetail{
				Path:    "",
				Code:    "INVALID_RESERVED_KEY",
				Message: msg,
			})
			err.Code = "INVALID_RESERVED_KEY"
			return err
		}
	}
	return nil
}
