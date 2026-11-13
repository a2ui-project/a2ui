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
	"sort"
	"strings"
)

type compUpdateSub struct {
	id     int
	active bool
	fn     func(*ComponentModel)
}

type compMetaSub struct {
	id     int
	active bool
	fn     func(map[string]any)
}

// ComponentModel holds the state and raw properties of a single component instance on a surface.
type ComponentModel struct {
	ID         string
	Type       string
	Catalog    *Catalog
	Properties map[string]any
	Metadata   map[string]any

	disposed          bool
	nextSubID         int
	onUpdated         []*compUpdateSub
	onMetadataChanged []*compMetaSub
}

// NewComponentModel constructs a ComponentModel with defensive copies of properties and normalized metadata.
func NewComponentModel(id, compType string, catalog *Catalog, props map[string]any, metadata map[string]any) (*ComponentModel, error) {
	if metadata != nil {
		if err := ValidateMetadata(metadata, Version1_0); err != nil {
			return nil, err
		}
	}
	copiedProps := map[string]any{}
	if props != nil {
		if m, ok := CloneJSONValue(props).(map[string]any); ok {
			copiedProps = m
		}
	}
	return &ComponentModel{
		ID:         id,
		Type:       compType,
		Catalog:    catalog,
		Properties: copiedProps,
		Metadata:   normalizeComponentMetadata(metadata),
	}, nil
}

func normalizeComponentMetadata(meta map[string]any) map[string]any {
	if meta == nil {
		return nil
	}
	ext, ok := meta["extensions"].(map[string]any)
	if !ok || len(ext) == 0 {
		return nil
	}
	copiedExt, _ := CloneJSONValue(ext).(map[string]any)
	return map[string]any{"extensions": copiedExt}
}

// ComponentTree returns the wire-shaped map representation of the component.
func (c *ComponentModel) ComponentTree() map[string]any {
	out := make(map[string]any, len(c.Properties)+3)
	for k, v := range c.Properties {
		out[k] = CloneJSONValue(v)
	}
	out["id"] = c.ID
	out["component"] = c.Type
	if len(c.Metadata) > 0 {
		out["@metadata"] = CloneJSONValue(c.Metadata)
	}
	return out
}

// Extensions returns a defensive copy of metadata["extensions"], or nil if unset.
func (c *ComponentModel) Extensions() map[string]any {
	if c.Metadata == nil {
		return nil
	}
	ext, ok := c.Metadata["extensions"].(map[string]any)
	if !ok {
		return nil
	}
	copied, _ := CloneJSONValue(ext).(map[string]any)
	return copied
}

// SetExtension sets a single UAX #31 extension key on the component metadata envelope.
func (c *ComponentModel) SetExtension(key string, val any) error {
	if !IsValidUAX31Identifier(key) {
		return NewValidationErrorf("invalid UAX #31 extension identifier %q in component %q metadata.extensions", key, c.ID)
	}
	ext := c.Extensions()
	if ext == nil {
		ext = map[string]any{}
	}
	ext[key] = CloneJSONValue(val)
	c.Metadata = map[string]any{"extensions": ext}
	c.emitMetadataChanged()
	return nil
}

// RemoveExtension deletes an extension key, collapsing empty metadata to nil.
func (c *ComponentModel) RemoveExtension(key string) {
	ext := c.Extensions()
	if ext == nil {
		return
	}
	if _, exists := ext[key]; !exists {
		return
	}
	delete(ext, key)
	if len(ext) == 0 {
		c.Metadata = nil
	} else {
		c.Metadata = map[string]any{"extensions": ext}
	}
	c.emitMetadataChanged()
}

// ApplyUpdate atomically updates Properties and Metadata, notifying listeners only for fields that changed.
func (c *ComponentModel) ApplyUpdate(newProps map[string]any, newMetadata map[string]any) error {
	if newMetadata != nil {
		if err := ValidateMetadata(newMetadata, Version1_0); err != nil {
			return err
		}
	}
	copiedProps := map[string]any{}
	if newProps != nil {
		if m, ok := CloneJSONValue(newProps).(map[string]any); ok {
			copiedProps = m
		}
	}
	nextMeta := normalizeComponentMetadata(newMetadata)
	propsChanged := !reflect.DeepEqual(c.Properties, copiedProps)
	metaChanged := !reflect.DeepEqual(c.Metadata, nextMeta)
	if propsChanged {
		c.Properties = copiedProps
	}
	if metaChanged {
		c.Metadata = nextMeta
	}
	if propsChanged {
		c.emitUpdated()
	}
	if metaChanged {
		c.emitMetadataChanged()
	}
	return nil
}

