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

package macros_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"slices"
	"sort"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	v09 "github.com/a2ui-project/a2ui/go/agent/builder/v09"
	v1 "github.com/a2ui-project/a2ui/go/agent/builder/v1"
	"github.com/a2ui-project/a2ui/go/agent/macros"
	"github.com/a2ui-project/a2ui/go/core"
)

const (
	macrosSuiteRelPath = "agent/macros/macros.yaml"

	v10BasicCID     = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
	v09BasicCID     = "https://a2ui.org/specification/v0_9/standard_catalog.json"
	fooCID          = "https://example.com/catalogs/foo/v1/catalog.json"
	barCID          = "https://example.com/catalogs/bar/v1/catalog.json"
	brandCID        = "https://example.com/brand.json"
	brandSurfaceCID = "https://example.com/brand_surface.json"
	catACID         = "https://example.com/catalog_a.json"
	catBCID         = "https://example.com/catalog_b.json"
	bazMacrosCID    = "https://example.com/catalogs/baz_macros.json"
)

var (
	knownMacroSuiteKeys = map[string]bool{
		"suite":           true,
		"custom_catalogs": true,
		"macros":          true,
		"tests":           true,
	}
	knownMacroCaseKeys = map[string]bool{
		"id":                        true,
		"features":                  true,
		"description":               true,
		"golden":                    true,
		"surface_id":                true,
		"version":                   true,
		"envelope_version":          true,
		"catalog_id":                true,
		"validation":                true,
		"input":                     true,
		"expect_error":              true,
		"action":                    true,
		"colliding_macro":           true,
		"expect":                    true,
		"passthrough_components":    true,
		"macro_catalog_id":          true,
		"expander_scoped":           true,
		"expander_catalog_id":       true,
		"macro_version":             true,
		"empty_macros":              true,
		"expander_protocol_version": true,
		"base_catalogs":             true,
		"validation_catalogs":       true,
		"surface_catalogs":          true,
		"messages":                  true,
		"on_error":                  true,
	}
	knownMacroValidationKeys = map[string]bool{
		"allow_missing_root":        true,
		"allow_orphan_components":   true,
		"allow_dangling_references": true,
		"skip_renderer_validation":  true,
	}
	knownExpectErrorKeys = map[string]bool{
		"category": true,
		"message":  true,
	}
	knownMacroExpectKeys = map[string]bool{
		"absent_any_component_references":   true,
		"absent_components":                 true,
		"absent_property_on_all_components": true,
		"any_component_references":          true,
		"augmented_components":              true,
		"catalog_id":                        true,
		"component_count":                   true,
		"component_properties":              true,
		"component_types":                   true,
		"components":                        true,
		"create_surface_catalog_id":         true,
		"has_any_component_discriminator":   true,
		"has_any_function":                  true,
		"protocol_version":                  true,
	}
)

type macroValidationProfile struct {
	AllowMissingRoot        bool
	AllowOrphanComponents   bool
	AllowDanglingReferences bool
	SkipRendererValidation  bool
}

func (vp macroValidationProfile) toConfig() core.ValidationConfig {
	return core.ValidationConfig{
		RootID:                  "root",
		AllowMissingRoot:        vp.AllowMissingRoot,
		AllowOrphanComponents:   vp.AllowOrphanComponents,
		AllowDanglingReferences: vp.AllowDanglingReferences,
	}
}

type macroCase struct {
	ID                      string
	Description             string
	Golden                  string
	SurfaceID               string
	Input                   any
	CatalogID               string
	Validation              macroValidationProfile
	ExpectError             map[string]any
	Action                  string
	CollidingMacro          string
	Expect                  map[string]any
	EnvelopeVersion         string
	PassthroughComponents   []string
	HasPassthrough          bool
	MacroCatalogID          string
	ExpanderScoped          bool
	ExpanderCatalogID       string
	MacroVersion            string
	EmptyMacros             bool
	ExpanderProtocolVersion string
	BaseCatalogs            []string
	ValidationCatalogs      []string
	SurfaceCatalogs         map[string]string
	HasSurfaceCatalogs      bool
	Messages                []core.AgentToRendererMessage
	HasMessages             bool
	OnError                 macros.ErrorPolicy
}

type manifestRecord struct {
	Harness string `json:"harness"`
	Suite   string `json:"suite"`
	Case    string `json:"case"`
	Status  string `json:"status"`
	Reason  string `json:"reason,omitempty"`
}

func findConformanceRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate caller path")
	}
	dir := filepath.Dir(file)
	for {
		candidate := filepath.Join(dir, "conformance", "conformance_schema.json")
		if _, err := os.Stat(candidate); err == nil {
			return filepath.Join(dir, "conformance")
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not locate conformance/conformance_schema.json walking upward")
		}
		dir = parent
	}
}

