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

package agent

import (
	"errors"
	"fmt"
	"maps"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/a2ui-project/a2ui/go/agent/internal/envelope"
	"github.com/a2ui-project/a2ui/go/core"
)

var (
	createActions = []string{"createSurface", "beginRendering"}
	updateActions = []string{"updateComponents", "updateDataModel", "deleteSurface", "surfaceUpdate", "dataModelUpdate"}

	inProgressValidation = core.ValidationConfig{
		RootID:                  "root",
		AllowDanglingReferences: true,
		AllowMissingRoot:        true,
		AllowOrphanComponents:   true,
		AllowUnknownElements:    false,
	}

	jsonPointerIndexRE = regexp.MustCompile(`^(?:0|[1-9][0-9]*)$`)
)

func acceptedWireVersions(pv core.ProtocolVersion) []string {
	switch pv {
	case core.Version0_8:
		return nil
	case core.Version0_9, core.Version0_9_1:
		return []string{"v0.9", "v0.9.1"}
	case core.Version1_0:
		return []string{"1.0"}
	default:
		return []string{pv.WireVersion()}
	}
}

// CheckCatalogs validates that catalogs is non-empty, has unique catalog IDs,
// and targets compatible protocol versions.
func CheckCatalogs(catalogs []*core.Catalog) ([]*core.Catalog, error) {
	if len(catalogs) == 0 {
		return nil, core.NewCatalogError("at least one catalog is required")
	}
	seen := make(map[string]bool, len(catalogs))
	firstPV := catalogs[0].ProtocolVersion()
	for _, cat := range catalogs {
		if cat == nil {
			return nil, core.NewCatalogError("catalog must not be nil")
		}
		cid := cat.CatalogID()
		if seen[cid] {
			return nil, core.NewCatalogErrorf("duplicate catalog ID %q", cid)
		}
		seen[cid] = true
		if !core.AreVersionsCompatible(firstPV, cat.ProtocolVersion()) {
			return nil, core.NewCatalogErrorf(
				"the catalogs target incompatible protocol versions: %q targets %s and %q targets %s",
				catalogs[0].CatalogID(), firstPV, cid, cat.ProtocolVersion(),
			)
		}
	}
	return append([]*core.Catalog(nil), catalogs...), nil
}

// CheckMixedCatalogs validates catalogs via CheckCatalogs and requires A2UI v1.0 or later when multiple catalogs are active.
func CheckMixedCatalogs(catalogs []*core.Catalog) ([]*core.Catalog, error) {
	checked, err := CheckCatalogs(catalogs)
	if err != nil {
		return nil, err
	}
	if len(checked) > 1 && !core.IsAtLeastVersion(string(checked[0].ProtocolVersion()), core.Version1_0) {
		return nil, core.NewCatalogErrorf(
			"several catalogs need A2UI v1.0 or later, but the catalogs target %s",
			checked[0].ProtocolVersion(),
		)
	}
	return checked, nil
}

type baselineComponent struct {
	position   int
	compType   string
	catalog    *core.Catalog
	properties map[string]any
	metadata   map[string]any
}

// RendererState mirrors the surfaces held by a client renderer across one turn (chat)
// or across an entire multi-turn session (canvas), supporting O(delta) undo-log rollback.
// A RendererState is not safe for concurrent use by multiple goroutines.
type RendererState struct {
	catalogs               []*core.Catalog
	protocolVersion        core.ProtocolVersion
	processor              *core.MessageProcessor
	runsCalls              bool
	assumesUnknownSurfaces bool
	surfaceCatalogIDs      map[string]string
	assumed                map[string]bool
	pending                map[string][]core.AgentToRendererMessage
	changed                map[string]map[string]bool
	baseline               map[string]map[string]*baselineComponent
	log                    []func()
	open                   int
	calls                  []core.AgentToRendererMessage
}

// NewRendererState constructs an empty RendererState for catalogs.
func NewRendererState(catalogs []*core.Catalog) (*RendererState, error) {
	checked, err := CheckCatalogs(catalogs)
	if err != nil {
		return nil, err
	}
	cfg := inProgressValidation
	proc, err := core.NewMessageProcessor(checked, &core.MessageProcessorOptions{
		ValidationConfig: &cfg,
	})
	if err != nil {
		return nil, err
	}
	return &RendererState{
		catalogs:        checked,
		protocolVersion: checked[0].ProtocolVersion(),
		processor:       proc,
		assumed:         make(map[string]bool),
		pending:         make(map[string][]core.AgentToRendererMessage),
		changed:         make(map[string]map[string]bool),
		baseline:        make(map[string]map[string]*baselineComponent),
	}, nil
}

// RendererStateOf creates a RendererState backed directly by an existing renderer MessageProcessor.
func RendererStateOf(processor *core.MessageProcessor) (*RendererState, error) {
	if processor == nil {
		return nil, core.NewCatalogError("message processor must not be nil")
	}
	checked, err := CheckCatalogs(processor.Catalogs)
	if err != nil {
		return nil, err
	}
	return &RendererState{
		catalogs:        checked,
		protocolVersion: checked[0].ProtocolVersion(),
		processor:       processor,
		runsCalls:       true,
		assumed:         make(map[string]bool),
		pending:         make(map[string][]core.AgentToRendererMessage),
		changed:         make(map[string]map[string]bool),
		baseline:        make(map[string]map[string]*baselineComponent),
	}, nil
}

