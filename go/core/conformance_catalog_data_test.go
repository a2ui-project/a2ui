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

func loadCaseCatalogDocument(t *testing.T, caseKey string, caseMap map[string]any) (map[string]any, []byte) {
	t.Helper()
	cPath, _ := caseMap["catalogPath"].(string)
	if cPath == "" {
		cPath, _ = caseMap["catalogFile"].(string)
	}
	if cPath != "" {
		full := filepath.Join(repoRootDir(t), filepath.FromSlash(cPath))
		raw, err := os.ReadFile(full)
		if err != nil {
			t.Fatalf("%s: read %s: %v", caseKey, cPath, err)
		}
		var doc map[string]any
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatalf("%s: unmarshal %s: %v", caseKey, cPath, err)
		}
		return doc, raw
	}
	for _, k := range []string{"catalogSchema", "catalog", "schema"} {
		if m, ok := caseMap[k].(map[string]any); ok {
			return m, nil
		}
	}
	return caseMap, nil
}

func collectAllRefs(node any) []string {
	var out []string
	switch typed := node.(type) {
	case map[string]any:
		if r, ok := typed["$ref"].(string); ok {
			out = append(out, r)
		}
		for _, v := range typed {
			out = append(out, collectAllRefs(v)...)
		}
	case []any:
		for _, item := range typed {
			out = append(out, collectAllRefs(item)...)
		}
	}
	return out
}

func resolveLocalRefInDoc(doc map[string]any, ref string) (any, bool) {
	if !strings.HasPrefix(ref, "#") {
		return nil, false
	}
	if ref == "#" || ref == "#/" {
		return doc, true
	}
	var cur any = doc
	for _, rawTok := range strings.Split(strings.TrimPrefix(ref, "#/"), "/") {
		tok := strings.ReplaceAll(strings.ReplaceAll(rawTok, "~1", "/"), "~0", "~")
		m, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		next, exists := m[tok]
		if !exists {
			return nil, false
		}
		cur = next
	}
	return cur, true
}

func assertSelfContainedSchema(t *testing.T, caseKey string, schema map[string]any) {
	t.Helper()
	refs := collectAllRefs(schema)
	if len(refs) == 0 {
		t.Fatalf("%s: catalog validation schema contains no $ref entries", caseKey)
	}
	for _, ref := range refs {
		if !strings.HasPrefix(ref, "#") {
			t.Fatalf("%s: reference %q leaves catalog document", caseKey, ref)
		}
		if _, ok := resolveLocalRefInDoc(schema, ref); !ok {
			t.Fatalf("%s: reference %q does not resolve within catalog document", caseKey, ref)
		}
	}
}

func schemaShapeForBuiltinCheck(doc map[string]any, schema any, seen map[string]bool) (map[string]bool, map[string]bool) {
	props := map[string]bool{}
	req := map[string]bool{}
	sm, ok := schema.(map[string]any)
	if !ok {
		return props, req
	}
	if pm, ok := sm["properties"].(map[string]any); ok {
		for k := range pm {
			props[k] = true
		}
	}
	if rSlice, ok := toAnySlice(sm["required"]); ok {
		for _, r := range rSlice {
			if rs, ok := r.(string); ok {
				req[rs] = true
			}
		}
	}
	if ref, ok := sm["$ref"].(string); ok && strings.HasPrefix(ref, "#") && !seen[ref] {
		nextSeen := map[string]bool{ref: true}
		for k := range seen {
			nextSeen[k] = true
		}
		if target, ok := resolveLocalRefInDoc(doc, ref); ok {
			sp, sr := schemaShapeForBuiltinCheck(doc, target, nextSeen)
			for k := range sp {
				props[k] = true
			}
			for k := range sr {
				req[k] = true
			}
		}
	}
	if allOf, ok := sm["allOf"].([]any); ok {
		for _, member := range allOf {
			sp, sr := schemaShapeForBuiltinCheck(doc, member, seen)
			for k := range sp {
				props[k] = true
			}
			for k := range sr {
				req[k] = true
			}
		}
	}
	return props, req
}

func componentShapesForBuiltinCheck(cat *core.Catalog) map[string]map[string]any {
	doc := cat.ValidationSchema()
	comps, _ := doc["components"].(map[string]any)
	out := map[string]map[string]any{}
	for name, s := range comps {
		pSet, rSet := schemaShapeForBuiltinCheck(doc, s, map[string]bool{})
		delete(pSet, "id")
		delete(pSet, "component")
		delete(rSet, "id")
		delete(rSet, "component")
		var pList, rList []string
		for k := range pSet {
			pList = append(pList, k)
		}
		for k := range rSet {
			rList = append(rList, k)
		}
		sort.Strings(pList)
		sort.Strings(rList)
		out[name] = map[string]any{"properties": pList, "required": rList}
	}
	return out
}

func functionSigsForBuiltinCheck(cat *core.Catalog) map[string]map[string]any {
	out := map[string]map[string]any{}
	for name, fn := range cat.Functions() {
		if strings.HasPrefix(name, "@") {
			continue
		}
		ac := string(fn.AllowedCallers)
		if ac == "" {
			ac = string(core.AllowedCallersRendererOnly)
		}
		rt := string(fn.ReturnType)
		if rt == "" {
			rt = "any"
		}
		out[name] = map[string]any{
			"returnType":             rt,
			"allowedCallers":         ac,
			"requiresUserActivation": fn.RequiresUserActivation,
		}
	}
	return out
}

func sdkBuiltinByCatalogID(t *testing.T, catalogID string) *core.Catalog {
	t.Helper()
	for _, ver := range []core.ProtocolVersion{core.Version0_8, core.Version0_9, core.Version1_0} {
		cat := mustBasicCatalog(t, ver)
		if cat.CatalogID() == catalogID {
			return cat
		}
	}
	if mcp, err := core.MCPCatalog(); err == nil && mcp.CatalogID() == catalogID {
		return mcp
	}
	return nil
}

func validateFromJSONCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, fromJSONCaseKeys, "case key", caseKey)
	doc, rawBytes := loadCaseCatalogDocument(t, caseKey, caseMap)
	cID := resolveCatalogIDFromCase(caseMap)
	if cID == "" && caseMap["catalogPath"] != nil {
		cID, _ = doc["catalogId"].(string)
	}
	var pVer string
	if pv, ok := caseMap["protocolVersion"].(string); ok {
		pVer = pv
	} else if cID != "" && caseMap["catalogPath"] == nil {
		pVer = resolveProtocolVersionFromCase(caseMap)
	}
	opts := &core.CatalogLoadOptions{
		CatalogID:       cID,
		ProtocolVersion: core.ProtocolVersion(pVer),
	}

	loadFn := func() (*core.Catalog, error) {
		if rawBytes != nil {
			return core.CatalogFromJSONBytes(rawBytes, opts)
		}
		return core.CatalogFromJSON(doc, opts)
	}

	if expErr := caseMap["expectError"]; expErr != nil {
		_, err := loadFn()
		assertErrorExpectation(t, caseKey, expErr, err, nil)
		return
	}
	cat, err := loadFn()
	if err != nil {
		t.Fatalf("%s: CatalogFromJSON failed: %v", caseKey, err)
	}
	expMap, _ := caseMap["expect"].(map[string]any)
	if expMap == nil {
		return
	}
	assertKnownKeys(t, expMap, fromJSONExpectKeys, "expect key", caseKey)
	if expCID, ok := expMap["catalogId"].(string); ok && cat.CatalogID() != expCID {
		t.Fatalf("%s: catalogId got %q, want %q", caseKey, cat.CatalogID(), expCID)
	}
	if expPV, ok := expMap["protocolVersion"].(string); ok {
		wantPV, _ := core.ToProtocolVersion(expPV)
		if cat.ProtocolVersion() != wantPV && string(cat.ProtocolVersion()) != strings.TrimPrefix(expPV, "v") {
			t.Fatalf("%s: protocolVersion got %q, want %q", caseKey, cat.ProtocolVersion(), expPV)
		}
	}
	if comps, ok := expMap["components"].([]any); ok {
		for _, rc := range comps {
			name, _ := rc.(string)
			if _, exists := cat.Components()[name]; !exists {
				t.Fatalf("%s: expected component %q in catalog", caseKey, name)
			}
		}
	} else if compsMap, ok := expMap["components"].(map[string]any); ok {
		for name := range compsMap {
			if _, exists := cat.Components()[name]; !exists {
				t.Fatalf("%s: expected component %q in catalog", caseKey, name)
			}
		}
	}
	if fns, ok := expMap["functions"].([]any); ok {
		for _, rf := range fns {
			name, _ := rf.(string)
			if _, exists := cat.Functions()[name]; !exists {
				t.Fatalf("%s: expected function %q in catalog", caseKey, name)
			}
		}
	}
	if compMeta, ok := expMap["componentMetadata"].(map[string]any); ok {
		for compName, expM := range compMeta {
			api, exists := cat.Components()[compName]
			if !exists {
				t.Fatalf("%s: component %q missing", caseKey, compName)
			}
			if !jsonValuesEqual(api.Metadata, expM) {
				t.Fatalf("%s: componentMetadata[%s] got %v, want %v", caseKey, compName, api.Metadata, expM)
			}
		}
	}
	if expMap["selfContained"] == true {
		assertSelfContainedSchema(t, caseKey, cat.ValidationSchema())
	}
	if expMap["matchesBuiltinCatalog"] == true {
		builtin := sdkBuiltinByCatalogID(t, cat.CatalogID())
		if builtin != nil {
			if cat.CatalogID() != builtin.CatalogID() {
				t.Fatalf("%s: builtin catalogId mismatch", caseKey)
			}
			if !jsonValuesEqual(componentShapesForBuiltinCheck(cat), componentShapesForBuiltinCheck(builtin)) {
				t.Fatalf("%s: component shapes differ from builtin catalog", caseKey)
			}
			if !jsonValuesEqual(functionSigsForBuiltinCheck(cat), functionSigsForBuiltinCheck(builtin)) {
				t.Fatalf("%s: function signatures differ from builtin catalog", caseKey)
			}
		}
	}
	validator := core.NewPayloadValidator(cat, nil)
	if validComps, ok := expMap["validComponents"].([]any); ok {
		for _, rawC := range validComps {
			cm, _ := rawC.(map[string]any)
			if err := validator.ValidateComponent(cm, "main"); err != nil {
				t.Fatalf("%s: validComponent %v rejected: %v", caseKey, cm, err)
			}
		}
	}
	if invalidComps, ok := expMap["invalidComponents"].([]any); ok {
		for _, rawC := range invalidComps {
			cm, _ := rawC.(map[string]any)
			if err := validator.ValidateComponent(cm, "main"); err == nil {
				t.Fatalf("%s: invalidComponent %v was unexpectedly accepted", caseKey, cm)
			}
		}
	}
}

func validateDeriveCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, deriveCaseKeys, "case key", caseKey)
	doc, rawBytes := loadCaseCatalogDocument(t, caseKey, caseMap)
	var source *core.Catalog
	var err error
	if rawBytes != nil {
		source, err = core.CatalogFromJSONBytes(rawBytes, nil)
	} else {
		source, err = core.CatalogFromJSON(doc, nil)
	}
	if err != nil {
		t.Fatalf("%s: load source catalog: %v", caseKey, err)
	}
	argsMap, _ := caseMap["args"].(map[string]any)
	assertKnownKeys(t, argsMap, deriveArgsKeys, "args key", caseKey)

	buildEntries := func(kind string) ([]any, bool) {
		rawList, exists := argsMap[kind]
		if !exists || rawList == nil {
			return nil, false
		}
		list, _ := rawList.([]any)
		out := make([]any, 0, len(list))
		for _, item := range list {
			if s, ok := item.(string); ok {
				out = append(out, s)
				continue
			}
			if m, ok := item.(map[string]any); ok {
				holderDoc := map[string]any{
					"catalogId": "conformance:derive-entries",
					kind:        m,
				}
				if pv, ok := doc["protocolVersion"]; ok {
					holderDoc["protocolVersion"] = pv
				}
				holder, hErr := core.CatalogFromJSON(holderDoc, nil)
				if hErr != nil {
					// Return raw map so Catalog.Derive reports the structured CatalogError.
					out = append(out, m)
					continue
				}
				for name := range m {
					if kind == "components" {
						out = append(out, holder.Components()[name])
					} else {
						out = append(out, holder.Functions()[name])
					}
				}
			}
		}
		return out, true
	}

	catID, _ := argsMap["catalogId"].(string)
	dOpts := core.DeriveOptions{CatalogID: catID}
	if comps, ok := buildEntries("components"); ok {
		dOpts.Components = comps
		if dOpts.Components == nil {
			dOpts.Components = []any{}
		}
	}
	if funcs, ok := buildEntries("functions"); ok {
		dOpts.Functions = funcs
		if dOpts.Functions == nil {
			dOpts.Functions = []any{}
		}
	}
	if instr, ok := argsMap["instructions"].(string); ok {
		dOpts.Instructions = &instr
	}

	derived, deriveErr := source.Derive(dOpts)
	if expErr := caseMap["expectError"]; expErr != nil {
		assertErrorExpectation(t, caseKey, expErr, deriveErr, nil)
		return
	}
	if deriveErr != nil {
		t.Fatalf("%s: Derive failed: %v", caseKey, deriveErr)
	}

	expMap, _ := caseMap["expect"].(map[string]any)
	assertKnownKeys(t, expMap, deriveExpectKeys, "expect key", caseKey)
	outDoc := derived.ToJSON()
	if expCID, ok := expMap["catalogId"].(string); ok && derived.CatalogID() != expCID {
		t.Fatalf("%s: derived catalogId got %q, want %q", caseKey, derived.CatalogID(), expCID)
	}
	if expPV, ok := expMap["protocolVersion"].(string); ok {
		wantPV, _ := core.ToProtocolVersion(expPV)
		if derived.ProtocolVersion() != wantPV {
			t.Fatalf("%s: derived protocolVersion got %q, want %q", caseKey, derived.ProtocolVersion(), wantPV)
		}
	}
	for _, kind := range []string{"components", "functions"} {
		rawExpected, exists := expMap[kind]
		if !exists {
			continue
		}
		var gotNames []string
		if kind == "components" {
			gotNames = derived.ComponentNames()
		} else {
			for _, fn := range derived.FunctionNames() {
				if !strings.HasPrefix(fn, "@") {
					gotNames = append(gotNames, fn)
				}
			}
		}
		sort.Strings(gotNames)
		var wantNames []string
		switch expTyped := rawExpected.(type) {
		case []any:
			for _, item := range expTyped {
				if s, ok := item.(string); ok {
					wantNames = append(wantNames, s)
				}
			}
		case map[string]any:
			for k, def := range expTyped {
				wantNames = append(wantNames, k)
				outSection, _ := outDoc[kind].(map[string]any)
				if !jsonValuesEqual(normalizeSetKeywords(outSection[k]), normalizeSetKeywords(def)) {
					t.Fatalf("%s: derived %s[%s] differs:\ngot=%v\nwant=%v", caseKey, kind, k, outSection[k], def)
				}
			}
		}
		sort.Strings(wantNames)
		if !jsonValuesEqual(gotNames, wantNames) {
			t.Fatalf("%s: derived %s names got %v, want %v", caseKey, kind, gotNames, wantNames)
		}
	}
	if expTheme, ok := expMap["theme"]; ok {
		if !jsonValuesEqual(normalizeSetKeywords(outDoc["theme"]), normalizeSetKeywords(expTheme)) {
			t.Fatalf("%s: derived theme mismatch", caseKey)
		}
	}
	if expInstr, ok := expMap["instructions"]; ok {
		if !jsonValuesEqual(outDoc["instructions"], expInstr) {
			t.Fatalf("%s: derived instructions got %v, want %v", caseKey, outDoc["instructions"], expInstr)
		}
	}
	if absent, ok := expMap["absentKeys"].([]any); ok {
		for _, rk := range absent {
			k, _ := rk.(string)
			if _, present := outDoc[k]; present {
				t.Fatalf("%s: expected ToJSON() to omit %q, got %v", caseKey, k, outDoc[k])
			}
		}
	}
}

func validateValidationSchemaCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, validationSchemaCaseKeys, "case key", caseKey)
	doc, rawBytes := loadCaseCatalogDocument(t, caseKey, caseMap)
	cID := resolveCatalogIDFromCase(caseMap)
	if cID == "" {
		cID, _ = doc["catalogId"].(string)
	}
	if cID == "" {
		cID = "https://a2ui.org/catalogs/basic"
	}
	var pVer string
	if pv, ok := caseMap["protocolVersion"].(string); ok {
		pVer = pv
	} else if _, hasDocPV := doc["protocolVersion"].(string); !hasDocPV {
		pVer = resolveProtocolVersionFromCase(caseMap)
	}
	opts := &core.CatalogLoadOptions{
		CatalogID:       cID,
		ProtocolVersion: core.ProtocolVersion(pVer),
	}
	loadFn := func() (*core.Catalog, error) {
		if rawBytes != nil {
			return core.CatalogFromJSONBytes(rawBytes, opts)
		}
		return core.CatalogFromJSON(doc, opts)
	}
	if expErr := caseMap["expectError"]; expErr != nil {
		cat, err := loadFn()
		if err == nil {
			_ = cat.ValidationSchema()
		}
		assertErrorExpectation(t, caseKey, expErr, err, nil)
		return
	}
	cat, err := loadFn()
	if err != nil {
		t.Fatalf("%s: CatalogFromJSON: %v", caseKey, err)
	}
	expFile, _ := caseMap["expectFile"].(string)
	goldenBytes, err := os.ReadFile(filepath.Join(repoRootDir(t), filepath.FromSlash(expFile)))
	if err != nil {
		t.Fatalf("%s: read expectFile %s: %v", caseKey, expFile, err)
	}
	var expected any
	if err := json.Unmarshal(goldenBytes, &expected); err != nil {
		t.Fatalf("%s: unmarshal expectFile %s: %v", caseKey, expFile, err)
	}
	got := cat.ValidationSchema()
	if !jsonValuesEqual(normalizeSetKeywords(got), normalizeSetKeywords(expected)) {
		bGot, _ := json.MarshalIndent(got, "", "  ")
		bWant, _ := json.MarshalIndent(expected, "", "  ")
		t.Fatalf("%s: validation_schema differs from %s:\ngot:\n%s\nwant:\n%s", caseKey, expFile, string(bGot), string(bWant))
	}
}

func validateRoundTripCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, roundTripCaseKeys, "case key", caseKey)
	doc, rawBytes := loadCaseCatalogDocument(t, caseKey, caseMap)
	cID := resolveCatalogIDFromCase(caseMap)
	var pVer string
	if pv, ok := caseMap["protocolVersion"].(string); ok {
		pVer = pv
	} else if _, hasDocPV := doc["protocolVersion"].(string); !hasDocPV {
		pVer = resolveProtocolVersionFromCase(caseMap)
	}
	opts := &core.CatalogLoadOptions{
		CatalogID:       cID,
		ProtocolVersion: core.ProtocolVersion(pVer),
	}
	var cat *core.Catalog
	var err error
	if rawBytes != nil {
		cat, err = core.CatalogFromJSONBytes(rawBytes, opts)
	} else {
		cat, err = core.CatalogFromJSON(doc, opts)
	}
	if err != nil {
		t.Fatalf("%s: CatalogFromJSON: %v", caseKey, err)
	}
	out := cat.ToJSON()
	if !jsonValuesEqual(normalizeSetKeywords(out), normalizeSetKeywords(doc)) {
		bGot, _ := json.MarshalIndent(out, "", "  ")
		bWant, _ := json.MarshalIndent(doc, "", "  ")
		t.Fatalf("%s: round_trip ToJSON() differs from source:\ngot:\n%s\nwant:\n%s", caseKey, string(bGot), string(bWant))
	}
	catAgain, err := core.CatalogFromJSON(out, opts)
	if err != nil {
		t.Fatalf("%s: second CatalogFromJSON: %v", caseKey, err)
	}
	again := catAgain.ToJSON()
	if !jsonValuesEqual(normalizeSetKeywords(again), normalizeSetKeywords(out)) {
		t.Fatalf("%s: second round_trip ToJSON() differs", caseKey)
	}
}

func validateToJSONCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, toJSONCaseKeys, "case key", caseKey)
	var cat *core.Catalog
	if builtinName, ok := caseMap["builtinCatalog"].(string); ok && builtinName != "" {
		pVer := resolveProtocolVersionFromCase(caseMap)
		if builtinName != "basic" {
			t.Skipf("no built-in %s catalog for %s", builtinName, pVer)
		}
		norm, err := core.ToProtocolVersion(pVer)
		if err != nil {
			t.Skipf("unsupported built-in protocolVersion %s", pVer)
		}
		cat, err = core.BasicCatalog(norm)
		if err != nil {
			t.Skipf("no built-in basic catalog for %s: %v", pVer, err)
		}
	} else {
		doc, rawBytes := loadCaseCatalogDocument(t, caseKey, caseMap)
		cID := resolveCatalogIDFromCase(caseMap)
		var pVer string
		if pv, ok := caseMap["protocolVersion"].(string); ok {
			pVer = pv
		} else if _, hasDocPV := doc["protocolVersion"].(string); !hasDocPV {
			pVer = resolveProtocolVersionFromCase(caseMap)
		}
		opts := &core.CatalogLoadOptions{
			CatalogID:       cID,
			ProtocolVersion: core.ProtocolVersion(pVer),
		}
		var err error
		if rawBytes != nil {
			cat, err = core.CatalogFromJSONBytes(rawBytes, opts)
		} else {
			cat, err = core.CatalogFromJSON(doc, opts)
		}
		if err != nil {
			t.Fatalf("%s: CatalogFromJSON: %v", caseKey, err)
		}
	}
	expFile, _ := caseMap["expectFile"].(string)
	goldenBytes, err := os.ReadFile(filepath.Join(repoRootDir(t), filepath.FromSlash(expFile)))
	if err != nil {
		t.Fatalf("%s: read expectFile %s: %v", caseKey, expFile, err)
	}
	var expected any
	if err := json.Unmarshal(goldenBytes, &expected); err != nil {
		t.Fatalf("%s: unmarshal %s: %v", caseKey, expFile, err)
	}
	got := cat.ToJSON()
	if !jsonValuesEqual(normalizeSetKeywords(got), normalizeSetKeywords(expected)) {
		bGot, _ := json.MarshalIndent(got, "", "  ")
		bWant, _ := json.MarshalIndent(expected, "", "  ")
		t.Fatalf("%s: ToJSON() differs from %s:\ngot:\n%s\nwant:\n%s", caseKey, expFile, string(bGot), string(bWant))
	}
}

func validateCommonTypesSchemaCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, schemaExportCaseKeys, "case key", caseKey)
	pVer, err := core.ToProtocolVersion(resolveProtocolVersionFromCase(caseMap))
	if err != nil {
		t.Fatalf("%s: ToProtocolVersion: %v", caseKey, err)
	}
	generated, err := core.CommonTypesSchemaMap(pVer)
	if err != nil {
		t.Fatalf("%s: CommonTypesSchemaMap: %v", caseKey, err)
	}
	expFile, _ := caseMap["expectFile"].(string)
	goldenBytes, err := os.ReadFile(filepath.Join(repoRootDir(t), filepath.FromSlash(expFile)))
	if err != nil {
		t.Fatalf("%s: read %s: %v", caseKey, expFile, err)
	}
	var expected any
	if err := json.Unmarshal(goldenBytes, &expected); err != nil {
		t.Fatalf("%s: unmarshal %s: %v", caseKey, expFile, err)
	}
	if !jsonValuesEqual(generated, expected) {
		t.Fatalf("%s: common_types_schema mismatch against %s", caseKey, expFile)
	}
}

func validateAgentToRendererSchemaCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, schemaExportCaseKeys, "case key", caseKey)
	pVer, err := core.ToProtocolVersion(resolveProtocolVersionFromCase(caseMap))
	if err != nil {
		t.Fatalf("%s: ToProtocolVersion: %v", caseKey, err)
	}
	rawBytes, err := core.AgentToRendererSchemaJSON(pVer)
	if err != nil {
		t.Fatalf("%s: AgentToRendererSchemaJSON: %v", caseKey, err)
	}
	generated, err := core.ParseJSON(rawBytes)
	if err != nil {
		t.Fatalf("%s: ParseJSON(AgentToRendererSchemaJSON): %v", caseKey, err)
	}
	expFile, _ := caseMap["expectFile"].(string)
	goldenBytes, err := os.ReadFile(filepath.Join(repoRootDir(t), filepath.FromSlash(expFile)))
	if err != nil {
		t.Fatalf("%s: read %s: %v", caseKey, expFile, err)
	}
	var expected any
	if err := json.Unmarshal(goldenBytes, &expected); err != nil {
		t.Fatalf("%s: unmarshal %s: %v", caseKey, expFile, err)
	}
	if !jsonValuesEqual(generated, expected) {
		t.Fatalf("%s: agent_to_renderer_schema mismatch against %s", caseKey, expFile)
	}
}

func validateCommonTypeCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, validateCommonTypeCaseKeys, "case key", caseKey)
	pVer, err := core.ToProtocolVersion(resolveProtocolVersionFromCase(caseMap))
	if err != nil {
		t.Fatalf("%s: ToProtocolVersion: %v", caseKey, err)
	}
	defName, _ := caseMap["definition"].(string)
	steps, _ := caseMap["steps"].([]any)
	if len(steps) == 0 {
		t.Fatalf("%s: validate_common_type requires non-empty steps", caseKey)
	}
	for idx, rs := range steps {
		step, _ := rs.(map[string]any)
		assertKnownKeys(t, step, validateCommonTypeStepKeys, fmt.Sprintf("steps[%d] key", idx), caseKey)
		val := step["value"]
		vErr := core.ValidateCommonType(pVer, defName, val)
		if expErr := step["expectError"]; expErr != nil {
			assertErrorExpectation(t, fmt.Sprintf("%s[step %d]", caseKey, idx), expErr, vErr, nil)
		} else if vErr != nil {
			t.Fatalf("%s[step %d]: unexpected ValidateCommonType error for %v: %v", caseKey, idx, val, vErr)
		}
	}
}

func validateResolvePathCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, resolvePathCaseKeys, "case key", caseKey)
	argsMap, _ := caseMap["args"].(map[string]any)
	assertKnownKeys(t, argsMap, resolvePathArgsKeys, "args key", caseKey)
	pathStr, _ := argsMap["path"].(string)
	ctxPath, _ := argsMap["contextPath"].(string)
	if ctxPath == "" {
		ctxPath, _ = argsMap["context_path"].(string)
	}
	surf := core.NewSurfaceModel("dummy", "basic", mustBasicCatalog(t, core.Version0_9))
	ctx := core.NewDataContext(surf, ctxPath)
	got, err := ctx.ResolvePath(pathStr)
	if err != nil {
		t.Fatalf("%s: ResolvePath: %v", caseKey, err)
	}
	exp := caseMap["expect"]
	if expMap, ok := exp.(map[string]any); ok {
		if r, exists := expMap["result"]; exists {
			exp = r
		}
	}
	if !jsonValuesEqual(got, exp) {
		t.Fatalf("%s: ResolvePath got %q, want %v", caseKey, got, exp)
	}
}

func mutateInPlaceForTest(target any, path string, val any) {
	var tokens []string
	for _, seg := range strings.Split(path, "/") {
		if seg != "" {
			tokens = append(tokens, strings.ReplaceAll(strings.ReplaceAll(seg, "~1", "/"), "~0", "~"))
		}
	}
	if len(tokens) == 0 || target == nil {
		return
	}
	cur := target
	for _, tok := range tokens[:len(tokens)-1] {
		switch c := cur.(type) {
		case []any:
			idx, _ := strconv.Atoi(tok)
			cur = c[idx]
		case map[string]any:
			cur = c[tok]
		}
	}
	last := tokens[len(tokens)-1]
	switch c := cur.(type) {
	case []any:
		idx, _ := strconv.Atoi(last)
		c[idx] = val
	case map[string]any:
		c[last] = val
	}
}

func validateDataModelCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, dataModelCaseKeys, "case key", caseKey)
	initMap, _ := caseMap["initial"].(map[string]any)
	model := core.NewDataModel(initMap)

	type dmObserver struct {
		path         string
		changeCount  int
		currentValue any
	}
	var observers []*dmObserver
	if watches, ok := caseMap["watch"].([]any); ok {
		for _, rw := range watches {
			p, _ := rw.(string)
			curVal, _, _ := model.Get(p)
			obs := &dmObserver{path: p, currentValue: curVal}
			_, err := model.Watch(p, func(val any) {
				obs.changeCount++
				obs.currentValue = val
			})
			if err != nil {
				t.Fatalf("%s: Watch(%s): %v", caseKey, p, err)
			}
			observers = append(observers, obs)
		}
	}

	var lastSetValue any
	steps, _ := caseMap["steps"].([]any)
	for idx, rs := range steps {
		step, _ := rs.(map[string]any)
		op, _ := step["op"].(string)
		allowed := dataModelStepKeysByOp[op]
		if allowed == nil {
			t.Fatalf("%s: unknown data_model op %q", caseKey, op)
		}
		assertKnownKeys(t, step, allowed, fmt.Sprintf("steps[%d] (%s) key", idx, op), caseKey)
		for _, obs := range observers {
			obs.changeCount = 0
		}

		expErr := step["expect_error"]
		if expErr == nil {
			expErr = step["expectError"]
		}

		execOp := func() error {
			stepPath, _ := step["path"].(string)
			switch op {
			case "get":
				actual, exists, err := model.Get(stepPath)
				if err != nil {
					return err
				}
				if step["expect_absent"] == true {
					if exists || actual != nil {
						t.Fatalf("%s[step %d]: expected path %q absent, got (%v, exists=%v)", caseKey, idx, stepPath, actual, exists)
					}
				}
				if expType, ok := step["expect_type"].(string); ok {
					switch expType {
					case "list":
						if _, ok := actual.([]any); !ok {
							t.Fatalf("%s[step %d]: expected list at %q, got %T", caseKey, idx, stepPath, actual)
						}
					case "object":
						if _, ok := actual.(map[string]any); !ok {
							t.Fatalf("%s[step %d]: expected object at %q, got %T", caseKey, idx, stepPath, actual)
						}
					default:
						t.Fatalf("%s[step %d]: unknown expect_type %q", caseKey, idx, expType)
					}
				}
				if expVal, hasExp := step["expect"]; hasExp {
					if !jsonValuesEqual(actual, expVal) {
						t.Fatalf("%s[step %d]: get(%q) got %v, want %v", caseKey, idx, stepPath, actual, expVal)
					}
				}
				return nil
			case "set":
				callerVal := core.CloneJSONValue(step["value"])
				lastSetValue = callerVal
				return model.Set(stepPath, callerVal)
			case "mutate_input":
				mutateInPlaceForTest(lastSetValue, stepPath, step["value"])
				return nil
			case "delete":
				return model.Set(stepPath, nil)
			case "dispose":
				model.Dispose()
				return nil
			default:
				return fmt.Errorf("unknown op %s", op)
			}
		}

		opErr := execOp()
		if expErr != nil {
			assertErrorExpectation(t, fmt.Sprintf("%s[step %d]", caseKey, idx), expErr, opErr, nil)
			continue
		}
		if opErr != nil {
			t.Fatalf("%s[step %d] (%s): unexpected error: %v", caseKey, idx, op, opErr)
		}

		if rawNotified, hasNotif := step["expect_notified"].([]any); hasNotif {
			var want []string
			for _, rn := range rawNotified {
				s, _ := rn.(string)
				want = append(want, s)
			}
			var got []string
			for _, obs := range observers {
				for c := 0; c < obs.changeCount; c++ {
					got = append(got, obs.path)
				}
			}
			sort.Strings(want)
			sort.Strings(got)
			if !jsonValuesEqual(got, want) {
				t.Fatalf("%s[step %d]: expect_notified got %v, want %v", caseKey, idx, got, want)
			}
		}
		if expVals, hasVals := step["expect_values"].(map[string]any); hasVals {
			for vPath, expV := range expVals {
				var matchedObs *dmObserver
				for _, o := range observers {
					if o.path == vPath {
						matchedObs = o
						break
					}
				}
				if matchedObs == nil {
					t.Fatalf("%s[step %d]: path %q in expect_values is not watched", caseKey, idx, vPath)
				}
				if !jsonValuesEqual(matchedObs.currentValue, expV) {
					t.Fatalf("%s[step %d]: expect_values[%s] got %v, want %v", caseKey, idx, vPath, matchedObs.currentValue, expV)
				}
			}
		}
	}

	if expRoot, hasExp := caseMap["expect"]; hasExp {
		gotRoot, _, _ := model.Get("/")
		if !jsonValuesEqual(gotRoot, expRoot) {
			t.Fatalf("%s: final DataModel got %v, want %v", caseKey, gotRoot, expRoot)
		}
	}
}

func validateGetRendererDataModelCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, getDataModelCaseKeys, "case key", caseKey)
	proc, err := core.NewMessageProcessor(getCatalogsForTestCase(t, caseMap), nil)
	if err != nil {
		t.Fatalf("%s: NewMessageProcessor: %v", caseKey, err)
	}
	if steps, ok := caseMap["steps"].([]any); ok && len(steps) > 0 {
		for idx, rs := range steps {
			step, _ := rs.(map[string]any)
			assertKnownKeys(t, step, getDataModelStepKeys, fmt.Sprintf("steps[%d] key", idx), caseKey)
			msgs := step["messages"]
			if msgs == nil {
				msgs = step["payload"]
			}
			if err := proc.ProcessPayload(msgs, nil); err != nil {
				t.Fatalf("%s[step %d]: ProcessPayload: %v", caseKey, idx, err)
			}
		}
	} else {
		msgs := caseMap["messages"]
		if msgs == nil && caseMap["payload"] != nil {
			msgs = []any{caseMap["payload"]}
		}
		if err := proc.ProcessPayload(msgs, nil); err != nil {
			t.Fatalf("%s: ProcessPayload: %v", caseKey, err)
		}
	}
	argsMap, _ := caseMap["args"].(map[string]any)
	assertKnownKeys(t, argsMap, getDataModelArgsKeys, "args key", caseKey)
	ver, _ := argsMap["version"].(string)
	if ver == "" {
		ver = resolveProtocolVersionFromCase(caseMap)
	}
	res, err := proc.RendererDataModelForVersion(core.ProtocolVersion(ver))
	if err != nil {
		t.Fatalf("%s: RendererDataModelForVersion: %v", caseKey, err)
	}
	exp := caseMap["expect"]
	if exp == nil {
		if res != nil {
			t.Fatalf("%s: expected nil renderer data model, got %v", caseKey, res)
		}
		return
	}
	if expMap, ok := exp.(map[string]any); ok {
		target := any(expMap)
		if d, hasData := expMap["data"]; hasData {
			target = d
		}
		if !jsonValuesEqual(res, target) {
			t.Fatalf("%s: renderer data model got %v, want %v", caseKey, res, target)
		}
	}
}

func validateSelectCatalogCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, selectCatalogCaseKeys, "case key", caseKey)
	argsMap, _ := caseMap["args"].(map[string]any)
	assertKnownKeys(t, argsMap, selectCatalogArgsKeys, "args key", caseKey)
	surfArgs, _ := argsMap["surface"].(map[string]any)
	assertKnownKeys(t, surfArgs, selectCatalogSurfaceKeys, "args.surface key", caseKey)
	if fc, ok := argsMap["functionCall"].(map[string]any); ok {
		assertKnownKeys(t, fc, selectCatalogFunctionCallKeys, "args.functionCall key", caseKey)
	}

	sID, _ := surfArgs["id"].(string)
	if sID == "" {
		sID = "main_surface"
	}
	defaultCatID, _ := surfArgs["defaultCatalogId"].(string)
	if defaultCatID == "" {
		defaultCatID = "basic"
	}
	catalogsDict := map[string]*core.Catalog{}
	if catsSpec, ok := argsMap["catalogs"].(map[string]any); ok {
		for cid, rawDef := range catsSpec {
			defMap, _ := rawDef.(map[string]any)
			pv, _ := defMap["protocolVersion"].(string)
			if pv == "" {
				pv = "1.0"
			}
			c, err := core.NewCatalog(cid, pv, nil, nil)
			if err != nil {
				t.Fatalf("%s: NewCatalog(%s): %v", caseKey, cid, err)
			}
			catalogsDict[cid] = c
		}
	} else {
		var supported []string
		if supSlice, ok := surfArgs["supportedCatalogIds"].([]any); ok {
			for _, rs := range supSlice {
				if s, ok := rs.(string); ok {
					supported = append(supported, s)
				}
			}
		} else {
			supported = []string{defaultCatID}
		}
		for _, cid := range supported {
			c, _ := core.NewCatalog(cid, "1.0", nil, nil)
			catalogsDict[cid] = c
		}
	}
	defaultCat := catalogsDict[defaultCatID]
	if defaultCat == nil {
		defaultCat, _ = core.NewCatalog(defaultCatID, "1.0", nil, nil)
	}
	surf := core.NewSurfaceModel(sID, defaultCat.CatalogID(), defaultCat)
	surf.AvailableCatalogs = catalogsDict

	selectForComps := func(comps map[string]any, checkMismatch bool) (string, error) {
		var lastSelected string
		var ids []string
		for k := range comps {
			ids = append(ids, k)
		}
		sort.Strings(ids)
		for _, cID := range ids {
			cData, _ := comps[cID].(map[string]any)
			var compCat *core.Catalog
			if compCatID, ok := cData["catalogId"].(string); ok && compCatID != "" {
				c, exists := catalogsDict[compCatID]
				if !exists {
					return "", core.NewCatalogErrorf("Catalog '%s' is not supported by surface '%s'.", compCatID, sID)
				}
				if checkMismatch && defaultCat.ProtocolVersion() != c.ProtocolVersion() {
					return "", core.NewCatalogErrorf("Component '%s' catalog protocol version %s mismatches default catalog protocol version %s.", cID, c.ProtocolVersion(), defaultCat.ProtocolVersion())
				}
				compCat = c
			} else {
				compCat = defaultCat
			}
			lastSelected = compCat.CatalogID()
			cType, _ := cData["component"].(string)
			if cType == "" {
				cType = "Box"
			}
			cm, err := core.NewComponentModel(cID, cType, compCat, nil, nil)
			if err != nil {
				return "", err
			}
			surf.ComponentsModel.Upsert(cm)
		}
		return lastSelected, nil
	}

	if expErr := caseMap["expectError"]; expErr != nil {
		runErr := func() error {
			for cid, cat := range catalogsDict {
				if defaultCat.ProtocolVersion() != cat.ProtocolVersion() {
					return core.NewCatalogErrorf("Protocol version mismatch: cannot mix catalog '%s' (%s) with surface version %s.", cid, cat.ProtocolVersion(), defaultCat.ProtocolVersion())
				}
			}
			if comps, ok := argsMap["components"].(map[string]any); ok {
				_, err := selectForComps(comps, true)
				return err
			}
			if fc, ok := argsMap["functionCall"].(map[string]any); ok {
				var catPtr *string
				if cid, ok := fc["catalogId"].(string); ok {
					catPtr = &cid
				}
				_, err := surf.ResolveCatalog(catPtr, "Function call")
				return err
			}
			return nil
		}()
		assertErrorExpectation(t, caseKey, expErr, runErr, nil)
		return
	}

	if comps, ok := argsMap["components"].(map[string]any); ok {
		got, err := selectForComps(comps, false)
		if err != nil {
			t.Fatalf("%s: selectForComps: %v", caseKey, err)
		}
		if got != caseMap["expectSelected"] {
			t.Fatalf("%s: expectSelected got %q, want %v", caseKey, got, caseMap["expectSelected"])
		}
	} else if fc, ok := argsMap["functionCall"].(map[string]any); ok {
		var catPtr *string
		if cid, ok := fc["catalogId"].(string); ok && cid != "" {
			catPtr = &cid
		}
		cat, err := surf.ResolveCatalog(catPtr, "Function call")
		if err != nil {
			t.Fatalf("%s: ResolveCatalog: %v", caseKey, err)
		}
		if cat.CatalogID() != caseMap["expectSelected"] {
			t.Fatalf("%s: expectSelected got %q, want %v", caseKey, cat.CatalogID(), caseMap["expectSelected"])
		}
	}
}

func validateParseExpressionTemplateCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, parseExprCaseKeys, "case key", caseKey)
	inputStr, _ := caseMap["input"].(string)
	expErr := caseMap["expect_error"]
	if expErr == nil {
		expErr = caseMap["expectError"]
	}
	parts, err := core.ParseExpressionTemplate(inputStr)
	if expErr != nil {
		assertErrorExpectation(t, caseKey, expErr, err, nil)
		return
	}
	if err != nil {
		t.Fatalf("%s: ParseExpressionTemplate(%q) failed: %v", caseKey, inputStr, err)
	}
	var joined []any
	for _, p := range parts {
		if ps, ok := p.(string); ok {
			if len(joined) > 0 {
				if prev, okPrev := joined[len(joined)-1].(string); okPrev {
					joined[len(joined)-1] = prev + ps
					continue
				}
			}
			if ps != "" {
				joined = append(joined, ps)
			}
		} else {
			joined = append(joined, p)
		}
	}
	if joined == nil {
		joined = []any{}
	}
	exp := caseMap["expect"]
	if exp == nil {
		exp = []any{}
	}
	if !jsonValuesEqual(joined, exp) {
		t.Fatalf("%s: ParseExpressionTemplate got %v, want %v", caseKey, joined, exp)
	}
}

func buildDispatchActionCatalog(t *testing.T, caseMap map[string]any) *core.Catalog {
	t.Helper()
	cats := getCatalogsForTestCase(t, caseMap)
	baseCat := mustBasicCatalog(t, core.Version0_9)
	if len(cats) > 0 {
		baseCat = cats[0]
	}
	fns := map[string]core.FunctionAPI{}
	for k, v := range baseCat.Functions() {
		fns[k] = v
	}
	fns["incrementCounter"] = core.FunctionAPI{
		Name:       "incrementCounter",
		ReturnType: core.ReturnTypeVoid,
		Schema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"path": map[string]any{"type": "string"},
				"step": map[string]any{"type": "number"},
			},
		},
		Evaluate: func(args map[string]any, evalCtx *core.DataContext) (any, error) {
			targetPath, _ := args["path"].(string)
			if targetPath == "" {
				targetPath = "/count"
			}
			stepF := 1.0
			if f, ok := toFloatNumeric(args["step"]); ok {
				stepF = f
			}
			curRaw, _, _ := evalCtx.Model.Get(targetPath)
			curF, _ := toFloatNumeric(curRaw)
			next := curF + stepF
			if next == float64(int64(next)) {
				_ = evalCtx.Model.Set(targetPath, int64(next))
			} else {
				_ = evalCtx.Model.Set(targetPath, next)
			}
			return nil, nil
		},
	}
	fns["failingAction"] = core.FunctionAPI{
		Name:       "failingAction",
		ReturnType: core.ReturnTypeVoid,
		Schema:     map[string]any{"type": "object", "properties": map[string]any{}},
		Evaluate: func(_ map[string]any, _ *core.DataContext) (any, error) {
			return nil, fmt.Errorf("Action execution failed")
		},
	}
	copied, err := baseCat.CopyWith(core.CopyWithOptions{
		Functions: fns,
	})
	if err != nil {
		t.Fatalf("CopyWith dispatch_action catalog: %v", err)
	}
	return copied
}

