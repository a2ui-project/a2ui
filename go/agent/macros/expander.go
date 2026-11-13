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
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"reflect"
	"slices"
	"sync"

	"github.com/a2ui-project/a2ui/go/agent/builder"
	"github.com/a2ui-project/a2ui/go/agent/internal/envelope"
	"github.com/a2ui-project/a2ui/go/agent/internal/schemahelper"
	"github.com/a2ui-project/a2ui/go/core"
)

const (
	// DefaultMacroCatalogID is the synthetic catalog URI assigned by ToCatalog when CatalogID is unset.
	DefaultMacroCatalogID = "https://a2ui.org/catalogs/macros"

	catalogComponentsKey = "components"
	defaultMaxMacroDepth = 16
	maxTrackedSurfaces   = 256
)

// ErrorPolicy controls how MacroExpander handles runtime macro expansion failures during TransformToTransport.
type ErrorPolicy string

const (
	// OnErrorPassthrough logs runtime macro failures and retains the unexpanded component map (default).
	OnErrorPassthrough ErrorPolicy = "passthrough"
	// OnErrorRaise returns a *core.ValidationError immediately so agent retry loops can self-correct.
	OnErrorRaise ErrorPolicy = "raise"
)

// ExpanderOptions configures a MacroExpander instance.
type ExpanderOptions struct {
	// PassthroughFilter reports whether a base catalog component stays exposed in inference catalogs
	// alongside the macros. A nil filter (the default) passes every base component; use
	// PassthroughOnly to keep a fixed set of names.
	PassthroughFilter func(componentName string) bool
	// CatalogID scopes macro expansion to components whose effective catalogId matches CatalogID,
	// and sets the catalogId of ToCatalog().
	CatalogID string
	// BaseCatalogs pre-registers transport catalogs so TransformToTransport can disambiguate
	// mixed-catalog primitives and stamp unique owning catalogIds on defaultless v1.0 surfaces.
	BaseCatalogs []*core.Catalog
	// ProtocolVersion constrains the expander to a single protocol version (such as core.Version1_0).
	ProtocolVersion core.ProtocolVersion
	// OnError selects "passthrough" (default) or "raise" for runtime macro expansion errors.
	OnError ErrorPolicy
	// MaxDepth overrides the maximum macro recursion depth (defaults to 16 when <= 0).
	MaxDepth int
	// Logger receives expansion warnings and passthrough errors (defaults to slog.Default()).
	Logger *slog.Logger
}

// PassthroughOnly returns an ExpanderOptions.PassthroughFilter that keeps only the named base
// components. With no names, it hides every base component so only macros remain exposed.
func PassthroughOnly(names ...string) func(componentName string) bool {
	allowed := make(map[string]bool, len(names))
	for _, name := range names {
		allowed[name] = true
	}
	return func(componentName string) bool { return allowed[componentName] }
}

type surfaceOp struct {
	isDelete  bool
	surfaceID string
	catalogID string
}

type surfaceCatalogTracker struct {
	mu      sync.Mutex
	logger  *slog.Logger
	entries map[string]string
	order   []string
}

func newSurfaceCatalogTracker(logger *slog.Logger) *surfaceCatalogTracker {
	return &surfaceCatalogTracker{logger: logger, entries: make(map[string]string)}
}

func (t *surfaceCatalogTracker) cloneStaged() *surfaceCatalogTracker {
	t.mu.Lock()
	defer t.mu.Unlock()
	return &surfaceCatalogTracker{
		entries: maps.Clone(t.entries),
		order:   slices.Clone(t.order),
	}
}

func (t *surfaceCatalogTracker) get(surfaceID string) (string, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	cid, ok := t.entries[surfaceID]
	return cid, ok
}

func (t *surfaceCatalogTracker) delete(surfaceID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.deleteLocked(surfaceID)
}

func (t *surfaceCatalogTracker) deleteLocked(surfaceID string) {
	if _, exists := t.entries[surfaceID]; !exists {
		return
	}
	delete(t.entries, surfaceID)
	for i, k := range t.order {
		if k == surfaceID {
			t.order = append(t.order[:i], t.order[i+1:]...)
			break
		}
	}
}

func (t *surfaceCatalogTracker) set(surfaceID, catalogID string) {
	t.mu.Lock()
	var evicted string
	didEvict := false
	t.deleteLocked(surfaceID)
	t.entries[surfaceID] = catalogID
	t.order = append(t.order, surfaceID)
	if len(t.order) > maxTrackedSurfaces {
		evicted = t.order[0]
		t.order = t.order[1:]
		delete(t.entries, evicted)
		didEvict = true
	}
	logger := t.logger
	t.mu.Unlock()
	if didEvict && logger != nil {
		logger.Warn("evicted oldest tracked surface from TransportSession", "surfaceId", evicted, "limit", maxTrackedSurfaces)
	}
}

// MacroExpander synthesizes inference catalog schemas for composite macros and lowers macro
// component invocations into flat primitive component subtrees at transport time.
//
// A MacroExpander holds no per-conversation state, so build one at startup and share it.
// Surface state that spans several calls (each surface's default catalogId) lives in a
// TransportSession; create one per conversation with NewSession.
// MacroExpander is safe for concurrent use across goroutines.
type MacroExpander struct {
	macros                  []*Macro
	macroMap                map[string]*Macro
	explicitProtocolVersion string
	passthroughFilter       func(componentName string) bool // nil passes every base component
	catalogID               string
	onError                 ErrorPolicy
	maxDepth                int
	logger                  *slog.Logger

	mu                    sync.RWMutex
	targetFamily          builder.VersionFamily
	catalogBaseComponents map[string]map[string]bool
	registeredBaseCIDs    []string
	baseCatalogs          map[string]*core.Catalog // registered base catalogs by catalogId
	schemaHelpers         *baseSchemaHelpers
}

type expanderSnapshot struct {
	macroMap              map[string]*Macro
	passthroughFilter     func(componentName string) bool
	logger                *slog.Logger
	catalogID             string
	macroCatalogID        string
	onError               ErrorPolicy
	maxDepth              int
	targetFamily          builder.VersionFamily
	catalogBaseComponents map[string]map[string]bool
	registeredBaseCIDs    []string
	baseCatalogs          map[string]*core.Catalog
	schemaHelpers         *baseSchemaHelpers
}

// baseSchemaHelpers builds the schema helper of a registered base catalog the first
// time stamping needs one. Only a lowered primitive that carries a legacy bare
// catalogId does, and a helper takes milliseconds to build.
type baseSchemaHelpers struct {
	mu      sync.Mutex
	helpers map[string]baseSchemaHelper // by catalogId
}

type baseSchemaHelper struct {
	catalog *core.Catalog
	helper  *schemahelper.CatalogSchemaHelper
}

