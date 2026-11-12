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
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

const (
	conformanceSurfaceID = "default_surface"
	defaultTestCatalog   = "test_data/catalogs/simplified_catalog_v1_0.json"
	scalingSkipReason    = "timing suite, run when A2UI_RUN_TIMING=1"
	experimentalSkipMsg  = "Elemental and Atom are experimental and Python-only"
)

type manifestRecord struct {
	Harness string `json:"harness"`
	Suite   string `json:"suite"`
	Case    string `json:"case"`
	Status  string `json:"status"`
	Reason  string `json:"reason,omitempty"`
}

type loadedYAMLCase struct {
	Suite    string
	Name     string
	Action   string
	Data     map[string]any
	KeyOrder map[string][]string
}

func findRepoAndConformanceRoot(t *testing.T) (string, string) {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	dir := filepath.Dir(filename)
	for {
		schemaPath := filepath.Join(dir, "conformance", "conformance_schema.json")
		if _, err := os.Stat(schemaPath); err == nil {
			return dir, filepath.Join(dir, "conformance")
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not locate conformance/conformance_schema.json above test directory")
		}
		dir = parent
	}
}

func writeManifestRecords(t *testing.T, fileName string, records []manifestRecord) {
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
	enc.SetEscapeHTML(false)
	for _, rec := range records {
		rec.Reason = strings.TrimSpace(rec.Reason)
		if err := enc.Encode(rec); err != nil {
			t.Fatalf("failed encoding manifest record: %v", err)
		}
	}
}

var unpairedSurrogateEscapeRE = regexp.MustCompile(`\\u[dD][89a-fA-F][0-9a-fA-F]{2}`)

func loadYAMLCases(t *testing.T, confRoot, relSuite string) []loadedYAMLCase {
	t.Helper()
	fullPath := filepath.Join(confRoot, filepath.FromSlash(relSuite))
	rawBytes, err := os.ReadFile(fullPath)
	if err != nil {
		t.Fatalf("failed reading suite %s: %v", relSuite, err)
	}
	out, err := tryDecodeYAMLCases(t, relSuite, rawBytes)
	if err != nil {
		// Legacy suites contain literal unpaired UTF-16 surrogates (e.g. \ud83d) inside YAML strings,
		// which gopkg.in/yaml.v3 rejects; sanitize unpaired surrogates on fallback.
		sanitized := unpairedSurrogateEscapeRE.ReplaceAll(rawBytes, []byte(`\ufffd`))
		out, err = tryDecodeYAMLCases(t, relSuite, sanitized)
		if err != nil {
			t.Fatalf("failed decoding YAML suite %s: %v", relSuite, err)
		}
	}
	return out
}

func tryDecodeYAMLCases(t *testing.T, relSuite string, rawBytes []byte) ([]loadedYAMLCase, error) {
	t.Helper()
	dec := yaml.NewDecoder(bytes.NewReader(rawBytes))
	var out []loadedYAMLCase
	for {
		var doc yaml.Node
		err := dec.Decode(&doc)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		root := &doc
		if root.Kind == yaml.DocumentNode && len(root.Content) > 0 {
			root = root.Content[0]
		}
		switch root.Kind {
		case yaml.SequenceNode:
			for _, itemNode := range root.Content {
				out = append(out, decodeYAMLCaseNode(t, relSuite, itemNode))
			}
		case yaml.MappingNode:
			val, ko := yamlNodeToNormalized(t, root)
			m, ok := val.(map[string]any)
			if !ok {
				t.Fatalf("expected mapping in %s", relSuite)
			}
			if testsSlice, hasTests := m["tests"].([]any); hasTests {
				var testsSeq *yaml.Node
				for i := 0; i+1 < len(root.Content); i += 2 {
					if root.Content[i].Value == "tests" {
						testsSeq = root.Content[i+1]
						break
					}
				}
				if testsSeq != nil && testsSeq.Kind == yaml.SequenceNode {
					for _, itemNode := range testsSeq.Content {
						out = append(out, decodeYAMLCaseNode(t, relSuite, itemNode))
					}
				} else {
					for _, rawItem := range testsSlice {
						im, _ := rawItem.(map[string]any)
						name, _ := im["id"].(string)
						if name == "" {
							name, _ = im["name"].(string)
						}
						action, _ := im["action"].(string)
						out = append(out, loadedYAMLCase{
							Suite:    relSuite,
							Name:     name,
							Action:   action,
							Data:     im,
							KeyOrder: ko,
						})
					}
				}
			} else {
				out = append(out, decodeYAMLCaseNode(t, relSuite, root))
			}
		}
	}
	return out, nil
}