// Catalogs returns a copy of the active catalogs in priority order.
func (s *RendererState) Catalogs() []*core.Catalog {
	return append([]*core.Catalog(nil), s.catalogs...)
}

// SurfaceIDs returns the IDs of active surfaces currently held in the state.
func (s *RendererState) SurfaceIDs() []string {
	return s.processor.Model.SurfaceIDs()
}

// Surface returns the SurfaceModel for surfaceID, or nil if absent.
func (s *RendererState) Surface(surfaceID string) *core.SurfaceModel {
	return s.processor.Model.Surface(surfaceID)
}

// Apply validates and applies payload atomically, returning touched surface IDs in first-seen order.
func (s *RendererState) Apply(payload []core.AgentToRendererMessage) ([]string, error) {
	messages := make([]core.AgentToRendererMessage, len(payload))
	for i, msg := range payload {
		if msg == nil {
			return nil, core.NewValidationErrorf("Message %d is not a JSON object.", i)
		}
		cloned := msg.Clone()
		if err := s.checkMessage(cloned, i); err != nil {
			return nil, err
		}
		messages[i] = cloned
	}

	var touchedOrder []string
	touchedSeen := make(map[string]bool)
	err := s.frame(func() error {
		for idx := range messages {
			sid, hasSID, applyErr := s.applyMessage(messages, idx)
			if applyErr != nil {
				return applyErr
			}
			if hasSID && !touchedSeen[sid] {
				touchedSeen[sid] = true
				touchedOrder = append(touchedOrder, sid)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return touchedOrder, nil
}

// CheckTopology checks root presence, dangling references, and reachability on surfaceIDs.
func (s *RendererState) CheckTopology(surfaceIDs []string) error {
	dedup := dedupStrings(surfaceIDs)
	for _, sid := range dedup {
		if s.assumed[sid] {
			if !s.assumesUnknownSurfaces {
				return core.NewIntegrityErrorf("Surface %q received updates but no beginRendering.", sid)
			}
			continue
		}
		surface := s.processor.Model.Surface(sid)
		if surface == nil {
			continue
		}
		components := surface.ComponentsModel.All()
		if len(components) == 0 {
			continue
		}
		rootID := surface.RootID
		if rootID == "" {
			rootID = "root"
		}
		cfg := core.StrictValidation()
		cfg.RootID = rootID
		cfg.AllowOrphanComponents = true

		if err := asValidationError(core.ValidateComponentIntegrity(components, rootID, cfg)); err != nil {
			return err
		}
		reachable, err := core.AnalyzeTopology(components, rootID, cfg)
		if err != nil {
			return asValidationError(err)
		}

		if changedSet := s.changed[sid]; len(changedSet) > 0 {
			var unreachable []string
			for cid := range changedSet {
				if _, exists := components[cid]; exists && !reachable[cid] {
					unreachable = append(unreachable, cid)
				}
			}
			if len(unreachable) > 0 {
				sort.Strings(unreachable)
				return core.NewIntegrityErrorf("Component '%s' is not reachable from '%s'", unreachable[0], rootID)
			}
		}
	}

	var checkedIDs []string
	for _, sid := range dedup {
		if !s.assumed[sid] {
			checkedIDs = append(checkedIDs, sid)
		}
	}
	s.MarkChecked(checkedIDs)
	return nil
}

// MarkChecked clears per-turn changed-component tracking on surfaceIDs.
func (s *RendererState) MarkChecked(surfaceIDs []string) {
	for _, sid := range dedupStrings(surfaceIDs) {
		s.forgetChanged(sid)
	}
}

// DropProvisionalComponent reverts a provisional component ID superseded during progressive streaming.
func (s *RendererState) DropProvisionalComponent(surfaceID, componentID string) {
	surface := s.processor.Model.Surface(surfaceID)
	if surface == nil {
		return
	}
	baseMap, hasBaseMap := s.baseline[surfaceID]
	if !hasBaseMap {
		return
	}
	baseEntry, tracked := baseMap[componentID]
	if !tracked {
		return
	}
	delete(baseMap, componentID)
	s.record(func() {
		baseMap[componentID] = baseEntry
	})

	cm := surface.ComponentsModel
	if existing := cm.Get(componentID); existing != nil {
		pos := indexOfKey(cm.Keys(), componentID)
		savedType := existing.Type
		savedCatalog := existing.Catalog
		savedProps, _ := core.CloneJSONValue(existing.Properties).(map[string]any)
		savedMeta, _ := core.CloneJSONValue(existing.Metadata).(map[string]any)
		cm.Remove(componentID)
		if baseEntry != nil {
			cm.InsertAt(baseEntry.position, restoreComponentModel(
				componentID,
				baseEntry.compType,
				baseEntry.catalog,
				baseEntry.properties,
				baseEntry.metadata,
			))
		}
		s.record(func() {
			if surf := s.processor.Model.Surface(surfaceID); surf != nil {
				surf.ComponentsModel.Remove(componentID)
				surf.ComponentsModel.InsertAt(pos, restoreComponentModel(
					componentID,
					savedType,
					savedCatalog,
					savedProps,
					savedMeta,
				))
			}
		})
	}

	if changedSet := s.changed[surfaceID]; changedSet != nil && changedSet[componentID] {
		delete(changedSet, componentID)
		s.record(func() {
			changedSet[componentID] = true
		})
	}
}

// Transaction executes fn and rolls back all state mutations if fn returns a non-nil error.
func (s *RendererState) Transaction(fn func() error) error {
	return s.frame(fn)
}

// ValidatePayload checks a standalone turn payload against catalogs, assuming pre-existing surfaces for updates without createSurface.
func ValidatePayload(catalogs []*core.Catalog, payload []core.AgentToRendererMessage) error {
	return ValidatePayloadWithSurfaceCatalogs(catalogs, payload, nil)
}

// ValidatePayloadWithSurfaceCatalogs checks a standalone turn payload against catalogs using optional known surface catalog IDs.
func ValidatePayloadWithSurfaceCatalogs(
	catalogs []*core.Catalog,
	payload []core.AgentToRendererMessage,
	surfaceCatalogIDs map[string]string,
) error {
	state, err := NewRendererState(catalogs)
	if err != nil {
		return err
	}
	state.assumesUnknownSurfaces = true
	if len(surfaceCatalogIDs) > 0 {
		state.surfaceCatalogIDs = make(map[string]string, len(surfaceCatalogIDs))
		for k, v := range surfaceCatalogIDs {
			state.surfaceCatalogIDs[k] = v
		}
	}
	touched, err := state.Apply(payload)
	if err != nil {
		return err
	}
	return state.CheckTopology(touched)
}

func (s *RendererState) frame(fn func() error) (retErr error) {
	mark := len(s.log)
	s.open++
	defer func() {
		if r := recover(); r != nil {
			s.revert(mark)
			s.open--
			if s.open == 0 {
				s.log = s.log[:0]
			}
			panic(r)
		}
		if retErr != nil {
			s.revert(mark)
		}
		s.open--
		if s.open == 0 {
			s.log = s.log[:0]
			if retErr == nil && len(s.calls) > 0 {
				calls := append([]core.AgentToRendererMessage(nil), s.calls...)
				s.calls = s.calls[:0]
				retErr = s.processUnlogged(calls)
			}
		}
	}()
	return fn()
}

func (s *RendererState) revert(mark int) {
	for len(s.log) > mark {
		idx := len(s.log) - 1
		undo := s.log[idx]
		s.log = s.log[:idx]
		safelyRunUndo(undo)
	}
}

func safelyRunUndo(undo func()) {
	if undo == nil {
		return
	}
	defer func() { _ = recover() }()
	undo()
}

func (s *RendererState) record(undo func()) {
	if s.open > 0 && undo != nil {
		s.log = append(s.log, undo)
	}
}

func (s *RendererState) setAssumed(surfaceID string, assumed bool) {
	was := s.assumed[surfaceID]
	if was == assumed {
		return
	}
	if assumed {
		s.assumed[surfaceID] = true
		s.record(func() { delete(s.assumed, surfaceID) })
	} else {
		delete(s.assumed, surfaceID)
		s.record(func() { s.assumed[surfaceID] = true })
	}
}

func (s *RendererState) setPending(surfaceID string, pending []core.AgentToRendererMessage) []core.AgentToRendererMessage {
	previous, hadPrev := s.pending[surfaceID]
	delete(s.pending, surfaceID)
	if pending != nil {
		s.pending[surfaceID] = pending
	}
	s.record(func() {
		if !hadPrev {
			delete(s.pending, surfaceID)
		} else {
			s.pending[surfaceID] = previous
		}
	})
	return previous
}

func (s *RendererState) bufferPending(surfaceID string, message core.AgentToRendererMessage) {
	s.pending[surfaceID] = append(s.pending[surfaceID], message)
	s.record(func() {
		cur := s.pending[surfaceID]
		if len(cur) > 0 {
			s.pending[surfaceID] = cur[:len(cur)-1]
		}
	})
}

func (s *RendererState) noteBaseline(surfaceID string, compIDs map[string]bool) {
	if len(compIDs) == 0 {
		return
	}
	baseMap, exists := s.baseline[surfaceID]
	if !exists {
		baseMap = make(map[string]*baselineComponent)
		s.baseline[surfaceID] = baseMap
		s.record(func() { delete(s.baseline, surfaceID) })
	}
	var unseen []string
	for cid := range compIDs {
		if _, seen := baseMap[cid]; !seen {
			unseen = append(unseen, cid)
		}
	}
	if len(unseen) == 0 {
		return
	}

	var cm *core.SurfaceComponentsModel
	if !s.assumed[surfaceID] {
		if surf := s.processor.Model.Surface(surfaceID); surf != nil {
			cm = surf.ComponentsModel
		}
	}
	positions := make(map[string]int)
	if cm != nil {
		wanted := make(map[string]bool)
		for _, cid := range unseen {
			if cm.Get(cid) != nil {
				wanted[cid] = true
			}
		}
		if len(wanted) > 0 {
			for idx, cid := range cm.Keys() {
				if wanted[cid] {
					positions[cid] = idx
				}
			}
		}
	}
	for _, cid := range unseen {
		var existing *core.ComponentModel
		if cm != nil {
			existing = cm.Get(cid)
		}
		if existing == nil {
			baseMap[cid] = nil
		} else {
			pos, hasPos := positions[cid]
			if !hasPos {
				pos = math.MaxInt
			}
			copiedProps, _ := core.CloneJSONValue(existing.Properties).(map[string]any)
			copiedMeta, _ := core.CloneJSONValue(existing.Metadata).(map[string]any)
			baseMap[cid] = &baselineComponent{
				position:   pos,
				compType:   existing.Type,
				catalog:    existing.Catalog,
				properties: copiedProps,
				metadata:   copiedMeta,
			}
		}
	}
	s.record(func() {
		for _, cid := range unseen {
			delete(baseMap, cid)
		}
	})
}

func (s *RendererState) noteChanged(surfaceID string, compIDs map[string]bool) {
	changedSet, exists := s.changed[surfaceID]
	if !exists {
		changedSet = make(map[string]bool)
		s.changed[surfaceID] = changedSet
		s.record(func() { delete(s.changed, surfaceID) })
	}
	var added []string
	for cid := range compIDs {
		if !changedSet[cid] {
			changedSet[cid] = true
			added = append(added, cid)
		}
	}
	if len(added) > 0 {
		s.record(func() {
			for _, cid := range added {
				delete(changedSet, cid)
			}
		})
	}
}

func (s *RendererState) forgetChanged(surfaceID string) {
	if changedSet, exists := s.changed[surfaceID]; exists {
		delete(s.changed, surfaceID)
		s.record(func() { s.changed[surfaceID] = changedSet })
	}
	if baseMap, exists := s.baseline[surfaceID]; exists {
		delete(s.baseline, surfaceID)
		s.record(func() { s.baseline[surfaceID] = baseMap })
	}
}

func (s *RendererState) holdCall(msg core.AgentToRendererMessage) {
	s.calls = append(s.calls, msg)
	s.record(func() {
		if len(s.calls) > 0 {
			s.calls = s.calls[:len(s.calls)-1]
		}
	})
}

func (s *RendererState) applyMessage(payload []core.AgentToRendererMessage, index int) (string, bool, error) {
	msg := payload[index]
	if _, isCall := msg["callRendererFunction"]; isCall {
		if err := s.checkRendererFunctionCall(payload, index); err != nil {
			return "", false, err
		}
		if s.runsCalls {
			s.holdCall(msg)
		}
		return "", false, nil
	}

	surfaceID, hasTarget, creates := messageTarget(msg)
	if !hasTarget {
		if err := s.processLogged([]core.AgentToRendererMessage{msg}); err != nil {
			return "", false, err
		}
		return "", false, nil
	}

	_, isDelete := msg["deleteSurface"]
	var compIDs map[string]bool
	if !isDelete {
		compIDs = messageComponentIDs(msg)
	}
	if len(compIDs) > 0 {
		s.noteBaseline(surfaceID, compIDs)
	}

	if creates {
		pending := s.setPending(surfaceID, nil)
		if pending != nil {
			s.deleteSurfaceLogged(surfaceID)
			s.setAssumed(surfaceID, false)
			batch := make([]core.AgentToRendererMessage, 0, 1+len(pending))
			batch = append(batch, msg)
			batch = append(batch, pending...)
			if err := s.processLogged(batch); err != nil {
				return "", false, err
			}
		} else {
			if err := s.processLogged([]core.AgentToRendererMessage{msg}); err != nil {
				return "", false, err
			}
		}
	} else if isDelete {
		if err := s.processLogged([]core.AgentToRendererMessage{msg}); err != nil {
			return "", false, err
		}
		s.setAssumed(surfaceID, false)
		s.setPending(surfaceID, nil)
		s.forgetChanged(surfaceID)
	} else if s.processor.Model.Surface(surfaceID) == nil && s.shouldAssume(surfaceID, payload, index) {
		if err := s.assumeSurface(surfaceID, payload, index); err != nil {
			return "", false, err
		}
	} else {
		if err := s.processLogged([]core.AgentToRendererMessage{msg}); err != nil {
			return "", false, err
		}
		if _, hasPending := s.pending[surfaceID]; hasPending {
			s.bufferPending(surfaceID, msg)
		}
	}

	if len(compIDs) > 0 {
		s.noteChanged(surfaceID, compIDs)
	}
	return surfaceID, true, nil
}

func (s *RendererState) processLogged(messages []core.AgentToRendererMessage) error {
	for _, msg := range messages {
		undo := s.undoFor(msg)
		if err := s.processUnlogged([]core.AgentToRendererMessage{msg}); err != nil {
			safelyRunUndo(undo)
			return err
		}
		s.record(undo)
	}
	return nil
}

func (s *RendererState) processUnlogged(messages []core.AgentToRendererMessage) error {
	cfg := inProgressValidation
	err := s.processor.ProcessMessages(messages, &core.ExecutionContext{
		ValidationConfig: &cfg,
	})
	return asValidationError(err)
}

func (s *RendererState) deleteSurfaceLogged(surfaceID string) {
	surf := s.processor.Model.Surface(surfaceID)
	if surf == nil {
		return
	}
	restore := buildSurfaceRestorer(surf)
	s.processor.Model.DeleteSurface(surfaceID)
	s.record(func() {
		if s.processor.Model.Surface(surfaceID) == nil {
			s.processor.Model.AddSurface(restore())
		}
	})
}

func (s *RendererState) undoFor(msg core.AgentToRendererMessage) func() {
	model := s.processor.Model
	for _, createKey := range createActions {
		if body, ok := msg[createKey].(map[string]any); ok {
			// An empty surfaceId is a surface ID like any other to the processor, so
			// creating it must be undone too.
			sid, isString := body["surfaceId"].(string)
			if !isString || model.Surface(sid) != nil {
				return nil
			}
			return func() {
				model.DeleteSurface(sid)
			}
		}
	}
	if body, ok := msg["deleteSurface"].(map[string]any); ok {
		sid, _ := body["surfaceId"].(string)
		surf := model.Surface(sid)
		if surf == nil {
			return nil
		}
		restore := buildSurfaceRestorer(surf)
		return func() {
			if model.Surface(sid) == nil {
				model.AddSurface(restore())
			}
		}
	}
	for _, compKey := range []string{"updateComponents", "surfaceUpdate"} {
		if body, ok := msg[compKey].(map[string]any); ok {
			return s.componentsRestorer(body)
		}
	}
	if body, ok := msg["updateDataModel"].(map[string]any); ok {
		return s.dataModelRestorer(body)
	}
	if body, ok := msg["dataModelUpdate"].(map[string]any); ok {
		sid, _ := body["surfaceId"].(string)
		surf := model.Surface(sid)
		if surf == nil {
			return nil
		}
		rootVal, _, _ := surf.DataModel.Get("/")
		return func() {
			if cur := model.Surface(sid); cur != nil {
				_ = cur.DataModel.Set("/", rootVal)
			}
		}
	}
	return nil
}

type savedComponentEntry struct {
	id       string
	existing *core.ComponentModel
	copyProp map[string]any
	copyMeta map[string]any
}

func (s *RendererState) componentsRestorer(body map[string]any) func() {
	model := s.processor.Model
	sid, ok := body["surfaceId"].(string)
	if !ok {
		return nil
	}
	rawComps, ok := normalizedComponentSlice(body["components"])
	if !ok {
		return nil
	}
	surface := model.Surface(sid)
	if surface == nil {
		return nil
	}
	cm := surface.ComponentsModel
	var previous []savedComponentEntry
	seen := make(map[string]bool)
	replaced := make(map[string]bool)

	for _, rawComp := range rawComps {
		compMap, ok := rawComp.(map[string]any)
		if !ok {
			continue
		}
		cid, ok := compMap["id"].(string)
		if !ok || seen[cid] {
			continue
		}
		seen[cid] = true
		existing := cm.Get(cid)
		var copiedProps map[string]any
		var copiedMeta map[string]any
		if existing != nil {
			copiedProps, _ = core.CloneJSONValue(existing.Properties).(map[string]any)
			copiedMeta, _ = core.CloneJSONValue(existing.Metadata).(map[string]any)
			if s.replacesComponent(compMap, existing, surface) {
				replaced[cid] = true
			}
		}
		previous = append(previous, savedComponentEntry{
			id:       cid,
			existing: existing,
			copyProp: copiedProps,
			copyMeta: copiedMeta,
		})
	}
	if len(previous) == 0 {
		return nil
	}

	positions := make(map[string]int)
	if len(replaced) > 0 {
		for idx, cid := range cm.Keys() {
			if replaced[cid] {
				positions[cid] = idx
			}
		}
	}

	return func() {
		surf := model.Surface(sid)
		if surf == nil {
			return
		}
		curCM := surf.ComponentsModel
		type posComp struct {
			pos  int
			comp *core.ComponentModel
		}
		var restored []posComp
		for i := len(previous) - 1; i >= 0; i-- {
			entry := previous[i]
			current := curCM.Get(entry.id)
			if entry.existing == nil {
				curCM.Remove(entry.id)
			} else if current != nil && current.Type == entry.existing.Type && current.Catalog == entry.existing.Catalog {
				_ = current.ApplyUpdate(entry.copyProp, entry.copyMeta)
			} else {
				curCM.Remove(entry.id)
				pos, hasPos := positions[entry.id]
				if !hasPos {
					pos = math.MaxInt
				}
				restored = append(restored, posComp{
					pos: pos,
					comp: restoreComponentModel(
						entry.id,
						entry.existing.Type,
						entry.existing.Catalog,
						entry.copyProp,
						entry.copyMeta,
					),
				})
			}
		}
		sort.Slice(restored, func(i, j int) bool { return restored[i].pos < restored[j].pos })
		for _, item := range restored {
			curCM.InsertAt(item.pos, item.comp)
		}
	}
}

func (s *RendererState) replacesComponent(update map[string]any, existing *core.ComponentModel, surface *core.SurfaceModel) bool {
	newType, _ := update["component"].(string)
	if newType != "" && newType != existing.Type {
		return true
	}
	atLeastV1 := core.IsAtLeastVersion(string(s.protocolVersion), core.Version1_0)
	// From v1.0 the override is @catalogId. A bare catalogId is the legacy override
	// unless the surface's default catalog declares it as a property.
	var custom map[string]bool
	_, hasAtCatID := update["@catalogId"]
	if _, hasBareCatID := update["catalogId"]; atLeastV1 && !hasAtCatID && hasBareCatID && surface.Catalog != nil {
		compType := newType
		if compType == "" {
			compType = existing.Type
		}
		custom = surface.Catalog.CustomEnvelopeProperties(compType)
	}
	if rawCatID := envelope.Value(update, "catalogId", atLeastV1, custom); rawCatID != nil {
		if cid, ok := rawCatID.(string); ok && (cid != "" || atLeastV1) {
			existingCID := ""
			if existing.Catalog != nil {
				existingCID = existing.Catalog.CatalogID()
			}
			return cid != existingCID
		}
	}
	if !atLeastV1 {
		return false
	}
	return existing.Catalog != surface.Catalog
}

func (s *RendererState) dataModelRestorer(body map[string]any) func() {
	model := s.processor.Model
	sid, ok := body["surfaceId"].(string)
	if !ok {
		return nil
	}
	surface := model.Surface(sid)
	if surface == nil {
		return nil
	}
	pathStr := "/"
	if p, ok := body["path"].(string); ok && p != "" {
		pathStr = p
	}
	tokens := pointerTokens(pathStr)
	rootVal, _, _ := surface.DataModel.Get("/")
	if len(tokens) == 0 {
		return func() {
			if cur := model.Surface(sid); cur != nil {
				_ = cur.DataModel.Set("/", rootVal)
			}
		}
	}

	parent := rootVal
	for depth, token := range tokens {
		exists, child := containerChild(parent, token)
		if exists && depth < len(tokens)-1 && isJSONContainer(child) {
			parent = child
			continue
		}
		if !isJSONContainer(parent) {
			return nil
		}
		parentTokens := append([]string(nil), tokens[:depth]...)
		var listLen int
		if arr, isArr := parent.([]any); isArr {
			listLen = len(arr)
		}
		savedChild := core.CloneJSONValue(child)
		savedParent := core.CloneJSONValue(parent)
		return func() {
			cur := model.Surface(sid)
			if cur == nil {
				return
			}
			parentPtr := joinPointer(parentTokens)
			if len(parentTokens) == 0 {
				curRoot, _, _ := cur.DataModel.Get("/")
				if m, ok := curRoot.(map[string]any); ok {
					if exists {
						m[token] = savedChild
					} else {
						delete(m, token)
					}
					_ = cur.DataModel.Set("/", m)
					return
				}
				_ = cur.DataModel.Set("/", savedParent)
				return
			}
			curContainer, ok, _ := cur.DataModel.Get(parentPtr)
			if !ok || !isJSONContainer(curContainer) {
				_ = cur.DataModel.Set(parentPtr, savedParent)
				return
			}
			switch c := curContainer.(type) {
			case map[string]any:
				if exists {
					c[token] = savedChild
				} else {
					delete(c, token)
				}
				_ = cur.DataModel.Set(parentPtr, c)
			case []any:
				idx, convErr := strconv.Atoi(token)
				if convErr == nil {
					if exists && idx >= 0 && idx < len(c) {
						c[idx] = savedChild
					} else if !exists && listLen <= len(c) {
						c = c[:listLen]
					}
					_ = cur.DataModel.Set(parentPtr, c)
				}
			}
		}
	}
	return nil
}

func buildSurfaceRestorer(surface *core.SurfaceModel) func() *core.SurfaceModel {
	sid := surface.ID
	cid := surface.CatalogID
	cat := surface.Catalog
	pVer := surface.ProtocolVersion
	availCats := maps.Clone(surface.AvailableCatalogs)
	rootID := surface.RootID
	locale := surface.Locale
	sendDM := surface.SendDataModel
	maxCache := surface.MaxAgentCallCacheEntries
	execFn := surface.AgentCallExecutor
	callerFn := surface.AgentFunctionCaller
	theme, _ := core.CloneJSONValue(surface.Theme).(map[string]any)
	meta, _ := core.CloneJSONValue(surface.Metadata).(map[string]any)
	dataVal, _, _ := surface.DataModel.Get("/")
	savedData := core.CloneJSONValue(dataVal)

	type savedCompSnapshot struct {
		id       string
		compType string
		catalog  *core.Catalog
		props    map[string]any
		meta     map[string]any
	}
	keys := surface.ComponentsModel.Keys()
	savedComps := make([]savedCompSnapshot, 0, len(keys))
	for _, k := range keys {
		if comp := surface.ComponentsModel.Get(k); comp != nil {
			props, _ := core.CloneJSONValue(comp.Properties).(map[string]any)
			compMeta, _ := core.CloneJSONValue(comp.Metadata).(map[string]any)
			savedComps = append(savedComps, savedCompSnapshot{
				id:       comp.ID,
				compType: comp.Type,
				catalog:  comp.Catalog,
				props:    props,
				meta:     compMeta,
			})
		}
	}

	return func() *core.SurfaceModel {
		restored := core.NewSurfaceModel(sid, cid, cat)
		restored.ProtocolVersion = pVer
		if availCats != nil {
			restored.AvailableCatalogs = maps.Clone(availCats)
		}
		restored.RootID = rootID
		restored.Locale = locale
		restored.SendDataModel = sendDM
		restored.MaxAgentCallCacheEntries = maxCache
		restored.AgentCallExecutor = execFn
		restored.AgentFunctionCaller = callerFn
		restored.Theme, _ = core.CloneJSONValue(theme).(map[string]any)
		restored.Metadata, _ = core.CloneJSONValue(meta).(map[string]any)
		_ = restored.DataModel.Set("/", core.CloneJSONValue(savedData))
		for _, comp := range savedComps {
			restored.ComponentsModel.Upsert(restoreComponentModel(
				comp.id,
				comp.compType,
				comp.catalog,
				comp.props,
				comp.meta,
			))
		}
		return restored
	}
}

func restoreComponentModel(id, compType string, catalog *core.Catalog, props, meta map[string]any) *core.ComponentModel {
	if comp, err := core.NewComponentModel(id, compType, catalog, props, meta); err == nil {
		return comp
	}
	copiedProps := map[string]any{}
	if props != nil {
		if m, ok := core.CloneJSONValue(props).(map[string]any); ok {
			copiedProps = m
		}
	}
	var copiedMeta map[string]any
	if meta != nil {
		copiedMeta, _ = core.CloneJSONValue(meta).(map[string]any)
	}
	return &core.ComponentModel{
		ID:         id,
		Type:       compType,
		Catalog:    catalog,
		Properties: copiedProps,
		Metadata:   copiedMeta,
	}
}

func (s *RendererState) shouldAssume(surfaceID string, payload []core.AgentToRendererMessage, index int) bool {
	if s.protocolVersion == core.Version0_8 {
		return true
	}
	if !s.assumesUnknownSurfaces {
		return false
	}
	for _, prev := range payload[:index] {
		if tid, ok, _ := messageTarget(prev); ok && tid == surfaceID {
			return false
		}
	}
	for _, later := range payload[index+1:] {
		tid, ok, creates := messageTarget(later)
		if !ok || tid != surfaceID {
			continue
		}
		if creates {
			return false
		}
		if _, isDel := later["deleteSurface"]; isDel {
			break
		}
	}
	return true
}

func (s *RendererState) assumeSurface(surfaceID string, payload []core.AgentToRendererMessage, index int) error {
	msg := payload[index]
	updates := collectSurfaceUpdates(surfaceID, payload, index)
	candidates, err := s.placeholderCatalogs(surfaceID, updates)
	if err != nil {
		return err
	}

	var firstErr error
	for _, cat := range candidates {
		placeholder := s.buildPlaceholder(surfaceID, cat, msg)
		trial := make([]core.AgentToRendererMessage, 0, 1+len(updates))
		trial = append(trial, placeholder)
		trial = append(trial, updates...)
		trialErr := s.processUnlogged(trial)
		s.processor.Model.DeleteSurface(surfaceID)
		if trialErr != nil {
			if firstErr == nil {
				firstErr = trialErr
			}
			continue
		}
		if err := s.processLogged([]core.AgentToRendererMessage{placeholder, msg}); err != nil {
			return err
		}
		s.setAssumed(surfaceID, true)
		if s.protocolVersion == core.Version0_8 {
			s.setPending(surfaceID, []core.AgentToRendererMessage{msg})
		}
		return nil
	}
	return firstErr
}

func (s *RendererState) placeholderCatalogs(surfaceID string, updates []core.AgentToRendererMessage) ([]*core.Catalog, error) {
	if s.surfaceCatalogIDs != nil {
		if forcedID, ok := s.surfaceCatalogIDs[surfaceID]; ok {
			for _, cat := range s.catalogs {
				if cat.CatalogID() == forcedID {
					return []*core.Catalog{cat}, nil
				}
			}
			return nil, core.NewValidationErrorf("Surface %q uses catalog %q, which isn't one of the active catalogs.", surfaceID, forcedID)
		}
	}
	compTypes := collectComponentTypes(updates)
	var matching []*core.Catalog
	for _, cat := range s.catalogs {
		comps := cat.Components()
		allFound := true
		for ctype := range compTypes {
			if _, ok := comps[ctype]; !ok {
				allFound = false
				break
			}
		}
		if allFound {
			matching = append(matching, cat)
		}
	}
	if len(matching) > 0 {
		return matching, nil
	}
	return []*core.Catalog{s.catalogs[0]}, nil
}

func (s *RendererState) buildPlaceholder(surfaceID string, cat *core.Catalog, msg core.AgentToRendererMessage) core.AgentToRendererMessage {
	if s.protocolVersion == core.Version0_8 {
		return core.AgentToRendererMessage{
			"beginRendering": map[string]any{
				"surfaceId": surfaceID,
				"root":      "root",
				"catalogId": cat.CatalogID(),
			},
		}
	}
	return core.AgentToRendererMessage{
		"version": msg["version"],
		"createSurface": map[string]any{
			"surfaceId": surfaceID,
			"catalogId": cat.CatalogID(),
		},
	}
}

func (s *RendererState) checkMessage(msg core.AgentToRendererMessage, index int) error {
	accepted := acceptedWireVersions(s.protocolVersion)
	if len(accepted) == 0 {
		if _, hasVer := msg["version"]; hasVer {
			return core.NewValidationErrorf("Message %d states a version, but %s messages have none.", index, s.protocolVersion)
		}
	} else {
		rawVer, hasVer := msg["version"]
		if !hasVer || rawVer == nil {
			return core.NewValidationErrorf("Message %d states no version, which %s messages require.", index, s.protocolVersion)
		}
		verStr, isStr := rawVer.(string)
		matched := false
		if isStr {
			for _, a := range accepted {
				if verStr == a {
					matched = true
					break
				}
			}
		}
		if !matched {
			quoted := make([]string, len(accepted))
			for i, a := range accepted {
				quoted[i] = fmt.Sprintf("'%s'", a)
			}
			return core.NewValidationErrorf(
				"Message %d states version %v, but the catalogs target %s, whose messages state %s.",
				index, rawVer, s.protocolVersion, strings.Join(quoted, " or "),
			)
		}
	}

	for _, action := range []string{"createSurface", "updateComponents", "surfaceUpdate"} {
		if body, ok := msg[action].(map[string]any); ok {
			if comps, isList := normalizedComponentSlice(body["components"]); isList && len(comps) == 0 {
				return core.NewValidationErrorf("Message %d (%s) has an empty 'components' list.", index, action)
			}
		}
	}
	return nil
}

func asValidationError(err error) error {
	if err == nil {
		return nil
	}
	var valErr *core.ValidationError
	if errors.As(err, &valErr) {
		return err
	}
	var catErr core.CategorizedError
	if errors.As(err, &catErr) {
		return core.NewValidationError(err.Error())
	}
	return err
}

func messageActions(msg core.AgentToRendererMessage) []string {
	var found []string
	for _, a := range createActions {
		if _, ok := msg[a]; ok {
			found = append(found, a)
		}
	}
	for _, a := range updateActions {
		if _, ok := msg[a]; ok {
			found = append(found, a)
		}
	}
	return found
}

func messageTarget(msg core.AgentToRendererMessage) (surfaceID string, hasTarget bool, creates bool) {
	actions := messageActions(msg)
	if len(actions) != 1 {
		return "", false, false
	}
	action := actions[0]
	body, ok := msg[action].(map[string]any)
	if !ok {
		return "", false, false
	}
	sid, ok := body["surfaceId"].(string)
	if !ok {
		return "", false, false
	}
	isCreate := false
	for _, ca := range createActions {
		if action == ca {
			isCreate = true
			break
		}
	}
	return sid, true, isCreate
}

func collectSurfaceUpdates(surfaceID string, payload []core.AgentToRendererMessage, index int) []core.AgentToRendererMessage {
	var updates []core.AgentToRendererMessage
	for _, msg := range payload[index:] {
		tid, ok, creates := messageTarget(msg)
		if !ok || tid != surfaceID {
			continue
		}
		_, isDel := msg["deleteSurface"]
		if len(updates) > 0 && (creates || isDel) {
			break
		}
		updates = append(updates, msg)
	}
	return updates
}

func normalizedComponentSlice(raw any) ([]any, bool) {
	if comps, ok := raw.([]any); ok {
		return comps, comps != nil
	}
	if comps, ok := core.CloneJSONValue(raw).([]any); ok {
		return comps, true
	}
	return nil, false
}

func messageComponentLists(msg core.AgentToRendererMessage) [][]any {
	var lists [][]any
	for _, action := range []string{"createSurface", "updateComponents", "surfaceUpdate"} {
		if body, ok := msg[action].(map[string]any); ok {
			if comps, isList := normalizedComponentSlice(body["components"]); isList {
				lists = append(lists, comps)
			}
		}
	}
	return lists
}

func messageComponentIDs(msg core.AgentToRendererMessage) map[string]bool {
	ids := make(map[string]bool)
	for _, comps := range messageComponentLists(msg) {
		for _, rawComp := range comps {
			if compMap, ok := rawComp.(map[string]any); ok {
				if cid, isStr := compMap["id"].(string); isStr {
					ids[cid] = true
				}
			}
		}
	}
	return ids
}

func collectComponentTypes(messages []core.AgentToRendererMessage) map[string]bool {
	types := make(map[string]bool)
	for _, msg := range messages {
		for _, comps := range messageComponentLists(msg) {
			for _, rawComp := range comps {
				compMap, ok := rawComp.(map[string]any)
				if !ok {
					continue
				}
				_, hasAtCatID := compMap["@catalogId"]
				if _, hasBareCatID := compMap["catalogId"]; hasAtCatID || hasBareCatID {
					continue
				}
				switch ct := compMap["component"].(type) {
				case string:
					types[ct] = true
				case map[string]any:
					for k := range ct {
						types[k] = true
					}
				}
			}
		}
	}
	return types
}

func pointerTokens(path string) []string {
	var tokens []string
	for _, part := range strings.Split(path, "/") {
		if part == "" {
			continue
		}
		unescaped := strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
		tokens = append(tokens, unescaped)
	}
	return tokens
}

func joinPointer(tokens []string) string {
	if len(tokens) == 0 {
		return "/"
	}
	escaped := make([]string, len(tokens))
	for i, tok := range tokens {
		escaped[i] = strings.ReplaceAll(strings.ReplaceAll(tok, "~", "~0"), "/", "~1")
	}
	return "/" + strings.Join(escaped, "/")
}

func isJSONContainer(v any) bool {
	switch v.(type) {
	case map[string]any, []any:
		return true
	default:
		return false
	}
}

func containerChild(container any, token string) (bool, any) {
	switch c := container.(type) {
	case map[string]any:
		val, ok := c[token]
		return ok, val
	case []any:
		if !jsonPointerIndexRE.MatchString(token) {
			return false, nil
		}
		idx, err := strconv.Atoi(token)
		if err != nil || idx < 0 || idx >= len(c) {
			return false, nil
		}
		return true, c[idx]
	default:
		return false, nil
	}
}

func dedupStrings(items []string) []string {
	seen := make(map[string]bool, len(items))
	out := make([]string, 0, len(items))
	for _, s := range items {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func indexOfKey(keys []string, target string) int {
	for i, k := range keys {
		if k == target {
			return i
		}
	}
	return math.MaxInt
}
