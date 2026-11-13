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

package agent_test

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

func TestAgentFoundationSmoke(t *testing.T) {
	var raw map[string]any
	if err := yaml.Unmarshal([]byte("format: express\n"), &raw); err != nil {
		t.Fatalf("yaml unmarshal failed: %v", err)
	}
	err := agent.NewCompilationParseError("bad syntax", "x =", 1, 3, "fix syntax")
	var parseErr *core.ParseError
	if !errors.As(err, &parseErr) {
		t.Fatalf("expected CompilationParseError to unwrap to *core.ParseError")
	}
	var compErr *agent.CompilationError
	if !errors.As(err, &compErr) {
		t.Fatalf("expected CompilationParseError to unwrap to *agent.CompilationError")
	}
}

var (
	agentCoreSuites = []string{
		"agent/agent_functions.yaml",
		"agent/catalog_provider.yaml",
		"agent/catalog_resolution.yaml",
		"agent/catalog_transformer.yaml",
		"agent/direct_json/compiler.yaml",
		"agent/direct_json/decompiler.yaml",
		"agent/direct_json/prompt_generator.yaml",
		"agent/direct_json/response_parser.yaml",
		"agent/direct_json/response_streaming.yaml",
		"agent/direct_json/scaling.yaml",
		"agent/multi_catalog_formats.yaml",
		"agent/renderer_capabilities.yaml",
		"agent/renderer_function_calls.yaml",
		"agent/renderer_state.yaml",
		"agent/request_processor.yaml",
		"agent/skill.yaml",
		"agent/streamed_answer.yaml",
	}

	unsupportedAgentSuites = map[string]string{
		"agent/atom/compiler.yaml":           experimentalSkipMsg,
		"agent/elemental/compiler.yaml":      experimentalSkipMsg,
		"agent/legacy/inference_format.yaml": "Pre-blueprint legacy suite superseded by the current agent suites.",
		"agent/legacy/parser.yaml":           "Pre-blueprint legacy suite superseded by the current agent suites.",
		"agent/legacy/streaming_parser.yaml": "Pre-blueprint legacy suite superseded by agent/direct_json/response_streaming.yaml and agent/express/response_streaming.yaml.",
	}

	siblingAgentSuites = makeSet(
		"agent/builder/builder.yaml",
		"agent/macros/macros.yaml",
		"agent/express/compiler.yaml",
		"agent/express/decompiler.yaml",
		"agent/express/prompt_generator.yaml",
		"agent/express/response_parser.yaml",
		"agent/express/response_streaming.yaml",
		"agent/express/scaling.yaml",
	)
)

func TestAllAgentSuitesAccountedFor(t *testing.T) {
	_, confRoot := findRepoAndConformanceRoot(t)
	agentDir := filepath.Join(confRoot, "agent")
	onDisk := make(map[string]bool)
	err := filepath.WalkDir(agentDir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !d.IsDir() && strings.HasSuffix(d.Name(), ".yaml") {
			rel, err := filepath.Rel(confRoot, path)
			if err != nil {
				return err
			}
			onDisk[filepath.ToSlash(rel)] = true
		}
		return nil
	})
	if err != nil {
		t.Fatalf("failed walking conformance/agent: %v", err)
	}

	accounted := make(map[string]bool)
	for _, s := range agentCoreSuites {
		if accounted[s] {
			t.Fatalf("duplicate suite %s", s)
		}
		accounted[s] = true
	}
	for s := range unsupportedAgentSuites {
		if accounted[s] {
			t.Fatalf("duplicate unsupported suite %s", s)
		}
		accounted[s] = true
	}
	for s := range siblingAgentSuites {
		if accounted[s] {
			t.Fatalf("duplicate sibling suite %s", s)
		}
		accounted[s] = true
	}

	if !reflect.DeepEqual(onDisk, accounted) {
		t.Fatalf("agent suite accounting mismatch:\nonDisk=%v\naccounted=%v", sortedMapKeys(onDisk), sortedMapKeys(accounted))
	}
}

func TestRejectsSnakeCaseFieldNames(t *testing.T) {
	_, err := agent.ReadRendererCapabilities(map[string]any{
		"a2uiRendererCapabilities": map[string]any{
			"1.0": map[string]any{
				"supported_catalog_ids": []any{"cat-1"},
			},
		},
	}, "1.0")
	var catErr *core.CatalogError
	if !errors.As(err, &catErr) {
		t.Fatalf("expected *core.CatalogError for snake_case supported_catalog_ids, got %v", err)
	}
}

func TestAgentConformance(t *testing.T) {
	repoRoot, confRoot := findRepoAndConformanceRoot(t)
	var records []manifestRecord

	for _, suite := range agentCoreSuites {
		suite := suite
		t.Run(suite, func(t *testing.T) {
			cases := loadYAMLCases(t, confRoot, suite)
			if len(cases) == 0 {
				t.Fatalf("suite %s has no cases", suite)
			}
			for _, tc := range cases {
				var skipReason string
				ok := t.Run(tc.Name, func(t *testing.T) {
					skipReason = dispatchAgentConformanceCase(t, repoRoot, confRoot, tc)
					if skipReason != "" {
						t.Skip(skipReason)
					}
				})
				status := "passed"
				if skipReason != "" {
					status = "skipped"
				} else if !ok {
					status = "failed"
				}
				records = append(records, manifestRecord{
					Harness: "go-agent",
					Suite:   suite,
					Case:    tc.Name,
					Status:  status,
					Reason:  skipReason,
				})
			}
		})
	}

	// Emit reasoned skip records ONLY for experimental/legacy unsupported suites.
	unsupportedNames := sortedMapKeys(unsupportedAgentSuites)
	for _, suite := range unsupportedNames {
		suite := suite
		reason := unsupportedAgentSuites[suite]
		t.Run(suite, func(t *testing.T) {
			cases := loadYAMLCases(t, confRoot, suite)
			for _, tc := range cases {
				t.Run(tc.Name, func(t *testing.T) {
					t.Skip(reason)
				})
				records = append(records, manifestRecord{
					Harness: "go-agent",
					Suite:   suite,
					Case:    tc.Name,
					Status:  "skipped",
					Reason:  reason,
				})
			}
		})
	}

	writeManifestRecords(t, "go-agent-core.jsonl", records)
}