func decodeYAMLCaseNode(t *testing.T, relSuite string, node *yaml.Node) loadedYAMLCase {
	t.Helper()
	val, ko := yamlNodeToNormalized(t, node)
	m, ok := val.(map[string]any)
	if !ok {
		t.Fatalf("expected case mapping in %s, got %T", relSuite, val)
	}
	name, _ := m["name"].(string)
	if name == "" {
		name, _ = m["id"].(string)
	}
	action, _ := m["action"].(string)
	return loadedYAMLCase{
		Suite:    relSuite,
		Name:     name,
		Action:   action,
		Data:     m,
		KeyOrder: ko,
	}
}

// yamlNodeToNormalized decodes a YAML node into JSON-compatible values, keeping integers
// (int64) and floats (float64) apart as PyYAML does, and returns the authored key order.
func yamlNodeToNormalized(t *testing.T, node *yaml.Node) (any, map[string][]string) {
	t.Helper()
	ko := make(map[string][]string)
	extractYAMLKeyOrder(node, "", ko)
	return decodeYAMLValue(t, node), ko
}

func decodeYAMLValue(t *testing.T, node *yaml.Node) any {
	t.Helper()
	if node == nil {
		return nil
	}
	switch node.Kind {
	case yaml.DocumentNode:
		if len(node.Content) == 0 {
			return nil
		}
		return decodeYAMLValue(t, node.Content[0])
	case yaml.AliasNode:
		return decodeYAMLValue(t, node.Alias)
	case yaml.SequenceNode:
		out := make([]any, len(node.Content))
		for i, child := range node.Content {
			out[i] = decodeYAMLValue(t, child)
		}
		return out
	case yaml.MappingNode:
		out := make(map[string]any, len(node.Content)/2)
		for i := 0; i+1 < len(node.Content); i += 2 {
			out[node.Content[i].Value] = decodeYAMLValue(t, node.Content[i+1])
		}
		return out
	}
	var decoded any
	if err := node.Decode(&decoded); err != nil {
		t.Fatalf("yaml node decode error at line %d: %v", node.Line, err)
	}
	switch v := decoded.(type) {
	case int:
		return int64(v)
	case uint64:
		if v <= math.MaxInt64 {
			return int64(v)
		}
		return float64(v)
	case time.Time:
		// JSON has no timestamps; keep the authored text.
		return node.Value
	default:
		return v
	}
}