func assertKnownKeys(m map[string]any, allowed map[string]bool, kind, ctx string) error {
	var unknown []string
	for k := range m {
		if !allowed[k] {
			unknown = append(unknown, k)
		}
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		return fmt.Errorf("Unknown %s '%s' in %s", kind, unknown[0], ctx)
	}
	return nil
}

func loadMacroSuite(t *testing.T, suitePath string) (map[string]map[string]any, []macroCase) {
	t.Helper()
	rawBytes, err := os.ReadFile(suitePath)
	if err != nil {
		t.Fatalf("failed reading %s: %v", suitePath, err)
	}
	var rawSuite map[string]any
	if err := yaml.Unmarshal(rawBytes, &rawSuite); err != nil {
		t.Fatalf("failed parsing YAML %s: %v", suitePath, err)
	}
	if err := assertKnownKeys(rawSuite, knownMacroSuiteKeys, "suite key", macrosSuiteRelPath); err != nil {
		t.Fatal(err)
	}

	customCatalogs := make(map[string]map[string]any)
	if rawCustom, ok := rawSuite["custom_catalogs"].(map[string]any); ok {
		for cid, doc := range rawCustom {
			if m, ok := doc.(map[string]any); ok {
				customCatalogs[cid] = m
			}
		}
	}

	rawTests, ok := rawSuite["tests"].([]any)
	if !ok {
		t.Fatalf("expected tests list in %s", suitePath)
	}
	cases := make([]macroCase, 0, len(rawTests))
	for idx, item := range rawTests {
		rc, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("tests[%d] must be map", idx)
		}
		id, _ := rc["id"].(string)
		caseCtx := fmt.Sprintf("%s#%s", macrosSuiteRelPath, id)
		if err := assertKnownKeys(rc, knownMacroCaseKeys, "case key", caseCtx); err != nil {
			t.Fatal(err)
		}

		mc := macroCase{
			ID:                      id,
			Description:             strOf(rc["description"]),
			Golden:                  strOf(rc["golden"]),
			SurfaceID:               strOfDefault(rc["surface_id"], "conformance"),
			Input:                   rc["input"],
			CatalogID:               strOf(rc["catalog_id"]),
			Action:                  strOf(rc["action"]),
			CollidingMacro:          strOf(rc["colliding_macro"]),
			MacroCatalogID:          strOf(rc["macro_catalog_id"]),
			ExpanderScoped:          boolOfDefault(rc["expander_scoped"], true),
			ExpanderCatalogID:       strOf(rc["expander_catalog_id"]),
			MacroVersion:            strOf(rc["macro_version"]),
			EmptyMacros:             boolOfDefault(rc["empty_macros"], false),
			ExpanderProtocolVersion: strOf(rc["expander_protocol_version"]),
			OnError:                 macros.ErrorPolicy(strOfDefault(rc["on_error"], string(macros.OnErrorPassthrough))),
		}

		envVer := strOf(rc["envelope_version"])
		if envVer == "" {
			if v := strOf(rc["version"]); v == "v1.0" || v == "1.0" {
				envVer = "1.0"
			}
		}
		mc.EnvelopeVersion = envVer

		if rawVal, ok := rc["validation"].(map[string]any); ok {
			if err := assertKnownKeys(rawVal, knownMacroValidationKeys, "validation key", caseCtx); err != nil {
				t.Fatal(err)
			}
			mc.Validation = macroValidationProfile{
				AllowMissingRoot:        boolOfDefault(rawVal["allow_missing_root"], false),
				AllowOrphanComponents:   boolOfDefault(rawVal["allow_orphan_components"], false),
				AllowDanglingReferences: boolOfDefault(rawVal["allow_dangling_references"], false),
				SkipRendererValidation:  boolOfDefault(rawVal["skip_renderer_validation"], false),
			}
		}
		if ee, ok := rc["expect_error"].(map[string]any); ok {
			if err := assertKnownKeys(ee, knownExpectErrorKeys, "expect_error key", caseCtx); err != nil {
				t.Fatal(err)
			}
			mc.ExpectError = ee
		}
		if exp, ok := rc["expect"].(map[string]any); ok {
			if err := assertKnownKeys(exp, knownMacroExpectKeys, "expect key", caseCtx); err != nil {
				t.Fatal(err)
			}
			mc.Expect = exp
		}
		if rawPT, hasPT := rc["passthrough_components"]; hasPT && rawPT != nil {
			mc.HasPassthrough = true
			mc.PassthroughComponents = strSliceOf(rawPT)
		}
		if rawBC, ok := rc["base_catalogs"]; ok && rawBC != nil {
			mc.BaseCatalogs = strSliceOf(rawBC)
		}
		if rawVC, ok := rc["validation_catalogs"]; ok && rawVC != nil {
			mc.ValidationCatalogs = strSliceOf(rawVC)
		}
		if rawSC, hasSC := rc["surface_catalogs"]; hasSC && rawSC != nil {
			if scMap, ok := rawSC.(map[string]any); ok {
				mc.HasSurfaceCatalogs = true
				mc.SurfaceCatalogs = make(map[string]string, len(scMap))
				for k, v := range scMap {
					mc.SurfaceCatalogs[k] = strOf(v)
				}
			}
		}
		if rawMsgs, hasMsgs := rc["messages"]; hasMsgs && rawMsgs != nil {
			if list, ok := rawMsgs.([]any); ok {
				mc.HasMessages = true
				mc.Messages = make([]core.AgentToRendererMessage, 0, len(list))
				for _, m := range list {
					mm, _ := core.CloneJSONValue(m).(map[string]any)
					mc.Messages = append(mc.Messages, core.AgentToRendererMessage(mm))
				}
			}
		}
		cases = append(cases, mc)
	}
	return customCatalogs, cases
}

