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
	"fmt"
	"reflect"
	"sort"
	"strings"
)

const (
	// PlaceholderComponentType is the placeholder type assigned to pending or unknown-type cyclic ComponentNodes.
	PlaceholderComponentType = "Placeholder"
	rootComponentID          = "root"
	rootDataPath             = "/"
)

// NodeState describes the lifecycle/resolution state of a ComponentNode.
type NodeState string

const (
	NodeStateResolved    NodeState = "resolved"
	NodeStatePending     NodeState = "pending"
	NodeStateUnknownType NodeState = "unknown-type"
	NodeStateCyclic      NodeState = "cyclic"
)

var skipBinderKeys = map[string]bool{
	"weight":            true,
	"@checks":           true,
	"isValid":           true,
	"validationErrors":  true,
	"validationResults": true,
	"validationResult":  true,
}

// ResolvedBinding holds an immutable snapshot of a resolved DynamicValue property on a ComponentNode.
type ResolvedBinding struct {
	Value    any
	Writable bool
	Path     string
	setter   func(any) error
}

// newResolvedBinding creates a read-only ResolvedBinding snapshot.
func newResolvedBinding(val any) *ResolvedBinding {
	return &ResolvedBinding{
		Value:    CloneJSONValue(val),
		Writable: false,
	}
}

// newWritableBinding creates a two-way ResolvedBinding backed by a DataModel path setter.
func newWritableBinding(val any, path string, setter func(any) error) *ResolvedBinding {
	return &ResolvedBinding{
		Value:    CloneJSONValue(val),
		Writable: true,
		Path:     path,
		setter:   setter,
	}
}

// Set writes newVal back into the underlying DataModel when Writable is true.
func (b *ResolvedBinding) Set(newVal any) error {
	if b == nil || !b.Writable || b.setter == nil {
		return NewStateError("binding is not writable")
	}
	return b.setter(newVal)
}