func dispatchAgentConformanceCase(t *testing.T, repoRoot, confRoot string, tc loadedYAMLCase) string {
	t.Helper()
	switch tc.Suite {
	case "agent/catalog_provider.yaml":
		runCatalogProviderCase(t, confRoot, tc)
	case "agent/catalog_transformer.yaml":
		runCatalogTransformerCase(t, confRoot, tc)
	case "agent/catalog_resolution.yaml":
		runCatalogResolutionCase(t, confRoot, tc)
	case "agent/renderer_capabilities.yaml":
		runRendererCapabilitiesCase(t, tc)
	case "agent/renderer_state.yaml":
		runRendererStateCase(t, confRoot, tc)
	case "agent/agent_functions.yaml":
		runAgentFunctionsCase(t, confRoot, tc)
	case "agent/renderer_function_calls.yaml":
		return runRendererFunctionCallsCase(t, tc)
	case "agent/skill.yaml":
		return runSkillCase(t, repoRoot, tc)
	case "agent/streamed_answer.yaml":
		runStreamedAnswerCase(t, confRoot, tc)
	case "agent/direct_json/scaling.yaml":
		if os.Getenv("A2UI_RUN_TIMING") != "1" {
			// Still verify we can prepare the timing case cleanly.
			prepareScalingCase(t, confRoot, tc)
			return scalingSkipReason
		}
		runScalingCase(t, confRoot, tc)
	case "agent/request_processor.yaml",
		"agent/multi_catalog_formats.yaml",
		"agent/direct_json/compiler.yaml",
		"agent/direct_json/decompiler.yaml",
		"agent/direct_json/prompt_generator.yaml",
		"agent/direct_json/response_parser.yaml":
		return runFormatOrProcessorCase(t, confRoot, tc)
	case "agent/direct_json/response_streaming.yaml":
		runResponseStreamingCase(t, confRoot, tc)
	default:
		t.Fatalf("unhandled suite %s", tc.Suite)
	}
	return ""
}

// --- Catalog Provider / Transformer / Resolution / Capabilities ---

func runCatalogProviderCase(t *testing.T, confRoot string, tc loadedYAMLCase) {
	t.Helper()
	assertKnownKeys(t, tc.Data, unionSet(caseMetadataKeys, "args", "expect", "expect_error"), "provide_catalog case")
	args, _ := tc.Data["args"].(map[string]any)
	provType, _ := args["provider"].(string)
	if provType == "" {
		provType = "file_system"
	}
	pv, _ := args["protocol_version"].(string)
	cid, _ := args["catalog_id"].(string)

	provide := func() (*core.Catalog, error) {
		switch provType {
		case "file_system":
			rel, ok := args["path"].(string)
			if !ok {
				return (&agent.FileSystemCatalogProvider{
					Path:            "",
					ProtocolVersion: core.ProtocolVersion(pv),
					CatalogID:       cid,
				}).Load()
			}
			fullPath := rel
			if !strings.Contains(rel, "://") && !filepath.IsAbs(rel) {
				fullPath = filepath.Join(confRoot, filepath.FromSlash(rel))
			}
			return (&agent.FileSystemCatalogProvider{
				Path:            fullPath,
				ProtocolVersion: core.ProtocolVersion(pv),
				CatalogID:       cid,
			}).Load()
		case "in_memory":
			docMap, isMap := args["catalog"].(map[string]any)
			if !isMap {
				docMap = nil
			}
			return (&agent.InMemoryCatalogProvider{
				Document:        docMap,
				ProtocolVersion: core.ProtocolVersion(pv),
				CatalogID:       cid,
				KeyOrder:        subKeyOrder(tc.KeyOrder, "/args/catalog"),
			}).Load()
		default:
			return nil, fmt.Errorf("unknown provider %q", provType)
		}
	}

	cat, err := provide()
	if expErr, hasErr := tc.Data["expect_error"]; hasErr {
		assertExpectedError(t, err, expErr, tc.Name)
		return
	}
	if err != nil {
		t.Fatalf("provide_catalog failed: %v", err)
	}
	expMap, _ := tc.Data["expect"].(map[string]any)
	checkExpectedCatalog(t, cat, expMap)
}

func buildCatalogSuiteConfig(t *testing.T, confRoot string, entry any) *agent.CatalogConfig {
	t.Helper()
	var m map[string]any
	if s, ok := entry.(string); ok {
		m = map[string]any{"catalog": s}
	} else {
		m, _ = entry.(map[string]any)
	}
	relPath, _ := m["catalog"].(string)
	absPath := filepath.Join(confRoot, filepath.FromSlash(relPath))
	docAny, ko := loadJSONFileWithOrder(t, absPath)
	docMap, _ := docAny.(map[string]any)
	pv := ""
	if _, hasPV := docMap["protocolVersion"]; !hasPV {
		pv = "1.0"
	}
	cid := ""
	if _, hasCID := docMap["catalogId"]; !hasCID {
		cid = relPath
	}
	cat, err := (&agent.InMemoryCatalogProvider{
		Document:        docMap,
		ProtocolVersion: core.ProtocolVersion(pv),
		CatalogID:       cid,
		KeyOrder:        ko,
	}).Load()
	if err != nil {
		t.Fatalf("failed loading catalog %s: %v", relPath, err)
	}
	var tfs []agent.CatalogTransformer
	if rawTfs, ok := m["transformers"].([]any); ok {
		for _, spec := range rawTfs {
			if sm, ok2 := spec.(map[string]any); ok2 {
				tfs = append(tfs, buildTransformer(t, sm))
			}
		}
	}
	cfg, err := agent.NewCatalogConfig(cat, tfs...)
	if err != nil {
		t.Fatalf("NewCatalogConfig failed: %v", err)
	}
	return cfg
}

func runCatalogTransformerCase(t *testing.T, confRoot string, tc loadedYAMLCase) {
	t.Helper()
	assertKnownKeys(t, tc.Data, unionSet(caseMetadataKeys, "args", "expect", "expect_error"), "transform_catalog case")
	cfg := buildCatalogSuiteConfig(t, confRoot, tc.Data["args"])
	expMap, _ := tc.Data["expect"].(map[string]any)
	checkExpectedCatalog(t, cfg.TransformedCatalog(), expMap)
}