func strOf(v any) string {
	s, _ := v.(string)
	return s
}

func strOfDefault(v any, def string) string {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return def
}

func boolOfDefault(v any, def bool) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return def
}

func strSliceOf(v any) []string {
	list, ok := v.([]any)
	if !ok {
		return []string{}
	}
	out := make([]string, 0, len(list))
	for _, item := range list {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

type macroTestRunner struct {
	suiteMacrosV09 []*macros.Macro
	suiteMacrosV10 []*macros.Macro
	scopedMacros   map[string][]*macros.Macro
	customSchemas  map[string]map[string]any
	basicCache     map[string]*core.Catalog
	customCache    map[string]*core.Catalog
}

func newMacroTestRunner(customSchemas map[string]map[string]any) *macroTestRunner {
	return &macroTestRunner{
		suiteMacrosV09: buildSuiteMacrosV09(),
		suiteMacrosV10: buildSuiteMacrosV1_0(),
		scopedMacros:   buildScopedSuiteMacros(),
		customSchemas:  customSchemas,
		basicCache:     make(map[string]*core.Catalog),
		customCache:    make(map[string]*core.Catalog),
	}
}

func (r *macroTestRunner) basicCatalogFor(version string) (*core.Catalog, error) {
	if cat, ok := r.basicCache[version]; ok {
		return cat, nil
	}
	pv, err := core.ToProtocolVersion(version)
	if err != nil {
		return nil, err
	}
	base, err := core.BasicCatalog(pv)
	if err != nil {
		return nil, err
	}
	reloaded, err := core.CatalogFromJSON(base.ValidationSchema(), &core.CatalogLoadOptions{
		CatalogID:       base.CatalogID(),
		ProtocolVersion: pv,
	})
	if err != nil {
		return nil, err
	}
	r.basicCache[version] = reloaded
	return reloaded, nil
}

func (r *macroTestRunner) resolveCatalog(catalogID, defaultVersion string) (*core.Catalog, error) {
	if schema, ok := r.customSchemas[catalogID]; ok {
		if cached, ok := r.customCache[catalogID]; ok {
			return cached, nil
		}
		ver := defaultVersion
		if pvStr, ok := schema["protocolVersion"].(string); ok && pvStr != "" {
			ver = pvStr
		}
		pv, err := core.ToProtocolVersion(ver)
		if err != nil {
			return nil, err
		}
		schemaCopy, _ := core.CloneJSONValue(schema).(map[string]any)
		cat, err := core.CatalogFromJSON(schemaCopy, &core.CatalogLoadOptions{
			CatalogID:       catalogID,
			ProtocolVersion: pv,
		})
		if err != nil {
			return nil, err
		}
		r.customCache[catalogID] = cat
		return cat, nil
	}
	if catalogID == v10BasicCID {
		return r.basicCatalogFor("1.0")
	}
	if catalogID == v09BasicCID {
		return r.basicCatalogFor("0.9.1")
	}
	base, err := r.basicCatalogFor(defaultVersion)
	if err != nil {
		return nil, err
	}
	if catalogID == base.CatalogID() {
		return base, nil
	}
	doc := base.ToJSON()
	doc["catalogId"] = catalogID
	return core.CatalogFromJSON(doc, &core.CatalogLoadOptions{
		CatalogID:       catalogID,
		ProtocolVersion: base.ProtocolVersion(),
	})
}

func caseCatalogVersion(mc macroCase) string {
	if mc.EnvelopeVersion != "" {
		if pv, err := core.ToProtocolVersion(mc.EnvelopeVersion); err == nil && pv == core.Version1_0 {
			return "1.0"
		}
	}
	return "0.9.1"
}

func caseMacroVersion(mc macroCase) string {
	raw := mc.MacroVersion
	if raw == "" {
		raw = mc.EnvelopeVersion
	}
	if raw != "" {
		if pv, err := core.ToProtocolVersion(raw); err == nil && pv == core.Version1_0 {
			return "1.0"
		}
	}
	return "0.9.1"
}

func (r *macroTestRunner) selectMacros(mc macroCase) ([]*macros.Macro, error) {
	if mc.EmptyMacros {
		return []*macros.Macro{}, nil
	}
	if mc.CollidingMacro != "" {
		type emptyArgs struct{}
		if caseMacroVersion(mc) == "1.0" {
			m, err := macros.NewPureMacro(mc.CollidingMacro, "", func(_ emptyArgs) *v1.Card {
				return v1.NewCard(v1.NewText(v1.Str("colliding")))
			})
			if err != nil {
				return nil, err
			}
			return []*macros.Macro{m}, nil
		}
		m, err := macros.NewPureMacro(mc.CollidingMacro, "", func(_ emptyArgs) *v09.Card {
			return v09.NewCard(v09.NewText(v09.Str("colliding")))
		})
		if err != nil {
			return nil, err
		}
		return []*macros.Macro{m}, nil
	}
	if mc.MacroCatalogID != "" {
		scoped, ok := r.scopedMacros[mc.MacroCatalogID]
		if !ok {
			return nil, fmt.Errorf("no scoped macros registered for catalog_id=%q", mc.MacroCatalogID)
		}
		return scoped, nil
	}
	if caseMacroVersion(mc) == "1.0" {
		return r.suiteMacrosV10, nil
	}
	return r.suiteMacrosV09, nil
}

func (r *macroTestRunner) buildExpander(mc macroCase) (*macros.MacroExpander, error) {
	macroList, err := r.selectMacros(mc)
	if err != nil {
		return nil, err
	}
	expCID := mc.ExpanderCatalogID
	if expCID == "" && mc.ExpanderScoped {
		expCID = mc.MacroCatalogID
	}
	defaultVer := caseCatalogVersion(mc)
	var baseCats []*core.Catalog
	if len(mc.BaseCatalogs) > 0 {
		baseCats = make([]*core.Catalog, 0, len(mc.BaseCatalogs))
		for _, cid := range mc.BaseCatalogs {
			c, err := r.resolveCatalog(cid, defaultVer)
			if err != nil {
				return nil, err
			}
			baseCats = append(baseCats, c)
		}
	}
	opts := &macros.ExpanderOptions{
		CatalogID:       expCID,
		BaseCatalogs:    baseCats,
		ProtocolVersion: core.ProtocolVersion(mc.ExpanderProtocolVersion),
		OnError:         mc.OnError,
	}
	if mc.HasPassthrough {
		opts.PassthroughFilter = macros.PassthroughOnly(mc.PassthroughComponents...)
	}
	return macros.NewMacroExpander(macroList, opts)
}

func normalizeNullCatalogIDOnInput(rawMsgs []core.AgentToRendererMessage) []core.AgentToRendererMessage {
	out := make([]core.AgentToRendererMessage, len(rawMsgs))
	for i, m := range rawMsgs {
		cloned := m.Clone()
		for _, envKey := range []string{"createSurface", "updateComponents", "surfaceUpdate"} {
			if body, ok := cloned[envKey].(map[string]any); ok {
				if cid, exists := body["catalogId"]; exists && cid == nil {
					delete(body, "catalogId")
				}
				if comps, ok := body["components"].([]any); ok {
					for _, elem := range comps {
						if cm, ok := elem.(map[string]any); ok {
							if cid, exists := cm["catalogId"]; exists && cid == nil {
								delete(cm, "catalogId")
							}
						}
					}
				}
			}
		}
		out[i] = cloned
	}
	return out
}

func (r *macroTestRunner) runCase(mc macroCase) (*core.Catalog, []core.AgentToRendererMessage, error) {
	switch mc.Action {
	case "to_catalog":
		exp, err := r.buildExpander(mc)
		if err != nil {
			return nil, nil, err
		}
		cat, err := exp.ToCatalog()
		return cat, nil, err

	case "transform_catalog":
		exp, err := r.buildExpander(mc)
		if err != nil {
			return nil, nil, err
		}
		base, err := r.basicCatalogFor(caseCatalogVersion(mc))
		if err != nil {
			return nil, nil, err
		}
		if _, err := exp.TransformToInferenceCatalog(base); err != nil {
			return nil, nil, err
		}
		return nil, []core.AgentToRendererMessage{}, nil

	case "transform_to_inference_catalog":
		exp, err := r.buildExpander(mc)
		if err != nil {
			return nil, nil, err
		}
		base, err := r.basicCatalogFor(caseCatalogVersion(mc))
		if err != nil {
			return nil, nil, err
		}
		cat, err := exp.TransformToInferenceCatalog(base)
		return cat, nil, err

	case "transform_to_inference":
		rawComps := toAnySliceInput(mc.Input)
		ver := mc.EnvelopeVersion
		if ver == "" {
			ver = "v0.9"
		}
		msg := core.AgentToRendererMessage{
			"version": ver,
			"updateComponents": map[string]any{
				"surfaceId":  mc.SurfaceID,
				"components": rawComps,
			},
		}
		// Go has no transform_to_inference: inference-direction messages carry macros unexpanded,
		// so the case checks that the expander builds and that the input passes through untouched.
		if _, err := r.buildExpander(mc); err != nil {
			return nil, nil, err
		}
		return nil, []core.AgentToRendererMessage{msg.Clone()}, nil
	}

	var rawMsgs []core.AgentToRendererMessage
	if mc.HasMessages {
		rawMsgs = normalizeNullCatalogIDOnInput(mc.Messages)
	} else {
		verStr := mc.EnvelopeVersion
		if verStr == "" {
			verStr = "v0.9"
		}
		rawComps := toAnySliceInput(mc.Input)
		if mc.CatalogID != "" {
			rawMsgs = []core.AgentToRendererMessage{
				{
					"version": verStr,
					"createSurface": map[string]any{
						"surfaceId": mc.SurfaceID,
						"catalogId": mc.CatalogID,
					},
				},
				{
					"version": verStr,
					"updateComponents": map[string]any{
						"surfaceId":  mc.SurfaceID,
						"components": rawComps,
					},
				},
			}
		} else {
			rawMsgs = []core.AgentToRendererMessage{
				{
					"version": verStr,
					"updateComponents": map[string]any{
						"surfaceId":  mc.SurfaceID,
						"components": rawComps,
					},
				},
			}
		}
		rawMsgs = normalizeNullCatalogIDOnInput(rawMsgs)
	}

	exp, err := r.buildExpander(mc)
	if err != nil {
		return nil, nil, err
	}
	session := exp.NewSession()
	surfaceIDs := make([]string, 0, len(mc.SurfaceCatalogs))
	for sid := range mc.SurfaceCatalogs {
		surfaceIDs = append(surfaceIDs, sid)
	}
	sort.Strings(surfaceIDs)
	for _, sid := range surfaceIDs {
		session.TrackSurface(sid, mc.SurfaceCatalogs[sid])
	}
	lowered, err := session.TransformToTransport(rawMsgs)
	return nil, lowered, err
}

func toAnySliceInput(input any) []any {
	if list, ok := input.([]any); ok {
		return core.CloneJSONValue(list).([]any)
	}
	return []any{core.CloneJSONValue(input)}
}

func (r *macroTestRunner) validateMacroPayload(payload []core.AgentToRendererMessage, mc macroCase) error {
	if mc.Validation.SkipRendererValidation {
		return nil
	}
	cfg := mc.Validation.toConfig()
	ver := caseCatalogVersion(mc)

	var catalogs []*core.Catalog
	if len(mc.ValidationCatalogs) > 0 {
		for _, cid := range mc.ValidationCatalogs {
			c, err := r.resolveCatalog(cid, ver)
			if err != nil {
				return err
			}
			catalogs = append(catalogs, c)
		}
	} else {
		base, err := r.basicCatalogFor(ver)
		if err != nil {
			return err
		}
		catalogs = append(catalogs, base)
		if mc.CatalogID != "" && mc.CatalogID != base.CatalogID() {
			extra, err := r.resolveCatalog(mc.CatalogID, ver)
			if err != nil {
				return err
			}
			catalogs = append(catalogs, extra)
		}
	}

	proc, err := core.NewMessageProcessor(catalogs, &core.MessageProcessorOptions{
		ValidationConfig: &cfg,
	})
	if err != nil {
		return err
	}

	hasCreate := false
	for _, m := range payload {
		if _, ok := m["createSurface"]; ok {
			hasCreate = true
			break
		}
	}
	if !hasCreate {
		defaultCat := catalogs[0]
		defaultCID := defaultCat.CatalogID()
		if mc.HasSurfaceCatalogs {
			if seededCID, exists := mc.SurfaceCatalogs[mc.SurfaceID]; exists {
				if seededCID == "" {
					defaultCat = nil
					defaultCID = ""
				} else {
					sc, err := r.resolveCatalog(seededCID, ver)
					if err != nil {
						return err
					}
					defaultCat = sc
					defaultCID = sc.CatalogID()
				}
			}
		}
		proc.Model.AddSurface(core.NewSurfaceModel(mc.SurfaceID, defaultCID, defaultCat))
	}
	return proc.ProcessMessages(payload, &core.ExecutionContext{ValidationConfig: &cfg})
}

func normalizeJSON(v any) (any, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func matchesErrorCategory(err error, category string) bool {
	switch category {
	case "CatalogError":
		var target *core.CatalogError
		return errors.As(err, &target)
	case "RecursionError":
		var target *core.RecursionError
		return errors.As(err, &target)
	case "ValidationError":
		var target *core.ValidationError
		return errors.As(err, &target)
	default:
		var ce core.CategorizedError
		return errors.As(err, &ce) && string(ce.ErrorCategory()) == category
	}
}

func writeMacroManifestRecords(t *testing.T, fileName string, records []manifestRecord) {
	t.Helper()
	manifestDir := os.Getenv("A2UI_CONFORMANCE_MANIFEST_DIR")
	if manifestDir == "" {
		return
	}
	if err := os.MkdirAll(manifestDir, 0o755); err != nil {
		t.Fatalf("failed creating manifest dir %s: %v", manifestDir, err)
	}
	path := filepath.Join(manifestDir, fileName)
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("failed creating manifest file %s: %v", path, err)
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	for _, rec := range records {
		if err := enc.Encode(rec); err != nil {
			t.Fatalf("failed encoding manifest record: %v", err)
		}
	}
}

func TestMacrosConformance(t *testing.T) {
	confRoot := findConformanceRoot(t)
	macrosDir := filepath.Join(confRoot, "agent", "macros")
	goldenDir := filepath.Join(macrosDir, "golden")
	suitePath := filepath.Join(macrosDir, "macros.yaml")

	customSchemas, cases := loadMacroSuite(t, suitePath)
	runner := newMacroTestRunner(customSchemas)

	records := make([]manifestRecord, 0, len(cases))
	for _, mc := range cases {
		status := "passed"
		ok := t.Run(mc.ID, func(t *testing.T) {
			catResult, msgResult, err := runner.runCase(mc)

			if mc.ExpectError != nil {
				wantCat := strOf(mc.ExpectError["category"])
				if err == nil && len(msgResult) > 0 {
					err = runner.validateMacroPayload(msgResult, mc)
				}
				if err == nil {
					t.Fatalf("expected error category %q, got nil", wantCat)
				}
				if !matchesErrorCategory(err, wantCat) {
					t.Fatalf("expected error category %q, got (%T) %v", wantCat, err, err)
				}
				if msgPattern := strOf(mc.ExpectError["message"]); msgPattern != "" {
					rx, compErr := regexp.Compile(msgPattern)
					if compErr != nil {
						t.Fatalf("invalid expect_error message regex %q: %v", msgPattern, compErr)
					}
					if !rx.MatchString(err.Error()) {
						t.Fatalf("error %q did not match regex %q", err.Error(), msgPattern)
					}
				}
				return
			}

			if err != nil {
				t.Fatalf("runCase(%s) failed unexpectedly: %v", mc.ID, err)
			}

			if mc.Action == "transform_to_inference" {
				if len(msgResult) != 1 {
					t.Fatalf("expected 1 message from transform_to_inference, got %d", len(msgResult))
				}
				uc, _ := msgResult[0]["updateComponents"].(map[string]any)
				gotNorm, _ := normalizeJSON(uc["components"])
				wantNorm, _ := normalizeJSON([]any{mc.Input})
				if !reflect.DeepEqual(gotNorm, wantNorm) {
					t.Fatalf("transform_to_inference mismatch: got %#v, want %#v", gotNorm, wantNorm)
				}
				return
			}

			if mc.Golden != "" {
				actualNorm, err := normalizeJSON(msgResult)
				if err != nil {
					t.Fatalf("normalizeJSON failed: %v", err)
				}
				goldenPath := filepath.Join(goldenDir, filepath.FromSlash(mc.Golden))
				goldenBytes, err := os.ReadFile(goldenPath)
				if err != nil {
					t.Fatalf("failed reading golden %s: %v", goldenPath, err)
				}
				var expected any
				if err := json.Unmarshal(goldenBytes, &expected); err != nil {
					t.Fatalf("failed unmarshaling golden %s: %v", goldenPath, err)
				}
				if !reflect.DeepEqual(actualNorm, expected) {
					gotJSON, _ := json.MarshalIndent(actualNorm, "", "  ")
					wantJSON, _ := json.MarshalIndent(expected, "", "  ")
					t.Fatalf("%s mismatch:\ngot:\n%s\nwant:\n%s", mc.Description, gotJSON, wantJSON)
				}
				if err := runner.validateMacroPayload(msgResult, mc); err != nil {
					t.Fatalf("validateMacroPayload(%s) failed: %v", mc.ID, err)
				}
				return
			}

			if mc.Expect != nil {
				assertMacroExpect(t, runner, mc, catResult, msgResult)
				return
			}

			t.Fatalf("case %s had no golden, expect_error, expect, or transform_to_inference assertion", mc.ID)
		})
		if !ok {
			status = "failed"
		}
		records = append(records, manifestRecord{
			Harness: "go-agent",
			Suite:   macrosSuiteRelPath,
			Case:    mc.ID,
			Status:  status,
		})
	}

	writeMacroManifestRecords(t, "go-agent-macros.jsonl", records)

	t.Run("SuiteCoversEveryGoldenAndCase", func(t *testing.T) {
		declaredGoldens := make(map[string]bool)
		seenIDs := make(map[string]bool)
		for _, mc := range cases {
			if seenIDs[mc.ID] {
				t.Fatalf("duplicate case ID %q in macros.yaml", mc.ID)
			}
			seenIDs[mc.ID] = true
			if mc.Golden != "" {
				declaredGoldens[mc.Golden] = true
			}
		}

		onDisk := make(map[string]bool)
		err := filepath.WalkDir(goldenDir, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if !d.IsDir() && filepath.Ext(d.Name()) == ".json" {
				rel, err := filepath.Rel(goldenDir, path)
				if err != nil {
					return err
				}
				onDisk[filepath.ToSlash(rel)] = true
			}
			return nil
		})
		if err != nil {
			t.Fatalf("failed walking golden dir: %v", err)
		}
		if !reflect.DeepEqual(onDisk, declaredGoldens) {
			t.Fatalf("golden files mismatch: onDisk=%v declared=%v", onDisk, declaredGoldens)
		}
	})
}

func assertMacroExpect(
	t *testing.T,
	runner *macroTestRunner,
	mc macroCase,
	catResult *core.Catalog,
	msgResult []core.AgentToRendererMessage,
) {
	t.Helper()
	expect := mc.Expect

	if catResult == nil {
		var allComps []map[string]any
		for _, msg := range msgResult {
			if uc, ok := msg["updateComponents"].(map[string]any); ok {
				if comps, ok := uc["components"].([]any); ok {
					for _, c := range comps {
						if cm, ok := c.(map[string]any); ok {
							allComps = append(allComps, cm)
						}
					}
				}
			}
		}
		if wantCSCID, has := expect["create_surface_catalog_id"]; has {
			var createMsgs []map[string]any
			for _, msg := range msgResult {
				if cs, ok := msg["createSurface"].(map[string]any); ok {
					createMsgs = append(createMsgs, cs)
				}
			}
			if len(createMsgs) != 1 {
				t.Fatalf("expected 1 createSurface message, got %d", len(createMsgs))
			}
			if createMsgs[0]["catalogId"] != wantCSCID {
				t.Fatalf("createSurface.catalogId = %v, want %v", createMsgs[0]["catalogId"], wantCSCID)
			}
		}
		if wantComps, has := expect["components"]; has {
			gotNorm, _ := normalizeJSON(allComps)
			wantNorm, _ := normalizeJSON(wantComps)
			if !reflect.DeepEqual(gotNorm, wantNorm) {
				gotB, _ := json.MarshalIndent(gotNorm, "", "  ")
				wantB, _ := json.MarshalIndent(wantNorm, "", "  ")
				t.Fatalf("components mismatch:\ngot:\n%s\nwant:\n%s", gotB, wantB)
			}
		}
		if wantTypesRaw, has := expect["component_types"]; has {
			wantTypes := strSliceOf(wantTypesRaw)
			gotTypes := make([]string, len(allComps))
			for i, c := range allComps {
				gotTypes[i] = strOf(c["component"])
			}
			if !reflect.DeepEqual(gotTypes, wantTypes) {
				t.Fatalf("component_types = %v, want %v", gotTypes, wantTypes)
			}
		}
		if absentProp, ok := expect["absent_property_on_all_components"].(string); ok {
			for _, c := range allComps {
				if _, exists := c[absentProp]; exists {
					t.Fatalf("expected property %q to be absent from component %#v", absentProp, c)
				}
			}
		}
		if err := runner.validateMacroPayload(msgResult, mc); err != nil {
			t.Fatalf("validateMacroPayload(%s) failed: %v", mc.ID, err)
		}
		return
	}

	catalogJSON := catResult.ToJSON()
	catalogSchema := catResult.ValidationSchema()

	if wantCID, ok := expect["catalog_id"].(string); ok {
		if catResult.CatalogID() != wantCID {
			t.Fatalf("catResult.CatalogID() = %q, want %q", catResult.CatalogID(), wantCID)
		}
		if catalogJSON["catalogId"] != wantCID {
			t.Fatalf("catalogJSON.catalogId = %v, want %q", catalogJSON["catalogId"], wantCID)
		}
	}

	if wantCount, has := expect["component_count"]; has {
		comps, _ := catalogJSON["components"].(map[string]any)
		var countInt int
		switch v := wantCount.(type) {
		case int:
			countInt = v
		case float64:
			countInt = int(v)
		}
		if len(comps) != countInt {
			t.Fatalf("component_count = %d, want %d", len(comps), countInt)
		}
	}

	if wantDisc, ok := expect["has_any_component_discriminator"].(bool); ok {
		defs, _ := catalogJSON["$defs"].(map[string]any)
		anyComp, _ := defs["anyComponent"].(map[string]any)
		disc := anyComp["discriminator"]
		if wantDisc {
			wantD := map[string]any{"propertyName": "component"}
			if !reflect.DeepEqual(disc, wantD) {
				t.Fatalf("anyComponent.discriminator = %#v, want %#v", disc, wantD)
			}
		} else if disc != nil {
			t.Fatalf("expected nil anyComponent.discriminator, got %#v", disc)
		}
	}

	if wantAnyFn, ok := expect["has_any_function"].(bool); ok {
		defs, _ := catalogJSON["$defs"].(map[string]any)
		_, hasAnyFn := defs["anyFunction"]
		if hasAnyFn != wantAnyFn {
			t.Fatalf("has_any_function = %v, want %v", hasAnyFn, wantAnyFn)
		}
	}

	if augRaw, has := expect["augmented_components"]; has {
		comps, _ := catalogSchema["components"].(map[string]any)
		for _, compName := range strSliceOf(augRaw) {
			if _, ok := comps[compName]; !ok {
				t.Fatalf("expected %q in synthesized catalog components", compName)
			}
		}
	}

	if absRaw, has := expect["absent_components"]; has {
		comps, _ := catalogSchema["components"].(map[string]any)
		for _, compName := range strSliceOf(absRaw) {
			if _, ok := comps[compName]; ok {
				t.Fatalf("expected %q to be absent from catalog components", compName)
			}
		}
	}

	if refsRaw, has := expect["any_component_references"]; has {
		refTargets := extractAnyCompRefTargets(catalogSchema)
		for _, wantRef := range strSliceOf(refsRaw) {
			if !slices.Contains(refTargets, wantRef) {
				t.Fatalf("expected %q in anyComponent.oneOf (%v)", wantRef, refTargets)
			}
		}
	}

	if absRefsRaw, has := expect["absent_any_component_references"]; has {
		refTargets := extractAnyCompRefTargets(catalogSchema)
		for _, name := range strSliceOf(absRefsRaw) {
			for _, r := range refTargets {
				if strings.HasSuffix(r, "/"+name) {
					t.Fatalf("expected reference to %q to be absent from anyComponent.oneOf (%v)", name, refTargets)
				}
			}
		}
	}

	if compPropsRaw, ok := expect["component_properties"].(map[string]any); ok {
		comps, _ := catalogJSON["components"].(map[string]any)
		for compName, expectedPropsRaw := range compPropsRaw {
			compDef, ok := comps[compName].(map[string]any)
			if !ok {
				t.Fatalf("component %q not found in catalog", compName)
			}
			actualProps, _ := compDef["properties"].(map[string]any)
			expectedProps, _ := expectedPropsRaw.(map[string]any)
			for pName, pSchemaRaw := range expectedProps {
				actualPropSchema, ok := actualProps[pName].(map[string]any)
				if !ok {
					t.Fatalf("property %q missing from %q (got %v)", pName, compName, actualProps)
				}
				pSchema, _ := pSchemaRaw.(map[string]any)
				for k, v := range pSchema {
					gotNorm, _ := normalizeJSON(actualPropSchema[k])
					wantNorm, _ := normalizeJSON(v)
					if !reflect.DeepEqual(gotNorm, wantNorm) {
						t.Fatalf("component %s.%s[%s] = %#v, want %#v", compName, pName, k, gotNorm, wantNorm)
					}
				}
			}
		}
	}

	if wantPV, ok := expect["protocol_version"].(string); ok {
		gotPV := catResult.ProtocolVersion().NumberString()
		if gotPV != wantPV {
			t.Fatalf("catResult.ProtocolVersion().NumberString() = %q, want %q", gotPV, wantPV)
		}
		if rawDocPV, ok := catalogJSON["protocolVersion"].(string); ok && rawDocPV != wantPV {
			t.Fatalf("catalogJSON.protocolVersion = %q, want %q", rawDocPV, wantPV)
		}
	}
}

func extractAnyCompRefTargets(schema map[string]any) []string {
	defs, _ := schema["$defs"].(map[string]any)
	anyComp, _ := defs["anyComponent"].(map[string]any)
	oneOf, _ := anyComp["oneOf"].([]any)
	out := make([]string, 0, len(oneOf))
	for _, entry := range oneOf {
		if rm, ok := entry.(map[string]any); ok {
			if ref, ok := rm["$ref"].(string); ok {
				out = append(out, ref)
			}
		}
	}
	return out
}
