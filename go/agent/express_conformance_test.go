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
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/a2ui-project/a2ui/go/agent/internal/schemahelper"
	"github.com/a2ui-project/a2ui/go/core"
)

const (
	expConfDefaultSurfaceID = "default_surface"
	expConfDefaultCatalog   = "test_data/catalogs/simplified_catalog_v1_0.json"
	expConfScalingSkipMsg   = "timing suite, run when A2UI_RUN_TIMING=1"
)

var (
	expConfSuites = []string{
		"agent/express/compiler.yaml",
		"agent/express/decompiler.yaml",
		"agent/express/prompt_generator.yaml",
		"agent/express/response_parser.yaml",
		"agent/express/response_streaming.yaml",
	}

	expConfVersions = []string{"v1.0", "v0.9-lowered"}

	expConfCaseMetadataKeys = map[string]bool{
		"name": true, "description": true, "features": true,
		"protocolVersion": true, "catalog": true, "catalogs": true,
	}
	expConfExpectErrorKeys       = map[string]bool{"category": true, "message": true, "details": true}
	expConfExpectErrorDetailKeys = map[string]bool{"path": true, "code": true, "message": true}

	expConfCompileCaseKeys = expConfMergeKeySet(expConfCaseMetadataKeys,
		"action", "args", "input", "expect", "expect_error", "expect_present",
	)
	expConfDecompileCaseKeys = expConfMergeKeySet(expConfCaseMetadataKeys,
		"action", "args", "messages", "expect_contains", "expect_absent",
		"expect_error", "expect_recompiled", "expect_round_trip",
	)
	expConfUnwrapCaseKeys = expConfMergeKeySet(expConfCaseMetadataKeys,
		"action", "args", "input", "expect",
	)
	expConfHasFormatContentCaseKeys = expConfMergeKeySet(expConfCaseMetadataKeys,
		"action", "args", "input", "expect",
	)
	expConfWrapCaseKeys = expConfMergeKeySet(expConfCaseMetadataKeys,
		"action", "args", "parts", "expect_output", "expect_contains", "expect_round_trip",
	)
	expConfParseResponseCaseKeys = expConfMergeKeySet(expConfCaseMetadataKeys,
		"action", "args", "input", "expect", "expect_error",
	)
	expConfParseChunkCaseKeys = expConfMergeKeySet(expConfCaseMetadataKeys,
		"action", "args", "steps", "expect_close", "expect_error", "expect_matches_single_shot",
	)
	expConfParseChunkStepKeys = map[string]bool{
		"input": true, "expect": true, "expect_error": true,
		"expect_in_block": true, "expect_partial_results": true,
	}
	expConfGeneratePromptSnippetCaseKeys = expConfMergeKeySet(expConfCaseMetadataKeys,
		"action", "args", "expect_file", "expect_callable_functions",
		"expect_contains", "expect_absent", "expect_deterministic", "expect_error",
	)
	expConfMeasureGrowthCaseKeys = expConfMergeKeySet(expConfCaseMetadataKeys,
		"action", "args", "operation", "payload", "sizes", "max_ratio", "chunk_size",
	)

	expConfV1OnlyCases = map[string]string{
		"test_compile_express_index_system_function":                                                                      "v0.9 defines no system functions.",
		"test_compile_express_index_system_function_positional_offset":                                                    "v0.9 defines no system functions.",
		"test_compile_express_index_system_function_named_offset":                                                         "v0.9 defines no system functions.",
		"test_decompile_express_index_system_function":                                                                    "v0.9 defines no system functions.",
		"test_express_snippet_lists_system_functions_from_v1_0":                                                           "v0.9 defines no system functions.",
		"test_compile_express_system_function_with_catalog_id_is_a_validation_error":                                      "v0.9 defines no system functions.",
		"test_compile_express_unknown_system_function_is_a_validation_error":                                              "v0.9 defines no system functions.",
		"test_compile_express_unreferenced_variable_holding_a_system_function_call_with_catalog_id_is_a_validation_error": "v0.9 defines no system functions.",
		"test_compile_express_unreferenced_variable_holding_an_unknown_system_function_is_a_validation_error":             "v0.9 defines no system functions.",
		"test_compile_express_root_holding_an_unknown_system_function_is_a_validation_error":                              "v0.9 defines no system functions.",
		"test_compile_express_variable_holding_a_system_function_call_is_inlined":                                         "v0.9 defines no system functions.",
		"test_compile_express_variable_holding_a_system_function_call_with_catalog_id_is_a_validation_error":              "v0.9 defines no system functions.",
		"test_decompile_express_system_function_with_catalog_id_is_a_validation_error":                                    "v0.9 defines no system functions.",
		"test_decompile_express_unknown_system_function_is_a_validation_error":                                            "v0.9 defines no system functions.",
		"test_compile_express_event_user_message":                                                                         "v0.9 Action has no userMessage field.",
		"test_compile_express_event_user_message_binding_with_context":                                                    "v0.9 Action has no userMessage field.",
		"test_decompile_express_event_action_with_user_message":                                                           "v0.9 Action has no userMessage field.",
		"test_compile_express_event_user_message_function_call":                                                           "v0.9 Action has no userMessage field.",
		"test_decompile_express_event_action_with_function_call_user_message":                                             "v0.9 Action has no userMessage field.",
		"test_express_snippet_teaches_event_user_message_from_v1_0":                                                       "v0.9 Action has no userMessage field.",
		"test_compile_express_surface_targeting_names_a_catalog":                                                          "v0.9 names one catalog per surface.",
		"test_decompile_express_two_surfaces_in_two_catalogs":                                                             "v0.9 names one catalog per surface.",
		"test_decompile_express_event_action_with_nested_context":                                                         "v0.9 DynamicValue holds no map.",
		"test_decompile_express_non_identifier_id_before_v1_0_derives_a_variable":                                         "Already written against a v0.9 catalog.",
		"test_decompile_express_non_identifier_id_from_v1_0_is_a_validation_error":                                        "Before v1.0, non-UAX-31 component IDs are derived rather than rejected.",
		"test_compile_express_non_identifier_id_from_v1_0_is_a_validation_error":                                          "Before v1.0, component IDs need not be UAX 31 identifiers.",
		"test_compile_express_map_literal_keeps_keys_named_like_express_constructs":                                       "v0.9 reserves plain path and call keys.",
		"test_compile_express_map_literal_keeps_quoted_keys_named_like_constructs":                                        "v0.9 reserves plain path and call keys.",
		"test_compile_express_map_literals_in_function_arguments_keep_their_keys":                                         "v0.9 reserves plain path and call keys.",
		"test_decompile_express_map_with_keys_named_like_express_constructs":                                              "v0.9 reserves plain path and call keys.",
		"test_decompile_express_map_with_plain_call_and_args_keys":                                                        "v0.9 reserves plain path and call keys.",
		"test_decompile_express_map_with_a_binding_key_beside_other_keys":                                                 "v0.9 reserves plain path key.",
		"test_compile_express_map_with_call_like_keys_still_rejects_bindings":                                             "Lowered v0.9 free-form object binding behavior differs.",
		"test_compile_express_surface_extensions_variable_reference":                                                      "Surface extensions require A2UI v1.0 or later.",
		"test_compile_express_empty_extensions_preserved":                                                                 "Surface and component extensions require A2UI v1.0 or later.",
		"test_decompile_express_component_metadata_writes_extensions":                                                     "Surface and component extensions require A2UI v1.0 or later.",
		"test_decompile_express_legacy_bare_metadata_on_v1_0":                                                             "Surface and component extensions require A2UI v1.0 or later.",
		"test_decompile_express_legacy_bare_checks_on_v1_0":                                                               "Tests v1.0 reading the legacy bare checks key, which is the v0.9 key, so it runs as written in v1.0 only.",
		"test_compile_express_standalone_call_renderer_or_agent_function":                                                 "Protocol v0.9 has no callRendererFunction message.",
		"test_compile_express_standalone_call_agent_only_function":                                                        "Protocol v0.9 has no callRendererFunction message.",
		"test_compile_express_standalone_call_renderer_only_function_is_validation_error":                                 "Protocol v0.9 has no callRendererFunction message.",
		"test_compile_express_standalone_call_user_activation_function_is_validation_error":                               "Protocol v0.9 has no callRendererFunction message.",
		"test_express_snippet_names_only_agent_callable_functions_for_standalone_calls":                                   "Protocol v0.9 function schema does not support allowedCallers.",
	}
)