func sameBinding(a, b *ResolvedBinding) bool {
	if a == b {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	if a.Writable != b.Writable {
		return false
	}
	if a.Writable && a.Path != b.Path {
		return false
	}
	return sameBindingValue(a.Value, b.Value)
}

func sameBindingValue(a, b any) bool {
	if _, ok := a.(*ComponentNode); ok {
		return a == b
	}
	if _, ok := b.(*ComponentNode); ok {
		return false
	}
	if actA, ok := a.(*ResolvedAction); ok {
		actB, okB := b.(*ResolvedAction)
		return okB && actA == actB
	}
	if _, ok := b.(*ResolvedAction); ok {
		return false
	}
	return reflect.DeepEqual(a, b)
}

type nodePropsSub struct {
	id     int
	active bool
	fn     func(map[string]any)
}

type nodeDestroySub struct {
	id     int
	active bool
	fn     func()
}

// ComponentNode represents a resolved, mounted node in a SurfaceModel's component hierarchy.
type ComponentNode struct {
	InstanceID        string
	ComponentID       string
	Type              string
	DataPath          string
	Props             map[string]any
	State             NodeState
	Parent            *ComponentNode
	Context           *ComponentContext
	IsValid           bool
	ValidationErrors  []string
	ValidationResults []map[string]any

	metadata          map[string]any
	disposed          bool
	nextSubID         int
	onUpdated         []*nodePropsSub
	onMetadataChanged []*compMetaSub
	onDestroyed       []*nodeDestroySub
}

// Metadata returns a defensive copy of the node's envelope metadata, or nil if unset.
func (n *ComponentNode) Metadata() map[string]any {
	if n == nil || n.metadata == nil {
		return nil
	}
	copied, _ := CloneJSONValue(n.metadata).(map[string]any)
	return copied
}

// Disposed reports whether the ComponentNode has been disposed.
func (n *ComponentNode) Disposed() bool {
	return n != nil && n.disposed
}

// IsPlaceholder reports whether the ComponentNode is in a non-resolved state.
func (n *ComponentNode) IsPlaceholder() bool {
	return n != nil && n.State != NodeStateResolved
}

// SubscribeUpdated registers fn to run when Props change and returns an unsubscribe function.
func (n *ComponentNode) SubscribeUpdated(fn func(map[string]any)) func() {
	if n.disposed {
		return func() {}
	}
	n.nextSubID++
	id := n.nextSubID
	entry := &nodePropsSub{id: id, active: true, fn: fn}
	n.onUpdated = append(n.onUpdated, entry)
	return func() {
		entry.active = false
		for i, sub := range n.onUpdated {
			if sub.id == id {
				n.onUpdated = append(n.onUpdated[:i], n.onUpdated[i+1:]...)
				break
			}
		}
	}
}

// SubscribeMetadataChanged registers fn to run when Metadata changes and returns an unsubscribe function.
func (n *ComponentNode) SubscribeMetadataChanged(fn func(map[string]any)) func() {
	if n.disposed {
		return func() {}
	}
	n.nextSubID++
	id := n.nextSubID
	entry := &compMetaSub{id: id, active: true, fn: fn}
	n.onMetadataChanged = append(n.onMetadataChanged, entry)
	return func() {
		entry.active = false
		for i, sub := range n.onMetadataChanged {
			if sub.id == id {
				n.onMetadataChanged = append(n.onMetadataChanged[:i], n.onMetadataChanged[i+1:]...)
				break
			}
		}
	}
}

// SubscribeDestroyed registers fn to run when the node is disposed and returns an unsubscribe function.
func (n *ComponentNode) SubscribeDestroyed(fn func()) func() {
	if n.disposed {
		return func() {}
	}
	n.nextSubID++
	id := n.nextSubID
	entry := &nodeDestroySub{id: id, active: true, fn: fn}
	n.onDestroyed = append(n.onDestroyed, entry)
	return func() {
		entry.active = false
		for i, sub := range n.onDestroyed {
			if sub.id == id {
				n.onDestroyed = append(n.onDestroyed[:i], n.onDestroyed[i+1:]...)
				break
			}
		}
	}
}

func (n *ComponentNode) setProps(nextProps map[string]any, changed bool) {
	if n.disposed || !changed {
		return
	}
	n.Props = nextProps
	subs := append([]*nodePropsSub(nil), n.onUpdated...)
	for _, sub := range subs {
		if n.disposed {
			break
		}
		if sub.active && sub.fn != nil {
			sub.fn(n.Props)
		}
	}
}

func (n *ComponentNode) setMetadata(nextMeta map[string]any) {
	if n.disposed {
		return
	}
	norm := normalizeComponentMetadata(nextMeta)
	if !reflect.DeepEqual(n.metadata, norm) {
		n.metadata = norm
		subs := append([]*compMetaSub(nil), n.onMetadataChanged...)
		for _, sub := range subs {
			if n.disposed {
				break
			}
			if !sub.active || sub.fn == nil {
				continue
			}
			var arg map[string]any
			if n.metadata != nil {
				arg, _ = CloneJSONValue(n.metadata).(map[string]any)
			}
			sub.fn(arg)
		}
	}
}

func (n *ComponentNode) dispose() {
	if n.disposed {
		return
	}
	n.disposed = true
	for _, sub := range n.onUpdated {
		sub.active = false
	}
	for _, sub := range n.onMetadataChanged {
		sub.active = false
	}
	subs := append([]*nodeDestroySub(nil), n.onDestroyed...)
	n.onDestroyed = nil
	n.onMetadataChanged = nil
	n.onUpdated = nil
	for _, sub := range subs {
		if sub.active && sub.fn != nil {
			sub.fn()
		}
		sub.active = false
	}
}

func escapeIDPart(part string) string {
	var b strings.Builder
	for i := 0; i < len(part); i++ {
		switch part[i] {
		case '~':
			b.WriteString("~0")
		case '#':
			b.WriteString("~1")
		case '[':
			b.WriteString("~2")
		case ']':
			b.WriteString("~3")
		case '>':
			b.WriteString("~4")
		case '@':
			b.WriteString("~5")
		default:
			b.WriteByte(part[i])
		}
	}
	return b.String()
}

func normalizeNodeDataPath(p string) string {
	trimmed := strings.TrimRight(p, "/")
	if trimmed == "" {
		return rootDataPath
	}
	return trimmed
}

func instanceIDFor(compID, dataPath string, occurrence int) string {
	trimmed := normalizeNodeDataPath(dataPath)
	base := escapeIDPart(compID)
	if trimmed != rootDataPath {
		base = fmt.Sprintf("%s-[%s]", base, escapeIDPart(trimmed))
	}
	if occurrence > 1 {
		return fmt.Sprintf("%s#%d", base, occurrence)
	}
	return base
}

type nodeRecord struct {
	node            *ComponentNode
	edgeKey         string
	occurrence      int
	refSpec         ComponentRefSpec
	parent          *ComponentNode
	behavior        *behaviorNode
	componentModel  *ComponentModel
	binder          *GenericBinder
	binderUnsub     func()
	metadataUnsub   func()
	lastBinderProps map[string]any
	childEdges      map[string]*ComponentNode
}

type rootReplacedSub struct {
	id     int
	active bool
	fn     func(*ComponentNode)
}

// NodeResolver projects a SurfaceModel's flat ComponentModel map into a reactive ComponentNode tree.
type NodeResolver struct {
	Surface *SurfaceModel
	Catalog *Catalog
	RootID  string

	records            map[*ComponentNode]*nodeRecord
	nodesByEdge        map[string]*ComponentNode
	nodesByComponentID map[string]map[*ComponentNode]bool
	pendingParents     map[string]map[*ComponentNode]bool
	dispatchedErrors   map[string]map[string]map[string]bool
	modelUnsubs        []func()
	rootRecord         *nodeRecord
	disposed           bool
	nextSubID          int
	onRootReplaced     []*rootReplacedSub
}

// NewNodeResolver constructs a reactive NodeResolver attached to surf.
func NewNodeResolver(surf *SurfaceModel, fallbackCatalog *Catalog) *NodeResolver {
	rootID := rootComponentID
	if surf != nil && surf.RootID != "" {
		rootID = surf.RootID
	}
	nr := &NodeResolver{
		Surface:            surf,
		Catalog:            fallbackCatalog,
		RootID:             rootID,
		records:            map[*ComponentNode]*nodeRecord{},
		nodesByEdge:        map[string]*ComponentNode{},
		nodesByComponentID: map[string]map[*ComponentNode]bool{},
		pendingParents:     map[string]map[*ComponentNode]bool{},
		dispatchedErrors:   map[string]map[string]map[string]bool{},
	}
	if surf != nil && surf.ComponentsModel != nil {
		cm := surf.ComponentsModel
		nr.modelUnsubs = append(nr.modelUnsubs,
			cm.SubscribeCreated(nr.onComponentCreated),
			cm.SubscribeDeleted(nr.onComponentDeleted),
		)
		surf.OnDisposed = append(surf.OnDisposed, nr.Dispose)
		if cm.Get(rootID) != nil {
			nr.buildRoot()
		}
	}
	return nr
}

// Root returns the mounted root ComponentNode, or nil if absent.
func (r *NodeResolver) Root() *ComponentNode {
	if r == nil || r.rootRecord == nil {
		return nil
	}
	return r.rootRecord.node
}

// ActiveNodeCount returns the number of active ComponentNode records in the tree.
func (r *NodeResolver) ActiveNodeCount() int {
	if r == nil {
		return 0
	}
	return len(r.records)
}

// Disposed reports whether the NodeResolver has been disposed.
func (r *NodeResolver) Disposed() bool {
	return r != nil && r.disposed
}

// SubscribeRootReplaced registers fn to run when the root ComponentNode is created, replaced, or cleared.
func (r *NodeResolver) SubscribeRootReplaced(fn func(*ComponentNode)) func() {
	if r.disposed {
		return func() {}
	}
	r.nextSubID++
	id := r.nextSubID
	entry := &rootReplacedSub{id: id, active: true, fn: fn}
	r.onRootReplaced = append(r.onRootReplaced, entry)
	return func() {
		entry.active = false
		for i, sub := range r.onRootReplaced {
			if sub.id == id {
				r.onRootReplaced = append(r.onRootReplaced[:i], r.onRootReplaced[i+1:]...)
				break
			}
		}
	}
}

func (r *NodeResolver) emitRootReplaced(node *ComponentNode) {
	subs := append([]*rootReplacedSub(nil), r.onRootReplaced...)
	for _, sub := range subs {
		if sub.active && sub.fn != nil {
			sub.fn(node)
		}
	}
}

func (r *NodeResolver) dispatchOnce(code, compID, dataPath, msg string) {
	byPath := r.dispatchedErrors[compID]
	if byPath == nil {
		byPath = map[string]map[string]bool{}
		r.dispatchedErrors[compID] = byPath
	}
	codes := byPath[dataPath]
	if codes == nil {
		codes = map[string]bool{}
		byPath[dataPath] = codes
	}
	if codes[code] {
		return
	}
	codes[code] = true
	if r.Surface != nil {
		r.Surface.DispatchError(map[string]any{
			"code":      code,
			"surfaceId": r.Surface.ID,
			"message":   msg,
		})
	}
}

func (r *NodeResolver) clearDispatched(compID, dataPath string) {
	if byPath, ok := r.dispatchedErrors[compID]; ok {
		delete(byPath, dataPath)
		if len(byPath) == 0 {
			delete(r.dispatchedErrors, compID)
		}
	}
}

func (r *NodeResolver) buildRoot() {
	if r.rootRecord != nil {
		return
	}
	esc := escapeIDPart(r.RootID)
	edgeKey := fmt.Sprintf(">%s>%s@/", esc, esc)
	node := r.createNode(r.RootID, rootDataPath, edgeKey, nil, 1)
	r.rootRecord = r.records[node]
	r.emitRootReplaced(node)
}

func (r *NodeResolver) onComponentCreated(comp *ComponentModel) {
	if r.disposed || comp == nil {
		return
	}
	if comp.ID == r.RootID {
		r.reconcileRootOnCreated()
	}
	if waiting, ok := r.pendingParents[comp.ID]; ok {
		delete(r.pendingParents, comp.ID)
		parents := make([]*ComponentNode, 0, len(waiting))
		for p := range waiting {
			parents = append(parents, p)
		}
		// Materialize in deterministic InstanceID order.
		sort.Slice(parents, func(i, j int) bool {
			return parents[i].InstanceID < parents[j].InstanceID
		})
		for _, p := range parents {
			if rec := r.records[p]; rec != nil && !p.Disposed() {
				r.materialize(rec)
			}
		}
	}
}

func (r *NodeResolver) reconcileRootOnCreated() {
	cur := r.Surface.ComponentsModel.Get(r.RootID)
	if r.rootRecord != nil && r.rootRecord.componentModel != cur {
		r.disposeNode(r.rootRecord.node)
		r.rootRecord = nil
		if cur == nil {
			r.emitRootReplaced(nil)
		}
	}
	if cur != nil {
		r.buildRoot()
	}
}

func (r *NodeResolver) onComponentDeleted(compID string) {
	if r.disposed {
		return
	}
	delete(r.dispatchedErrors, compID)
	affected := r.nodesByComponentID[compID]
	if len(affected) == 0 {
		return
	}
	var parents []*ComponentNode
	seen := map[*ComponentNode]bool{}
	rootAffected := false
	for node := range affected {
		rec := r.records[node]
		if rec == nil {
			continue
		}
		if rec.parent != nil {
			if !seen[rec.parent] {
				seen[rec.parent] = true
				parents = append(parents, rec.parent)
			}
		} else {
			rootAffected = true
		}
	}
	sort.Slice(parents, func(i, j int) bool {
		return parents[i].InstanceID < parents[j].InstanceID
	})
	if rootAffected && r.rootRecord != nil {
		model := r.Surface.ComponentsModel.Get(compID)
		if model == nil {
			r.disposeNode(r.rootRecord.node)
			r.rootRecord = nil
			r.emitRootReplaced(nil)
		} else if r.rootRecord.componentModel != model {
			r.disposeNode(r.rootRecord.node)
			r.rootRecord = nil
			r.buildRoot()
		}
	}
	for _, p := range parents {
		if rec := r.records[p]; rec != nil && !p.Disposed() {
			r.materialize(rec)
		}
	}
}

func (r *NodeResolver) registerNode(
	node *ComponentNode,
	edgeKey string,
	parent *ComponentNode,
	occurrence int,
	refSpec ComponentRefSpec,
	beh *behaviorNode,
	compModel *ComponentModel,
	binder *GenericBinder,
) *nodeRecord {
	rec := &nodeRecord{
		node:           node,
		edgeKey:        edgeKey,
		occurrence:     occurrence,
		refSpec:        refSpec,
		parent:         parent,
		behavior:       beh,
		componentModel: compModel,
		binder:         binder,
		childEdges:     map[string]*ComponentNode{},
	}
	r.records[node] = rec
	r.nodesByEdge[edgeKey] = node
	byID := r.nodesByComponentID[node.ComponentID]
	if byID == nil {
		byID = map[*ComponentNode]bool{}
		r.nodesByComponentID[node.ComponentID] = byID
	}
	byID[node] = true
	return rec
}

func (r *NodeResolver) registerPendingParent(compID string, parent *ComponentNode) {
	if parent == nil {
		return
	}
	set := r.pendingParents[compID]
	if set == nil {
		set = map[*ComponentNode]bool{}
		r.pendingParents[compID] = set
	}
	set[parent] = true
}

func (r *NodeResolver) resolveModelCatalog(model *ComponentModel) *Catalog {
	if model != nil && model.Catalog != nil {
		return model.Catalog
	}
	if r.Catalog != nil {
		return r.Catalog
	}
	if r.Surface != nil {
		return r.Surface.Catalog
	}
	return nil
}

func (r *NodeResolver) resolveRefSpec(model *ComponentModel) ComponentRefSpec {
	if model == nil {
		return ComponentRefSpec{}
	}
	cat := r.resolveModelCatalog(model)
	if cat == nil {
		return ComponentRefSpec{}
	}
	if spec, ok := cat.refMap()[model.Type]; ok {
		return spec
	}
	return analyzeChildRefSchema(cat.ResolvedComponentSchema(model.Type), cat.validationSchema())
}

func (r *NodeResolver) createNode(compID, dataPath, edgeKey string, parent *ComponentNode, occurrence int) *ComponentNode {
	normPath := normalizeNodeDataPath(dataPath)
	var model *ComponentModel
	if r.Surface != nil && r.Surface.ComponentsModel != nil {
		model = r.Surface.ComponentsModel.Get(compID)
	}
	if model == nil {
		node := &ComponentNode{
			InstanceID:        instanceIDFor(compID, normPath, occurrence),
			ComponentID:       compID,
			Type:              PlaceholderComponentType,
			DataPath:          normPath,
			Props:             map[string]any{},
			State:             NodeStatePending,
			Parent:            parent,
			IsValid:           true,
			ValidationErrors:  []string{},
			ValidationResults: []map[string]any{},
		}
		r.registerNode(node, edgeKey, parent, occurrence, ComponentRefSpec{}, nil, nil, nil)
		r.registerPendingParent(compID, parent)
		return node
	}

	cat := r.resolveModelCatalog(model)
	var hasAPI bool
	if cat != nil {
		_, hasAPI = cat.components[model.Type]
	}
	if !hasAPI {
		r.dispatchOnce(
			"UNKNOWN_COMPONENT_TYPE",
			model.ID,
			normPath,
			fmt.Sprintf("Component '%s' has unknown type '%s'.", model.ID, model.Type),
		)
		node := &ComponentNode{
			InstanceID:        instanceIDFor(model.ID, normPath, occurrence),
			ComponentID:       model.ID,
			Type:              model.Type,
			DataPath:          normPath,
			Props:             map[string]any{},
			State:             NodeStateUnknownType,
			Parent:            parent,
			IsValid:           true,
			ValidationErrors:  []string{},
			ValidationResults: []map[string]any{},
			metadata:          normalizeComponentMetadata(model.Metadata),
		}
		rec := r.registerNode(node, edgeKey, parent, occurrence, ComponentRefSpec{}, nil, model, nil)
		rec.metadataUnsub = model.SubscribeMetadataChanged(node.setMetadata)
		return node
	}

	r.clearDispatched(model.ID, normPath)
	// Ensure model has an effective catalog attached so GenericBinder can classify schema properties.
	if model.Catalog == nil && cat != nil {
		model.Catalog = cat
	}
	ctx, _ := NewComponentContext(r.Surface, model.ID, normPath)
	binder := NewGenericBinder(ctx, true)
	node := &ComponentNode{
		InstanceID:        instanceIDFor(model.ID, normPath, occurrence),
		ComponentID:       model.ID,
		Type:              model.Type,
		DataPath:          normPath,
		Props:             map[string]any{},
		State:             NodeStateResolved,
		Parent:            parent,
		Context:           ctx,
		IsValid:           true,
		ValidationErrors:  []string{},
		ValidationResults: []map[string]any{},
		metadata:          normalizeComponentMetadata(model.Metadata),
	}
	rec := r.registerNode(node, edgeKey, parent, occurrence, r.resolveRefSpec(model), binder.behaviorTree, model, binder)
	rec.binderUnsub = binder.Subscribe(func(raw map[string]any) {
		rec.lastBinderProps = raw
		r.materialize(rec)
	})
	rec.metadataUnsub = model.SubscribeMetadataChanged(node.setMetadata)
	return node
}

func (r *NodeResolver) isCyclic(compID, dataPath string, parent *ComponentNode) bool {
	for cur := parent; cur != nil; {
		if cur.ComponentID == compID && cur.DataPath == dataPath {
			return true
		}
		rec := r.records[cur]
		if rec == nil {
			break
		}
		cur = rec.parent
	}
	return false
}

func (r *NodeResolver) isExistingUpToDate(
	existing *ComponentNode,
	rec *nodeRecord,
	compID, dataPath string,
	occurrence int,
	model *ComponentModel,
) bool {
	if rec == nil || existing.ComponentID != compID || existing.DataPath != dataPath || rec.occurrence != occurrence {
		return false
	}
	hasAPI := false
	if model != nil {
		if cat := r.resolveModelCatalog(model); cat != nil {
			_, hasAPI = cat.components[model.Type]
		}
	}
	if existing.IsPlaceholder() {
		return (model == nil && existing.State == NodeStatePending) ||
			(model != nil && !hasAPI && existing.State == NodeStateUnknownType && rec.componentModel == model)
	}
	return model != nil && existing.Type == model.Type && rec.componentModel == model
}

func (r *NodeResolver) childNode(compID, dataPath, edgeKey string, parent *ComponentNode, occurrence int) *ComponentNode {
	normPath := normalizeNodeDataPath(dataPath)
	existing := r.nodesByEdge[edgeKey]
	var model *ComponentModel
	if r.Surface != nil && r.Surface.ComponentsModel != nil {
		model = r.Surface.ComponentsModel.Get(compID)
	}
	if r.isCyclic(compID, normPath, parent) {
		return r.resolveCyclicChild(existing, model, compID, normPath, edgeKey, parent, occurrence)
	}
	if existing != nil && !existing.Disposed() {
		rec := r.records[existing]
		if r.isExistingUpToDate(existing, rec, compID, normPath, occurrence, model) {
			if existing.State == NodeStatePending {
				r.registerPendingParent(compID, parent)
			}
			return existing
		}
		r.disposeNode(existing)
	}
	return r.createNode(compID, normPath, edgeKey, parent, occurrence)
}

func (r *NodeResolver) resolveCyclicChild(
	existing *ComponentNode,
	model *ComponentModel,
	compID, dataPath, edgeKey string,
	parent *ComponentNode,
	occurrence int,
) *ComponentNode {
	if existing != nil && !existing.Disposed() && existing.State == NodeStateCyclic {
		if rec := r.records[existing]; rec != nil && rec.occurrence == occurrence {
			return existing
		}
	}
	if existing != nil && !existing.Disposed() {
		r.disposeNode(existing)
	}
	r.dispatchOnce(
		"CYCLIC_REFERENCE",
		compID,
		dataPath,
		fmt.Sprintf("Component '%s' at '%s' is cyclic.", compID, dataPath),
	)
	nodeType := PlaceholderComponentType
	if model != nil {
		nodeType = model.Type
	}
	node := &ComponentNode{
		InstanceID:        instanceIDFor(compID, dataPath, occurrence),
		ComponentID:       compID,
		Type:              nodeType,
		DataPath:          dataPath,
		Props:             map[string]any{},
		State:             NodeStateCyclic,
		Parent:            parent,
		IsValid:           true,
		ValidationErrors:  []string{},
		ValidationResults: []map[string]any{},
	}
	r.registerNode(node, edgeKey, parent, occurrence, ComponentRefSpec{}, nil, nil, nil)
	return node
}

func extractNodeValidationFields(binderProps map[string]any) (bool, []string, []map[string]any) {
	isValid := true
	if v, ok := binderProps["isValid"].(bool); ok {
		isValid = v
	}
	errs := []string{}
	if rawErrs, ok := binderProps["validationErrors"].([]any); ok {
		for _, item := range rawErrs {
			errs = append(errs, coerceToString(item))
		}
	}
	results := []map[string]any{}
	if rawRes, ok := binderProps["validationResults"].([]any); ok {
		for _, item := range rawRes {
			if m, okM := item.(map[string]any); okM {
				copied, _ := CloneJSONValue(m).(map[string]any)
				results = append(results, copied)
			}
		}
	}
	return isValid, errs, results
}

func (r *NodeResolver) materialize(rec *nodeRecord) {
	if rec == nil || rec.node == nil || rec.node.Disposed() {
		return
	}
	raw := map[string]any{}
	src := rec.lastBinderProps
	if src == nil && rec.binder != nil {
		src = rec.binder.CurrentProps
	}
	for k, v := range src {
		raw[k] = v
	}

	if rec.componentModel != nil && rec.componentModel.Properties != nil {
		modelProps := rec.componentModel.Properties
		for _, k := range rec.refSpec.SingleRefs {
			if !hasKey(modelProps, k) {
				delete(raw, k)
			}
		}
		for _, k := range rec.refSpec.ListRefs {
			if !hasKey(modelProps, k) {
				delete(raw, k)
			}
		}
	}

	isValid, valErrs, valRes := extractNodeValidationFields(raw)
	rec.node.IsValid = isValid
	rec.node.ValidationErrors = valErrs
	rec.node.ValidationResults = valRes

	newEdges := r.resolveAllChildRefs(rec, raw)
	r.cleanupUnreferencedEdges(rec, newEdges)
	rec.childEdges = newEdges

	wrapped, changed := r.wrapAndStabilizeProps(rec, raw)
	rec.node.setProps(wrapped, changed)
}

func getSafeChildList(val any) []any {
	switch typed := val.(type) {
	case []any:
		return typed
	case []string:
		out := make([]any, len(typed))
		for i, s := range typed {
			out[i] = s
		}
		return out
	case map[string]any:
		if expl, okE := typed["explicitList"]; okE {
			return append([]any(nil), getSafeChildList(expl)...)
		}
		return []any{}
	}
	if arr, ok := CloneJSONValue(val).([]any); ok {
		return arr
	}
	if m, ok := CloneJSONValue(val).(map[string]any); ok {
		if expl, okE := m["explicitList"]; okE {
			return append([]any(nil), getSafeChildList(expl)...)
		}
	}
	return []any{}
}

func (r *NodeResolver) resolveAllChildRefs(rec *nodeRecord, nextProps map[string]any) map[string]*ComponentNode {
	newEdges := map[string]*ComponentNode{}
	occurrences := map[string]int{}

	resolveOne := func(slot, compID, path string) *ComponentNode {
		norm := normalizeNodeDataPath(path)
		occKey := fmt.Sprintf("%s@%s", escapeIDPart(compID), escapeIDPart(norm))
		occ := occurrences[occKey] + 1
		occurrences[occKey] = occ
		edgeKey := fmt.Sprintf("%s>%s>%s#%d", rec.edgeKey, slot, occKey, occ)
		child := r.childNode(compID, norm, edgeKey, rec.node, occ)
		newEdges[edgeKey] = child
		return child
	}

	singleKeys := append([]string(nil), rec.refSpec.SingleRefs...)
	sort.Strings(singleKeys)
	for _, key := range singleKeys {
		if cid, ok := nextProps[key].(string); ok && cid != "" {
			nextProps[key] = resolveOne(escapeIDPart(key), cid, rec.node.DataPath)
		}
	}

	listKeys := append([]string(nil), rec.refSpec.ListRefs...)
	sort.Strings(listKeys)
	for _, key := range listKeys {
		if subKeys, hasNested := rec.refSpec.NestedSingleRefs[key]; hasNested && len(subKeys) > 0 {
			arr, ok := CloneJSONValue(nextProps[key]).([]any)
			if !ok {
				continue
			}
			sortedSub := append([]string(nil), subKeys...)
			sort.Strings(sortedSub)
			escKey := escapeIDPart(key)
			outList := make([]any, len(arr))
			for idx, item := range arr {
				im, isMap := item.(map[string]any)
				if !isMap {
					outList[idx] = item
					continue
				}
				entry := make(map[string]any, len(im))
				for k, v := range im {
					entry[k] = v
				}
				resolvedAny := false
				for _, subK := range sortedSub {
					if cid, okC := entry[subK].(string); okC && cid != "" {
						slot := fmt.Sprintf("%s[%d].%s", escKey, idx, escapeIDPart(subK))
						entry[subK] = resolveOne(slot, cid, rec.node.DataPath)
						resolvedAny = true
					}
				}
				if resolvedAny {
					outList[idx] = entry
				} else {
					outList[idx] = item
				}
			}
			nextProps[key] = outList
			continue
		}

		if !hasKey(nextProps, key) {
			continue
		}
		safeList := getSafeChildList(nextProps[key])
		slot := escapeIDPart(key)
		resolvedItems := make([]any, len(safeList))
		for i, item := range safeList {
			if cid, okS := item.(string); okS && cid != "" {
				resolvedItems[i] = resolveOne(slot, cid, rec.node.DataPath)
			} else if im, okM := item.(map[string]any); okM {
				idStr, okID := im["id"].(string)
				bpStr, okBP := im["basePath"].(string)
				if okID && okBP {
					resolvedItems[i] = resolveOne(slot, idStr, bpStr)
				} else if cidStr, okCID := im["componentId"].(string); okCID && cidStr != "" {
					resolvedItems[i] = resolveOne(slot, cidStr, rec.node.DataPath)
				} else {
					resolvedItems[i] = item
				}
			} else {
				resolvedItems[i] = item
			}
		}
		nextProps[key] = resolvedItems
	}

	return newEdges
}

func (r *NodeResolver) cleanupUnreferencedEdges(rec *nodeRecord, newEdges map[string]*ComponentNode) {
	for edgeKey, child := range rec.childEdges {
		if _, kept := newEdges[edgeKey]; kept {
			continue
		}
		r.disposeNode(child)
		if child.IsPlaceholder() {
			stillWaiting := false
			for _, other := range newEdges {
				if other.IsPlaceholder() && other.ComponentID == child.ComponentID {
					stillWaiting = true
					break
				}
			}
			if !stillWaiting {
				if waiting, ok := r.pendingParents[child.ComponentID]; ok {
					delete(waiting, rec.node)
					if len(waiting) == 0 {
						delete(r.pendingParents, child.ComponentID)
					}
				}
			}
		}
	}
}

func extractBindingPath(raw any, atLeastV10 bool) (string, bool) {
	rm, ok := raw.(map[string]any)
	if !ok || hasKey(rm, "componentId") {
		return "", false
	}
	key := "path"
	if atLeastV10 {
		key = "@path"
	}
	s, ok := rm[key].(string)
	return s, ok
}

func wrapDynamicObject(val map[string]any, shape map[string]*behaviorNode, raw any, dctx *DataContext) map[string]any {
	rawMap, _ := raw.(map[string]any)
	out := map[string]any{}
	for k, item := range val {
		if skipBinderKeys[k] {
			continue
		}
		var cb *behaviorNode
		if shape != nil {
			cb = shape[k]
		}
		if k == "checks" && cb != nil && cb.Type == behaviorCheckable {
			continue
		}
		if cb == nil {
			cb = staticBehavior
		}
		var rawChild any
		if rawMap != nil {
			rawChild = rawMap[k]
		}
		out[k] = wrapDynamicValues(item, cb, rawChild, dctx)
	}
	for k, cb := range shape {
		if cb != nil && cb.Type == behaviorDynamic && !hasKey(out, k) {
			out[k] = newResolvedBinding(nil)
		}
	}
	return out
}

func wrapDynamicValues(val any, beh *behaviorNode, raw any, dctx *DataContext) any {
	if _, isNode := val.(*ComponentNode); isNode {
		return val
	}
	if _, isAct := val.(*ResolvedAction); isAct {
		return val
	}
	if beh == nil {
		return val
	}
	switch beh.Type {
	case behaviorDynamic:
		pathStr, ok := extractBindingPath(raw, dctx != nil && dctx.AtLeastV10())
		if !ok {
			return newResolvedBinding(val)
		}
		return newWritableBinding(val, pathStr, func(newVal any) error {
			if dctx == nil {
				return nil
			}
			return dctx.Set(pathStr, newVal)
		})
	case behaviorArray:
		arr, ok := val.([]any)
		if !ok {
			return val
		}
		rawItems, _ := raw.([]any)
		elemB := beh.Element
		if elemB == nil {
			elemB = staticBehavior
		}
		out := make([]any, len(arr))
		for i, item := range arr {
			var rItem any
			if i < len(rawItems) {
				rItem = rawItems[i]
			}
			out[i] = wrapDynamicValues(item, elemB, rItem, dctx)
		}
		return out
	case behaviorObject:
		if m, ok := val.(map[string]any); ok {
			return wrapDynamicObject(m, beh.Shape, raw, dctx)
		}
	}
	return val
}

// stabilizeValue returns (stabilizedValue, isUnchangedFromPrev).
func stabilizeValue(prev, next any) (any, bool) {
	if prevBind, okA := prev.(*ResolvedBinding); okA {
		nextBind, okB := next.(*ResolvedBinding)
		if okB && sameBinding(prevBind, nextBind) {
			return prevBind, true
		}
		return next, false
	}
	if _, ok := next.(*ResolvedBinding); ok {
		return next, false
	}

	if prevNode, okA := prev.(*ComponentNode); okA {
		nextNode, okB := next.(*ComponentNode)
		return next, okB && prevNode == nextNode
	}
	if _, ok := next.(*ComponentNode); ok {
		return next, false
	}

	if prevAct, okA := prev.(*ResolvedAction); okA {
		nextAct, okB := next.(*ResolvedAction)
		return next, okB && prevAct == nextAct
	}
	if _, ok := next.(*ResolvedAction); ok {
		return next, false
	}

	prevSlice, okAS := prev.([]any)
	nextSlice, okBS := next.([]any)
	if okAS && okBS {
		if len(prevSlice) != len(nextSlice) {
			return nextSlice, false
		}
		allSame := true
		out := make([]any, len(nextSlice))
		for i := range nextSlice {
			sv, same := stabilizeValue(prevSlice[i], nextSlice[i])
			out[i] = sv
			if !same {
				allSame = false
			}
		}
		if allSame {
			return prevSlice, true
		}
		return out, false
	}

	prevMap, okAM := prev.(map[string]any)
	nextMap, okBM := next.(map[string]any)
	if okAM && okBM {
		if len(prevMap) != len(nextMap) {
			return nextMap, false
		}
		allSame := true
		out := make(map[string]any, len(nextMap))
		for k, nv := range nextMap {
			pv, exists := prevMap[k]
			if !exists {
				return nextMap, false
			}
			sv, same := stabilizeValue(pv, nv)
			out[k] = sv
			if !same {
				allSame = false
			}
		}
		if allSame {
			return prevMap, true
		}
		return out, false
	}

	if reflect.DeepEqual(prev, next) {
		return prev, true
	}
	return next, false
}

func (r *NodeResolver) wrapAndStabilizeProps(rec *nodeRecord, nextProps map[string]any) (map[string]any, bool) {
	var modelProps map[string]any
	if rec.componentModel != nil {
		modelProps = rec.componentModel.Properties
	}
	dropBareChecks := true
	if r.Surface != nil && r.Surface.ProtocolVersion != "" && IsAtLeastVersion(string(r.Surface.ProtocolVersion), Version1_0) {
		dropBareChecks = false
	}

	unwrappedProps := func() map[string]any {
		out := map[string]any{}
		for k, v := range nextProps {
			if skipBinderKeys[k] || (dropBareChecks && k == "checks") {
				continue
			}
			out[k] = v
		}
		return out
	}

	var wrapped map[string]any
	if rec.behavior != nil && rec.node.Context != nil {
		if wm, ok := wrapDynamicValues(nextProps, rec.behavior, modelProps, rec.node.Context.DataContext).(map[string]any); ok {
			wrapped = wm
		} else {
			wrapped = unwrappedProps()
		}
	} else {
		wrapped = unwrappedProps()
	}

	prev := rec.node.Props
	changed := len(prev) != len(wrapped)
	for k, nv := range wrapped {
		pv, exists := prev[k]
		if !exists {
			changed = true
			continue
		}
		sv, same := stabilizeValue(pv, nv)
		wrapped[k] = sv
		if !same {
			changed = true
		}
	}
	// Note: initial materialization of a newly created resolved node with empty props (`len(prev)==0 && len(wrapped)==0`)
	// keeps `changed == false` so created_emissions starts at 0 after creation!
	return wrapped, changed
}

func (r *NodeResolver) teardownRecord(node *ComponentNode, rec *nodeRecord) {
	children := make([]*ComponentNode, 0, len(rec.childEdges))
	for _, ch := range rec.childEdges {
		children = append(children, ch)
	}
	rec.childEdges = map[string]*ComponentNode{}
	for _, ch := range children {
		r.disposeNode(ch)
	}
	if rec.metadataUnsub != nil {
		rec.metadataUnsub()
		rec.metadataUnsub = nil
	}
	if rec.binderUnsub != nil {
		rec.binderUnsub()
		rec.binderUnsub = nil
	}
	if rec.binder != nil {
		rec.binder.Dispose()
		rec.binder = nil
	}
	if r.nodesByEdge[rec.edgeKey] == node {
		delete(r.nodesByEdge, rec.edgeKey)
	}
}

func (r *NodeResolver) disposeNode(node *ComponentNode) {
	if node == nil || node.Disposed() {
		return
	}
	if rec, ok := r.records[node]; ok {
		delete(r.records, node)
		r.teardownRecord(node, rec)
	}
	if byID, ok := r.nodesByComponentID[node.ComponentID]; ok {
		delete(byID, node)
		if len(byID) == 0 {
			delete(r.nodesByComponentID, node.ComponentID)
		}
	}
	for cid, waiting := range r.pendingParents {
		delete(waiting, node)
		if len(waiting) == 0 {
			delete(r.pendingParents, cid)
		}
	}
	if node.State == NodeStateCyclic {
		r.clearDispatched(node.ComponentID, node.DataPath)
	}
	node.dispose()
}

// Dispose tears down all active ComponentNodes and disconnects SurfaceModel listeners.
func (r *NodeResolver) Dispose() {
	if r == nil || r.disposed {
		return
	}
	r.disposed = true
	for _, u := range r.modelUnsubs {
		u()
	}
	r.modelUnsubs = nil
	nodes := make([]*ComponentNode, 0, len(r.records))
	for n := range r.records {
		nodes = append(nodes, n)
	}
	for _, n := range nodes {
		r.disposeNode(n)
	}
	r.pendingParents = map[string]map[*ComponentNode]bool{}
	r.dispatchedErrors = map[string]map[string]map[string]bool{}
	r.rootRecord = nil
	r.emitRootReplaced(nil)
	for _, sub := range r.onRootReplaced {
		sub.active = false
	}
	r.onRootReplaced = nil
}