func runCatalogResolutionCase(t *testing.T, confRoot string, tc loadedYAMLCase) {
	t.Helper()
	assertKnownKeys(t, tc.Data, unionSet(caseMetadataKeys, "args", "expect", "expect_error"), "resolve_catalogs case")
	args, _ := tc.Data["args"].(map[string]any)
	rawCats, _ := args["catalogs"].([]any)
	configs := make([]*agent.CatalogConfig, len(rawCats))
	for i, entry := range rawCats {
		configs[i] = buildCatalogSuiteConfig(t, confRoot, entry)
	}
	acceptsInline, _ := args["accepts_inline_catalogs"].(bool)
	rawCaps := args["renderer_capabilities"]
	var parsedCaps core.RendererCapabilities
	var err error
	if rawCaps != nil {
		if cm, ok := rawCaps.(map[string]any); ok {
			parsedCaps, err = agent.ParseRendererCapabilities(cm)
		} else {
			err = core.NewValidationErrorf("renderer capabilities must be a mapping, got %T", rawCaps)
		}
	}
	var resolved []*core.Catalog
	if err == nil {
		resolved, err = agent.ResolveCatalogs(configs, parsedCaps, acceptsInline)
	}
	if expErr, hasErr := tc.Data["expect_error"]; hasErr {
		assertExpectedError(t, err, expErr, tc.Name)
		return
	}
	if err != nil {
		t.Fatalf("ResolveCatalogs failed: %v", err)
	}
	expMap, _ := tc.Data["expect"].(map[string]any)
	assertKnownKeys(t, expMap, makeSet("active_catalog_ids", "catalogs"), "resolve_catalogs expect")
	gotIDs := make([]string, len(resolved))
	byID := make(map[string]*core.Catalog, len(resolved))
	for i, c := range resolved {
		gotIDs[i] = c.CatalogID()
		byID[c.CatalogID()] = c
	}
	wantIDs := toStringSlice(expMap["active_catalog_ids"])
	gotSorted := append([]string(nil), gotIDs...)
	wantSorted := append([]string(nil), wantIDs...)
	sort.Strings(gotSorted)
	sort.Strings(wantSorted)
	if !reflect.DeepEqual(gotSorted, wantSorted) {
		t.Fatalf("expected active_catalog_ids %v, got %v", wantIDs, gotIDs)
	}
	if expCats, ok := expMap["catalogs"].([]any); ok {
		for _, ec := range expCats {
			ecMap, _ := ec.(map[string]any)
			cid, _ := ecMap["catalog_id"].(string)
			cat, exists := byID[cid]
			if !exists {
				t.Fatalf("missing resolved catalog %q", cid)
			}
			checkExpectedCatalog(t, cat, ecMap)
		}
	}
}

func runRendererCapabilitiesCase(t *testing.T, tc loadedYAMLCase) {
	t.Helper()
	assertKnownKeys(t, tc.Data, unionSet(caseMetadataKeys, "args", "expect", "expect_error"), "read_renderer_capabilities case")
	args, _ := tc.Data["args"].(map[string]any)
	assertKnownKeys(t, args, makeSet("metadata", "version"), "read_renderer_capabilities args")
	var metadata map[string]any
	if rawMeta, hasMeta := args["metadata"]; hasMeta && rawMeta != nil {
		var isMap bool
		metadata, isMap = rawMeta.(map[string]any)
		if !isMap {
			// Pass non-map metadata check if any.
			metadata = nil
		}
	}
	version, _ := args["version"].(string)

	got, err := agent.ReadRendererCapabilities(metadata, core.ProtocolVersion(version))
	if expErr, hasErr := tc.Data["expect_error"]; hasErr {
		assertExpectedError(t, err, expErr, tc.Name)
		return
	}
	if err != nil {
		t.Fatalf("ReadRendererCapabilities failed: %v", err)
	}
	expected := tc.Data["expect"]
	if expected == nil {
		if got != nil {
			t.Fatalf("expected nil capabilities, got %#v", got)
		}
		return
	}
	assertJSONEqual(t, got, expected, tc.Name)
}

// --- Format, Prompt Generator, Multi-Catalog, and RequestProcessor ---

var (
	compileCaseKeys          = unionSet(caseMetadataKeys, "args", "input", "expect", "expect_error", "expect_present")
	decompileCaseKeys        = unionSet(caseMetadataKeys, "args", "messages", "expect_contains", "expect_absent", "expect_error", "expect_recompiled", "expect_round_trip")
	unwrapCaseKeys           = unionSet(caseMetadataKeys, "args", "input", "expect")
	hasFormatContentCaseKeys = unionSet(caseMetadataKeys, "args", "input", "expect")
	wrapCaseKeys             = unionSet(caseMetadataKeys, "args", "parts", "expect_output", "expect_contains", "expect_round_trip")
	parseResponseCaseKeys    = unionSet(caseMetadataKeys, "args", "input", "expect", "expect_error")
	promptSnippetCaseKeys    = unionSet(caseMetadataKeys, "args", "expect_file", "expect_callable_functions", "expect_contains", "expect_absent", "expect_deterministic", "expect_error")
	createFormatCaseKeys     = unionSet(caseMetadataKeys, "args", "expect", "expect_error")
	createProcessorCaseKeys  = unionSet(caseMetadataKeys, "args", "expect", "expect_error", "then_parse", "then_stream")
)

func unsupportedFormatReason(args map[string]any) string {
	fmtName, _ := args["format"].(string)
	if fmtName != "" && fmtName != "direct_json" && fmtName != "express" {
		return experimentalSkipMsg
	}
	override, _ := args["format_override"].(string)
	if override != "" && override != "direct_json" && override != "express" {
		return experimentalSkipMsg
	}
	return ""
}

func loadCatalogsFromArgs(t *testing.T, confRoot string, args map[string]any, keyOrder map[string][]string, withDefault bool) ([]*core.Catalog, error) {
	t.Helper()
	if rawList, hasList := args["catalogs"].([]any); hasList {
		out := make([]*core.Catalog, 0, len(rawList))
		for i, item := range rawList {
			cfg, err := buildCatalogConfigFromEntry(t, confRoot, item, subKeyOrder(keyOrder, fmt.Sprintf("/args/catalogs/%d", i)))
			if err != nil {
				return nil, err
			}
			out = append(out, cfg.TransformedCatalog())
		}
		return out, nil
	}
	if rawCat, hasCat := args["catalog"]; hasCat {
		cfg, err := buildCatalogConfigFromEntry(t, confRoot, rawCat, subKeyOrder(keyOrder, "/args/catalog"))
		if err != nil {
			return nil, err
		}
		return []*core.Catalog{cfg.TransformedCatalog()}, nil
	}
	if withDefault {
		cfg, err := buildCatalogConfigFromEntry(t, confRoot, defaultTestCatalog, nil)
		if err != nil {
			return nil, err
		}
		return []*core.Catalog{cfg.TransformedCatalog()}, nil
	}
	return nil, nil
}