func expConfMergeKeySet(base map[string]bool, extra ...string) map[string]bool {
	out := maps.Clone(base)
	for _, k := range extra {
		out[k] = true
	}
	return out
}

type expConfOutcome struct {
	status string
	reason string
}

type expConfCaseKey struct {
	suite string
	name  string
}

type expConfManifestTracker struct {
	mu      sync.Mutex
	order   []expConfCaseKey
	records map[expConfCaseKey]map[string]expConfOutcome
}

var expConfManifest = &expConfManifestTracker{
	records: make(map[expConfCaseKey]map[string]expConfOutcome),
}

func (m *expConfManifestTracker) record(suite, caseName, versionKey, status, reason string) {
	manifestDir := os.Getenv("A2UI_CONFORMANCE_MANIFEST_DIR")
	if manifestDir == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	key := expConfCaseKey{suite: suite, name: caseName}
	if _, exists := m.records[key]; !exists {
		m.order = append(m.order, key)
		m.records[key] = make(map[string]expConfOutcome)
	}
	m.records[key][versionKey] = expConfOutcome{status: status, reason: reason}

	_ = os.MkdirAll(manifestDir, 0o755)
	manifestPath := filepath.Join(manifestDir, "go-agent-express.jsonl")
	var lines []string
	for _, k := range m.order {
		mergedStatus, mergedReason := expConfCombineOutcomes(m.records[k])
		rec := map[string]string{
			"harness": "go-agent",
			"suite":   k.suite,
			"case":    k.name,
			"status":  mergedStatus,
		}
		if mergedReason != "" {
			rec["reason"] = mergedReason
		}
		b, _ := json.Marshal(rec)
		lines = append(lines, string(b))
	}
	_ = os.WriteFile(manifestPath, []byte(strings.Join(lines, "\n")+"\n"), 0o644)
}

