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

package core_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/a2ui-project/a2ui/go/core"
)

var (
	surfaceStateExpectKeys = keySet("surfaces")
	surfaceExpectKeys      = keySet(
		"components", "dataModel", "exists", "isValid", "metadata",
		"sendDataModel", "theme", "validationErrors", "validationResult", "validationResults",
	)
	validateCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "catalog", "catalogPaths", "catalogs", "expect",
		"expect_error", "expectError", "messages", "payload",
		"protocolVersion", "steps", "strictMode",
	))
	validateStepKeys = keySet(
		"expect", "expect_error", "expectError", "message", "messages", "payload",
	)
	processMessagesCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "catalog", "catalogPaths", "catalogs", "expect", "expectError",
		"messages", "options", "payload", "protocolVersion", "steps",
		"strict_mode", "strictMode", "validationConfig",
	))
	processMessagesStepKeys = keySet(
		"expect", "expectError", "message", "messages", "payload", "validationConfig",
	)
	caseValidationFlagKeys = keySet(
		"allowOrphanComponents", "allowDanglingReferences",
		"allowMissingRoot", "allowUnknownElements",
	)
	capabilitiesCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "args", "catalog", "catalogs", "expect", "protocolVersion",
	))
	capabilitiesArgsKeys = keySet(
		"componentEnvelopeRef", "includeInlineCatalogs", "version", "versions",
	)
	fromJSONCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "catalog", "catalogFile", "catalogId", "catalogPath",
		"catalogSchema", "expect", "expectError", "protocolVersion", "schema",
	))
	fromJSONExpectKeys = keySet(
		"catalogId", "componentMetadata", "components", "functions",
		"invalidComponents", "matchesBuiltinCatalog", "protocolVersion",
		"selfContained", "theme", "validComponents",
	)
	deriveCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "args", "catalog", "catalogFile", "catalogId", "catalogPath",
		"catalogSchema", "expect", "expectError", "protocolVersion", "schema",
	))
	deriveArgsKeys   = keySet("catalogId", "components", "functions", "instructions")
	deriveExpectKeys = keySet(
		"absentKeys", "catalogId", "components", "functions",
		"instructions", "protocolVersion", "theme",
	)
	validationSchemaCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "catalog", "catalogFile", "catalogId", "catalogPath",
		"catalogSchema", "expectError", "expectFile", "protocolVersion", "schema",
	))
	roundTripCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "catalog", "catalogFile", "catalogId", "catalogPath",
		"catalogSchema", "protocolVersion", "schema",
	))
	toJSONCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "builtinCatalog", "catalog", "catalogFile", "catalogId",
		"catalogPath", "catalogSchema", "expectFile", "protocolVersion", "schema",
	))
	schemaExportCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "expectFile", "protocolVersion",
	))
	validateCommonTypeCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "definition", "protocolVersion", "steps",
	))
	validateCommonTypeStepKeys = keySet("expectError", "value")
	resolvePathCaseKeys        = unionKeys(caseMetadataKeys, keySet(
		"action", "args", "catalog", "expect",
	))
	resolvePathArgsKeys = keySet("context_path", "contextPath", "path")
	dataModelCaseKeys   = unionKeys(caseMetadataKeys, keySet(
		"action", "catalog", "expect", "initial", "steps", "watch",
	))
	dataModelStepKeysByOp = map[string]map[string]bool{
		"get":          keySet("op", "path", "expect", "expect_absent", "expect_type", "expect_error", "expectError", "expect_notified", "expect_values"),
		"set":          keySet("op", "path", "value", "expect_error", "expectError", "expect_notified", "expect_values"),
		"delete":       keySet("op", "path", "expect_error", "expectError", "expect_notified", "expect_values"),
		"dispose":      keySet("op", "expect_error", "expectError", "expect_notified", "expect_values"),
		"mutate_input": keySet("op", "path", "value", "expect_error", "expectError", "expect_notified", "expect_values"),
	}
	getDataModelCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "args", "catalogPaths", "expect", "messages", "payload", "protocolVersion", "steps",
	))
	getDataModelArgsKeys  = keySet("version")
	getDataModelStepKeys  = keySet("messages", "payload")
	selectCatalogCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "args", "catalog", "expectError", "expectSelected",
	))
	selectCatalogArgsKeys         = keySet("catalogs", "components", "functionCall", "surface")
	selectCatalogSurfaceKeys      = keySet("defaultCatalogId", "id", "supportedCatalogIds")
	selectCatalogFunctionCallKeys = keySet("@call", "args", "call", "catalogId")
	parseExprCaseKeys             = unionKeys(caseMetadataKeys, keySet(
		"action", "expect", "expect_error", "expectError", "input",
	))
	dispatchActionCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "actionPayload", "catalog", "catalogPaths", "catalogs",
		"dataModel", "expectDataModel", "expectDispatched", "expectError",
		"metadata", "protocolVersion", "scope", "sourceComponentId",
		"surfaceId", "useBasicCatalog", "userActivation",
	))
	expectDispatchedKeys = keySet(
		"catalogId", "context", "hasTimestamp", "metadata", "name",
		"sourceComponentId", "surfaceId", "timestampIso8601", "userMessage",
	)
	evaluateFunctionCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "args", "catalogId", "catalogPaths", "dataModel", "expect",
		"expect_error", "expectError", "function", "locale", "protocolVersion",
		"surface", "useBasicCatalog",
	))
	evaluateFunctionSurfaceKeys = keySet("catalogId")
)