func validateDispatchActionCase(t *testing.T, caseKey string, caseMap map[string]any, caseKeyOrder map[string][]string) {
	t.Helper()
	assertKnownKeys(t, caseMap, dispatchActionCaseKeys, "case key", caseKey)
	actionPayload, _ := caseMap["actionPayload"].(map[string]any)
	surfaceID, _ := caseMap["surfaceId"].(string)
	if surfaceID == "" {
		surfaceID = "main"
	}
	sourceCompID, _ := caseMap["sourceComponentId"].(string)
	if sourceCompID == "" {
		sourceCompID = "test_comp"
	}
	userAct := true
	if ua, ok := caseMap["userActivation"].(bool); ok {
		userAct = ua
	}

	defaultCat := buildDispatchActionCatalog(t, caseMap)
	dmInit, _ := caseMap["dataModel"].(map[string]any)
	dm := core.NewDataModel(dmInit)
	surf := core.NewSurfaceModel(surfaceID, defaultCat.CatalogID(), defaultCat)
	surf.DataModel = dm
	surf.ProtocolVersion = defaultCat.ProtocolVersion()

	var dispatched []map[string]any
	var surfErrors []map[string]any
	var capturedRendererErrors []map[string]any
	surf.OnAction = append(surf.OnAction, func(evt map[string]any) {
		dispatched = append(dispatched, evt)
	})
	wireVer := string(defaultCat.ProtocolVersion())
	if !strings.HasPrefix(wireVer, "v") && wireVer != "1.0" {
		wireVer = "v" + wireVer
	} else if wireVer == "1.0" {
		wireVer = "v1.0"
	}
	surf.OnError = append(surf.OnError, func(errObj map[string]any) {
		surfErrors = append(surfErrors, errObj)
		capturedRendererErrors = append(capturedRendererErrors, map[string]any{
			"version": wireVer,
			"error":   core.CloneJSONValue(errObj),
		})
	})

	scope, _ := caseMap["scope"].(string)
	if scope == "" {
		scope = "/"
	}
	ctx := core.NewDataContext(surf, scope)
	actionKO := extractSubKeyOrder(caseKeyOrder, "/actionPayload")
	metaMap, _ := caseMap["metadata"].(map[string]any)

	if expErr := caseMap["expectError"]; expErr != nil {
		resolved := ctx.ResolveActionWithKeyOrder(actionPayload, userAct, actionKO)
		var dispErr error
		if resMap, ok := resolved.(map[string]any); ok {
			dispErr = surf.DispatchResolvedAction(resMap, sourceCompID, metaMap)
		}
		if dispErr == nil && len(surfErrors) > 0 {
			last := surfErrors[len(surfErrors)-1]
			msg, _ := last["message"].(string)
			if msg == "" {
				msg = "Invalid action"
			}
			ve := core.NewValidationError(msg)
			ve.Code, _ = last["code"].(string)
			ve.SurfaceID, _ = last["surfaceId"].(string)
			dispErr = ve
		}
		assertErrorExpectation(t, caseKey, expErr, dispErr, capturedRendererErrors)
		return
	}

	resolved := ctx.ResolveActionWithKeyOrder(actionPayload, userAct, actionKO)
	if resMap, ok := resolved.(map[string]any); ok {
		if err := surf.DispatchResolvedAction(resMap, sourceCompID, metaMap); err != nil {
			t.Fatalf("%s: DispatchResolvedAction: %v", caseKey, err)
		}
	}
	if rawExpDisp, hasExpDisp := caseMap["expectDispatched"]; hasExpDisp {
		if rawExpDisp == nil {
			if len(dispatched) != 0 {
				t.Fatalf("%s: expected no dispatched event, got %v", caseKey, dispatched)
			}
		} else if expDisp, ok := rawExpDisp.(map[string]any); ok {
			assertKnownKeys(t, expDisp, expectDispatchedKeys, "expectDispatched key", caseKey)
			if len(dispatched) == 0 {
				t.Fatalf("%s: expected dispatched action, got none", caseKey)
			}
			actual := dispatched[0]
			for _, k := range []string{"name", "context", "userMessage", "surfaceId", "sourceComponentId", "metadata"} {
				if expV, exists := expDisp[k]; exists {
					if !jsonValuesEqual(actual[k], expV) {
						t.Fatalf("%s: dispatched.%s got %v, want %v", caseKey, k, actual[k], expV)
					}
				}
			}
			if expDisp["hasTimestamp"] == true || expDisp["timestampIso8601"] == true {
				ts, _ := actual["timestamp"].(string)
				if ts == "" {
					t.Fatalf("%s: expected non-empty timestamp on dispatched action", caseKey)
				}
			}
		}
	}
	if expDM, hasExpDM := caseMap["expectDataModel"]; hasExpDM && expDM != nil {
		gotDM, _, _ := dm.Get("/")
		if !jsonValuesEqual(gotDM, expDM) {
			t.Fatalf("%s: expectDataModel got %v, want %v", caseKey, gotDM, expDM)
		}
	}
}

func validateEvaluateFunctionCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	assertKnownKeys(t, caseMap, evaluateFunctionCaseKeys, "case key", caseKey)
	expErr := caseMap["expectError"]
	if expErr == nil {
		expErr = caseMap["expect_error"]
	}

	var got any
	var evalErr error
	if surfSpec, hasSurf := caseMap["surface"].(map[string]any); hasSurf {
		assertKnownKeys(t, surfSpec, evaluateFunctionSurfaceKeys, "surface key", caseKey)
		verStr, _ := caseMap["protocolVersion"].(string)
		normVer, _ := core.ToProtocolVersion(verStr)
		avail := map[string]*core.Catalog{}
		if rawPaths, ok := caseMap["catalogPaths"].([]any); ok {
			for _, rp := range rawPaths {
				pStr, _ := rp.(string)
				cat := loadCatalogPathForCase(t, pStr)
				if cat.ProtocolVersion() == normVer {
					avail[cat.CatalogID()] = cat
				}
			}
		}
		defaultID, _ := surfSpec["catalogId"].(string)
		defaultCat := avail[defaultID]
		surf := core.NewSurfaceModel("main", defaultID, defaultCat)
		surf.AvailableCatalogs = avail
		surf.ProtocolVersion = normVer
		if dmInit, ok := caseMap["dataModel"].(map[string]any); ok {
			surf.DataModel = core.NewDataModel(dmInit)
		}
		if loc, ok := caseMap["locale"].(string); ok && loc != "" {
			surf.Locale = loc
		}
		var capturedSurfErr error
		surf.OnError = append(surf.OnError, func(errPayload map[string]any) {
			code, _ := errPayload["code"].(string)
			msg, _ := errPayload["message"].(string)
			if code == "CATALOG_ERROR" {
				capturedSurfErr = core.NewCatalogError(msg)
			} else {
				capturedSurfErr = core.NewExpressionError(msg)
			}
		})
		ctx := core.NewDataContext(surf, "/")
		callKey := "call"
		if ctx.AtLeastV10() {
			callKey = "@call"
		}
		callObj := map[string]any{
			callKey: caseMap["function"],
			"args":  caseMap["args"],
		}
		if cid, hasCID := caseMap["catalogId"]; hasCID {
			callObj["catalogId"] = cid
		}
		got, evalErr = ctx.ResolveDynamicValue(callObj)
		if evalErr == nil && capturedSurfErr != nil {
			evalErr = capturedSurfErr
		}
	} else {
		fnName, _ := caseMap["function"].(string)
		argsMap, _ := caseMap["args"].(map[string]any)
		cats := getCatalogsForTestCase(t, caseMap)
		defaultCat := mustBasicCatalog(t, core.Version0_9)
		if len(cats) > 0 {
			defaultCat = cats[0]
		}
		surf := core.NewSurfaceModel("main", defaultCat.CatalogID(), defaultCat)
		if dmInit, ok := caseMap["dataModel"].(map[string]any); ok {
			surf.DataModel = core.NewDataModel(dmInit)
		}
		if loc, ok := caseMap["locale"].(string); ok && loc != "" {
			surf.Locale = loc
		}
		var capturedSurfErr error
		surf.OnError = append(surf.OnError, func(errPayload map[string]any) {
			msg, _ := errPayload["message"].(string)
			capturedSurfErr = core.NewExpressionError(msg)
		})
		ctx := core.NewDataContext(surf, "/")
		if fn, exists := defaultCat.Functions()[fnName]; exists && fn.Evaluate != nil {
			got, evalErr = fn.Evaluate(argsMap, ctx)
		} else {
			got, evalErr = ctx.ResolveDynamicValue(map[string]any{"call": fnName, "args": argsMap})
			if evalErr == nil && capturedSurfErr != nil {
				evalErr = capturedSurfErr
			}
		}
	}

	if expErr != nil {
		assertErrorExpectation(t, caseKey, expErr, evalErr, nil)
		return
	}
	if evalErr != nil {
		t.Fatalf("%s: evaluate_function unexpected error: %v", caseKey, evalErr)
	}
	if !jsonValuesEqual(got, caseMap["expect"]) {
		t.Fatalf("%s: evaluate_function got %#v, want %#v", caseKey, got, caseMap["expect"])
	}
}