func expConfCombineOutcomes(outcomes map[string]expConfOutcome) (string, string) {
	for _, target := range []string{"failed", "xfailed"} {
		for _, o := range outcomes {
			if o.status == target {
				return o.status, o.reason
			}
		}
	}
	for _, o := range outcomes {
		if o.status == "skipped" && o.reason == "" {
			return "skipped", ""
		}
	}
	for _, o := range outcomes {
		if o.status == "passed" {
			return "passed", ""
		}
	}
	for _, o := range outcomes {
		if o.reason != "" {
			return "skipped", o.reason
		}
	}
	return "skipped", ""
}

func expConfFindRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("os.Getwd: %v", err)
	}
	for {
		candidate := filepath.Join(dir, "conformance", "conformance_schema.json")
		if _, err := os.Stat(candidate); err == nil {
			return filepath.Join(dir, "conformance")
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("could not locate conformance/conformance_schema.json above %s", dir)
		}
		dir = parent
	}
}

func expConfLoadYAMLSuiteNodes(t *testing.T, confRoot, suiteRel string) []*yaml.Node {
	t.Helper()
	fullPath := filepath.Join(confRoot, filepath.FromSlash(suiteRel))
	data, err := os.ReadFile(fullPath)
	if err != nil {
		t.Fatalf("ReadFile(%s): %v", fullPath, err)
	}
	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		t.Fatalf("yaml.Unmarshal(%s): %v", fullPath, err)
	}
	if root.Kind == yaml.DocumentNode && len(root.Content) > 0 && root.Content[0].Kind == yaml.SequenceNode {
		return root.Content[0].Content
	}
	return nil
}

func expConfYAMLNodeCaseName(n *yaml.Node) string {
	if n != nil && n.Kind == yaml.MappingNode {
		for i := 0; i+1 < len(n.Content); i += 2 {
			if n.Content[i].Value == "name" {
				return n.Content[i+1].Value
			}
		}
	}
	return ""
}