func (h *baseSchemaHelpers) get(cid string, cat *core.Catalog) *schemahelper.CatalogSchemaHelper {
	h.mu.Lock()
	defer h.mu.Unlock()
	if cached, ok := h.helpers[cid]; ok && cached.catalog == cat {
		return cached.helper
	}
	helper := schemahelper.NewCatalogSchemaHelper(cat, "")
	h.helpers[cid] = baseSchemaHelper{catalog: cat, helper: helper}
	return helper
}

// NewMacroExpander constructs and validates a MacroExpander for macros and optional ExpanderOptions.
func NewMacroExpander(macros []*Macro, opts *ExpanderOptions) (*MacroExpander, error) {
	var resolved ExpanderOptions
	if opts != nil {
		resolved = *opts
	}
	if resolved.OnError == "" {
		resolved.OnError = OnErrorPassthrough
	}
	if resolved.OnError != OnErrorPassthrough && resolved.OnError != OnErrorRaise {
		return nil, core.NewValidationErrorf("invalid OnError policy %q; expected %q or %q", resolved.OnError, OnErrorPassthrough, OnErrorRaise)
	}
	maxDepth := resolved.MaxDepth
	if maxDepth <= 0 {
		maxDepth = defaultMaxMacroDepth
	}

	detectedFamilies := make(map[builder.VersionFamily]bool)
	macroList := make([]*Macro, 0, len(macros))
	macroMap := make(map[string]*Macro, len(macros))
	for _, m := range macros {
		if m == nil {
			continue
		}
		if _, dup := macroMap[m.name]; dup {
			return nil, core.NewValidationErrorf("duplicate macro %q registered on MacroExpander", m.name)
		}
		macroList = append(macroList, m)
		macroMap[m.name] = m
		if m.targetVersion != builder.VersionFamilyUnspecified {
			detectedFamilies[m.targetVersion] = true
		}
	}

	explicitVerStr := ""
	if resolved.ProtocolVersion != "" {
		pv, err := core.ToProtocolVersion(string(resolved.ProtocolVersion))
		if err != nil {
			return nil, newMacroProtocolErrorf("unsupported macro protocol version %q", resolved.ProtocolVersion)
		}
		explicitVerStr = pv.NumberString()
		fam, err := normalizeVersionFamily(explicitVerStr)
		if err != nil {
			return nil, err
		}
		detectedFamilies[fam] = true
	}

	if len(detectedFamilies) > 1 {
		return nil, newMacroProtocolError("MacroExpander cannot mix A2UI v0.9 and v1.0 macros or protocol versions")
	}
	var targetFam builder.VersionFamily
	for f := range detectedFamilies {
		targetFam = f
	}
	if targetFam == builder.VersionFamily1_0 {
		for _, m := range macroList {
			if err := validateV1_0MacroName(m.name); err != nil {
				return nil, err
			}
		}
	}

	logger := resolved.Logger
	if logger == nil {
		logger = slog.Default()
	}

	exp := &MacroExpander{
		macros:                  macroList,
		macroMap:                macroMap,
		targetFamily:            targetFam,
		explicitProtocolVersion: explicitVerStr,
		passthroughFilter:       resolved.PassthroughFilter,
		logger:                  logger,
		catalogID:               resolved.CatalogID,
		catalogBaseComponents:   make(map[string]map[string]bool),
		baseCatalogs:            make(map[string]*core.Catalog),
		schemaHelpers:           &baseSchemaHelpers{helpers: make(map[string]baseSchemaHelper)},
		onError:                 resolved.OnError,
		maxDepth:                maxDepth,
	}
	if resolved.CatalogID != "" {
		exp.catalogBaseComponents[resolved.CatalogID] = make(map[string]bool)
	}
	for _, cat := range resolved.BaseCatalogs {
		if err := exp.RegisterCatalog(cat); err != nil {
			return nil, err
		}
	}
	return exp, nil
}

// MacroCatalogID returns the catalog identifier URI used for standalone sidecar macro schemas.
func (e *MacroExpander) MacroCatalogID() string {
	if e.catalogID != "" {
		return e.catalogID
	}
	return DefaultMacroCatalogID
}

func (e *MacroExpander) snapshot() expanderSnapshot {
	e.mu.RLock()
	defer e.mu.RUnlock()
	baseCopy := make(map[string]map[string]bool, len(e.catalogBaseComponents))
	for cid, comps := range e.catalogBaseComponents {
		cMap := make(map[string]bool, len(comps))
		for k, v := range comps {
			cMap[k] = v
		}
		baseCopy[cid] = cMap
	}
	regCopy := append([]string(nil), e.registeredBaseCIDs...)
	return expanderSnapshot{
		macroMap:              e.macroMap,
		passthroughFilter:     e.passthroughFilter,
		logger:                e.logger,
		catalogID:             e.catalogID,
		macroCatalogID:        e.MacroCatalogID(),
		onError:               e.onError,
		maxDepth:              e.maxDepth,
		targetFamily:          e.targetFamily,
		catalogBaseComponents: baseCopy,
		registeredBaseCIDs:    regCopy,
		baseCatalogs:          maps.Clone(e.baseCatalogs),
		schemaHelpers:         e.schemaHelpers,
	}
}

func (e *MacroExpander) targetFamilySnapshot() builder.VersionFamily {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.targetFamily
}

func extractCatalogComponentSet(cat *core.Catalog) map[string]bool {
	doc := cat.ToJSON()
	compSet := make(map[string]bool)
	if compsMap, ok := doc[catalogComponentsKey].(map[string]any); ok {
		for k := range compsMap {
			compSet[k] = true
		}
	} else {
		for k := range cat.Components() {
			compSet[k] = true
		}
	}
	return compSet
}

func (e *MacroExpander) registerBaseComponents(cat *core.Catalog) {
	if cat == nil || cat.CatalogID() == "" {
		return
	}
	compSet := extractCatalogComponentSet(cat)
	cid := cat.CatalogID()

	e.mu.Lock()
	defer e.mu.Unlock()
	e.catalogBaseComponents[cid] = compSet
	e.baseCatalogs[cid] = cat
	if !slices.Contains(e.registeredBaseCIDs, cid) {
		e.registeredBaseCIDs = append(e.registeredBaseCIDs, cid)
	}
}