func stageExamplesFromArgs(t *testing.T, confRoot string, args map[string]any) [][]core.AgentToRendererMessage {
	t.Helper()
	exList, ok := args["examples"].([]any)
	if !ok || len(exList) == 0 {
		return nil
	}
	var out [][]core.AgentToRendererMessage
	for _, item := range exList {
		rel, _ := item.(string)
		full := filepath.Join(confRoot, filepath.FromSlash(rel))
		rawBytes, err := os.ReadFile(full)
		if err != nil {
			t.Fatalf("failed reading example %s: %v", rel, err)
		}
		parsed, err := core.ParseJSON(rawBytes)
		if err != nil {
			t.Fatalf("failed parsing example %s: %v", rel, err)
		}
		out = append(out, toMessageSlice(t, parsed))
	}
	return out
}

func toMessageSlice(t *testing.T, raw any) []core.AgentToRendererMessage {
	t.Helper()
	var items []any
	if arr, ok := raw.([]any); ok {
		items = arr
	} else if raw != nil {
		items = []any{raw}
	}
	out := make([]core.AgentToRendererMessage, len(items))
	for i, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("expected map message at index %d, got %T", i, item)
		}
		cloned, _ := core.CloneJSONValue(m).(map[string]any)
		out[i] = core.AgentToRendererMessage(cloned)
	}
	return out
}

func buildFormatForCase(
	t *testing.T,
	formatName string,
	catalogs []*core.Catalog,
	examples [][]core.AgentToRendererMessage,
	args map[string]any,
	bufferIncomplete bool,
) (agent.InferenceFormat, error) {
	t.Helper()
	if len(catalogs) == 0 {
		return nil, core.NewCatalogError("At least one active catalog is required.")
	}
	var allowedMsgs []string
	var hasAllowed bool
	if rawAllowed, ok := args["allowed_messages"]; ok && rawAllowed != nil {
		allowedMsgs = toStringSlice(rawAllowed)
		hasAllowed = true
	}
	var progKeys []string
	var hasProg bool
	if rawProg, ok := args["progressive_keys"]; ok && rawProg != nil {
		progKeys = toStringSlice(rawProg)
		hasProg = true
	}

	switch formatName {
	case "direct_json":
		opts := &agent.DirectJSONFormatOptions{
			BufferIncompleteComponents: bufferIncomplete,
		}
		if hasAllowed {
			opts.AllowedMessages = allowedMsgs
		}
		if hasProg {
			if len(progKeys) == 0 {
				opts.DisableProgressiveHealing = true
			} else {
				opts.ProgressiveKeys = progKeys
			}
		}
		return agent.NewDirectJSONFormat(catalogs, examples, opts)
	case "express":
		opts := &agent.ExpressFormatOptions{
			SurfaceID: conformanceSurfaceID,
			Version:   catalogs[0].ProtocolVersion(),
		}
		if hasAllowed {
			opts.AllowedMessages = allowedMsgs
		}
		if hasProg {
			if len(progKeys) == 0 {
				opts.DisableProgressiveHealing = true
			} else {
				opts.ProgressiveKeys = progKeys
			}
		}
		return agent.NewExpressFormat(catalogs, examples, opts)
	default:
		return nil, fmt.Errorf("unsupported format %q", formatName)
	}
}

func buildFactoryForCase(formatName string, args map[string]any) agent.InferenceFormatFactory {
	var allowedMsgs []string
	var hasAllowed bool
	if rawAllowed, ok := args["allowed_messages"]; ok && rawAllowed != nil {
		allowedMsgs = toStringSlice(rawAllowed)
		hasAllowed = true
	}
	var progKeys []string
	var hasProg bool
	if rawProg, ok := args["progressive_keys"]; ok && rawProg != nil {
		progKeys = toStringSlice(rawProg)
		hasProg = true
	}

	switch formatName {
	case "direct_json":
		opts := &agent.DirectJSONFormatOptions{}
		if hasAllowed {
			opts.AllowedMessages = allowedMsgs
		}
		if hasProg {
			if len(progKeys) == 0 {
				opts.DisableProgressiveHealing = true
			} else {
				opts.ProgressiveKeys = progKeys
			}
		}
		return agent.NewDirectJSONFormatFactory(opts)
	case "express":
		opts := &agent.ExpressFormatOptions{
			SurfaceID: conformanceSurfaceID,
		}
		if hasAllowed {
			opts.AllowedMessages = allowedMsgs
		}
		if hasProg {
			if len(progKeys) == 0 {
				opts.DisableProgressiveHealing = true
			} else {
				opts.ProgressiveKeys = progKeys
			}
		}
		return agent.NewExpressFormatFactory(opts)
	default:
		panic(fmt.Sprintf("unsupported format factory %q", formatName))
	}
}

func sortComponentsByID(raw any) any {
	arr, ok := raw.([]any)
	if !ok {
		return raw
	}
	out := make([]any, len(arr))
	for i, item := range arr {
		m, isMap := item.(map[string]any)
		if !isMap {
			out[i] = item
			continue
		}
		cloned, _ := core.CloneJSONValue(m).(map[string]any)
		for _, key := range []string{"createSurface", "updateComponents"} {
			body, ok2 := cloned[key].(map[string]any)
			if !ok2 {
				continue
			}
			comps, ok3 := body["components"].([]any)
			if !ok3 {
				continue
			}
			sorted := append([]any(nil), comps...)
			sort.Slice(sorted, func(a, b int) bool {
				am, _ := sorted[a].(map[string]any)
				bm, _ := sorted[b].(map[string]any)
				aid, _ := am["id"].(string)
				bid, _ := bm["id"].(string)
				return aid < bid
			})
			body["components"] = sorted
		}
		out[i] = cloned
	}
	return out
}