func expConfDecodeYAMLNode(n *yaml.Node) any {
	if n == nil {
		return nil
	}
	switch n.Kind {
	case yaml.DocumentNode:
		if len(n.Content) == 0 {
			return nil
		}
		return expConfDecodeYAMLNode(n.Content[0])
	case yaml.SequenceNode:
		out := make([]any, len(n.Content))
		for i, child := range n.Content {
			out[i] = expConfDecodeYAMLNode(child)
		}
		return out
	case yaml.MappingNode:
		m := make(map[string]any, len(n.Content)/2)
		keys := make([]string, 0, len(n.Content)/2)
		for i := 0; i+1 < len(n.Content); i += 2 {
			k := n.Content[i].Value
			keys = append(keys, k)
			m[k] = expConfDecodeYAMLNode(n.Content[i+1])
		}
		schemahelper.SetMapKeyOrder(m, keys)
		return m
	case yaml.ScalarNode:
		switch n.Tag {
		case "!!null":
			return nil
		case "!!bool":
			b, err := strconv.ParseBool(n.Value)
			if err == nil {
				return b
			}
			return n.Value
		case "!!int":
			iv, err := strconv.ParseInt(n.Value, 10, 64)
			if err == nil {
				return iv
			}
			fv, fErr := strconv.ParseFloat(n.Value, 64)
			if fErr == nil {
				return fv
			}
			return n.Value
		case "!!float":
			fv, err := strconv.ParseFloat(n.Value, 64)
			if err == nil {
				return fv
			}
			return n.Value
		default:
			return n.Value
		}
	case yaml.AliasNode:
		return expConfDecodeYAMLNode(n.Alias)
	default:
		return n.Value
	}
}

func expConfBuildKeyOrderMap(v any, pointer string, out map[string][]string) {
	switch cur := v.(type) {
	case map[string]any:
		keys := schemahelper.OrderedKeys(cur)
		out[pointer] = keys
		for _, k := range keys {
			escaped := strings.ReplaceAll(strings.ReplaceAll(k, "~", "~0"), "/", "~1")
			expConfBuildKeyOrderMap(cur[k], pointer+"/"+escaped, out)
		}
	case []any:
		for idx, item := range cur {
			expConfBuildKeyOrderMap(item, fmt.Sprintf("%s/%d", pointer, idx), out)
		}
	}
}

func expConfAssertKnownKeys(t *testing.T, m map[string]any, allowed map[string]bool, label string) {
	t.Helper()
	for k := range m {
		if !allowed[k] {
			t.Fatalf("unknown conformance key %q in %s", k, label)
		}
	}
}

func expConfErrorCategoryName(err error) string {
	var parseErr *core.ParseError
	if errors.As(err, &parseErr) {
		return "ParseError"
	}
	var valErr *core.ValidationError
	if errors.As(err, &valErr) {
		return "ValidationError"
	}
	var catErr *core.CatalogError
	if errors.As(err, &catErr) {
		return "CatalogError"
	}
	var intErr *core.IntegrityError
	if errors.As(err, &intErr) {
		return "IntegrityError"
	}
	var recErr *core.RecursionError
	if errors.As(err, &recErr) {
		return "RecursionError"
	}
	var compErr *CompilationError
	if errors.As(err, &compErr) {
		return "CompilationError"
	}
	var categorized core.CategorizedError
	if errors.As(err, &categorized) {
		return string(categorized.ErrorCategory())
	}
	return fmt.Sprintf("%T", err)
}

func expConfErrorDetails(err error) []core.ErrorDetail {
	var valErr *core.ValidationError
	if errors.As(err, &valErr) && len(valErr.Details) > 0 {
		return valErr.Details
	}
	var compErr *CompilationError
	if errors.As(err, &compErr) && len(compErr.Details) > 0 {
		return compErr.Details
	}
	var a2uiErr *core.A2UIError
	if errors.As(err, &a2uiErr) {
		return a2uiErr.Details
	}
	return nil
}