// numberValue reports a YAML or JSON number as float64.
func numberValue(v any) (float64, bool) {
	switch n := v.(type) {
	case int64:
		return float64(n), true
	case int:
		return float64(n), true
	case float64:
		return n, true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

// intValue reports a YAML or JSON number as int.
func intValue(v any) (int, bool) {
	f, ok := numberValue(v)
	return int(f), ok
}

func extractYAMLKeyOrder(node *yaml.Node, pointer string, out map[string][]string) {
	if node == nil {
		return
	}
	if node.Kind == yaml.AliasNode && node.Alias != nil {
		node = node.Alias
	}
	switch node.Kind {
	case yaml.DocumentNode:
		if len(node.Content) > 0 {
			extractYAMLKeyOrder(node.Content[0], pointer, out)
		}
	case yaml.MappingNode:
		keys := make([]string, 0, len(node.Content)/2)
		for i := 0; i+1 < len(node.Content); i += 2 {
			k := node.Content[i].Value
			keys = append(keys, k)
			escaped := strings.ReplaceAll(strings.ReplaceAll(k, "~", "~0"), "/", "~1")
			extractYAMLKeyOrder(node.Content[i+1], pointer+"/"+escaped, out)
		}
		out[pointer] = keys
	case yaml.SequenceNode:
		for idx, child := range node.Content {
			extractYAMLKeyOrder(child, pointer+"/"+strconv.Itoa(idx), out)
		}
	}
}

func subKeyOrder(full map[string][]string, prefix string) map[string][]string {
	if len(full) == 0 {
		return nil
	}
	out := make(map[string][]string)
	for k, v := range full {
		if k == prefix {
			out[""] = append([]string(nil), v...)
		} else if strings.HasPrefix(k, prefix+"/") {
			out[k[len(prefix):]] = append([]string(nil), v...)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func normalizeViaJSON(v any) (any, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	var out any
	if err := json.Unmarshal(buf.Bytes(), &out); err != nil {
		return nil, err
	}
	return out, nil
}

func mustNormalizeJSON(t *testing.T, v any) any {
	t.Helper()
	n, err := normalizeViaJSON(v)
	if err != nil {
		t.Fatalf("normalizeViaJSON failed: %v", err)
	}
	return n
}

func assertJSONEqual(t *testing.T, got, want any, label string) {
	t.Helper()
	gotNorm := mustNormalizeJSON(t, got)
	wantNorm := mustNormalizeJSON(t, want)
	if !reflect.DeepEqual(gotNorm, wantNorm) {
		gotB, _ := json.MarshalIndent(gotNorm, "", "  ")
		wantB, _ := json.MarshalIndent(wantNorm, "", "  ")
		t.Fatalf("%s mismatch:\ngot:\n%s\nwant:\n%s", label, gotB, wantB)
	}
}

func assertKnownKeys(t *testing.T, m map[string]any, allowed map[string]bool, where string) {
	t.Helper()
	if m == nil {
		return
	}
	var unknown []string
	for k := range m {
		if !allowed[k] {
			unknown = append(unknown, k)
		}
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		t.Fatalf("Unknown conformance keys at %s: %s", where, strings.Join(unknown, ", "))
	}
}

func makeSet(items ...string) map[string]bool {
	out := make(map[string]bool, len(items))
	for _, s := range items {
		out[s] = true
	}
	return out
}

func unionSet(base map[string]bool, extra ...string) map[string]bool {
	out := make(map[string]bool, len(base)+len(extra))
	for k, v := range base {
		out[k] = v
	}
	for _, s := range extra {
		out[s] = true
	}
	return out
}

var (
	caseMetadataKeys = makeSet(
		"name",
		"description",
		"features",
		"action",
		"protocolVersion",
		"catalog",
		"catalogs",
	)
	expectErrorKeys   = makeSet("category", "message", "message_is_regex", "details")
	expectDetailKeys  = makeSet("path", "code", "message")
	catalogExpectKeys = makeSet(
		"catalog_id",
		"protocol_version",
		"components",
		"functions",
		"serialized_defs_contain",
		"serialized_defs_omit",
	)
)

func errorCategoryOf(err error) string {
	if err == nil {
		return ""
	}
	switch err.(type) {
	case *agent.CompilationParseError:
		return "ParseError"
	case *agent.CompilationValidationError:
		return "ValidationError"
	}
	if ce, ok := err.(core.CategorizedError); ok {
		return string(ce.ErrorCategory())
	}
	var compParse *agent.CompilationParseError
	if errors.As(err, &compParse) {
		return "ParseError"
	}
	var compVal *agent.CompilationValidationError
	if errors.As(err, &compVal) {
		return "ValidationError"
	}
	var ce core.CategorizedError
	if errors.As(err, &ce) {
		return string(ce.ErrorCategory())
	}
	return fmt.Sprintf("%T", err)
}

func alignErrorRegex(msg string) string {
	if msg == "" {
		return ""
	}
	if strings.Contains(msg, "required property") {
		return fmt.Sprintf("(?i)(%s|missing required property|Field required)", msg)
	}
	if strings.Contains(msg, "'v0.9' was expected") {
		return fmt.Sprintf("(?i)(%s|Input should be 'v0.9'|expected const \"v0.9\")", msg)
	}
	if strings.Contains(msg, "is not of type") {
		return fmt.Sprintf("(?i)(%s|expected type|Input should be a valid)", msg)
	}
	if strings.Contains(msg, "Validation failed") {
		return fmt.Sprintf("(?i)(%s|Field required|Extra inputs are not permitted|additional property|unevaluated property|missing required)", msg)
	}
	return "(?i)" + msg
}

func assertExpectedError(t *testing.T, err error, expectErr any, where string) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: expected error %v, got nil", where, expectErr)
	}
	if msgStr, ok := expectErr.(string); ok {
		re, compErr := regexp.Compile(alignErrorRegex(msgStr))
		if compErr != nil {
			if !strings.Contains(strings.ToLower(err.Error()), strings.ToLower(msgStr)) {
				t.Fatalf("%s: expected error containing %q, got %q", where, msgStr, err.Error())
			}
			return
		}
		if !re.MatchString(err.Error()) {
			t.Fatalf("%s: expected error matching %q, got %q", where, msgStr, err.Error())
		}
		return
	}

	errMap, ok := expectErr.(map[string]any)
	if !ok {
		t.Fatalf("%s: unexpected expect_error type %T", where, expectErr)
	}
	assertKnownKeys(t, errMap, expectErrorKeys, where+".expect_error")

	if cat, hasCat := errMap["category"].(string); hasCat && cat != "" {
		gotCat := errorCategoryOf(err)
		if cat == "CompilationError" {
			var compErr *agent.CompilationError
			if !errors.As(err, &compErr) {
				t.Fatalf("%s: expected CompilationError, got (%T) %v", where, err, err)
			}
		} else if cat == "ValidationError" {
			// Note: IntegrityError and RecursionError embed ValidationError in Python/TS; check category or unwrap.
			var valErr *core.ValidationError
			var compVal *agent.CompilationValidationError
			var intErr *core.IntegrityError
			var recErr *core.RecursionError
			if !errors.As(err, &valErr) && !errors.As(err, &compVal) && !errors.As(err, &intErr) && !errors.As(err, &recErr) {
				t.Fatalf("%s: expected ValidationError, got category=%s (%T) %v", where, gotCat, err, err)
			}
		} else if gotCat != cat {
			t.Fatalf("%s: expected error category %q, got %q ((%T) %v)", where, cat, gotCat, err, err)
		}
	}

	if msg, hasMsg := errMap["message"].(string); hasMsg && msg != "" {
		isRegex, _ := errMap["message_is_regex"].(bool)
		if isRegex {
			re := regexp.MustCompile(msg)
			if !re.MatchString(err.Error()) {
				t.Fatalf("%s: expected error matching regex %q, got %q", where, msg, err.Error())
			}
		} else {
			re, compErr := regexp.Compile(alignErrorRegex(msg))
			if compErr != nil {
				if !strings.Contains(strings.ToLower(err.Error()), strings.ToLower(msg)) {
					t.Fatalf("%s: expected error containing %q, got %q", where, msg, err.Error())
				}
			} else if !re.MatchString(err.Error()) {
				if !strings.Contains(strings.ToLower(err.Error()), strings.ToLower(msg)) {
					t.Fatalf("%s: expected error matching %q, got %q", where, msg, err.Error())
				}
			}
		}
	}

	if details, hasDetails := errMap["details"].([]any); hasDetails {
		var valErr *core.ValidationError
		if !errors.As(err, &valErr) {
			t.Fatalf("%s: expected *core.ValidationError with details, got (%T) %v", where, err, err)
		}
		for _, rawExp := range details {
			expMap, _ := rawExp.(map[string]any)
			assertKnownKeys(t, expMap, expectDetailKeys, where+".expect_error.details[]")
			expPath, _ := expMap["path"].(string)
			expCode, _ := expMap["code"].(string)
			found := false
			for _, d := range valErr.Details {
				if d.Path == expPath && d.Code == expCode {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("%s: expected validation detail (path=%q, code=%q) in %+v (err=%v)", where, expPath, expCode, valErr.Details, err)
			}
		}
	}
}

func loadJSONFileWithOrder(t *testing.T, path string) (any, map[string][]string) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed reading JSON file %s: %v", path, err)
	}
	doc, err := core.ParseJSON(raw)
	if err != nil {
		t.Fatalf("failed parsing JSON file %s: %v", path, err)
	}
	ko, _ := core.ExtractJSONKeyOrder(raw)
	return doc, ko
}

func wireProtocolVersion(pv core.ProtocolVersion) string {
	switch pv {
	case core.Version0_8:
		return "v0.8"
	case core.Version0_9, core.Version0_9_1:
		return "v0.9"
	case core.Version1_0:
		return "1.0"
	default:
		return string(pv)
	}
}

func extractPartialResults(err error) []agent.ResponsePart {
	var carrier agent.PartialResultsCarrier
	if errors.As(err, &carrier) {
		return carrier.PartialResults()
	}
	return nil
}

func buildTransformer(t *testing.T, spec map[string]any) agent.CatalogTransformer {
	t.Helper()
	if rawComps, ok := spec["component_pruning"]; ok {
		return &agent.ComponentPruningTransformer{AllowedComponents: toStringSlice(rawComps)}
	}
	if rawFns, ok := spec["function_pruning"]; ok {
		return &agent.FunctionPruningTransformer{AllowedFunctions: toStringSlice(rawFns)}
	}
	t.Fatalf("unknown transformer spec: %#v", spec)
	return nil
}

func toStringSlice(raw any) []string {
	arr, ok := raw.([]any)
	if !ok {
		if ss, ok2 := raw.([]string); ok2 {
			return ss
		}
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func buildCatalogConfigFromEntry(t *testing.T, confRoot string, entry any, entryKeyOrder map[string][]string) (*agent.CatalogConfig, error) {
	t.Helper()
	var transformers []agent.CatalogTransformer
	ref := entry
	refOrder := entryKeyOrder
	if m, isMap := entry.(map[string]any); isMap {
		if inner, hasCat := m["catalog"]; hasCat {
			if rawTfs, ok := m["transformers"].([]any); ok {
				for _, tf := range rawTfs {
					if tfMap, ok2 := tf.(map[string]any); ok2 {
						transformers = append(transformers, buildTransformer(t, tfMap))
					}
				}
			}
			ref = inner
			refOrder = subKeyOrder(entryKeyOrder, "/catalog")
		}
	}

	if docMap, isMap := ref.(map[string]any); isMap {
		pv := ""
		if _, hasPV := docMap["protocolVersion"]; !hasPV {
			pv = "1.0"
		}
		cid := ""
		if _, hasCID := docMap["catalogId"]; !hasCID {
			cid = "inline"
		}
		cat, err := (&agent.InMemoryCatalogProvider{
			Document:        docMap,
			ProtocolVersion: core.ProtocolVersion(pv),
			CatalogID:       cid,
			KeyOrder:        refOrder,
		}).Load()
		if err != nil {
			return nil, err
		}
		return agent.NewCatalogConfig(cat, transformers...)
	}

	relPath, ok := ref.(string)
	if !ok {
		return nil, fmt.Errorf("invalid catalog entry %T", ref)
	}
	absPath := filepath.Join(confRoot, filepath.FromSlash(relPath))
	docAny, _ := loadJSONFileWithOrder(t, absPath)
	docMap, _ := docAny.(map[string]any)
	pv := ""
	if _, hasPV := docMap["protocolVersion"]; !hasPV {
		pv = "1.0"
	}
	cid := ""
	if _, hasCID := docMap["catalogId"]; !hasCID {
		cid = strings.TrimSuffix(filepath.Base(relPath), ".json")
	}
	return agent.CatalogConfigFromPath(absPath, &agent.CatalogConfigOptions{
		CatalogID:       cid,
		ProtocolVersion: core.ProtocolVersion(pv),
		Transformers:    transformers,
	})
}

func checkExpectedCatalog(t *testing.T, cat *core.Catalog, expected map[string]any) {
	t.Helper()
	assertKnownKeys(t, expected, catalogExpectKeys, "expect.catalog")
	if expID, ok := expected["catalog_id"].(string); ok {
		if cat.CatalogID() != expID {
			t.Fatalf("expected catalog_id %q, got %q", expID, cat.CatalogID())
		}
	}
	if expVer, ok := expected["protocol_version"].(string); ok {
		wireVer := wireProtocolVersion(cat.ProtocolVersion())
		if wireVer != expVer && string(cat.ProtocolVersion()) != expVer {
			t.Fatalf("expected protocol_version %q, got %q (wire=%q)", expVer, cat.ProtocolVersion(), wireVer)
		}
	}
	if rawComps, hasComps := expected["components"]; hasComps {
		got := sortedMapKeys(cat.Components())
		want := dedupSortedStrings(toStringSlice(rawComps))
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("expected components %v, got %v", want, got)
		}
	}
	if rawFns, hasFns := expected["functions"]; hasFns {
		got := sortedMapKeys(cat.Functions())
		want := dedupSortedStrings(toStringSlice(rawFns))
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("expected functions %v, got %v", want, got)
		}
	}
	if rawContain, hasContain := expected["serialized_defs_contain"]; hasContain {
		defs, _ := cat.ToJSON()["$defs"].(map[string]any)
		for _, k := range toStringSlice(rawContain) {
			if _, ok := defs[k]; !ok {
				t.Fatalf("expected serialized $defs to contain %q, got %v", k, sortedMapKeys(defs))
			}
		}
	}
	if rawOmit, hasOmit := expected["serialized_defs_omit"]; hasOmit {
		defs, _ := cat.ToJSON()["$defs"].(map[string]any)
		for _, k := range toStringSlice(rawOmit) {
			if _, ok := defs[k]; ok {
				t.Fatalf("expected serialized $defs to omit %q, got %v", k, sortedMapKeys(defs))
			}
		}
	}
}

func sortedMapKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func dedupSortedStrings(items []string) []string {
	seen := make(map[string]bool, len(items))
	out := make([]string, 0, len(items))
	for _, s := range items {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}

func compileChecked(parser agent.Parser, content string) ([]core.AgentToRendererMessage, error) {
	msgs, err := parser.Compile(content, true)
	if err != nil {
		var catErr core.CategorizedError
		if errors.As(err, &catErr) {
			return nil, err
		}
		ce := agent.NewCompilationError(fmt.Sprintf("Failed to compile A2UI block: %v", err), content)
		ce.Cause = err
		return nil, ce
	}
	if err := agent.ValidatePayload(parser.Catalogs(), msgs); err != nil {
		return nil, err
	}
	return msgs, nil
}

func streamPartToDict(p agent.StreamPart) map[string]any {
	if p.IsText() {
		return map[string]any{"text": p.Text}
	}
	if p.IsError() {
		return map[string]any{"error": map[string]any{"category": errorCategoryOf(p.Error)}}
	}
	items := make([]any, len(p.A2UI))
	for i, m := range p.A2UI {
		items[i] = map[string]any(m)
	}
	return map[string]any{"a2ui": items}
}

func responsePartToDict(p agent.ResponsePart) map[string]any {
	if p.IsText() {
		return map[string]any{"text": p.Text}
	}
	items := make([]any, len(p.A2UI))
	for i, m := range p.A2UI {
		items[i] = map[string]any(m)
	}
	return map[string]any{"a2ui": items}
}

func mergeTextPartDicts(parts []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(parts))
	for _, p := range parts {
		if txt, isText := p["text"].(string); isText && len(out) > 0 {
			if prevTxt, prevIsText := out[len(out)-1]["text"].(string); prevIsText {
				out[len(out)-1] = map[string]any{"text": prevTxt + txt}
				continue
			}
		}
		out = append(out, p)
	}
	return out
}

// fakeClock implements agent.Clock deterministically for conformance/agent/renderer_function_calls.yaml.
type fakeClock struct {
	mu      sync.Mutex
	now     time.Duration
	nextSeq int
	timers  []*fakeTimer
}

type fakeTimer struct {
	clock   *fakeClock
	due     time.Duration
	seq     int
	fn      func()
	stopped bool
	fired   bool
}

func (ft *fakeTimer) Stop() bool {
	ft.clock.mu.Lock()
	defer ft.clock.mu.Unlock()
	if ft.stopped || ft.fired {
		return false
	}
	ft.stopped = true
	return true
}

func (fc *fakeClock) AfterFunc(d time.Duration, f func()) agent.TimerHandle {
	fc.mu.Lock()
	fc.nextSeq++
	ft := &fakeTimer{
		clock: fc,
		due:   fc.now + d,
		seq:   fc.nextSeq,
		fn:    f,
	}
	if d <= 0 {
		ft.fired = true
		fc.mu.Unlock()
		f()
		return ft
	}
	fc.timers = append(fc.timers, ft)
	fc.mu.Unlock()
	return ft
}

func (fc *fakeClock) Advance(ms int) {
	fc.mu.Lock()
	target := fc.now + time.Duration(ms)*time.Millisecond
	for {
		var earliest *fakeTimer
		for _, t := range fc.timers {
			if t.stopped || t.fired || t.due > target {
				continue
			}
			if earliest == nil || t.due < earliest.due || (t.due == earliest.due && t.seq < earliest.seq) {
				earliest = t
			}
		}
		if earliest == nil {
			break
		}
		earliest.fired = true
		fc.now = earliest.due
		fn := earliest.fn
		fc.mu.Unlock()
		fn()
		fc.mu.Lock()
	}
	fc.now = target
	fc.mu.Unlock()
}