func resolveSimplePointer(doc any, pointer string) any {
	cur := doc
	for _, tok := range strings.Split(strings.Trim(pointer, "/"), "/") {
		if tok == "" {
			continue
		}
		switch c := cur.(type) {
		case []any:
			idx, err := strconv.Atoi(tok)
			if err != nil || idx < 0 || idx >= len(c) {
				return nil
			}
			cur = c[idx]
		case map[string]any:
			cur = c[tok]
		default:
			return nil
		}
	}
	return cur
}

func deleteSimplePointer(doc any, pointer string) {
	tokens := strings.Split(strings.Trim(pointer, "/"), "/")
	if len(tokens) == 0 || tokens[0] == "" {
		return
	}
	cur := doc
	for _, tok := range tokens[:len(tokens)-1] {
		switch c := cur.(type) {
		case []any:
			idx, _ := strconv.Atoi(tok)
			cur = c[idx]
		case map[string]any:
			cur = c[tok]
		default:
			return
		}
	}
	last := tokens[len(tokens)-1]
	if m, ok := cur.(map[string]any); ok {
		delete(m, last)
	}
}

func runFormatOrProcessorCase(t *testing.T, confRoot string, tc loadedYAMLCase) string {
	t.Helper()
	args, _ := tc.Data["args"].(map[string]any)
	if reason := unsupportedFormatReason(args); reason != "" {
		return reason
	}

	isMultiCatalogSuite := tc.Suite == "agent/multi_catalog_formats.yaml"
	fmtName, _ := args["format"].(string)
	if fmtName == "" {
		fmtName = "express"
	}

	switch tc.Action {
	case "compile":
		assertKnownKeys(t, tc.Data, compileCaseKeys, "compile case")
		cats, err := loadCatalogsFromArgs(t, confRoot, args, tc.KeyOrder, true)
		if err != nil {
			t.Fatalf("loadCatalogs failed: %v", err)
		}
		fmtInst, err := buildFormatForCase(t, fmtName, cats, nil, args, false)
		if err != nil {
			t.Fatalf("buildFormat failed: %v", err)
		}
		parser := fmtInst.CreateParser()
		inputStr, _ := tc.Data["input"].(string)
		compiled, err := compileChecked(parser, inputStr)
		if expErr, hasErr := tc.Data["expect_error"]; hasErr {
			assertExpectedError(t, err, expErr, tc.Name)
			return ""
		}
		if err != nil {
			t.Fatalf("compileChecked failed: %v", err)
		}
		norm := mustNormalizeJSON(t, compiled)
		if rawPres, ok := tc.Data["expect_present"].([]any); ok {
			for _, p := range toStringSlice(rawPres) {
				v := resolveSimplePointer(norm, p)
				if v == nil || v == "" {
					t.Fatalf("expected non-empty value at pointer %q, got %#v", p, v)
				}
				deleteSimplePointer(norm, p)
			}
		}
		want := mustNormalizeJSON(t, tc.Data["expect"])
		if isMultiCatalogSuite {
			norm = sortComponentsByID(norm)
			want = sortComponentsByID(want)
		}
		assertJSONEqual(t, norm, want, tc.Name)

	case "decompile":
		assertKnownKeys(t, tc.Data, decompileCaseKeys, "decompile case")
		cats, err := loadCatalogsFromArgs(t, confRoot, args, tc.KeyOrder, true)
		if err != nil {
			t.Fatalf("loadCatalogs failed: %v", err)
		}
		fmtInst, err := buildFormatForCase(t, fmtName, cats, nil, args, false)
		if err != nil {
			t.Fatalf("buildFormat failed: %v", err)
		}
		parser := fmtInst.CreateParser()
		msgs := toMessageSlice(t, tc.Data["messages"])
		notation, err := parser.Decompile(msgs)
		if expErr, hasErr := tc.Data["expect_error"]; hasErr {
			assertExpectedError(t, err, expErr, tc.Name)
			return ""
		}
		if err != nil {
			t.Fatalf("Decompile failed: %v", err)
		}
		assertSnippetFragments(t, notation, tc.Data["expect_contains"], tc.Data["expect_absent"])
		if roundTrip, _ := tc.Data["expect_round_trip"].(bool); roundTrip {
			recompiled, err := compileChecked(parser, notation)
			if err != nil {
				t.Fatalf("round-trip compileChecked failed: %v\nnotation:\n%s", err, notation)
			}
			got := mustNormalizeJSON(t, recompiled)
			want := mustNormalizeJSON(t, tc.Data["messages"])
			if isMultiCatalogSuite {
				got = sortComponentsByID(got)
				want = sortComponentsByID(want)
			}
			assertJSONEqual(t, got, want, tc.Name+" round-trip")
		}
		if expRecompiled, hasExpRecompiled := tc.Data["expect_recompiled"]; hasExpRecompiled {
			var recompiled []core.AgentToRendererMessage
			if isMultiCatalogSuite {
				recompiled, err = parser.Compile(notation, true)
			} else {
				recompiled, err = compileChecked(parser, notation)
			}
			if err != nil {
				t.Fatalf("recompile failed: %v", err)
			}
			got := mustNormalizeJSON(t, recompiled)
			want := mustNormalizeJSON(t, expRecompiled)
			if isMultiCatalogSuite {
				got = sortComponentsByID(got)
				want = sortComponentsByID(want)
			}
			assertJSONEqual(t, got, want, tc.Name+" expect_recompiled")
		}

	case "unwrap":
		assertKnownKeys(t, tc.Data, unwrapCaseKeys, "unwrap case")
		cats, err := loadCatalogsFromArgs(t, confRoot, args, tc.KeyOrder, true)
		if err != nil {
			t.Fatalf("loadCatalogs failed: %v", err)
		}
		fmtInst, err := buildFormatForCase(t, fmtName, cats, nil, args, false)
		if err != nil {
			t.Fatalf("buildFormat failed: %v", err)
		}
		parser := fmtInst.CreateParser()
		inputStr, _ := tc.Data["input"].(string)
		rawParts := parser.Unwrap(inputStr)
		expSlice, _ := tc.Data["expect"].([]any)
		assertRawPartsMatch(t, rawParts, expSlice)
		hasAny := false
		hasComplete := false
		for _, ep := range expSlice {
			em, _ := ep.(map[string]any)
			if _, hasRaw := em["a2ui_raw"]; hasRaw {
				hasAny = true
				isFinal := true
				if f, ok := em["is_final"].(bool); ok {
					isFinal = f
				}
				if isFinal {
					hasComplete = true
				}
			}
		}
		if parser.HasFormatContent(inputStr, false) != hasAny {
			t.Fatalf("HasFormatContent(false) = %v, want %v", !hasAny, hasAny)
		}
		if parser.HasFormatContent(inputStr, true) != hasComplete {
			t.Fatalf("HasFormatContent(true) = %v, want %v", !hasComplete, hasComplete)
		}

	case "has_format_content":
		assertKnownKeys(t, tc.Data, hasFormatContentCaseKeys, "has_format_content case")
		cats, err := loadCatalogsFromArgs(t, confRoot, args, tc.KeyOrder, true)
		if err != nil {
			t.Fatalf("loadCatalogs failed: %v", err)
		}
		fmtInst, err := buildFormatForCase(t, fmtName, cats, nil, args, false)
		if err != nil {
			t.Fatalf("buildFormat failed: %v", err)
		}
		parser := fmtInst.CreateParser()
		inputStr, _ := tc.Data["input"].(string)
		complete, _ := args["complete"].(bool)
		want, _ := tc.Data["expect"].(bool)
		if got := parser.HasFormatContent(inputStr, complete); got != want {
			t.Fatalf("HasFormatContent(%q, %v) = %v, want %v", inputStr, complete, got, want)
		}

	case "wrap":
		assertKnownKeys(t, tc.Data, wrapCaseKeys, "wrap case")
		cats, err := loadCatalogsFromArgs(t, confRoot, args, tc.KeyOrder, true)
		if err != nil {
			t.Fatalf("loadCatalogs failed: %v", err)
		}
		fmtInst, err := buildFormatForCase(t, fmtName, cats, nil, args, false)
		if err != nil {
			t.Fatalf("buildFormat failed: %v", err)
		}
		parser := fmtInst.CreateParser()
		partsSlice, _ := tc.Data["parts"].([]any)
		rawParts := make([]agent.RawResponsePart, len(partsSlice))
		for i, p := range partsSlice {
			pm, _ := p.(map[string]any)
			isFinal := true
			if f, ok := pm["is_final"].(bool); ok {
				isFinal = f
			}
			if txt, hasTxt := pm["text"].(string); hasTxt {
				rp := agent.NewRawTextPart(txt)
				rp.IsFinal = isFinal
				rawParts[i] = rp
			} else {
				raw, _ := pm["a2ui_raw"].(string)
				rawParts[i] = agent.NewRawA2UIPart(raw, isFinal)
			}
		}
		output := parser.Wrap(rawParts)
		if expOut, hasOut := tc.Data["expect_output"].(string); hasOut {
			if output != expOut {
				t.Fatalf("Wrap output mismatch:\ngot:\n%s\nwant:\n%s", output, expOut)
			}
		}
		assertSnippetFragments(t, output, tc.Data["expect_contains"], nil)
		if rt, _ := tc.Data["expect_round_trip"].(bool); rt {
			assertRawPartsMatch(t, parser.Unwrap(output), partsSlice)
		}

	case "parse_response":
		assertKnownKeys(t, tc.Data, parseResponseCaseKeys, "parse_response case")
		cats, err := loadCatalogsFromArgs(t, confRoot, args, tc.KeyOrder, true)
		if err != nil {
			t.Fatalf("loadCatalogs failed: %v", err)
		}
		fmtInst, err := buildFormatForCase(t, fmtName, cats, nil, args, false)
		if err != nil {
			t.Fatalf("buildFormat failed: %v", err)
		}
		parser := fmtInst.CreateParser()
		wrapped := true
		if w, ok := args["wrapped"].(bool); ok {
			wrapped = w
		}
		inputStr, _ := tc.Data["input"].(string)
		parts, err := parser.ParseResponse(inputStr, &agent.ParseOptions{Unwrapped: !wrapped})
		if expErr, hasErr := tc.Data["expect_error"]; hasErr {
			assertExpectedError(t, err, expErr, tc.Name)
			return ""
		}
		if err != nil {
			t.Fatalf("ParseResponse failed: %v", err)
		}
		got := make([]any, len(parts))
		for i, p := range parts {
			d := responsePartToDict(p)
			if isMultiCatalogSuite {
				if a2uiVal, hasA2UI := d["a2ui"]; hasA2UI {
					d["a2ui"] = sortComponentsByID(a2uiVal)
				}
			}
			got[i] = d
		}
		want := mustNormalizeJSON(t, tc.Data["expect"])
		if isMultiCatalogSuite {
			if wantArr, ok := want.([]any); ok {
				for i, item := range wantArr {
					if im, ok2 := item.(map[string]any); ok2 {
						if a2uiVal, hasA2UI := im["a2ui"]; hasA2UI {
							im["a2ui"] = sortComponentsByID(a2uiVal)
						}
						wantArr[i] = im
					}
				}
			}
		}
		assertJSONEqual(t, got, want, tc.Name)

	case "generate_prompt_snippet":
		assertKnownKeys(t, tc.Data, promptSnippetCaseKeys, "generate_prompt_snippet case")
		makeAndGenerate := func() (agent.InferenceFormat, string, error) {
			cats, err := loadCatalogsFromArgs(t, confRoot, args, tc.KeyOrder, false)
			if err != nil {
				return nil, "", err
			}
			examples := stageExamplesFromArgs(t, confRoot, args)
			fmtInst, err := buildFormatForCase(t, fmtName, cats, examples, args, false)
			if err != nil {
				return nil, "", err
			}
			s, err := fmtInst.PromptGenerator().Generate()
			return fmtInst, s, err
		}
		fmtInst, snippet, err := makeAndGenerate()
		if expErr, hasErr := tc.Data["expect_error"]; hasErr {
			assertExpectedError(t, err, expErr, tc.Name)
			return ""
		}
		if err != nil {
			t.Fatalf("PromptGenerator.Generate failed: %v", err)
		}
		if expFile, hasFile := tc.Data["expect_file"].(string); hasFile {
			goldenBytes, readErr := os.ReadFile(filepath.Join(confRoot, filepath.FromSlash(expFile)))
			if readErr != nil {
				t.Fatalf("failed reading golden prompt %s: %v", expFile, readErr)
			}
			if snippet != string(goldenBytes) {
				t.Fatalf("golden prompt mismatch against %s:\ngot (%d bytes):\n%s\nwant (%d bytes):\n%s",
					expFile, len(snippet), snippet, len(goldenBytes), string(goldenBytes))
			}
		}
		assertSnippetFragments(t, snippet, tc.Data["expect_contains"], tc.Data["expect_absent"])
		if rawCallable, hasCallable := tc.Data["expect_callable_functions"]; hasCallable {
			cats, _ := loadCatalogsFromArgs(t, confRoot, args, tc.KeyOrder, false)
			gotCallable := agent.AgentCallableFunctions(cats)
			if gotCallable == nil {
				gotCallable = []string{}
			}
			assertJSONEqual(t, gotCallable, rawCallable, tc.Name+" callable_functions")
		}
		if det, _ := tc.Data["expect_deterministic"].(bool); det {
			again, gErr := fmtInst.PromptGenerator().Generate()
			if gErr != nil || again != snippet {
				t.Fatalf("PromptGenerator is non-deterministic (err=%v)", gErr)
			}
		}

	case "create_format":
		assertKnownKeys(t, tc.Data, createFormatCaseKeys, "create_format case")
		cats, err := loadCatalogsFromArgs(t, confRoot, args, tc.KeyOrder, false)
		var fmtInst agent.InferenceFormat
		if err == nil {
			examples := stageExamplesFromArgs(t, confRoot, args)
			fmtInst, err = buildFormatForCase(t, fmtName, cats, examples, args, false)
		}
		if expErr, hasErr := tc.Data["expect_error"]; hasErr {
			assertExpectedError(t, err, expErr, tc.Name)
			return ""
		}
		if err != nil {
			t.Fatalf("create_format failed: %v", err)
		}
		expMap, _ := tc.Data["expect"].(map[string]any)
		assertKnownKeys(t, expMap, makeSet("parsers_are_distinct", "parser_state_isolated", "prompt_snippet_contains", "prompt_snippet_absent"), "create_format expect")
		if distinct, _ := expMap["parsers_are_distinct"].(bool); distinct {
			p1 := fmtInst.CreateParser()
			p2 := fmtInst.CreateParser()
			if reflect.ValueOf(p1).Pointer() == reflect.ValueOf(p2).Pointer() {
				t.Fatalf("expected distinct Parser instances on each CreateParser call")
			}
		}
		if isolated, _ := expMap["parser_state_isolated"].(bool); isolated {
			chunks := toStringSlice(args["probe_chunks"])
			readChunks := func(p agent.Parser) []any {
				s, err := p.OpenStream(nil)
				if err != nil {
					t.Fatalf("OpenStream failed: %v", err)
				}
				out := make([]any, len(chunks))
				for i, ch := range chunks {
					sp, err := s.Feed(ch)
					if err != nil {
						t.Fatalf("Feed failed: %v", err)
					}
					step := make([]any, len(sp))
					for j, part := range sp {
						step[j] = streamPartToDict(part)
					}
					out[i] = step
				}
				return out
			}
			first := readChunks(fmtInst.CreateParser())
			second := readChunks(fmtInst.CreateParser())
			assertJSONEqual(t, second, first, tc.Name+" parser_state_isolated")
		}
		snippet, gErr := fmtInst.PromptGenerator().Generate()
		if gErr != nil {
			t.Fatalf("PromptGenerator.Generate failed: %v", gErr)
		}
		assertSnippetFragments(t, snippet, expMap["prompt_snippet_contains"], expMap["prompt_snippet_absent"])

	case "create_processor":
		runCreateProcessorCase(t, confRoot, tc)

	default:
		t.Fatalf("unsupported action %q in %s", tc.Action, tc.Suite)
	}
	return ""
}