// RegisterCatalog records a transport catalog's primitive component names for mixed-catalog
// disambiguation and automatic catalogId stamping.
func (e *MacroExpander) RegisterCatalog(cat *core.Catalog) error {
	if cat == nil {
		return nil
	}
	var catFam builder.VersionFamily
	if pv := cat.ProtocolVersion(); pv != "" {
		var err error
		catFam, err = normalizeVersionFamily(string(pv))
		if err != nil {
			return err
		}
	}
	var compSet map[string]bool
	cid := cat.CatalogID()
	if cid != "" {
		compSet = extractCatalogComponentSet(cat)
	}

	e.mu.Lock()
	defer e.mu.Unlock()
	if catFam != builder.VersionFamilyUnspecified {
		if e.targetFamily != builder.VersionFamilyUnspecified && e.targetFamily != catFam {
			return newMacroProtocolErrorf("cannot register %s catalog with v%s MacroExpander", cat.ProtocolVersion().Label(), e.targetFamily)
		}
		if e.targetFamily == builder.VersionFamilyUnspecified {
			if catFam == builder.VersionFamily1_0 {
				for _, m := range e.macros {
					if err := validateV1_0MacroName(m.name); err != nil {
						return err
					}
				}
			}
			e.targetFamily = catFam
		}
	}
	if cid != "" {
		e.catalogBaseComponents[cid] = compSet
		e.baseCatalogs[cid] = cat
		if !slices.Contains(e.registeredBaseCIDs, cid) {
			e.registeredBaseCIDs = append(e.registeredBaseCIDs, cid)
		}
	}
	return nil
}

// Transform satisfies agent.CatalogTransformer by augmenting catalog with macro schemas.
func (e *MacroExpander) Transform(catalog *core.Catalog) (*core.Catalog, error) {
	return e.TransformToInferenceCatalog(catalog)
}