func mustBasicCatalog(t *testing.T, ver core.ProtocolVersion) *core.Catalog {
	t.Helper()
	cat, err := core.BasicCatalog(ver)
	if err != nil {
		t.Fatalf("BasicCatalog(%s): %v", ver, err)
	}
	return cat
}

func basicCatalogForVersionStr(t *testing.T, pVer string) *core.Catalog {
	t.Helper()
	if strings.Contains(pVer, "1.0") {
		return mustBasicCatalog(t, core.Version1_0)
	}
	if strings.Contains(pVer, "0.8") {
		return mustBasicCatalog(t, core.Version0_8)
	}
	return mustBasicCatalog(t, core.Version0_9)
}

// deriveTestCatalog derives a catalog named catalogID from base, keeping the $defs its schemas reference.
// A nil components or functions list keeps all of base's entries; an empty list keeps none.
func deriveTestCatalog(t *testing.T, base *core.Catalog, catalogID, protocolVersion string, components, functions []any) *core.Catalog {
	t.Helper()
	derived, err := base.Derive(core.DeriveOptions{
		CatalogID:       catalogID,
		ProtocolVersion: core.ProtocolVersion(protocolVersion),
		Components:      components,
		Functions:       functions,
	})
	if err != nil {
		t.Fatalf("Derive(%s from %s): %v", catalogID, base.CatalogID(), err)
	}
	return derived
}