func runCreateProcessorCase(t *testing.T, confRoot string, tc loadedYAMLCase) {
	t.Helper()
	assertKnownKeys(t, tc.Data, createProcessorCaseKeys, "create_processor case")
	args, _ := tc.Data["args"].(map[string]any)
	rawCats, _ := args["catalogs"].([]any)
	configs := make([]*agent.CatalogConfig, len(rawCats))
	for i, entry := range rawCats {
		cfg, err := buildCatalogConfigFromEntry(t, confRoot, entry, subKeyOrder(tc.KeyOrder, fmt.Sprintf("/args/catalogs/%d", i)))
		if err != nil {
			t.Fatalf("buildCatalogConfigFromEntry failed: %v", err)
		}
		configs[i] = cfg
	}

	describeConfigs := func(cfgs []*agent.CatalogConfig) string {
		var sb strings.Builder
		for _, c := range cfgs {
			cat := c.TransformedCatalog()
			sb.WriteString(cat.CatalogID())
			sb.WriteString(fmt.Sprintf("%v%v;", sortedMapKeys(cat.Components()), sortedMapKeys(cat.Functions())))
		}
		return sb.String()
	}
	before := describeConfigs(configs)

	examples := stageExamplesFromArgs(t, confRoot, args)
	var baseFactory agent.InferenceFormatFactory
	if fmtName, ok := args["format"].(string); ok && fmtName != "" {
		baseFactory = buildFactoryForCase(fmtName, args)
	}
	var overrideFactory agent.InferenceFormatFactory
	if overName, ok := args["format_override"].(string); ok && overName != "" {
		overrideFactory = buildFactoryForCase(overName, args)
	}
	acceptsInline, _ := args["accepts_inline_catalogs"].(bool)

	gen := agent.NewGenerator(configs, &agent.GeneratorOptions{
		Examples:               examples,
		InferenceFormatFactory: baseFactory,
		AcceptsInlineCatalogs:  acceptsInline,
	})

	create := func() (*agent.RequestProcessor, string, error) {
		rawCaps := args["renderer_capabilities"]
		var parsedCaps core.RendererCapabilities
		if rawCaps != nil {
			cm, ok := rawCaps.(map[string]any)
			if !ok {
				return nil, "", core.NewValidationErrorf("renderer capabilities must be a mapping, got %T", rawCaps)
			}
			var parseErr error
			parsedCaps, parseErr = agent.ParseRendererCapabilities(cm)
			if parseErr != nil {
				return nil, "", parseErr
			}
		}
		proc, err := gen.CreateProcessor(parsedCaps, &agent.CreateProcessorOptions{
			InferenceFormatFactory: overrideFactory,
		})
		if err != nil {
			return nil, "", err
		}
		snippet, err := proc.PromptSnippet()
		if err != nil {
			return nil, "", err
		}
		return proc, snippet, nil
	}

	proc, snippet, err := create()
	if expErr, hasErr := tc.Data["expect_error"]; hasErr {
		assertExpectedError(t, err, expErr, tc.Name)
		return
	}
	if err != nil {
		t.Fatalf("CreateProcessor failed: %v", err)
	}

	expMap, _ := tc.Data["expect"].(map[string]any)
	assertKnownKeys(t, expMap, makeSet(
		"active_catalog_ids",
		"catalogs",
		"generator_catalogs_unchanged",
		"prompt_snippet_contains",
		"prompt_snippet_absent",
	), "create_processor expect")

	active := proc.ActiveCatalogs()
	if rawActiveIDs, hasIDs := expMap["active_catalog_ids"]; hasIDs {
		gotIDs := make([]string, len(active))
		for i, c := range active {
			gotIDs[i] = c.CatalogID()
		}
		wantIDs := toStringSlice(rawActiveIDs)
		if !reflect.DeepEqual(gotIDs, wantIDs) {
			t.Fatalf("active_catalog_ids = %v, want %v", gotIDs, wantIDs)
		}
	}
	if rawExpCats, ok := expMap["catalogs"].([]any); ok {
		for i, ec := range rawExpCats {
			if i >= len(active) {
				t.Fatalf("expected at least %d active catalogs, got %d", len(rawExpCats), len(active))
			}
			ecMap, _ := ec.(map[string]any)
			checkExpectedCatalog(t, active[i], ecMap)
		}
	}
	assertSnippetFragments(t, snippet, expMap["prompt_snippet_contains"], expMap["prompt_snippet_absent"])
	if unchanged, _ := expMap["generator_catalogs_unchanged"].(bool); unchanged {
		if describeConfigs(gen.Catalogs()) != before {
			t.Fatalf("generator catalogs mutated during CreateProcessor")
		}
	}

	if thenParse, ok := tc.Data["then_parse"].(map[string]any); ok {
		assertKnownKeys(t, thenParse, makeSet("input", "expect", "expect_error"), "then_parse")
		inStr, _ := thenParse["input"].(string)
		parts, parseErr := proc.ParseResponse(inStr, nil)
		if expErr, hasErr := thenParse["expect_error"]; hasErr {
			assertExpectedError(t, parseErr, expErr, tc.Name+".then_parse")
		} else {
			if parseErr != nil {
				t.Fatalf("then_parse failed: %v", parseErr)
			}
			got := make([]any, len(parts))
			for i, p := range parts {
				got[i] = responsePartToDict(p)
			}
			assertJSONEqual(t, got, thenParse["expect"], tc.Name+".then_parse")
		}
	}

	if thenStream, ok := tc.Data["then_stream"].(map[string]any); ok {
		assertKnownKeys(t, thenStream, makeSet("steps", "expect_close", "expect_error"), "then_stream")
		stream, err := proc.OpenStream(nil)
		if err != nil {
			t.Fatalf("then_stream OpenStream failed: %v", err)
		}
		steps, _ := thenStream["steps"].([]any)
		for idx, rawStep := range steps {
			stepMap, _ := rawStep.(map[string]any)
			assertKnownKeys(t, stepMap, makeSet("input", "expect", "expect_error"), "then_stream step")
			chunk, _ := stepMap["input"].(string)
			sp, feedErr := stream.Feed(chunk)
			if expErr, hasErr := stepMap["expect_error"]; hasErr {
				assertExpectedError(t, feedErr, expErr, fmt.Sprintf("%s.then_stream[%d]", tc.Name, idx))
				return
			}
			if feedErr != nil {
				t.Fatalf("then_stream[%d] Feed failed: %v", idx, feedErr)
			}
			got := make([]any, len(sp))
			for i, p := range sp {
				got[i] = streamPartToDict(p)
			}
			assertJSONEqual(t, got, stepMap["expect"], fmt.Sprintf("%s.then_stream[%d]", tc.Name, idx))
		}
		closedParts, closeErr := stream.Close()
		if expErr, hasErr := thenStream["expect_error"]; hasErr {
			assertExpectedError(t, closeErr, expErr, tc.Name+".then_stream.close")
			return
		}
		if closeErr != nil {
			t.Fatalf("then_stream Close failed: %v", closeErr)
		}
		if expClose, hasClose := thenStream["expect_close"]; hasClose {
			got := make([]any, len(closedParts))
			for i, p := range closedParts {
				got[i] = streamPartToDict(p)
			}
			assertJSONEqual(t, got, expClose, tc.Name+".then_stream.close")
		}
	}
}