// TransformCatalogs transforms transport catalogs into inference catalogs for prompt generation and parsing:
//   - In v0.9, augments the sole catalog in place via TransformToInferenceCatalog.
//   - In v1.0, optionally prunes base components via PassthroughFilter and appends ToCatalog()
//     as a sidecar catalog (or augments in place when CatalogID matches one of catalogs).
func (e *MacroExpander) TransformCatalogs(catalogs []*core.Catalog) ([]*core.Catalog, error) {
	if len(catalogs) == 0 {
		if len(e.macros) == 0 {
			return []*core.Catalog{}, nil
		}
		sidecar, err := e.ToCatalog()
		if err != nil {
			return nil, err
		}
		return []*core.Catalog{sidecar}, nil
	}

	effectiveFam := e.targetFamilySnapshot()
	for _, cat := range catalogs {
		if cat == nil {
			return nil, core.NewCatalogError("catalog in TransformCatalogs must not be nil")
		}
		if pv := cat.ProtocolVersion(); pv != "" {
			catFam, err := normalizeVersionFamily(string(pv))
			if err != nil {
				return nil, err
			}
			if effectiveFam != builder.VersionFamilyUnspecified && effectiveFam != catFam {
				return nil, newMacroProtocolErrorf("cannot register %s catalog with v%s MacroExpander", cat.ProtocolVersion().Label(), effectiveFam)
			}
			if effectiveFam == builder.VersionFamilyUnspecified {
				if catFam == builder.VersionFamily1_0 {
					for _, m := range e.macros {
						if err := validateV1_0MacroName(m.name); err != nil {
							return nil, err
						}
					}
				}
				effectiveFam = catFam
			}
		}
	}

	var out []*core.Catalog
	if effectiveFam == builder.VersionFamily1_0 {
		hasMatchingCID := false
		if e.catalogID != "" {
			for _, c := range catalogs {
				if c.CatalogID() == e.catalogID {
					hasMatchingCID = true
					break
				}
			}
		}
		out = make([]*core.Catalog, 0, len(catalogs)+1)
		for _, c := range catalogs {
			if hasMatchingCID && c.CatalogID() == e.catalogID {
				aug, err := e.buildInferenceCatalog(c, effectiveFam)
				if err != nil {
					return nil, err
				}
				out = append(out, aug)
			} else if e.passthroughFilter != nil {
				pruned, err := pruneCatalogComponents(c, e.passthroughFilter)
				if err != nil {
					return nil, err
				}
				out = append(out, pruned)
			} else {
				out = append(out, c)
			}
		}
		if !hasMatchingCID && len(e.macros) > 0 {
			sidecar, err := e.buildSidecarCatalog(effectiveFam)
			if err != nil {
				return nil, err
			}
			out = append(out, sidecar)
		}
	} else {
		if len(catalogs) != 1 {
			return nil, core.NewCatalogError("A2UI v0.9 supports only a single catalog per surface")
		}
		aug, err := e.buildInferenceCatalog(catalogs[0], effectiveFam)
		if err != nil {
			return nil, err
		}
		out = []*core.Catalog{aug}
	}

	for _, cat := range catalogs {
		if err := e.RegisterCatalog(cat); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func pruneCatalogComponents(cat *core.Catalog, keep func(componentName string) bool) (*core.Catalog, error) {
	doc := cat.ToJSON()
	compsMap, _ := doc[catalogComponentsKey].(map[string]any)
	newComps := make(map[string]any)
	pruned := make(map[string]bool)
	for k, v := range compsMap {
		if keep(k) {
			newComps[k] = v
		} else {
			pruned[k] = true
		}
	}
	doc[catalogComponentsKey] = newComps

	if defsMap, ok := doc["$defs"].(map[string]any); ok {
		if anyComp, ok := defsMap["anyComponent"].(map[string]any); ok {
			if oneOf, ok := anyComp["oneOf"].([]any); ok {
				filtered := make([]any, 0, len(oneOf))
				for _, entry := range oneOf {
					refMap, ok := entry.(map[string]any)
					if !ok {
						filtered = append(filtered, entry)
						continue
					}
					refStr, _ := refMap["$ref"].(string)
					drop := false
					for pName := range pruned {
						if hasComponentRefSuffix(refStr, pName) {
							drop = true
							break
						}
					}
					if !drop {
						filtered = append(filtered, entry)
					}
				}
				if len(filtered) > 0 {
					anyComp["oneOf"] = filtered
				} else {
					defsMap["anyComponent"] = map[string]any{"not": map[string]any{}}
				}
			}
		}
	}

	return core.CatalogFromJSON(doc, &core.CatalogLoadOptions{
		CatalogID:       cat.CatalogID(),
		ProtocolVersion: cat.ProtocolVersion(),
	})
}

func hasComponentRefSuffix(ref, compName string) bool {
	suffix := "/" + compName
	return len(ref) >= len(suffix) && ref[len(ref)-len(suffix):] == suffix
}

// TransformToInferenceCatalog derives an inference catalog by augmenting baseCatalog with macro schemas.
func (e *MacroExpander) TransformToInferenceCatalog(baseCatalog *core.Catalog) (*core.Catalog, error) {
	if baseCatalog == nil {
		return nil, core.NewCatalogError("baseCatalog must not be nil")
	}
	aug, err := e.buildInferenceCatalog(baseCatalog, e.targetFamilySnapshot())
	if err != nil {
		return nil, err
	}
	e.registerBaseComponents(baseCatalog)
	return aug, nil
}

func (e *MacroExpander) buildInferenceCatalog(baseCatalog *core.Catalog, targetFam builder.VersionFamily) (*core.Catalog, error) {
	if baseCatalog == nil {
		return nil, core.NewCatalogError("baseCatalog must not be nil")
	}
	var baseFamily builder.VersionFamily
	if pv := baseCatalog.ProtocolVersion(); pv != "" {
		var err error
		baseFamily, err = normalizeVersionFamily(string(pv))
		if err != nil {
			return nil, err
		}
	}
	if targetFam != builder.VersionFamilyUnspecified && baseFamily != builder.VersionFamilyUnspecified && targetFam != baseFamily {
		return nil, newMacroProtocolErrorf("cannot augment %s catalog with v%s macros", baseCatalog.ProtocolVersion().Label(), targetFam)
	}

	isV1_0 := baseFamily == builder.VersionFamily1_0
	if isV1_0 {
		for _, m := range e.macros {
			if err := validateV1_0MacroName(m.name); err != nil {
				return nil, err
			}
		}
	}

	schemaCopy := baseCatalog.ToJSON()
	rawComps, _ := schemaCopy[catalogComponentsKey].(map[string]any)
	compsMap := make(map[string]any, len(rawComps)+len(e.macros))
	for k, v := range rawComps {
		compsMap[k] = v
	}

	defsMap, hasDefs := schemaCopy["$defs"].(map[string]any)
	var anyComp map[string]any
	if hasDefs {
		anyComp, _ = defsMap["anyComponent"].(map[string]any)
	}
	wasEmptyNot := anyComp != nil && reflect.DeepEqual(anyComp, map[string]any{"not": map[string]any{}})

	var anyCompRefs []any
	hasAnyCompRefs := false
	if anyComp != nil {
		if oneOf, ok := anyComp["oneOf"].([]any); ok {
			anyCompRefs = append([]any(nil), oneOf...)
			hasAnyCompRefs = true
		} else if wasEmptyNot && len(e.macros) > 0 && hasDefs {
			anyCompRefs = []any{}
			hasAnyCompRefs = true
		}
	}

	if e.passthroughFilter != nil {
		prunedNames := make(map[string]bool)
		for name := range compsMap {
			if !e.passthroughFilter(name) {
				prunedNames[name] = true
				delete(compsMap, name)
			}
		}
		if hasAnyCompRefs {
			filtered := make([]any, 0, len(anyCompRefs))
			for _, entry := range anyCompRefs {
				refMap, ok := entry.(map[string]any)
				if !ok {
					filtered = append(filtered, entry)
					continue
				}
				refStr, _ := refMap["$ref"].(string)
				drop := false
				for pName := range prunedNames {
					if hasComponentRefSuffix(refStr, pName) {
						drop = true
						break
					}
				}
				if !drop {
					filtered = append(filtered, entry)
				}
			}
			anyCompRefs = filtered
		}
	}

	for _, m := range e.macros {
		if _, exists := compsMap[m.name]; exists {
			return nil, core.NewCatalogErrorf("macro component %q collides with an existing component in the base catalog", m.name)
		}
		compsMap[m.name] = m.ToJSONSchema(SchemaOptions{
			IncludeComponentConst: isV1_0,
			Version:               schemaVersionFamily(isV1_0),
		})
		if hasAnyCompRefs {
			refTarget := fmt.Sprintf("#/%s/%s", catalogComponentsKey, m.name)
			already := false
			for _, existing := range anyCompRefs {
				if rm, ok := existing.(map[string]any); ok && rm["$ref"] == refTarget {
					already = true
					break
				}
			}
			if !already {
				anyCompRefs = append(anyCompRefs, map[string]any{"$ref": refTarget})
			}
		}
	}

	if hasDefs && hasAnyCompRefs {
		if len(anyCompRefs) > 0 {
			updatedAnyComp := map[string]any{"oneOf": anyCompRefs}
			var existingDisc any
			hasExistingDisc := false
			if anyComp != nil {
				existingDisc, hasExistingDisc = anyComp["discriminator"]
			}
			if isV1_0 || hasExistingDisc {
				if hasExistingDisc {
					updatedAnyComp["discriminator"] = existingDisc
				} else {
					updatedAnyComp["discriminator"] = map[string]any{"propertyName": "component"}
				}
			}
			defsMap["anyComponent"] = updatedAnyComp
		} else {
			defsMap["anyComponent"] = map[string]any{"not": map[string]any{}}
		}
	}

	schemaCopy[catalogComponentsKey] = compsMap

	return core.CatalogFromJSON(schemaCopy, &core.CatalogLoadOptions{
		CatalogID:       baseCatalog.CatalogID(),
		ProtocolVersion: baseCatalog.ProtocolVersion(),
	})
}

// ToCatalog exports a standalone Catalog containing exclusively the registered macro component schemas.
// When neither ProtocolVersion, BaseCatalogs, nor v1.0 macro annotations are present, it defaults to "0.9.1".
func (e *MacroExpander) ToCatalog() (*core.Catalog, error) {
	return e.buildSidecarCatalog(e.targetFamilySnapshot())
}

func (e *MacroExpander) buildSidecarCatalog(targetFam builder.VersionFamily) (*core.Catalog, error) {
	version := core.Version0_9_1.NumberString()
	if e.explicitProtocolVersion != "" {
		version = e.explicitProtocolVersion
	} else if targetFam == builder.VersionFamily1_0 {
		version = core.Version1_0.NumberString()
	}

	fam, err := normalizeVersionFamily(version)
	if err != nil {
		return nil, err
	}
	isV1_0 := fam == builder.VersionFamily1_0
	if isV1_0 {
		for _, m := range e.macros {
			if err := validateV1_0MacroName(m.name); err != nil {
				return nil, err
			}
		}
	}

	catalogID := e.MacroCatalogID()
	components := make(map[string]any, len(e.macros))
	anyCompRefs := make([]any, 0, len(e.macros))
	for _, m := range e.macros {
		components[m.name] = m.ToJSONSchema(SchemaOptions{
			IncludeComponentConst: isV1_0,
			Version:               schemaVersionFamily(isV1_0),
		})
		anyCompRefs = append(anyCompRefs, map[string]any{
			"$ref": fmt.Sprintf("#/%s/%s", catalogComponentsKey, m.name),
		})
	}

	var defs map[string]any
	if isV1_0 {
		var anyCompDef map[string]any
		if len(anyCompRefs) > 0 {
			anyCompDef = map[string]any{
				"oneOf":         anyCompRefs,
				"discriminator": map[string]any{"propertyName": "component"},
			}
		} else {
			anyCompDef = map[string]any{"not": map[string]any{}}
		}
		defs = map[string]any{
			"anyComponent": anyCompDef,
			"anyFunction":  map[string]any{"not": map[string]any{}},
		}
	} else {
		var anyCompDef map[string]any
		if len(anyCompRefs) > 0 {
			anyCompDef = map[string]any{"oneOf": anyCompRefs}
		} else {
			anyCompDef = map[string]any{"not": map[string]any{}}
		}
		defs = map[string]any{
			"anyComponent": anyCompDef,
		}
	}

	schema := map[string]any{
		"$schema":            "https://json-schema.org/draft/2020-12/schema",
		"protocolVersion":    version,
		"catalogId":          catalogID,
		"title":              "A2UI Macros Catalog",
		"description":        "Standalone catalog of high-level A2UI macro components.",
		catalogComponentsKey: components,
		"$defs":              defs,
	}

	protoVer, err := core.ToProtocolVersion(version)
	if err != nil {
		return nil, err
	}
	return core.CatalogFromJSON(schema, &core.CatalogLoadOptions{
		CatalogID:       catalogID,
		ProtocolVersion: protoVer,
	})
}

func (s expanderSnapshot) isV1_0Envelope(protocolVersion string) bool {
	if protocolVersion != "" {
		return protocolVersion == core.Version1_0.NumberString()
	}
	return s.targetFamily == builder.VersionFamily1_0
}

func (s expanderSnapshot) isPureMacroSidecarID(cid string) bool {
	return cid != "" && cid == s.macroCatalogID && !slices.Contains(s.registeredBaseCIDs, cid)
}

func (s expanderSnapshot) resolveSurfaceCatalogPair(cid string, isV1_0 bool, rewriteCreateSurface bool) (string, string, error) {
	if isV1_0 && s.isPureMacroSidecarID(cid) {
		if len(s.registeredBaseCIDs) == 0 {
			if rewriteCreateSurface {
				return "", "", core.NewCatalogErrorf(
					"surface default catalogId %q is a standalone macro catalog, and no BaseCatalogs are registered on MacroExpander to resolve a transport catalog",
					cid,
				)
			}
			return cid, "", nil
		}
		if len(s.registeredBaseCIDs) == 1 {
			return cid, s.registeredBaseCIDs[0], nil
		}
		return cid, "", nil
	}
	return cid, cid, nil
}

// TransportSession lowers macro components for one conversation. It remembers each surface's
// default catalogId from createSurface so that updateComponents messages sent in later turns
// resolve against the right catalog. Create one per conversation with MacroExpander.NewSession.
// A TransportSession tracks at most 256 surfaces, evicting the oldest first, and is safe for
// concurrent use.
type TransportSession struct {
	expander *MacroExpander
	surfaces *surfaceCatalogTracker
}

// NewSession returns an empty TransportSession that lowers messages with e.
func (e *MacroExpander) NewSession() *TransportSession {
	return &TransportSession{expander: e, surfaces: newSurfaceCatalogTracker(e.logger)}
}

// TrackSurface records that surfaceID already exists with default catalogID, for example
// when a conversation resumes after its createSurface message was lowered elsewhere.
// Pass an empty catalogID for a v1.0 surface without a default catalog.
func (s *TransportSession) TrackSurface(surfaceID, catalogID string) {
	s.surfaces.set(surfaceID, catalogID)
}

// TransformToTransport lowers outbound inference messages by expanding macro components into
// flat primitive subtrees, updating the session's surface state from createSurface and
// deleteSurface messages once the entire batch succeeds.
func (s *TransportSession) TransformToTransport(messages []core.AgentToRendererMessage) ([]core.AgentToRendererMessage, error) {
	return s.expander.transformToTransport(messages, s.surfaces)
}

// TransformToTransport lowers a self-contained batch of outbound inference messages.
// Surfaces created in earlier calls are unknown to it; use a TransportSession when a
// conversation spans several calls.
func (e *MacroExpander) TransformToTransport(messages []core.AgentToRendererMessage) ([]core.AgentToRendererMessage, error) {
	return e.NewSession().TransformToTransport(messages)
}

func (e *MacroExpander) transformToTransport(
	messages []core.AgentToRendererMessage,
	activeSurfaces *surfaceCatalogTracker,
) ([]core.AgentToRendererMessage, error) {
	snap := e.snapshot()
	if len(e.macros) == 0 && snap.targetFamily == builder.VersionFamilyUnspecified {
		out := make([]core.AgentToRendererMessage, len(messages))
		for i, m := range messages {
			out[i] = m.Clone()
		}
		return out, nil
	}

	stagedSurfaces := activeSurfaces.cloneStaged()
	var stagedOps []surfaceOp

	result := make([]core.AgentToRendererMessage, 0, len(messages))
	for _, msg := range messages {
		msgDict := msg.Clone()
		protocolVersion := ""
		if rawVer, ok := msgDict["version"].(string); ok && rawVer != "" {
			pv, err := core.ToProtocolVersion(rawVer)
			if err != nil {
				return nil, newMacroProtocolErrorf("unsupported message envelope protocol version %q", rawVer)
			}
			protocolVersion = pv.NumberString()
			msgFam, err := normalizeVersionFamily(protocolVersion)
			if err != nil {
				return nil, err
			}
			if snap.targetFamily != builder.VersionFamilyUnspecified && snap.targetFamily != msgFam {
				return nil, newMacroProtocolErrorf("cannot lower v%s message envelope with v%s MacroExpander", protocolVersion, snap.targetFamily)
			}
		}

		isV1_0 := snap.isV1_0Envelope(protocolVersion)
		if delBody, ok := toStringAnyMap(msgDict["deleteSurface"]); ok {
			if delSID, ok := delBody["surfaceId"].(string); ok && delSID != "" {
				stagedSurfaces.delete(delSID)
				stagedOps = append(stagedOps, surfaceOp{isDelete: true, surfaceID: delSID})
			}
		}

		if len(e.macros) == 0 {
			result = append(result, msgDict)
			continue
		}

		for _, envelopeKey := range []string{"surfaceUpdate", "createSurface", "updateComponents"} {
			body, ok := msgDict[envelopeKey].(map[string]any)
			if !ok {
				if normBody, normOK := toStringAnyMap(msgDict[envelopeKey]); normOK {
					body = normBody
					msgDict[envelopeKey] = body
				} else {
					continue
				}
			}
			surfaceID, hasSID := body["surfaceId"].(string)
			if envelopeKey == "createSurface" && hasSID {
				cid, _ := body["catalogId"].(string)
				infCID, transCID, err := snap.resolveSurfaceCatalogPair(cid, isV1_0, true)
				if err != nil {
					return nil, err
				}
				if transCID != cid {
					if transCID != "" {
						body["catalogId"] = transCID
					} else {
						delete(body, "catalogId")
					}
				}
				stagedSurfaces.set(surfaceID, infCID)
				stagedOps = append(stagedOps, surfaceOp{surfaceID: surfaceID, catalogID: infCID})
			}

			surfaceKnown := false
			surfaceCID := ""
			transportSurfaceCID := ""
			if hasSID {
				if trackedInfCID, ok := stagedSurfaces.get(surfaceID); ok {
					surfaceKnown = true
					var err error
					surfaceCID, transportSurfaceCID, err = snap.resolveSurfaceCatalogPair(trackedInfCID, isV1_0, false)
					if err != nil {
						return nil, err
					}
				}
			}

			if rawComps, hasComps := body["components"]; hasComps && rawComps != nil {
				compsList, err := toComponentMapSlice(rawComps)
				if err != nil {
					return nil, err
				}
				if len(compsList) > 0 {
					expandedComps, err := snap.expandComponentList(
						compsList,
						expandState{
							depth:                     0,
							surfaceID:                 surfaceID,
							surfaceCatalogID:          surfaceCID,
							transportSurfaceCatalogID: transportSurfaceCID,
							surfaceKnown:              surfaceKnown,
							protocolVersion:           protocolVersion,
							activeMacros:              make(map[string]bool),
							enclosingCatalogID:        "",
						},
					)
					if err != nil {
						return nil, err
					}
					anySlice := make([]any, len(expandedComps))
					for i, c := range expandedComps {
						anySlice[i] = c
					}
					body["components"] = anySlice
				}
			}
		}

		result = append(result, msgDict)
	}

	for _, op := range stagedOps {
		if op.isDelete {
			activeSurfaces.delete(op.surfaceID)
		} else {
			activeSurfaces.set(op.surfaceID, op.catalogID)
		}
	}
	return result, nil
}

func toComponentMapSlice(raw any) ([]map[string]any, error) {
	switch list := raw.(type) {
	case []map[string]any:
		out := make([]map[string]any, len(list))
		for i, c := range list {
			cloned, _ := core.CloneJSONValue(c).(map[string]any)
			out[i] = cloned
		}
		return out, nil
	case []any:
		out := make([]map[string]any, 0, len(list))
		for i, elem := range list {
			m, ok := toStringAnyMap(elem)
			if !ok {
				return nil, core.NewValidationErrorf("component[%d] must be an object, got %T", i, elem)
			}
			cloned, _ := core.CloneJSONValue(m).(map[string]any)
			out = append(out, cloned)
		}
		return out, nil
	default:
		rv := reflect.ValueOf(raw)
		if rv.IsValid() && (rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array) {
			out := make([]map[string]any, 0, rv.Len())
			for i := range rv.Len() {
				elem := rv.Index(i).Interface()
				m, ok := toStringAnyMap(elem)
				if !ok {
					return nil, core.NewValidationErrorf("component[%d] must be an object, got %T", i, elem)
				}
				cloned, _ := core.CloneJSONValue(m).(map[string]any)
				out = append(out, cloned)
			}
			return out, nil
		}
		return nil, core.NewValidationErrorf("components must be an array, got %T", raw)
	}
}

type expandState struct {
	depth                     int
	surfaceID                 string
	surfaceCatalogID          string
	transportSurfaceCatalogID string
	surfaceKnown              bool
	protocolVersion           string
	activeMacros              map[string]bool
	enclosingCatalogID        string
}

func (s expanderSnapshot) isInAnyBaseCatalog(compName string) bool {
	for _, comps := range s.catalogBaseComponents {
		if comps[compName] {
			return true
		}
	}
	return false
}

func (s expanderSnapshot) hasAnyBaseCatalogComponents() bool {
	for _, comps := range s.catalogBaseComponents {
		if len(comps) > 0 {
			return true
		}
	}
	return false
}

func (s expanderSnapshot) inheritsEnclosingCatalog(compName string, st expandState) bool {
	if st.depth == 0 || st.enclosingCatalogID == "" {
		return false
	}
	if _, registered := s.catalogBaseComponents[st.surfaceCatalogID]; st.surfaceCatalogID != "" &&
		st.surfaceCatalogID != st.enclosingCatalogID &&
		st.surfaceCatalogID != s.macroCatalogID &&
		!registered {
		return false
	}
	if s.isInAnyBaseCatalog(compName) {
		return false
	}
	if st.activeMacros[compName] && !s.hasAnyBaseCatalogComponents() {
		return false
	}
	return true
}

func (s expanderSnapshot) expandComponentList(components []map[string]any, st expandState) ([]map[string]any, error) {
	if st.depth > s.maxDepth {
		return nil, core.NewRecursionError(
			fmt.Sprintf("macro expansion exceeded maximum recursion depth of %d", s.maxDepth),
		)
	}

	isV1_0 := s.isV1_0Envelope(st.protocolVersion)
	expanded := make([]map[string]any, 0, len(components))

	for _, comp := range components {
		cName, ok := comp["component"].(string)
		if !ok || cName == "" {
			expanded = append(expanded, comp)
			continue
		}
		cID, _ := comp["id"].(string)

		meta := s.macroMap[cName]
		effectiveCatalogID := ""
		var rawCID any // nil when omitted or explicit null
		if meta != nil {
			rawCID = envelope.Value(comp, "catalogId", isV1_0, meta.customEnvelope)
		}

		if meta != nil {
			if rawCID != nil {
				cidStr, ok := rawCID.(string)
				if !ok || cidStr == "" {
					s.logger.Warn("skipping macro on component with invalid catalogId", "macro", cName, "id", cID, "catalogId", rawCID)
					meta = nil
				} else {
					effectiveCatalogID = cidStr
				}
			} else if s.inheritsEnclosingCatalog(cName, st) {
				effectiveCatalogID = st.enclosingCatalogID
			} else {
				effectiveCatalogID = st.surfaceCatalogID
			}
		}

		if meta != nil && st.depth > 0 && rawCID == nil {
			if s.isInAnyBaseCatalog(cName) {
				meta = nil
			}
		}

		if meta != nil && st.activeMacros[cName] {
			isBasePrimitive := effectiveCatalogID != st.enclosingCatalogID ||
				(effectiveCatalogID != "" && s.catalogBaseComponents[effectiveCatalogID][cName]) ||
				(rawCID == nil && s.isInAnyBaseCatalog(cName))
			if isBasePrimitive {
				meta = nil
			}
		}

		if meta != nil {
			if s.catalogID != "" {
				if effectiveCatalogID != s.catalogID {
					meta = nil
				}
			} else if len(s.catalogBaseComponents) > 0 && effectiveCatalogID != "" {
				_, registered := s.catalogBaseComponents[effectiveCatalogID]
				if !registered && effectiveCatalogID != s.macroCatalogID {
					meta = nil
				} else if s.catalogBaseComponents[effectiveCatalogID][cName] &&
					(s.passthroughFilter == nil || s.passthroughFilter(cName)) {
					meta = nil
				}
			}
		}

		if meta == nil {
			expanded = append(expanded, comp)
			continue
		}

		params := extractMacroInvocationParams(comp, meta, isV1_0)
		expandedMacro, err := s.executeSingleMacro(meta, params, cID, st.protocolVersion)
		if err == nil {
			applyRootEnvelopeFields(comp, meta, expandedMacro, cID, isV1_0)
			nextActive := make(map[string]bool, len(st.activeMacros)+1)
			for k, v := range st.activeMacros {
				nextActive[k] = v
			}
			nextActive[cName] = true
			nextEnclosing := effectiveCatalogID
			if nextEnclosing == "" {
				nextEnclosing = s.catalogID
			}
			expandedMacro, err = s.expandComponentList(expandedMacro, expandState{
				depth:                     st.depth + 1,
				surfaceID:                 st.surfaceID,
				surfaceCatalogID:          st.surfaceCatalogID,
				transportSurfaceCatalogID: st.transportSurfaceCatalogID,
				surfaceKnown:              st.surfaceKnown,
				protocolVersion:           st.protocolVersion,
				activeMacros:              nextActive,
				enclosingCatalogID:        nextEnclosing,
			})
		}

		if err != nil {
			var recErr *core.RecursionError
			if errors.As(err, &recErr) {
				return nil, recErr
			}
			var protoErr *macroProtocolError
			if errors.As(err, &protoErr) {
				return nil, protoErr
			}
			var catErr *core.CatalogError
			if errors.As(err, &catErr) {
				return nil, catErr
			}
			if s.onError == OnErrorRaise {
				var valErr *core.ValidationError
				if errors.As(err, &valErr) {
					return nil, valErr
				}
				return nil, core.NewValidationErrorf("failed to expand macro %q (id=%q): %v", cName, cID, err)
			}
			s.logger.Error("failed to expand macro; retaining unexpanded component", "macro", cName, "id", cID, "err", err)
			expanded = append(expanded, comp)
			continue
		}

		if st.depth == 0 {
			if err := s.stampLoweredPrimitives(expandedMacro, st.surfaceID, st.transportSurfaceCatalogID, st.surfaceKnown, isV1_0); err != nil {
				return nil, err
			}
		}
		expanded = append(expanded, expandedMacro...)
	}

	return expanded, nil
}

func extractMacroInvocationParams(comp map[string]any, meta *Macro, isV1_0 bool) map[string]any {
	if !meta.HasParameter("parameters") {
		if nestedParams, ok := toStringAnyMap(comp["parameters"]); ok {
			params := make(map[string]any, len(nestedParams)+len(meta.customEnvelope))
			for k, v := range nestedParams {
				params[k] = v
			}
			for envKey := range meta.customEnvelope {
				if val, present := comp[envKey]; present && (val != nil || meta.paramMap[envKey].GoType == anyIfaceType) {
					if _, exists := params[envKey]; !exists {
						params[envKey] = val
					}
				}
			}
			return params
		}
	}

	params := make(map[string]any, len(comp))
	for k, v := range comp {
		if k == "component" || k == "id" {
			continue
		}
		if k == "parameters" && !meta.HasParameter("parameters") {
			continue
		}
		if envelope.IsEnvelopeKey(k, isV1_0, meta.customEnvelope) {
			continue
		}
		params[k] = v
	}
	return params
}

func (s expanderSnapshot) executeSingleMacro(
	meta *Macro,
	args map[string]any,
	instanceID string,
	protocolVersion string,
) ([]map[string]any, error) {
	envFamily := s.targetFamily
	if protocolVersion != "" {
		var err error
		envFamily, err = normalizeVersionFamily(protocolVersion)
		if err != nil {
			return nil, err
		}
	}
	if meta.targetVersion != builder.VersionFamilyUnspecified && envFamily != builder.VersionFamilyUnspecified && meta.targetVersion != envFamily {
		return nil, newMacroProtocolErrorf("cannot expand v%s macro %q under A2UI protocol %s", meta.targetVersion, meta.name, protocolVersion)
	}
	effectiveFamily := meta.targetVersion
	if effectiveFamily == builder.VersionFamilyUnspecified {
		effectiveFamily = envFamily
	}
	useV1_0 := effectiveFamily == builder.VersionFamily1_0

	rootNode, err := meta.invoke(args, useV1_0)
	if err != nil {
		return nil, err
	}
	if builder.IsNilValue(rootNode) {
		return nil, fmt.Errorf("macro %q returned nil root node", meta.name)
	}

	nodeVersions := make(map[builder.VersionFamily]bool)
	collectReturnedNodeVersions(rootNode, nodeVersions, make(map[uintptr]bool))
	if len(nodeVersions) > 1 {
		return nil, newMacroProtocolErrorf("macro %q returned mixed A2UI v0.9 and v1.0 builder nodes", meta.name)
	}
	if effectiveFamily != builder.VersionFamilyUnspecified && len(nodeVersions) == 1 && !nodeVersions[effectiveFamily] {
		var emitted builder.VersionFamily
		for f := range nodeVersions {
			emitted = f
		}
		return nil, newMacroProtocolErrorf("macro %q returned v%s builder nodes, expected v%s", meta.name, emitted, effectiveFamily)
	}

	flattened, err := builder.FlattenComponentTree(rootNode, instanceID)
	if err != nil {
		return nil, err
	}

	if useV1_0 || nodeVersions[builder.VersionFamily1_0] {
		if err := validateV1_0MacroName(meta.name); err != nil {
			return nil, err
		}
		for _, comp := range flattened {
			if compName, ok := comp["component"].(string); ok && isNFKCSurface(compName) {
				return nil, newMacroProtocolErrorf("macro %q emitted reserved component name \"Surface\"", meta.name)
			}
		}
	}
	return flattened, nil
}

// applyRootEnvelopeFields merges the envelope fields of the macro instance comp onto the
// root of its expansion, as the package documentation describes. The instance's catalogId
// names the macro catalog, so it is never copied.
func applyRootEnvelopeFields(
	comp map[string]any,
	meta *Macro,
	expandedMacro []map[string]any,
	instanceID string,
	isV1_0 bool,
) {
	if len(expandedMacro) == 0 {
		return
	}
	rootComp := expandedMacro[len(expandedMacro)-1]
	if instanceID != "" {
		for i := len(expandedMacro) - 1; i >= 0; i-- {
			if expandedMacro[i]["id"] == instanceID {
				rootComp = expandedMacro[i]
				break
			}
		}
	}

	read := func(name string) any {
		return instanceEnvelopeValue(comp, name, isV1_0, meta.customEnvelope)
	}

	if a11y := read("accessibility"); a11y != nil {
		key := envelope.Key("accessibility", isV1_0)
		a11yCopy := core.CloneJSONValue(a11y)
		rootA11y, okRoot := toStringAnyMap(rootComp[key])
		inA11y, okIn := toStringAnyMap(a11yCopy)
		if okRoot && okIn {
			merged := make(map[string]any, len(rootA11y)+len(inA11y))
			for k, v := range rootA11y {
				merged[k] = v
			}
			for k, v := range inA11y {
				merged[k] = core.CloneJSONValue(v)
			}
			rootComp[key] = merged
		} else if okIn {
			normalized := make(map[string]any, len(inA11y))
			for k, v := range inA11y {
				normalized[k] = core.CloneJSONValue(v)
			}
			rootComp[key] = normalized
		} else {
			rootComp[key] = a11yCopy
		}
	}

	if checks := read("checks"); checks != nil {
		key := envelope.Key("checks", isV1_0)
		checksCopy := core.CloneJSONValue(checks)
		rootChecks, okRoot := toAnySlice(rootComp[key])
		inChecks, okIn := toAnySlice(checksCopy)
		if okRoot && okIn {
			rootComp[key] = slices.Concat(rootChecks, inChecks)
		} else if okIn {
			rootComp[key] = inChecks
		} else {
			rootComp[key] = checksCopy
		}
	}

	if !isV1_0 {
		return
	}

	if metadata := read("metadata"); metadata != nil {
		key := envelope.Key("metadata", isV1_0)
		metaCopy := core.CloneJSONValue(metadata)
		rootMeta, okRoot := toStringAnyMap(rootComp[key])
		inMeta, okIn := toStringAnyMap(metaCopy)
		if okRoot && okIn {
			mergedMeta := make(map[string]any, len(rootMeta)+len(inMeta))
			for k, v := range rootMeta {
				mergedMeta[k] = v
			}
			for k, v := range inMeta {
				mergedMeta[k] = core.CloneJSONValue(v)
			}
			rootExt, okRootExt := toStringAnyMap(rootMeta["extensions"])
			inExt, okInExt := toStringAnyMap(inMeta["extensions"])
			if okRootExt && okInExt {
				mergedExt := make(map[string]any, len(rootExt)+len(inExt))
				for k, v := range rootExt {
					mergedExt[k] = core.CloneJSONValue(v)
				}
				for k, v := range inExt {
					mergedExt[k] = core.CloneJSONValue(v)
				}
				mergedMeta["extensions"] = mergedExt
			} else if okInExt {
				normalizedExt := make(map[string]any, len(inExt))
				for k, v := range inExt {
					normalizedExt[k] = core.CloneJSONValue(v)
				}
				mergedMeta["extensions"] = normalizedExt
			}
			rootComp[key] = mergedMeta
		} else if okIn {
			normalizedMeta := make(map[string]any, len(inMeta))
			for k, v := range inMeta {
				normalizedMeta[k] = core.CloneJSONValue(v)
			}
			if inExt, okInExt := toStringAnyMap(inMeta["extensions"]); okInExt {
				normalizedExt := make(map[string]any, len(inExt))
				for k, v := range inExt {
					normalizedExt[k] = core.CloneJSONValue(v)
				}
				normalizedMeta["extensions"] = normalizedExt
			}
			rootComp[key] = normalizedMeta
		} else {
			rootComp[key] = metaCopy
		}
	}
}

// instanceEnvelopeValue reads the envelope field name from the macro instance comp, or
// returns nil when the instance does not set it. From v1.0 the @-prefixed key wins and the
// bare key is a legacy fallback; in every version, a bare key that the macro declares as a
// parameter is a macro argument rather than the envelope field.
func instanceEnvelopeValue(comp map[string]any, name string, isV1_0 bool, customEnvelope map[string]bool) any {
	key, ok := envelope.ReadKey(comp, name, isV1_0, customEnvelope)
	if !ok || (key == name && customEnvelope[name]) {
		return nil
	}
	return comp[key]
}

func (s expanderSnapshot) stampLoweredPrimitives(
	primitives []map[string]any,
	surfaceID string,
	transportSurfaceCID string,
	surfaceKnown bool,
	isV1_0 bool,
) error {
	if !isV1_0 || !surfaceKnown || len(s.registeredBaseCIDs) == 0 {
		return nil
	}
	for _, prim := range primitives {
		pName, ok := prim["component"].(string)
		if !ok || pName == "" {
			continue
		}
		if s.onError == OnErrorPassthrough && s.macroMap[pName] != nil && !s.findInRegisteredBaseCatalogs(pName) {
			continue
		}
		owners := s.owningBaseCatalogs(pName)
		var customEnvelope map[string]bool
		if _, hasAtKey := prim["@catalogId"]; !hasAtKey && prim["catalogId"] != nil && s.declaresCustomCatalogID(pName, owners) {
			customEnvelope = map[string]bool{"catalogId": true}
		}
		if envelope.Value(prim, "catalogId", true, customEnvelope) != nil {
			continue
		}

		if transportSurfaceCID == "" {
			switch len(owners) {
			case 1:
				prim["@catalogId"] = owners[0]
			case 0:
				return core.NewCatalogErrorf(
					"expanded component %q has no catalogId on defaultless surface %q and is not found in any registered base catalog: %v",
					pName, surfaceID, s.registeredBaseCIDs,
				)
			default:
				return core.NewCatalogErrorf(
					"expanded component %q has no catalogId on defaultless surface %q and is defined in multiple base catalogs %v; set CatalogID explicitly on the builder node",
					pName, surfaceID, owners,
				)
			}
		} else if slices.Contains(s.registeredBaseCIDs, transportSurfaceCID) && !s.catalogBaseComponents[transportSurfaceCID][pName] {
			switch len(owners) {
			case 1:
				prim["@catalogId"] = owners[0]
			case 0:
				return core.NewCatalogErrorf(
					"expanded component %q has no catalogId on surface %q (default %q) and is not found in any registered base catalog: %v",
					pName, surfaceID, transportSurfaceCID, s.registeredBaseCIDs,
				)
			default:
				return core.NewCatalogErrorf(
					"expanded component %q has no catalogId on surface %q (default %q) and is defined in multiple base catalogs %v; set CatalogID explicitly on the builder node",
					pName, surfaceID, transportSurfaceCID, owners,
				)
			}
		}
	}
	return nil
}

// declaresCustomCatalogID reports whether every base catalog in owners declares catalogId as
// an ordinary property of compName, so that a bare catalogId on a lowered primitive is that
// property rather than the legacy form of @catalogId.
func (s expanderSnapshot) declaresCustomCatalogID(compName string, owners []string) bool {
	if len(owners) == 0 {
		return false
	}
	for _, cid := range owners {
		cat := s.baseCatalogs[cid]
		if cat == nil || !s.schemaHelpers.get(cid, cat).CustomEnvelopeProperties(compName)["catalogId"] {
			return false
		}
	}
	return true
}

func (s expanderSnapshot) findInRegisteredBaseCatalogs(compName string) bool {
	for _, cid := range s.registeredBaseCIDs {
		if s.catalogBaseComponents[cid][compName] {
			return true
		}
	}
	return false
}

func (s expanderSnapshot) owningBaseCatalogs(compName string) []string {
	var owners []string
	for _, cid := range s.registeredBaseCIDs {
		if s.catalogBaseComponents[cid][compName] {
			owners = append(owners, cid)
		}
	}
	return owners
}

func schemaVersionFamily(isV1_0 bool) builder.VersionFamily {
	if isV1_0 {
		return builder.VersionFamily1_0
	}
	return builder.VersionFamily0_9
}