func loadCatalogPathForCase(t *testing.T, relPath string) *core.Catalog {
	t.Helper()
	full := filepath.Join(repoRootDir(t), filepath.FromSlash(relPath))
	raw, err := os.ReadFile(full)
	if err != nil {
		t.Fatalf("read catalogPath %s: %v", relPath, err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("unmarshal catalogPath %s: %v", relPath, err)
	}
	cID, _ := doc["catalogId"].(string)
	for _, ver := range []core.ProtocolVersion{core.Version0_8, core.Version0_9, core.Version1_0} {
		sdkCat := mustBasicCatalog(t, ver)
		if cID == sdkCat.CatalogID() {
			return sdkCat
		}
	}
	rawPVer, _ := doc["protocolVersion"].(string)
	cat, err := core.CatalogFromJSONBytes(raw, &core.CatalogLoadOptions{
		CatalogID:       cID,
		ProtocolVersion: core.ProtocolVersion(rawPVer),
	})
	if err != nil {
		t.Fatalf("CatalogFromJSONBytes(%s): %v", relPath, err)
	}
	return cat
}

func buildInlineCatalogForTest(t *testing.T, spec map[string]any, cID, pVer, action string, forbidUnlistedFunctions bool) *core.Catalog {
	t.Helper()
	_, hasComps := spec["components"]
	_, hasTheme := spec["theme"]
	_, hasFuncs := spec["functions"]
	if (hasComps && spec["components"] != nil) || (hasTheme && spec["theme"] != nil) || (hasFuncs && spec["functions"] != nil) {
		cSchema := map[string]any{"catalogId": cID}
		if s, ok := spec["$schema"]; ok {
			cSchema["$schema"] = s
		}
		if pv, ok := spec["protocolVersion"]; ok {
			cSchema["protocolVersion"] = pv
		}
		if forbidUnlistedFunctions && spec["functions"] == nil {
			if _, hasDefs := spec["$defs"]; !hasDefs {
				cSchema["$defs"] = map[string]any{"anyFunction": map[string]any{"not": map[string]any{}}}
			}
		}
		if spec["components"] != nil {
			cSchema["components"] = spec["components"]
		}
		if spec["theme"] != nil {
			cSchema["theme"] = spec["theme"]
		}
		if spec["functions"] != nil {
			cSchema["functions"] = spec["functions"]
		}
		if defs, ok := spec["$defs"]; ok {
			cSchema["$defs"] = defs
		}
		cat, err := core.CatalogFromJSON(cSchema, &core.CatalogLoadOptions{
			CatalogID:       cID,
			ProtocolVersion: core.ProtocolVersion(pVer),
		})
		if err != nil {
			t.Fatalf("buildInlineCatalog CatalogFromJSON: %v", err)
		}
		return cat
	}
	isCap := action == "get_client_capabilities" || action == "get_renderer_capabilities"
	if isCap {
		cat, err := core.NewCatalog(cID, pVer, nil, nil)
		if err != nil {
			t.Fatalf("NewCatalog(%s, %s): %v", cID, pVer, err)
		}
		return cat
	}
	return deriveTestCatalog(t, mustBasicCatalog(t, core.Version0_9), cID, pVer, nil, []any{})
}

func getCatalogsForTestCase(t *testing.T, caseMap map[string]any) []*core.Catalog {
	t.Helper()
	version := resolveProtocolVersionFromCase(caseMap)
	if version == "" {
		version = "v0.9"
	}
	v08Cat := mustBasicCatalog(t, core.Version0_8)
	v09Cat := mustBasicCatalog(t, core.Version0_9)
	v10Cat := mustBasicCatalog(t, core.Version1_0)
	curBasic := basicCatalogForVersionStr(t, version)

	catalogsMap := map[string]*core.Catalog{
		v08Cat.CatalogID(): v08Cat,
		v09Cat.CatalogID(): v09Cat,
		v10Cat.CatalogID(): v10Cat,
		"basic":            v09Cat,
		"v0.8:basic":       v08Cat,
		"v0.9:basic":       v09Cat,
		"v1.0:basic":       v10Cat,
	}
	catalogsMap["standard"] = deriveTestCatalog(t, v09Cat, "standard", "v0.9", nil, []any{})
	if version == "1.0" || version == "v1.0" {
		catalogsMap["basic"] = deriveTestCatalog(t, v10Cat, "basic", "1.0", nil, nil)
	}

	var mapOrder []string
	for k := range catalogsMap {
		mapOrder = append(mapOrder, k)
	}
	sort.Strings(mapOrder)

	var specified []*core.Catalog
	actionStr, _ := caseMap["action"].(string)

	// 1. Single catalog spec
	if catSpec, ok := caseMap["catalog"].(map[string]any); ok {
		pVer := version
		if innerSchema, hasInner := catSpec["catalogSchema"].(map[string]any); hasInner {
			cID := resolveCatalogIDFromCase(caseMap)
			if cID == "" {
				cID = fmt.Sprintf("catalog-%v", caseMap["name"])
			}
			cat, err := core.CatalogFromJSON(innerSchema, &core.CatalogLoadOptions{
				CatalogID:       cID,
				ProtocolVersion: core.ProtocolVersion(pVer),
			})
			if err != nil {
				t.Fatalf("CatalogFromJSON single catalogSchema: %v", err)
			}
			catalogsMap[cID] = cat
			specified = append(specified, cat)
		} else if _, hasComps := catSpec["components"]; hasComps || catSpec["catalogId"] != nil {
			cID, _ := catSpec["catalogId"].(string)
			if cID == "" {
				cID = resolveCatalogIDFromCase(caseMap)
			}
			if cID == "" {
				cID = fmt.Sprintf("catalog-%v", caseMap["name"])
			}
			cat := buildInlineCatalogForTest(t, catSpec, cID, pVer, actionStr, true)
			catalogsMap[cID] = cat
			specified = append(specified, cat)
		}
	}

	// 2. Catalogs list spec
	if catList, ok := caseMap["catalogs"].([]any); ok {
		for _, rawItem := range catList {
			item, ok := rawItem.(map[string]any)
			if !ok {
				continue
			}
			if cSchema, hasCS := item["catalogSchema"].(map[string]any); hasCS {
				cID, _ := cSchema["catalogId"].(string)
				if cID == "" {
					cID, _ = item["catalogId"].(string)
				}
				pVer, _ := item["protocolVersion"].(string)
				if pVer == "" {
					pVer, _ = cSchema["protocolVersion"].(string)
				}
				if pVer == "" {
					pVer = "v0.9"
				}
				if cID != "" {
					cat, err := core.CatalogFromJSON(cSchema, &core.CatalogLoadOptions{
						CatalogID:       cID,
						ProtocolVersion: core.ProtocolVersion(pVer),
					})
					if err != nil {
						t.Fatalf("CatalogFromJSON list catalogSchema: %v", err)
					}
					catalogsMap[cID] = cat
					specified = append(specified, cat)
				}
			} else if cID, hasCID := item["catalogId"].(string); hasCID && cID != "" {
				pVer, _ := item["protocolVersion"].(string)
				if pVer == "" {
					pVer = version
				}
				cat := buildInlineCatalogForTest(t, item, cID, pVer, actionStr, false)
				catalogsMap[cID] = cat
				specified = append(specified, cat)
			}
		}
	}

	// 3. catalogPaths spec
	if paths, ok := caseMap["catalogPaths"].([]any); ok {
		basicIDs := map[string]bool{
			v10Cat.CatalogID(): true,
			v09Cat.CatalogID(): true,
			v08Cat.CatalogID(): true,
		}
		for _, rp := range paths {
			pStr, _ := rp.(string)
			full := filepath.Join(repoRootDir(t), filepath.FromSlash(pStr))
			raw, err := os.ReadFile(full)
			if err != nil {
				t.Fatalf("catalogPaths read %s: %v", pStr, err)
			}
			var cJSON map[string]any
			if err := json.Unmarshal(raw, &cJSON); err != nil {
				t.Fatalf("catalogPaths unmarshal %s: %v", pStr, err)
			}
			cID, _ := cJSON["catalogId"].(string)
			if cID == "" {
				cID, _ = cJSON["id"].(string)
			}
			if cID == "" {
				cID = "test-catalog"
			}
			if basicIDs[cID] || strings.Contains(pStr, "basic/catalog.json") {
				matching := basicCatalogForVersionStr(t, version)
				specified = append(specified, matching)
				catalogsMap[cID] = matching
				continue
			}
			cat, err := core.CatalogFromJSONBytes(raw, &core.CatalogLoadOptions{
				CatalogID:       cID,
				ProtocolVersion: core.ProtocolVersion(version),
			})
			if err != nil {
				t.Fatalf("catalogPaths CatalogFromJSONBytes(%s): %v", pStr, err)
			}
			specified = append(specified, cat)
			if cID != "test-catalog" {
				testCat, err := core.CatalogFromJSONBytes(raw, &core.CatalogLoadOptions{
					CatalogID:       "test-catalog",
					ProtocolVersion: core.ProtocolVersion(version),
				})
				if err == nil {
					catalogsMap["test-catalog"] = testCat
					specified = append(specified, testCat)
				}
			}
		}
	}

	// 4. Scan messages for dynamic catalogIds unless expecting CatalogError
	expErrMap, _ := caseMap["expectError"].(map[string]any)
	expCat, _ := expErrMap["category"].(string)
	isCatErr := expCat == "CatalogError" || expCat == "A2uiCatalogError"
	if !isCatErr {
		addCatID := func(catID, scanVer string) {
			if catID == "" {
				return
			}
			for _, existing := range catalogsMap {
				if existing != nil && existing.CatalogID() == catID {
					return
				}
			}
			useVer := version
			if scanVer != "" {
				useVer = scanVer
			}
			catalogsMap[catID] = deriveTestCatalog(t, curBasic, catID, useVer, nil, []any{})
			mapOrder = append(mapOrder, catID)
		}
		scanMessagesForCatalogIDs(collectCaseMessages(caseMap), addCatID)
	}

	if (actionStr == "get_client_capabilities" || actionStr == "get_renderer_capabilities") && len(specified) > 0 {
		return specified
	}

	containsPtr := func(list []*core.Catalog, target *core.Catalog) bool {
		for _, c := range list {
			if c == target {
				return true
			}
		}
		return false
	}

	var out []*core.Catalog
	out = append(out, specified...)
	if !containsPtr(out, curBasic) {
		out = append(out, curBasic)
	}
	for _, k := range mapOrder {
		c := catalogsMap[k]
		if c != nil && !containsPtr(out, c) {
			out = append(out, c)
		}
	}
	// Include any newly added keys in deterministic order.
	var remainingKeys []string
	for k := range catalogsMap {
		remainingKeys = append(remainingKeys, k)
	}
	sort.Strings(remainingKeys)
	for _, k := range remainingKeys {
		c := catalogsMap[k]
		if c != nil && !containsPtr(out, c) {
			out = append(out, c)
		}
	}
	return out
}

func collectCaseMessages(caseMap map[string]any) []any {
	var out []any
	appendRaw := func(raw any) {
		switch v := raw.(type) {
		case []any:
			out = append(out, v...)
		case map[string]any:
			out = append(out, v)
		}
	}
	if msgs, ok := caseMap["messages"]; ok && msgs != nil {
		appendRaw(msgs)
	} else if p, ok := caseMap["payload"]; ok && p != nil {
		appendRaw(p)
	}
	if steps, ok := caseMap["steps"].([]any); ok {
		for _, rawStep := range steps {
			if sm, ok := rawStep.(map[string]any); ok {
				if msgs, ok := sm["messages"]; ok && msgs != nil {
					appendRaw(msgs)
				} else if p, ok := sm["payload"]; ok && p != nil {
					appendRaw(p)
				}
			}
		}
	}
	return out
}

func scanMessagesForCatalogIDs(messages []any, addCatID func(catID, scanVer string)) {
	var scanVer string
	var walk func(items []any)
	walk = func(items []any) {
		for _, item := range items {
			switch typed := item.(type) {
			case []any:
				walk(typed)
			case map[string]any:
				if v, ok := typed["version"].(string); ok {
					scanVer = v
				}
				if inner, ok := typed["messages"].([]any); ok {
					walk(inner)
				}
				for _, actionKey := range []string{"createSurface", "beginRendering"} {
					if sub, ok := typed[actionKey].(map[string]any); ok {
						if cid, ok := sub["catalogId"].(string); ok {
							addCatID(cid, scanVer)
						}
					}
				}
			}
		}
	}
	walk(messages)
}

type resolvedCompInfo struct {
	compType string
	props    map[string]any
}

func resolveSurfaceComponents(surface *core.SurfaceModel) map[string]resolvedCompInfo {
	resolved := map[string]resolvedCompInfo{}
	var resolveOne func(compID, dataPath, instanceKey string)
	resolveOne = func(compID, dataPath, instanceKey string) {
		if _, exists := resolved[instanceKey]; exists {
			return
		}
		comp := surface.ComponentsModel.Get(compID)
		if comp == nil {
			return
		}
		ctx, err := core.NewComponentContext(surface, compID, dataPath)
		if err != nil {
			return
		}
		binder := core.NewGenericBinder(ctx, false)
		props := map[string]any{}
		for k, v := range binder.CurrentProps {
			props[k] = v
		}
		binder.Dispose()

		for _, pVal := range props {
			pm, ok := pVal.(map[string]any)
			if !ok {
				continue
			}
			tplCompID, okID := pm["componentId"].(string)
			if !okID || tplCompID == "" {
				continue
			}
			rawTplPath, okP := pm["@path"].(string)
			if !okP {
				rawTplPath, okP = pm["path"].(string)
			}
			if !okP {
				continue
			}
			tplPath, _ := ctx.DataContext.ResolvePath(rawTplPath)
			arrVal, _, _ := surface.DataModel.Get(tplPath)
			arr, okArr := arrVal.([]any)
			if !okArr {
				continue
			}
			baseTpl := strings.TrimRight(tplPath, "/")
			for i := range arr {
				scoped := fmt.Sprintf("%s/%d", baseTpl, i)
				resolveOne(tplCompID, scoped, fmt.Sprintf("%s_%d", tplCompID, i))
				resolveOne(tplCompID, scoped, fmt.Sprintf("%s-[%s]", tplCompID, scoped))
			}
		}

		// Indexed suffix propagation for non-template children inside template items
		var idxSuffix string
		parts := strings.Split(strings.Trim(dataPath, "/"), "/")
		if len(parts) > 0 && parts[len(parts)-1] != "" {
			last := parts[len(parts)-1]
			if _, err := strconv.Atoi(last); err == nil {
				idxSuffix = last
			}
		}
		if idxSuffix != "" {
			for _, ref := range comp.ChildReferences() {
				resolveOne(ref.ID, dataPath, fmt.Sprintf("%s_%s", ref.ID, idxSuffix))
				resolveOne(ref.ID, dataPath, fmt.Sprintf("%s-[%s]", ref.ID, dataPath))
			}
		}

		resolved[instanceKey] = resolvedCompInfo{
			compType: comp.Type,
			props:    props,
		}
	}

	for _, compID := range surface.ComponentsModel.Keys() {
		resolveOne(compID, "/", compID)
	}
	return resolved
}

func assertExpectedSurfaceState(t *testing.T, caseKey string, proc *core.MessageProcessor, expected map[string]any) {
	t.Helper()
	if len(expected) == 0 {
		return
	}
	assertKnownKeys(t, expected, surfaceStateExpectKeys, "expect key", caseKey)
	surfacesMap, _ := expected["surfaces"].(map[string]any)
	for sID, rawSExp := range surfacesMap {
		sExp, _ := rawSExp.(map[string]any)
		assertKnownKeys(t, sExp, surfaceExpectKeys, fmt.Sprintf("expect.surfaces.%s key", sID), caseKey)
		surf := proc.Model.Surface(sID)
		if existsVal, hasExists := sExp["exists"].(bool); hasExists && !existsVal {
			if surf != nil {
				t.Fatalf("%s: expected surface %q not to exist", caseKey, sID)
			}
			continue
		}
		if surf == nil {
			t.Fatalf("%s: expected surface %q to exist", caseKey, sID)
		}
		if expTheme, ok := sExp["theme"]; ok {
			if !jsonValuesEqual(surf.Theme, expTheme) {
				t.Fatalf("%s: surface %q theme got %v, want %v", caseKey, sID, surf.Theme, expTheme)
			}
		}
		if expMeta, ok := sExp["metadata"]; ok {
			if !jsonValuesEqual(surf.Metadata, expMeta) {
				t.Fatalf("%s: surface %q metadata got %v, want %v", caseKey, sID, surf.Metadata, expMeta)
			}
		}
		if expSend, ok := sExp["sendDataModel"].(bool); ok {
			if surf.SendDataModel != expSend {
				t.Fatalf("%s: surface %q sendDataModel got %v, want %v", caseKey, sID, surf.SendDataModel, expSend)
			}
		}
		if expDM, ok := sExp["dataModel"]; ok {
			gotDM, _, _ := surf.DataModel.Get("/")
			if !jsonValuesEqual(gotDM, expDM) {
				t.Fatalf("%s: surface %q dataModel got %v, want %v", caseKey, sID, gotDM, expDM)
			}
		}
		if compsExp, ok := sExp["components"]; ok {
			assertSurfaceComponentsState(t, caseKey, sID, compsExp, surf)
		}
		for _, valField := range []string{"validationResult", "validationResults", "isValid", "validationErrors"} {
			if fieldExp, ok := sExp[valField].(map[string]any); ok {
				resolvedNodes := resolveSurfaceComponents(surf)
				for cID, expV := range fieldExp {
					nodeInfo, found := resolvedNodes[cID]
					if !found {
						t.Fatalf("%s: component node %q missing from surface %q", caseKey, cID, sID)
					}
					actualV := nodeInfo.props[valField]
					if !jsonValuesEqual(actualV, expV) {
						t.Fatalf("%s: %s mismatch on %q: got %v, want %v", caseKey, valField, cID, actualV, expV)
					}
				}
			}
		}
	}
}

func assertSurfaceComponentsState(t *testing.T, caseKey, sID string, compsExpected any, surf *core.SurfaceModel) {
	t.Helper()
	type compExpectPair struct {
		id  string
		exp any
	}
	var pairs []compExpectPair
	isList := false
	switch typed := compsExpected.(type) {
	case map[string]any:
		for k, v := range typed {
			pairs = append(pairs, compExpectPair{id: k, exp: v})
		}
	case []any:
		isList = true
		for _, item := range typed {
			if m, ok := item.(map[string]any); ok {
				cid, _ := m["id"].(string)
				pairs = append(pairs, compExpectPair{id: cid, exp: m})
			}
		}
	}
	resolvedNodes := resolveSurfaceComponents(surf)
	atLeastV10 := surf.ProtocolVersion != "" && core.IsAtLeastVersion(string(surf.ProtocolVersion), core.Version1_0)
	for _, pair := range pairs {
		comp := surf.ComponentsModel.Get(pair.id)
		nodeInfo, hasNode := resolvedNodes[pair.id]
		if comp == nil && !hasNode {
			t.Fatalf("%s: component %q missing from surface %q", caseKey, pair.id, sID)
		}
		cExp, ok := pair.exp.(map[string]any)
		if !ok {
			continue
		}
		cType := nodeInfo.compType
		if comp != nil {
			cType = comp.Type
		}
		if expType, ok := cExp["component"].(string); ok {
			if cType != expType {
				t.Fatalf("%s: component %q type got %q, want %q", caseKey, pair.id, cType, expType)
			}
		}
		if !atLeastV10 {
			if _, hasMeta := cExp["metadata"]; hasMeta && comp != nil {
				if comp.Metadata != nil {
					t.Fatalf("%s: pre-1.0 component %q expected nil Metadata, got %v", caseKey, pair.id, comp.Metadata)
				}
			}
		} else if expAtMeta, hasAtMeta := cExp["@metadata"]; hasAtMeta {
			if comp == nil || !jsonValuesEqual(comp.Metadata, expAtMeta) {
				t.Fatalf("%s: component %q @metadata got %v, want %v", caseKey, pair.id, comp.Metadata, expAtMeta)
			}
		}
		if !hasNode {
			continue
		}
		for pKey, pVal := range cExp {
			if pKey == "id" || pKey == "component" || pKey == "@metadata" {
				continue
			}
			actualVal := nodeInfo.props[pKey]
			if !propValueMatches(actualVal, pVal) {
				t.Fatalf("%s: property %q mismatch on component %q: got %#v, want %#v", caseKey, pKey, pair.id, actualVal, pVal)
			}
		}
	}
	if isList {
		allDirect := true
		for _, pair := range pairs {
			if surf.ComponentsModel.Get(pair.id) == nil {
				allDirect = false
				break
			}
		}
		if allDirect && len(surf.ComponentsModel.Keys()) != len(pairs) {
			t.Fatalf("%s: surface %q component count got %d, want %d", caseKey, sID, len(surf.ComponentsModel.Keys()), len(pairs))
		}
	}
}

func propValueMatches(actual, expected any) bool {
	if jsonValuesEqual(actual, expected) {
		return true
	}
	if _, isBool := actual.(bool); !isBool {
		if f, ok := toFloatNumeric(actual); ok && f == float64(int64(f)) {
			if es, okS := expected.(string); okS && strconv.FormatInt(int64(f), 10) == es {
				return true
			}
		}
	}
	return false
}

func stepMessagesFromMap(t *testing.T, caseKey string, step map[string]any, idx int) any {
	t.Helper()
	if msgs, ok := step["messages"]; ok && msgs != nil {
		return msgs
	}
	if p, ok := step["payload"]; ok && p != nil {
		return p
	}
	if m, ok := step["message"]; ok && m != nil {
		return []any{m}
	}
	t.Fatalf("%s: step %d has no messages or payload", caseKey, idx)
	return nil
}

func validatePureValidationCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, validateCaseKeys, "case key", caseKey)
	catalogs := getCatalogsForTestCase(t, caseMap)
	cfg := core.StrictValidation()
	if strict, ok := caseMap["strictMode"].(bool); ok && !strict {
		cfg = core.RelaxedValidation()
	}
	var capturedErrors []map[string]any
	proc, err := core.NewMessageProcessor(catalogs, &core.MessageProcessorOptions{
		ValidationConfig: &cfg,
		ErrorHandler: func(env map[string]any) {
			capturedErrors = append(capturedErrors, env)
		},
	})
	if err != nil {
		t.Fatalf("%s: NewMessageProcessor: %v", caseKey, err)
	}

	var steps []map[string]any
	hasSteps := false
	if rawSteps, ok := caseMap["steps"].([]any); ok {
		hasSteps = true
		for _, rs := range rawSteps {
			sm, _ := rs.(map[string]any)
			steps = append(steps, sm)
		}
	} else {
		steps = []map[string]any{caseMap}
	}
	if len(steps) == 0 {
		t.Fatalf("%s: validate case has no steps", caseKey)
	}

	for idx, step := range steps {
		if hasSteps {
			assertKnownKeys(t, step, validateStepKeys, fmt.Sprintf("steps[%d] key", idx), caseKey)
		}
		msgs := stepMessagesFromMap(t, caseKey, step, idx)
		isLast := idx == len(steps)-1
		expErr := step["expectError"]
		if expErr == nil {
			expErr = step["expect_error"]
		}
		if expErr == nil && isLast {
			expErr = caseMap["expectError"]
			if expErr == nil {
				expErr = caseMap["expect_error"]
			}
		}

		if expErr != nil {
			capturedErrors = nil
			var surfErrors []map[string]any
			for _, sid := range proc.Model.SurfaceIDs() {
				if s := proc.Model.Surface(sid); s != nil {
					s.OnError = append(s.OnError, func(e map[string]any) { surfErrors = append(surfErrors, e) })
				}
			}
			stepErr := proc.ProcessPayload(msgs, nil)
			if stepErr == nil {
				for _, sid := range proc.Model.SurfaceIDs() {
					if s := proc.Model.Surface(sid); s != nil {
						s.OnError = append(s.OnError, func(e map[string]any) { surfErrors = append(surfErrors, e) })
						resolveSurfaceComponents(s)
					}
				}
				if len(surfErrors) > 0 {
					first := surfErrors[0]
					msgStr, _ := first["message"].(string)
					if msgStr == "" {
						msgStr = "Expression error"
					}
					ve := core.NewValidationError(msgStr)
					ve.Code, _ = first["code"].(string)
					ve.Path, _ = first["path"].(string)
					ve.SurfaceID, _ = first["surfaceId"].(string)
					stepErr = ve
				}
			}
			assertErrorExpectation(t, caseKey, expErr, stepErr, capturedErrors)
		} else {
			if err := proc.ProcessPayload(msgs, nil); err != nil {
				t.Fatalf("%s: step %d unexpected error: %v", caseKey, idx, err)
			}
			expMap, _ := step["expect"].(map[string]any)
			if expMap == nil && isLast {
				expMap, _ = caseMap["expect"].(map[string]any)
			}
			if expMap != nil {
				assertExpectedSurfaceState(t, caseKey, proc, expMap)
			}
		}
	}
}