func assertSnippetFragments(t *testing.T, snippet string, rawContains, rawAbsent any) {
	t.Helper()
	for _, frag := range toStringSlice(rawContains) {
		if !strings.Contains(snippet, frag) {
			t.Fatalf("expected snippet to contain %q, got:\n%s", frag, snippet)
		}
	}
	for _, frag := range toStringSlice(rawAbsent) {
		if strings.Contains(snippet, frag) {
			t.Fatalf("expected snippet NOT to contain %q, got:\n%s", frag, snippet)
		}
	}
}

func assertRawPartsMatch(t *testing.T, actual []agent.RawResponsePart, expected []any) {
	t.Helper()
	got := make([]any, len(actual))
	for i, p := range actual {
		if p.IsText() {
			got[i] = map[string]any{"text": p.Text}
		} else {
			m := map[string]any{"a2ui_raw": p.A2UIRaw}
			if !p.IsFinal {
				m["is_final"] = false
			}
			got[i] = m
		}
	}
	want := make([]any, len(expected))
	for i, ep := range expected {
		em, _ := ep.(map[string]any)
		cleaned := make(map[string]any, len(em))
		for k, v := range em {
			if k == "is_final" && v == true {
				continue
			}
			cleaned[k] = v
		}
		want[i] = cleaned
	}
	assertJSONEqual(t, got, want, "raw parts")
}