// SubscribeUpdated registers fn to be notified when Properties change and returns an unsubscribe function.
func (c *ComponentModel) SubscribeUpdated(fn func(*ComponentModel)) func() {
	if c.disposed {
		return func() {}
	}
	c.nextSubID++
	id := c.nextSubID
	entry := &compUpdateSub{id: id, active: true, fn: fn}
	c.onUpdated = append(c.onUpdated, entry)
	return func() {
		entry.active = false
		for i, sub := range c.onUpdated {
			if sub.id == id {
				c.onUpdated = append(c.onUpdated[:i], c.onUpdated[i+1:]...)
				break
			}
		}
	}
}

// SubscribeMetadataChanged registers fn to be notified when Metadata changes and returns an unsubscribe function.
func (c *ComponentModel) SubscribeMetadataChanged(fn func(map[string]any)) func() {
	if c.disposed {
		return func() {}
	}
	c.nextSubID++
	id := c.nextSubID
	entry := &compMetaSub{id: id, active: true, fn: fn}
	c.onMetadataChanged = append(c.onMetadataChanged, entry)
	return func() {
		entry.active = false
		for i, sub := range c.onMetadataChanged {
			if sub.id == id {
				c.onMetadataChanged = append(c.onMetadataChanged[:i], c.onMetadataChanged[i+1:]...)
				break
			}
		}
	}
}

func (c *ComponentModel) emitUpdated() {
	if c.disposed {
		return
	}
	subs := append([]*compUpdateSub(nil), c.onUpdated...)
	for _, sub := range subs {
		if c.disposed {
			break
		}
		if sub.active && sub.fn != nil {
			sub.fn(c)
		}
	}
}

func (c *ComponentModel) emitMetadataChanged() {
	if c.disposed {
		return
	}
	subs := append([]*compMetaSub(nil), c.onMetadataChanged...)
	for _, sub := range subs {
		if c.disposed {
			break
		}
		if !sub.active || sub.fn == nil {
			continue
		}
		var arg map[string]any
		if c.Metadata != nil {
			arg, _ = CloneJSONValue(c.Metadata).(map[string]any)
		}
		sub.fn(arg)
	}
}

// Dispose clears listeners on the ComponentModel.
func (c *ComponentModel) Dispose() {
	c.disposed = true
	for _, sub := range c.onUpdated {
		sub.active = false
	}
	for _, sub := range c.onMetadataChanged {
		sub.active = false
	}
	c.onUpdated = nil
	c.onMetadataChanged = nil
}