func expConfAssertErrorMatches(t *testing.T, err error, expectErr any) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error matching %v, got nil", expectErr)
	}
	switch exp := expectErr.(type) {
	case string:
		if exp != "" {
			re, compErr := regexp.Compile(exp)
			if compErr == nil {
				if !re.MatchString(err.Error()) {
					t.Fatalf("expected error matching %q, got %q", exp, err.Error())
				}
			} else if !strings.Contains(err.Error(), exp) {
				t.Fatalf("expected error containing %q, got %q", exp, err.Error())
			}
		}
	case map[string]any:
		expConfAssertKnownKeys(t, exp, expConfExpectErrorKeys, "expect_error")
		if wantCat, ok := exp["category"].(string); ok && wantCat != "" {
			gotCat := expConfErrorCategoryName(err)
			if gotCat != wantCat {
				if !(wantCat == "CompilationError" && (gotCat == "ParseError" || gotCat == "ValidationError")) {
					t.Fatalf("expected error category %q, got %q (%v)", wantCat, gotCat, err)
				}
			}
		}
		if wantMsg, ok := exp["message"].(string); ok && wantMsg != "" {
			pattern := expConfAlignErrorMatch(wantMsg)
			re, compErr := regexp.Compile(pattern)
			if compErr == nil {
				if !re.MatchString(err.Error()) {
					t.Fatalf("expected error message matching %q, got %q", pattern, err.Error())
				}
			} else if !strings.Contains(err.Error(), wantMsg) {
				t.Fatalf("expected error message containing %q, got %q", wantMsg, err.Error())
			}
		}
		if wantDetails, ok := exp["details"].([]any); ok {
			actualDetails := expConfErrorDetails(err)
			for _, wdRaw := range wantDetails {
				wd, _ := wdRaw.(map[string]any)
				expConfAssertKnownKeys(t, wd, expConfExpectErrorDetailKeys, "expect_error.details[]")
				wantPath, _ := wd["path"].(string)
				wantCode, _ := wd["code"].(string)
				found := false
				for _, ad := range actualDetails {
					if ad.Path == wantPath && ad.Code == wantCode {
						found = true
						break
					}
				}
				if !found {
					t.Fatalf("expected error detail {path: %q, code: %q} in %+v (err=%v)", wantPath, wantCode, actualDetails, err)
				}
			}
		}
	}
}

func expConfAlignErrorMatch(expect string) string {
	switch {
	case strings.Contains(expect, "required property"):
		return "(" + expect + "|Field required|missing required property)"
	case strings.Contains(expect, "'v0.9' was expected"):
		return "(" + expect + "|Input should be 'v0.9')"
	case strings.Contains(expect, "is not of type"):
		return "(" + expect + "|Input should be a valid)"
	case strings.Contains(expect, "Validation failed"):
		return "(" + expect + "|Field required|Extra inputs are not permitted)"
	default:
		return expect
	}
}

func expConfLoadJSONFile(t *testing.T, confRoot, relPath string) (any, map[string][]string) {
	t.Helper()
	fullPath := filepath.Join(confRoot, filepath.FromSlash(relPath))
	raw, err := os.ReadFile(fullPath)
	if err != nil {
		t.Fatalf("ReadFile(%s): %v", fullPath, err)
	}
	parsed, ko, err := schemahelper.UnmarshalJSONPreservingOrder(raw)
	if err != nil {
		t.Fatalf("UnmarshalJSONPreservingOrder(%s): %v", fullPath, err)
	}
	return parsed, ko
}

func expConfTransformer(spec map[string]any) (CatalogTransformer, error) {
	if rawList, ok := spec["component_pruning"].([]any); ok {
		return &ComponentPruningTransformer{AllowedComponents: expConfToStringSlice(rawList)}, nil
	}
	if rawList, ok := spec["function_pruning"].([]any); ok {
		return &FunctionPruningTransformer{AllowedFunctions: expConfToStringSlice(rawList)}, nil
	}
	return nil, fmt.Errorf("unknown transformer: %v", spec)
}