func buildCaseValidationConfig(t *testing.T, caseKey string, flags map[string]any) *core.ValidationConfig {
	t.Helper()
	assertKnownKeys(t, flags, caseValidationFlagKeys, "validationConfig key", caseKey)
	cfg := core.StrictValidation()
	if b, ok := flags["allowOrphanComponents"].(bool); ok {
		cfg.AllowOrphanComponents = b
	}
	if b, ok := flags["allowDanglingReferences"].(bool); ok {
		cfg.AllowDanglingReferences = b
	}
	if b, ok := flags["allowMissingRoot"].(bool); ok {
		cfg.AllowMissingRoot = b
	}
	if b, ok := flags["allowUnknownElements"].(bool); ok {
		cfg.AllowUnknownElements = b
	}
	return &cfg
}

func validateProcessMessagesCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, processMessagesCaseKeys, "case key", caseKey)
	catalogs := getCatalogsForTestCase(t, caseMap)
	var valCfg *core.ValidationConfig
	if rawFlags, ok := caseMap["validationConfig"].(map[string]any); ok {
		valCfg = buildCaseValidationConfig(t, caseKey, rawFlags)
	} else {
		optsMap, _ := caseMap["options"].(map[string]any)
		isStrict := caseMap["strictMode"] == true || caseMap["strict_mode"] == true || optsMap["strict_mode"] == true
		if isStrict {
			strict := core.StrictValidation()
			valCfg = &strict
		}
	}

	var capturedErrors []map[string]any
	proc, err := core.NewMessageProcessor(catalogs, &core.MessageProcessorOptions{
		ValidationConfig: valCfg,
		ErrorHandler: func(env map[string]any) {
			capturedErrors = append(capturedErrors, env)
		},
	})
	if err != nil {
		t.Fatalf("%s: NewMessageProcessor: %v", caseKey, err)
	}

	runStep := func(msgs any, execCtx *core.ExecutionContext, expErr any, expState map[string]any) {
		if expErr != nil {
			capturedErrors = nil
			err := proc.ProcessPayload(msgs, execCtx)
			assertErrorExpectation(t, caseKey, expErr, err, capturedErrors)
		} else {
			if err := proc.ProcessPayload(msgs, execCtx); err != nil {
				t.Fatalf("%s: unexpected ProcessPayload error: %v", caseKey, err)
			}
			if expState != nil {
				assertExpectedSurfaceState(t, caseKey, proc, expState)
			}
		}
	}

	var topMsgs any
	if m, ok := caseMap["messages"]; ok && m != nil {
		topMsgs = m
	} else if p, ok := caseMap["payload"]; ok && p != nil {
		topMsgs = []any{p}
	}
	if topMsgs != nil {
		expState, _ := caseMap["expect"].(map[string]any)
		runStep(topMsgs, nil, caseMap["expectError"], expState)
		return
	}

	rawSteps, _ := caseMap["steps"].([]any)
	if len(rawSteps) == 0 {
		t.Fatalf("%s: process_messages case requires messages, payload, or steps", caseKey)
	}
	for idx, rs := range rawSteps {
		step, _ := rs.(map[string]any)
		assertKnownKeys(t, step, processMessagesStepKeys, fmt.Sprintf("steps[%d] key", idx), caseKey)
		stepMsgs := stepMessagesFromMap(t, caseKey, step, idx)
		var execCtx *core.ExecutionContext
		if stepFlags, hasStepFlags := step["validationConfig"].(map[string]any); hasStepFlags {
			execCtx = &core.ExecutionContext{
				ValidationConfig: buildCaseValidationConfig(t, caseKey, stepFlags),
			}
		}
		isLast := idx == len(rawSteps)-1
		expErr := step["expectError"]
		if expErr == nil && isLast {
			expErr = caseMap["expectError"]
		}
		expState, _ := step["expect"].(map[string]any)
		if expState == nil && isLast {
			expState, _ = caseMap["expect"].(map[string]any)
		}
		runStep(stepMsgs, execCtx, expErr, expState)
	}
}

func validateCapabilitiesCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, capabilitiesCaseKeys, "case key", caseKey)
	catalogs := getCatalogsForTestCase(t, caseMap)
	proc, err := core.NewMessageProcessor(catalogs, nil)
	if err != nil {
		t.Fatalf("%s: NewMessageProcessor: %v", caseKey, err)
	}
	argsMap, _ := caseMap["args"].(map[string]any)
	assertKnownKeys(t, argsMap, capabilitiesArgsKeys, "args key", caseKey)
	var rawVersions []string
	if vers, ok := argsMap["versions"].([]any); ok {
		for _, v := range vers {
			if s, ok := v.(string); ok {
				rawVersions = append(rawVersions, s)
			}
		}
	} else if v, ok := argsMap["version"].(string); ok {
		rawVersions = []string{v}
	} else {
		pVer := resolveProtocolVersionFromCase(caseMap)
		if pVer == "" {
			pVer = "v0.9"
		}
		rawVersions = []string{pVer}
	}
	envRef, _ := argsMap["componentEnvelopeRef"].(string)
	if envRef == "" {
		envRef = "common_types.json#/$defs/ComponentCommon"
	}
	caps, err := proc.RendererCapabilities(&core.CapabilitiesOptions{
		RawVersions:           rawVersions,
		IncludeInlineCatalogs: argsMap["includeInlineCatalogs"] == true,
		ComponentEnvelopeRef:  envRef,
	})
	if err != nil {
		t.Fatalf("%s: RendererCapabilities: %v", caseKey, err)
	}
	if !jsonValuesEqual(caps, caseMap["expect"]) {
		bGot, _ := json.MarshalIndent(caps, "", "  ")
		bWant, _ := json.MarshalIndent(caseMap["expect"], "", "  ")
		t.Fatalf("%s: capabilities mismatch:\ngot:\n%s\nwant:\n%s", caseKey, string(bGot), string(bWant))
	}
}