// ChildReferences extracts all structural child references from Properties using the component's catalog ref spec (or structural v0.8 fallback).
func (c *ComponentModel) ChildReferences() []ChildReference {
	if c == nil || len(c.Properties) == 0 {
		return nil
	}
	if c.Catalog != nil {
		refMap := c.Catalog.refMap()
		if spec, ok := refMap[c.Type]; ok {
			if len(spec.SingleRefs) > 0 || len(spec.ListRefs) > 0 {
				return spec.ExtractChildReferences(c.Properties)
			}
			// From v0.9 on, components declared in the catalog without $ref child properties have no children.
			if IsAtLeastVersion(string(c.Catalog.ProtocolVersion()), Version0_9) {
				return nil
			}
		}
	}
	// Structural fallback for unschematized / v0.8 components (never guesses plain scalar string properties).
	keys := make([]string, 0, len(c.Properties))
	for k := range c.Properties {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var out []ChildReference
	for _, k := range keys {
		if k == "id" || k == "component" {
			continue
		}
		v := c.Properties[k]
		if !isV08StructuralChildProp(k, v) {
			continue
		}
		for _, sub := range extractChildRefsFromValue(v) {
			full := k
			if sub.Path != "" {
				full = k + "." + sub.Path
			}
			out = append(out, ChildReference{ID: sub.ID, Path: full})
		}
	}
	return out
}

var v08NonChildProps = map[string]bool{
	"text": true, "title": true, "label": true, "description": true, "icon": true,
	"url": true, "path": true, "value": true, "key": true, "id": true,
	"component": true, "type": true, "variant": true, "size": true, "color": true,
	"action": true, "style": true, "styles": true, "theme": true, "weight": true,
	"align": true, "distribution": true, "disabled": true, "selected": true,
	"usagehint": true, "placeholder": true, "hint": true, "caption": true, "alttext": true,
}

func isV08StructuralChildProp(key string, val any) bool {
	if v08NonChildProps[strings.ToLower(key)] {
		return false
	}
	switch key {
	case "child", "contentChild", "entryPointChild", "componentId",
		"children", "explicitList", "template", "tabs", "tabItems":
		return true
	}
	if strings.HasSuffix(key, "Child") || strings.HasSuffix(key, "Children") ||
		strings.HasSuffix(key, "children") || strings.HasPrefix(key, "child") {
		return true
	}
	switch typed := val.(type) {
	case map[string]any:
		_, hasChild := typed["child"].(string)
		_, hasCID := typed["componentId"].(string)
		_, hasExp := typed["explicitList"]
		_, hasTpl := typed["template"]
		return hasChild || hasCID || hasExp || hasTpl
	case []any:
		for _, item := range typed {
			if m, ok := item.(map[string]any); ok {
				if _, hasChild := m["child"].(string); hasChild {
					return true
				}
				if _, hasCID := m["componentId"].(string); hasCID {
					return true
				}
			}
		}
	}
	return false
}

type compDeleteSub struct {
	id     int
	active bool
	fn     func(string)
}

// SurfaceComponentsModel maintains an ordered map of ComponentModel instances on a surface.
type SurfaceComponentsModel struct {
	DefaultCatalog *Catalog

	byID           map[string]*ComponentModel
	compUnsubs     map[string]func()
	order          []string
	changes        int
	bound          *componentGraphBound
	boundAt        int
	pendingBound   *componentGraphBound
	pendingBoundAt int
	disposed       bool
	nextSubID      int
	onCreated      []*compUpdateSub
	onDeleted      []*compDeleteSub
}

// NewSurfaceComponentsModel constructs an empty SurfaceComponentsModel.
func NewSurfaceComponentsModel() *SurfaceComponentsModel {
	return &SurfaceComponentsModel{
		byID:           make(map[string]*ComponentModel),
		compUnsubs:     make(map[string]func()),
		boundAt:        -1,
		pendingBoundAt: -1,
	}
}

func (m *SurfaceComponentsModel) watchComponent(comp *ComponentModel) {
	if comp == nil {
		return
	}
	if m.compUnsubs == nil {
		m.compUnsubs = make(map[string]func())
	}
	if prev, ok := m.compUnsubs[comp.ID]; ok {
		prev()
		delete(m.compUnsubs, comp.ID)
	}
	m.compUnsubs[comp.ID] = comp.SubscribeUpdated(func(_ *ComponentModel) {
		m.changes++
		m.bound = nil
		m.boundAt = -1
	})
}

func (m *SurfaceComponentsModel) unwatchComponent(id string) {
	if prev, ok := m.compUnsubs[id]; ok {
		prev()
		delete(m.compUnsubs, id)
	}
}

func (m *SurfaceComponentsModel) commitValidatedUpdate() {
	if m.pendingBound != nil && m.changes == m.pendingBoundAt {
		m.bound = m.pendingBound
		m.boundAt = m.changes
	}
	m.pendingBound = nil
	m.pendingBoundAt = -1
}

// SubscribeCreated registers fn to run when a component is added or replaced and returns an unsubscribe function.
func (m *SurfaceComponentsModel) SubscribeCreated(fn func(*ComponentModel)) func() {
	if m.disposed {
		return func() {}
	}
	m.nextSubID++
	id := m.nextSubID
	entry := &compUpdateSub{id: id, active: true, fn: fn}
	m.onCreated = append(m.onCreated, entry)
	return func() {
		entry.active = false
		for i, sub := range m.onCreated {
			if sub.id == id {
				m.onCreated = append(m.onCreated[:i], m.onCreated[i+1:]...)
				break
			}
		}
	}
}

// SubscribeDeleted registers fn to run when a component is removed or replaced and returns an unsubscribe function.
func (m *SurfaceComponentsModel) SubscribeDeleted(fn func(string)) func() {
	if m.disposed {
		return func() {}
	}
	m.nextSubID++
	id := m.nextSubID
	entry := &compDeleteSub{id: id, active: true, fn: fn}
	m.onDeleted = append(m.onDeleted, entry)
	return func() {
		entry.active = false
		for i, sub := range m.onDeleted {
			if sub.id == id {
				m.onDeleted = append(m.onDeleted[:i], m.onDeleted[i+1:]...)
				break
			}
		}
	}
}

func (m *SurfaceComponentsModel) emitCreated(comp *ComponentModel) {
	if m.disposed {
		return
	}
	subs := append([]*compUpdateSub(nil), m.onCreated...)
	for _, sub := range subs {
		if m.disposed {
			break
		}
		if sub.active && sub.fn != nil {
			sub.fn(comp)
		}
	}
}

func (m *SurfaceComponentsModel) emitDeleted(id string) {
	if m.disposed {
		return
	}
	subs := append([]*compDeleteSub(nil), m.onDeleted...)
	for _, sub := range subs {
		if m.disposed {
			break
		}
		if sub.active && sub.fn != nil {
			sub.fn(id)
		}
	}
}

// Keys returns component IDs in insertion/replacement order.
func (m *SurfaceComponentsModel) Keys() []string {
	return append([]string(nil), m.order...)
}

// Get returns the ComponentModel with id, or nil if absent.
func (m *SurfaceComponentsModel) Get(id string) *ComponentModel {
	return m.byID[id]
}

// All returns a map copy of all components on the surface.
func (m *SurfaceComponentsModel) All() map[string]*ComponentModel {
	out := make(map[string]*ComponentModel, len(m.byID))
	for k, v := range m.byID {
		out[k] = v
	}
	return out
}

// Upsert inserts, updates in place (when type and catalog match), or replaces comp on the surface.
func (m *SurfaceComponentsModel) Upsert(comp *ComponentModel) {
	old, exists := m.byID[comp.ID]
	if !exists {
		m.order = append(m.order, comp.ID)
		m.byID[comp.ID] = comp
		m.watchComponent(comp)
		m.changes++
		m.bound = nil
		m.boundAt = -1
		m.emitCreated(comp)
		return
	}
	if old.Type == comp.Type && old.Catalog == comp.Catalog {
		prevChanges := m.changes
		m.bound = nil
		m.boundAt = -1
		_ = old.ApplyUpdate(comp.Properties, comp.Metadata)
		if m.changes == prevChanges {
			m.changes++
		}
		return
	}
	m.unwatchComponent(comp.ID)
	old.Dispose()
	m.byID[comp.ID] = comp
	m.watchComponent(comp)
	m.changes++
	m.bound = nil
	m.boundAt = -1
	m.emitDeleted(comp.ID)
	m.emitCreated(comp)
}

// InsertAt inserts comp at index pos in the ordered component list.
func (m *SurfaceComponentsModel) InsertAt(pos int, comp *ComponentModel) {
	m.Remove(comp.ID)
	if pos < 0 {
		pos = 0
	}
	if pos >= len(m.order) {
		m.order = append(m.order, comp.ID)
	} else {
		m.order = append(m.order[:pos], append([]string{comp.ID}, m.order[pos:]...)...)
	}
	m.byID[comp.ID] = comp
	m.watchComponent(comp)
	m.changes++
	m.bound = nil
	m.boundAt = -1
	m.emitCreated(comp)
}

// Remove deletes the component with id if present.
func (m *SurfaceComponentsModel) Remove(id string) {
	old, exists := m.byID[id]
	if !exists {
		return
	}
	m.unwatchComponent(id)
	delete(m.byID, id)
	old.Dispose()
	for i, k := range m.order {
		if k == id {
			m.order = append(m.order[:i], m.order[i+1:]...)
			break
		}
	}
	m.changes++
	m.bound = nil
	m.boundAt = -1
	m.emitDeleted(id)
}

// Dispose cleans up listeners on the SurfaceComponentsModel and its ComponentModels.
func (m *SurfaceComponentsModel) Dispose() {
	if m == nil || m.disposed {
		return
	}
	m.disposed = true
	for id, unsub := range m.compUnsubs {
		unsub()
		delete(m.compUnsubs, id)
	}
	for _, comp := range m.byID {
		comp.Dispose()
	}
	for _, sub := range m.onCreated {
		sub.active = false
	}
	for _, sub := range m.onDeleted {
		sub.active = false
	}
	m.onCreated = nil
	m.onDeleted = nil
	m.bound = nil
	m.boundAt = -1
	m.pendingBound = nil
	m.pendingBoundAt = -1
}

// SurfaceModel represents an active UI surface managed by a MessageProcessor or RendererState.
type SurfaceModel struct {
	ID                       string
	CatalogID                string
	Catalog                  *Catalog
	ProtocolVersion          ProtocolVersion
	AvailableCatalogs        map[string]*Catalog
	RootID                   string
	Locale                   string
	SendDataModel            bool
	Theme                    map[string]any
	Metadata                 map[string]any
	ComponentsModel          *SurfaceComponentsModel
	DataModel                *DataModel
	MaxAgentCallCacheEntries int

	OnError             []func(map[string]any)
	OnAction            []func(map[string]any)
	OnDisposed          []func()
	AgentCallExecutor   func(call CallFunctionPayload) (any, bool, error)
	AgentFunctionCaller func(call CallFunctionPayload) (*AgentCallFuture, error)

	agentCallCache     map[string]any
	agentCallHistory   []string
	inFlightAgentCalls map[string]*AgentCallFuture
	disposed           bool
}

// NewSurfaceModel constructs a new SurfaceModel.
func NewSurfaceModel(id string, catalogID string, catalog *Catalog) *SurfaceModel {
	var pVer ProtocolVersion
	avail := map[string]*Catalog{}
	if catalog != nil {
		pVer = catalog.ProtocolVersion()
		if catalog.CatalogID() != "" {
			avail[catalog.CatalogID()] = catalog
		}
	}
	if catalogID != "" && catalog != nil {
		avail[catalogID] = catalog
	}
	cm := NewSurfaceComponentsModel()
	cm.DefaultCatalog = catalog
	return &SurfaceModel{
		ID:                       id,
		CatalogID:                catalogID,
		Catalog:                  catalog,
		ProtocolVersion:          pVer,
		AvailableCatalogs:        avail,
		RootID:                   "root",
		Locale:                   "en-US",
		ComponentsModel:          cm,
		DataModel:                NewDataModel(nil),
		MaxAgentCallCacheEntries: 256,
		agentCallCache:           map[string]any{},
	}
}

// ResolveCatalog resolves an explicit catalogID (or nil for the surface default catalog) on this surface.
func (s *SurfaceModel) ResolveCatalog(catalogID *string, subject string) (*Catalog, error) {
	if catalogID == nil {
		if s.Catalog != nil {
			return s.Catalog, nil
		}
		err := NewCatalogErrorf("%s names no catalogId and surface %s has no default catalogId.", subject, s.ID)
		err.SurfaceID = s.ID
		return nil, err
	}
	if s.AvailableCatalogs != nil {
		if cat, ok := s.AvailableCatalogs[*catalogID]; ok && cat != nil {
			return cat, nil
		}
	}
	if s.Catalog != nil && (*catalogID == s.CatalogID || *catalogID == s.Catalog.CatalogID()) {
		return s.Catalog, nil
	}
	err := NewCatalogErrorf("Catalog not found: %s", *catalogID)
	err.SurfaceID = s.ID
	return nil, err
}

func (s *SurfaceModel) getCachedAgentCall(key string) (any, bool) {
	if s.agentCallCache == nil {
		return nil, false
	}
	v, ok := s.agentCallCache[key]
	if !ok {
		return nil, false
	}
	return CloneJSONValue(v), true
}

func (s *SurfaceModel) putCachedAgentCall(key string, val any) {
	if s.MaxAgentCallCacheEntries <= 0 {
		return
	}
	if s.agentCallCache == nil {
		s.agentCallCache = map[string]any{}
	}
	if _, exists := s.agentCallCache[key]; !exists {
		for len(s.agentCallHistory) >= s.MaxAgentCallCacheEntries {
			oldest := s.agentCallHistory[0]
			s.agentCallHistory = s.agentCallHistory[1:]
			delete(s.agentCallCache, oldest)
		}
		s.agentCallHistory = append(s.agentCallHistory, key)
	}
	s.agentCallCache[key] = CloneJSONValue(val)
}

// DispatchError notifies surface error listeners, populating surfaceId when functionCallId is absent.
func (s *SurfaceModel) DispatchError(errBody map[string]any) {
	if s == nil || s.disposed || errBody == nil {
		return
	}
	payload, _ := CloneJSONValue(errBody).(map[string]any)
	if fcID, ok := payload["functionCallId"].(string); ok && fcID != "" {
		delete(payload, "surfaceId")
	} else {
		payload["surfaceId"] = s.ID
	}
	subs := append(([]func(map[string]any))(nil), s.OnError...)
	for _, fn := range subs {
		if s.disposed {
			break
		}
		if fn != nil {
			fn(payload)
		}
	}
}

// Disposed reports whether the surface has been disposed.
func (s *SurfaceModel) Disposed() bool {
	return s != nil && s.disposed
}

// DispatchAction notifies surface action listeners.
func (s *SurfaceModel) DispatchAction(actionMsg map[string]any) {
	if s == nil || s.disposed {
		return
	}
	subs := append(([]func(map[string]any))(nil), s.OnAction...)
	for _, fn := range subs {
		if s.disposed {
			break
		}
		if fn != nil {
			fn(actionMsg)
		}
	}
}

// Dispose cleans up the surface's DataModel and marks it disposed.
func (s *SurfaceModel) Dispose() {
	if s.disposed {
		return
	}
	s.disposed = true
	s.AgentFunctionCaller = nil
	s.inFlightAgentCalls = nil
	s.agentCallCache = nil
	s.agentCallHistory = nil
	if s.DataModel != nil {
		s.DataModel.Dispose()
	}
	disposedSubs := append(([]func())(nil), s.OnDisposed...)
	s.OnDisposed = nil
	s.OnError = nil
	s.OnAction = nil
	for _, fn := range disposedSubs {
		if fn != nil {
			fn()
		}
	}
	if s.ComponentsModel != nil {
		s.ComponentsModel.Dispose()
	}
}

// SurfaceGroupModel manages the collection of active SurfaceModel instances.
type SurfaceGroupModel struct {
	surfaces map[string]*SurfaceModel
	order    []string

	OnError          []func(map[string]any)
	OnAction         []func(map[string]any)
	OnSurfaceCreated []func(*SurfaceModel)
	OnSurfaceDeleted []func(string)
}

// NewSurfaceGroupModel constructs an empty SurfaceGroupModel.
func NewSurfaceGroupModel() *SurfaceGroupModel {
	return &SurfaceGroupModel{surfaces: make(map[string]*SurfaceModel)}
}

// SurfaceIDs returns active surface IDs in creation order.
func (g *SurfaceGroupModel) SurfaceIDs() []string {
	return append([]string(nil), g.order...)
}

// Surface returns the surface with id, or nil if absent.
func (g *SurfaceGroupModel) Surface(id string) *SurfaceModel {
	return g.surfaces[id]
}

// AddSurface adds or replaces surf in the group.
func (g *SurfaceGroupModel) AddSurface(surf *SurfaceModel) {
	_, exists := g.surfaces[surf.ID]
	if !exists {
		g.order = append(g.order, surf.ID)
	}
	g.surfaces[surf.ID] = surf
	surf.OnAction = append(surf.OnAction, func(msg map[string]any) {
		for _, fn := range g.OnAction {
			fn(msg)
		}
	})
	if !exists {
		for _, fn := range g.OnSurfaceCreated {
			fn(surf)
		}
	}
}

// DeleteSurface removes and disposes the surface with id.
func (g *SurfaceGroupModel) DeleteSurface(id string) {
	surf, exists := g.surfaces[id]
	if !exists {
		return
	}
	surf.Dispose()
	delete(g.surfaces, id)
	for i, k := range g.order {
		if k == id {
			g.order = append(g.order[:i], g.order[i+1:]...)
			break
		}
	}
	for _, fn := range g.OnSurfaceDeleted {
		fn(id)
	}
}

// EmitError notifies group error listeners with a mapped renderer error envelope.
func (g *SurfaceGroupModel) EmitError(errMsg map[string]any) {
	for _, fn := range g.OnError {
		fn(errMsg)
	}
}

// Dispose disposes all active surfaces in the group.
func (g *SurfaceGroupModel) Dispose() {
	for _, id := range append([]string(nil), g.order...) {
		g.DeleteSurface(id)
	}
	g.OnError = nil
	g.OnAction = nil
	g.OnSurfaceCreated = nil
	g.OnSurfaceDeleted = nil
}