func expConfToStringSlice(list []any) []string {
	out := make([]string, 0, len(list))
	for _, v := range list {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func expConfSetupCatalog(t *testing.T, confRoot string, ref any) (*core.Catalog, error) {
	t.Helper()
	var transformers []CatalogTransformer
	if m, ok := ref.(map[string]any); ok {
		if inner, hasCat := m["catalog"]; hasCat {
			if trList, ok := m["transformers"].([]any); ok {
				for _, trRaw := range trList {
					trMap, _ := trRaw.(map[string]any)
					tr, err := expConfTransformer(trMap)
					if err != nil {
						return nil, err
					}
					transformers = append(transformers, tr)
				}
			}
			ref = inner
		}
	}

	var baseCat *core.Catalog
	switch r := ref.(type) {
	case map[string]any:
		ko := make(map[string][]string)
		expConfBuildKeyOrderMap(r, "", ko)
		var pv core.ProtocolVersion
		if _, hasPV := r["protocolVersion"]; !hasPV {
			pv = core.Version1_0
		}
		catID := ""
		if _, hasID := r["catalogId"]; !hasID {
			catID = "inline"
		}
		prov := &InMemoryCatalogProvider{
			Document:        r,
			CatalogID:       catID,
			ProtocolVersion: pv,
			KeyOrder:        ko,
		}
		cat, err := prov.Load()
		if err != nil {
			return nil, err
		}
		baseCat = cat
	case string:
		docRaw, _ := expConfLoadJSONFile(t, confRoot, r)
		doc, _ := docRaw.(map[string]any)
		var pv core.ProtocolVersion
		if _, hasPV := doc["protocolVersion"]; !hasPV {
			pv = core.Version1_0
		}
		catID := ""
		if _, hasID := doc["catalogId"]; !hasID {
			catID = strings.TrimSuffix(filepath.Base(r), ".json")
		}
		cfg, err := CatalogConfigFromPath(filepath.Join(confRoot, filepath.FromSlash(r)), &CatalogConfigOptions{
			CatalogID:       catID,
			ProtocolVersion: pv,
			Transformers:    transformers,
		})
		if err != nil {
			return nil, err
		}
		return cfg.TransformedCatalog(), nil
	default:
		return nil, fmt.Errorf("unsupported catalog reference %T", ref)
	}

	cfg, err := NewCatalogConfig(baseCat, transformers...)
	if err != nil {
		return nil, err
	}
	return cfg.TransformedCatalog(), nil
}

func expConfCatalogsFor(t *testing.T, confRoot string, args map[string]any, useDefault bool) ([]*core.Catalog, error) {
	t.Helper()
	if rawCats, ok := args["catalogs"].([]any); ok {
		out := make([]*core.Catalog, 0, len(rawCats))
		for _, item := range rawCats {
			cat, err := expConfSetupCatalog(t, confRoot, item)
			if err != nil {
				return nil, err
			}
			out = append(out, cat)
		}
		return out, nil
	}
	if rawCat, ok := args["catalog"]; ok {
		cat, err := expConfSetupCatalog(t, confRoot, rawCat)
		if err != nil {
			return nil, err
		}
		return []*core.Catalog{cat}, nil
	}
	if !useDefault {
		return nil, nil
	}
	cat, err := expConfSetupCatalog(t, confRoot, expConfDefaultCatalog)
	if err != nil {
		return nil, err
	}
	return []*core.Catalog{cat}, nil
}

func expConfMakeFormat(t *testing.T, confRoot string, args map[string]any, useDefaultCat, lowerExamples bool) (*ExpressFormat, error) {
	t.Helper()
	catalogs, err := expConfCatalogsFor(t, confRoot, args, useDefaultCat)
	if err != nil {
		return nil, err
	}
	if len(catalogs) == 0 {
		return nil, core.NewCatalogError("at least one active catalog is required")
	}

	var examples [][]core.AgentToRendererMessage
	if exList, ok := args["examples"].([]any); ok && len(exList) > 0 {
		defCatID := catalogs[0].CatalogID()
		for _, exRaw := range exList {
			exPath, _ := exRaw.(string)
			parsed, _ := expConfLoadJSONFile(t, confRoot, exPath)
			turn := expConfToMessageSlice(parsed)
			if lowerExamples {
				turn = expConfLowerMessages(turn, defCatID)
			}
			examples = append(examples, turn)
		}
	}

	opts := &ExpressFormatOptions{
		SurfaceID: expConfDefaultSurfaceID,
		Version:   catalogs[0].ProtocolVersion(),
	}
	if allowedRaw, hasAllowed := args["allowed_messages"]; hasAllowed && allowedRaw != nil {
		if list, ok := allowedRaw.([]any); ok {
			opts.AllowedMessages = expConfToStringSlice(list)
		}
	}
	if progRaw, hasProg := args["progressive_keys"]; hasProg && progRaw != nil {
		if list, ok := progRaw.([]any); ok {
			keys := expConfToStringSlice(list)
			if len(keys) == 0 {
				opts.DisableProgressiveHealing = true
			} else {
				opts.ProgressiveKeys = keys
			}
		}
	}
	return NewExpressFormat(catalogs, examples, opts)
}

func expConfMakeParser(t *testing.T, confRoot string, args map[string]any) Parser {
	t.Helper()
	fmtInst, err := expConfMakeFormat(t, confRoot, args, true, false)
	if err != nil {
		t.Fatalf("expConfMakeFormat: %v", err)
	}
	return fmtInst.CreateParser()
}

func expConfCompileChecked(p Parser, content string) ([]core.AgentToRendererMessage, error) {
	msgs, err := p.Compile(content, true)
	if err != nil {
		return nil, err
	}
	if err := ValidatePayload(p.Catalogs(), msgs); err != nil {
		return nil, err
	}
	return msgs, nil
}

func expConfToMessageSlice(v any) []core.AgentToRendererMessage {
	switch cur := v.(type) {
	case []core.AgentToRendererMessage:
		return cur
	case map[string]any:
		return []core.AgentToRendererMessage{schemahelper.CloneMapPreservingOrder(cur)}
	case []any:
		out := make([]core.AgentToRendererMessage, 0, len(cur))
		for _, item := range cur {
			if m, ok := item.(map[string]any); ok {
				out = append(out, schemahelper.CloneMapPreservingOrder(m))
			}
		}
		return out
	default:
		return nil
	}
}

func expConfMessagesToAnySlice(msgs []core.AgentToRendererMessage) []any {
	out := make([]any, len(msgs))
	for i, m := range msgs {
		out[i] = map[string]any(m)
	}
	return out
}

func expConfResponsePartToDict(p ResponsePart) map[string]any {
	if p.IsText() {
		return map[string]any{"text": p.Text}
	}
	return map[string]any{"a2ui": expConfMessagesToAnySlice(p.A2UI)}
}

func expConfStreamPartToDict(p StreamPart) map[string]any {
	if p.IsError() {
		return map[string]any{
			"error": map[string]any{
				"category": expConfErrorCategoryName(p.Error),
			},
		}
	}
	if p.IsText() {
		return map[string]any{"text": p.Text}
	}
	return map[string]any{"a2ui": expConfMessagesToAnySlice(p.A2UI)}
}

func expConfRawPartToDict(p RawResponsePart) map[string]any {
	if p.IsText() {
		return map[string]any{"text": p.Text}
	}
	res := map[string]any{"a2ui_raw": p.A2UIRaw}
	if !p.IsFinal {
		res["is_final"] = false
	}
	return res
}

func expConfWithoutTrueFinalFlags(expected any) any {
	switch cur := expected.(type) {
	case []any:
		out := make([]any, len(cur))
		for i, item := range cur {
			out[i] = expConfWithoutTrueFinalFlags(item)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(cur))
		for k, v := range cur {
			if k == "is_final" {
				if b, ok := v.(bool); ok && b {
					continue
				}
			}
			out[k] = v
		}
		return out
	default:
		return expected
	}
}

func expConfToRawParts(partsList []any) []RawResponsePart {
	out := make([]RawResponsePart, 0, len(partsList))
	for _, item := range partsList {
		m, _ := item.(map[string]any)
		isFinal := true
		if b, ok := m["is_final"].(bool); ok {
			isFinal = b
		}
		if text, hasText := m["text"].(string); hasText {
			out = append(out, NewRawTextPart(text))
		} else if raw, hasRaw := m["a2ui_raw"].(string); hasRaw {
			out = append(out, NewRawA2UIPart(raw, isFinal))
		}
	}
	return out
}

func expConfMergeTextParts(parts []any) []any {
	var merged []any
	for _, raw := range parts {
		m, _ := raw.(map[string]any)
		if tCur, curIsText := m["text"].(string); curIsText && len(merged) > 0 {
			if prev, _ := merged[len(merged)-1].(map[string]any); prev != nil {
				if tPrev, prevIsText := prev["text"].(string); prevIsText {
					merged[len(merged)-1] = map[string]any{"text": tPrev + tCur}
					continue
				}
			}
		}
		merged = append(merged, raw)
	}
	return merged
}

func expConfResolvePointer(payload any, pointer string) any {
	cur := payload
	for _, tok := range strings.Split(strings.Trim(pointer, "/"), "/") {
		switch node := cur.(type) {
		case []any:
			idx, _ := strconv.Atoi(tok)
			cur = node[idx]
		case map[string]any:
			cur = node[tok]
		default:
			return nil
		}
	}
	return cur
}

func expConfDeletePointer(payload any, pointer string) {
	tokens := strings.Split(strings.Trim(pointer, "/"), "/")
	cur := payload
	for _, tok := range tokens[:len(tokens)-1] {
		switch node := cur.(type) {
		case []any:
			idx, _ := strconv.Atoi(tok)
			cur = node[idx]
		case map[string]any:
			cur = node[tok]
		}
	}
	last := tokens[len(tokens)-1]
	if m, ok := cur.(map[string]any); ok {
		delete(m, last)
	}
}

func expConfAsNumber(v any) (int64, float64, bool, bool) {
	switch n := v.(type) {
	case int:
		return int64(n), float64(n), true, true
	case int64:
		return n, float64(n), true, true
	case int32:
		return int64(n), float64(n), true, true
	case float64:
		return 0, n, false, true
	case float32:
		return 0, float64(n), false, true
	case json.Number:
		if iv, err := n.Int64(); err == nil && !strings.ContainsAny(n.String(), ".eE") {
			return iv, float64(iv), true, true
		}
		if fv, err := n.Float64(); err == nil {
			return 0, fv, false, true
		}
		return 0, 0, false, false
	default:
		return 0, 0, false, false
	}
}

func expConfJSONEqual(a, b any) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	if ba, okA := a.(bool); okA {
		bb, okB := b.(bool)
		return okB && ba == bb
	}
	if ia, fa, intA, numA := expConfAsNumber(a); numA {
		ib, fb, intB, numB := expConfAsNumber(b)
		if !numB {
			return false
		}
		if intA && intB {
			return ia == ib
		}
		if math.IsNaN(fa) && math.IsNaN(fb) {
			return true
		}
		return fa == fb
	}
	if sa, okA := a.(string); okA {
		sb, okB := b.(string)
		return okB && sa == sb
	}
	sliceA, isSliceA := expConfToAnySlice(a)
	sliceB, isSliceB := expConfToAnySlice(b)
	if isSliceA || isSliceB {
		if !isSliceA || !isSliceB || len(sliceA) != len(sliceB) {
			return false
		}
		for i := range sliceA {
			if !expConfJSONEqual(sliceA[i], sliceB[i]) {
				return false
			}
		}
		return true
	}
	mapA, isMapA := expConfToStringMap(a)
	mapB, isMapB := expConfToStringMap(b)
	if isMapA || isMapB {
		if !isMapA || !isMapB || len(mapA) != len(mapB) {
			return false
		}
		for k, va := range mapA {
			vb, exists := mapB[k]
			if !exists || !expConfJSONEqual(va, vb) {
				return false
			}
		}
		return true
	}
	return false
}

func expConfToAnySlice(v any) ([]any, bool) {
	switch s := v.(type) {
	case []any:
		return s, true
	case []string:
		out := make([]any, len(s))
		for i, x := range s {
			out[i] = x
		}
		return out, true
	case []map[string]any:
		out := make([]any, len(s))
		for i, x := range s {
			out[i] = x
		}
		return out, true
	case []core.AgentToRendererMessage:
		return expConfMessagesToAnySlice(s), true
	default:
		return nil, false
	}
}

func expConfToStringMap(v any) (map[string]any, bool) {
	switch m := v.(type) {
	case map[string]any:
		return m, true
	case core.AgentToRendererMessage:
		return map[string]any(m), true
	default:
		return nil, false
	}
}

func expConfAssertJSONEqual(t *testing.T, got, want any, contextMsg string) {
	t.Helper()
	if !expConfJSONEqual(got, want) {
		gotJSON, _ := json.MarshalIndent(got, "", "  ")
		wantJSON, _ := json.MarshalIndent(want, "", "  ")
		t.Fatalf("%s mismatch:\ngot:\n%s\nwant:\n%s", contextMsg, string(gotJSON), string(wantJSON))
	}
}

// --- Conformance Test Entrypoints ---

func TestExpressConformance(t *testing.T) {
	confRoot := expConfFindRoot(t)
	for _, suite := range expConfSuites {
		caseNodes := expConfLoadYAMLSuiteNodes(t, confRoot, suite)
		if len(caseNodes) == 0 {
			t.Fatalf("no cases loaded from %s", suite)
		}
		t.Run(suite, func(t *testing.T) {
			for _, caseNode := range caseNodes {
				caseName := expConfYAMLNodeCaseName(caseNode)
				t.Run(caseName, func(t *testing.T) {
					for _, ver := range expConfVersions {
						t.Run(ver, func(t *testing.T) {
							origCase, _ := expConfDecodeYAMLNode(caseNode).(map[string]any)
							expConfRunCaseWithManifest(t, confRoot, suite, caseName, ver, origCase)
						})
					}
				})
			}
		})
	}
}
