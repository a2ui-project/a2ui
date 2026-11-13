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
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"gopkg.in/yaml.v3"

	"github.com/a2ui-project/a2ui/go/core"
	"github.com/a2ui-project/a2ui/go/core/internal/schemaengine"
)

var (
	supportedProtocolVersions = map[string]bool{
		"v0.8": true, "v0.9": true, "v0.9.1": true, "v1.0": true,
		"0.8": true, "0.9": true, "0.9.1": true, "1.0": true,
	}

	unrunnableSuites = map[string]string{
		"core/accessibility.yaml":       "Accessibility attributes are applied by the UI framework renderers (Lit, React, Angular, Flutter, SwiftUI), which the headless Go core library does not have access to.",
		"core/adapter_conformance.yaml": "UI framework adapter suite requires a visual widget/DOM renderer.",
	}

	unsupportedCases = map[string]string{
		"core/agent_function_routing.yaml#test_agent_routing_cancelled_call_is_sent_again_when_its_value_is_rewritten": "DataModel does not notify subscribers when a path is set to an equal value, so the binding does not re-evaluate; covered by test_agent_routing_cancelled_call_is_sent_again_on_unrelated_change.",
	}

	caseMetadataKeys = keySet("name", "description", "features")

	expectErrorKeys = keySet(
		"category", "code", "details", "functionCallId",
		"message", "path", "rendererError", "surfaceId",
	)
	expectErrorDetailKeys     = keySet("code", "message", "path", "surfaceId")
	rendererErrorEnvelopeKeys = keySet("version", "error")
	rendererErrorBodyKeys     = keySet("code", "functionCallId", "message", "path", "surfaceId")

	measureGrowthCaseKeys = unionKeys(caseMetadataKeys, keySet(
		"action", "args", "catalogPaths", "max_ratio",
		"operation", "payload", "protocolVersion", "sizes",
	))
	timingArgsKeys = keySet("validation_config")
)

type loadedConformanceCase struct {
	testID   string
	relPath  string
	name     string
	data     map[string]any
	keyOrder map[string][]string
}

type manifestEntry struct {
	Harness string `json:"harness"`
	Suite   string `json:"suite"`
	Case    string `json:"case"`
	Status  string `json:"status"`
	Reason  string `json:"reason,omitempty"`
}

type manifestRecorder struct {
	mu      sync.Mutex
	path    string
	records []manifestEntry
}

func newManifestRecorder() *manifestRecorder {
	dir := strings.TrimSpace(os.Getenv("A2UI_CONFORMANCE_MANIFEST_DIR"))
	if dir == "" {
		return nil
	}
	return &manifestRecorder{path: filepath.Join(dir, "go-core.jsonl")}
}

func (m *manifestRecorder) record(suite, caseName, status, reason string) {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.records = append(m.records, manifestEntry{
		Harness: "go-core",
		Suite:   suite,
		Case:    caseName,
		Status:  status,
		Reason:  reason,
	})
}

func (m *manifestRecorder) flush(t *testing.T) {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(m.path), 0o755); err != nil {
		t.Fatalf("mkdir manifest dir: %v", err)
	}
	f, err := os.Create(m.path)
	if err != nil {
		t.Fatalf("create manifest %s: %v", m.path, err)
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetEscapeHTML(false)
	for _, rec := range m.records {
		if err := enc.Encode(rec); err != nil {
			t.Fatalf("encode manifest record: %v", err)
		}
	}
}

func keySet(keys ...string) map[string]bool {
	out := make(map[string]bool, len(keys))
	for _, k := range keys {
		out[k] = true
	}
	return out
}

func unionKeys(a, b map[string]bool) map[string]bool {
	out := make(map[string]bool, len(a)+len(b))
	for k := range a {
		out[k] = true
	}
	for k := range b {
		out[k] = true
	}
	return out
}

func assertKnownKeys(t testing.TB, obj map[string]any, allowed map[string]bool, where, caseKey string) {
	t.Helper()
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if !allowed[k] {
			t.Fatalf("Unknown %s '%s' in %s", where, k, caseKey)
		}
	}
}

// checkActionAllowedInSuite rejects actions that only one suite may use, as the reference harness does.
func checkActionAllowedInSuite(t testing.TB, relPath, action, caseKey string) {
	t.Helper()
	if action == "resolve_nodes" && relPath != "core/node_resolution.yaml" {
		t.Fatalf("%s: resolve_nodes is only supported in core/node_resolution.yaml", caseKey)
	}
}

func conformanceRoot(t *testing.T) string {
	t.Helper()
	if env := os.Getenv("CONFORMANCE_ROOT"); env != "" {
		return env
	}
	return filepath.Join(repoRootDir(t), "conformance")
}

func decodeYAMLBytesWithKeyOrder(raw []byte) (any, map[string][]string, error) {
	var root yaml.Node
	if err := yaml.Unmarshal(raw, &root); err != nil {
		return nil, nil, err
	}
	if root.Kind == 0 {
		return nil, map[string][]string{}, nil
	}
	ko := map[string][]string{}
	val, err := yamlNodeToGo(&root, "", ko)
	if err != nil {
		return nil, nil, err
	}
	return val, ko, nil
}

func yamlNodeToGo(node *yaml.Node, ptr string, ko map[string][]string) (any, error) {
	if node == nil {
		return nil, nil
	}
	if node.Kind == yaml.AliasNode && node.Alias != nil {
		return yamlNodeToGo(node.Alias, ptr, ko)
	}
	switch node.Kind {
	case yaml.DocumentNode:
		if len(node.Content) == 0 {
			return nil, nil
		}
		return yamlNodeToGo(node.Content[0], ptr, ko)
	case yaml.MappingNode:
		out := make(map[string]any, len(node.Content)/2)
		keys := make([]string, 0, len(node.Content)/2)
		for i := 0; i+1 < len(node.Content); i += 2 {
			kNode := node.Content[i]
			vNode := node.Content[i+1]
			keyStr := kNode.Value
			keys = append(keys, keyStr)
			childPtr := ptr + "/" + escapePtrToken(keyStr)
			val, err := yamlNodeToGo(vNode, childPtr, ko)
			if err != nil {
				return nil, err
			}
			out[keyStr] = val
		}
		ko[ptr] = keys
		return out, nil
	case yaml.SequenceNode:
		out := make([]any, len(node.Content))
		for i, elem := range node.Content {
			childPtr := ptr + "/" + strconv.Itoa(i)
			val, err := yamlNodeToGo(elem, childPtr, ko)
			if err != nil {
				return nil, err
			}
			out[i] = val
		}
		return out, nil
	case yaml.ScalarNode:
		var decoded any
		if err := node.Decode(&decoded); err != nil {
			return node.Value, nil
		}
		switch v := decoded.(type) {
		case int:
			return int64(v), nil
		case uint64:
			if v <= math.MaxInt64 {
				return int64(v), nil
			}
			return float64(v), nil
		default:
			return decoded, nil
		}
	default:
		return nil, nil
	}
}

func escapePtrToken(tok string) string {
	s := strings.ReplaceAll(tok, "~", "~0")
	return strings.ReplaceAll(s, "/", "~1")
}

func extractSubKeyOrder(full map[string][]string, prefix string) map[string][]string {
	if len(full) == 0 {
		return nil
	}
	out := map[string][]string{}
	for k, ord := range full {
		if k == prefix {
			cp := append([]string(nil), ord...)
			out[""] = cp
			out["/"] = cp
		} else if strings.HasPrefix(k, prefix+"/") {
			rel := strings.TrimPrefix(k, prefix)
			cp := append([]string(nil), ord...)
			out[rel] = cp
			out[strings.TrimPrefix(rel, "/")] = cp
		}
	}
	return out
}

func loadAllCoreConformanceCases(t *testing.T) ([]loadedConformanceCase, []string) {
	t.Helper()
	confRoot := conformanceRoot(t)
	coreDir := filepath.Join(confRoot, "core")
	entries, err := os.ReadDir(coreDir)
	if err != nil {
		return nil, []string{fmt.Sprintf("read %s: %v", coreDir, err)}
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && (strings.HasSuffix(e.Name(), ".yaml") || strings.HasSuffix(e.Name(), ".yml")) {
			files = append(files, filepath.Join(coreDir, e.Name()))
		}
	}
	sort.Strings(files)
	if len(files) == 0 {
		return nil, []string{fmt.Sprintf("no conformance suites found under %s", coreDir)}
	}

	var cases []loadedConformanceCase
	var loadErrors []string
	for _, fp := range files {
		rel, err := filepath.Rel(confRoot, fp)
		if err != nil {
			rel = fp
		}
		rel = filepath.ToSlash(rel)
		raw, err := os.ReadFile(fp)
		if err != nil {
			loadErrors = append(loadErrors, fmt.Sprintf("%s: read error: %v", rel, err))
			continue
		}
		parsed, ko, err := decodeYAMLBytesWithKeyOrder(raw)
		if err != nil {
			loadErrors = append(loadErrors, fmt.Sprintf("%s: yaml parse error: %v", rel, err))
			continue
		}
		list, ok := parsed.([]any)
		if !ok {
			loadErrors = append(loadErrors, fmt.Sprintf("%s: expected list of test cases, got %T", rel, parsed))
			continue
		}
		for idx, item := range list {
			m, ok := item.(map[string]any)
			if !ok {
				loadErrors = append(loadErrors, fmt.Sprintf("%s: entry %d is not a mapping", rel, idx))
				continue
			}
			name, _ := m["name"].(string)
			if name == "" {
				loadErrors = append(loadErrors, fmt.Sprintf("%s: entry %d has no 'name'", rel, idx))
				continue
			}
			subKO := extractSubKeyOrder(ko, "/"+strconv.Itoa(idx))
			cases = append(cases, loadedConformanceCase{
				testID:   rel + "::" + name,
				relPath:  rel,
				name:     name,
				data:     m,
				keyOrder: subKO,
			})
		}
	}
	return cases, loadErrors
}

func toFloatNumeric(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case int32:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

// untypedNil maps typed nil maps and slices to an untyped nil so JSON null comparisons treat them alike.
func untypedNil(v any) any {
	switch typed := v.(type) {
	case map[string]any:
		if typed == nil {
			return nil
		}
	case []any:
		if typed == nil {
			return nil
		}
	case []string:
		if typed == nil {
			return nil
		}
	case []map[string]any:
		if typed == nil {
			return nil
		}
	}
	return v
}

func jsonValuesEqual(actual, expected any) bool {
	actual = untypedNil(actual)
	expected = untypedNil(expected)
	if actual == nil || expected == nil {
		return actual == nil && expected == nil
	}
	if ab, okA := actual.(bool); okA {
		eb, okE := expected.(bool)
		return okE && ab == eb
	}
	if _, okE := expected.(bool); okE {
		return false
	}
	if af, okA := toFloatNumeric(actual); okA {
		ef, okE := toFloatNumeric(expected)
		if !okE {
			return false
		}
		if math.IsNaN(af) && math.IsNaN(ef) {
			return true
		}
		return af == ef
	}
	if as, okA := actual.(string); okA {
		es, okE := expected.(string)
		return okE && as == es
	}
	if aSlice, okA := toAnySlice(actual); okA {
		eSlice, okE := toAnySlice(expected)
		if !okE || len(aSlice) != len(eSlice) {
			return false
		}
		for i := range aSlice {
			if !jsonValuesEqual(aSlice[i], eSlice[i]) {
				return false
			}
		}
		return true
	}
	if aMap, okA := toStringAnyMap(actual); okA {
		eMap, okE := toStringAnyMap(expected)
		if !okE || len(aMap) != len(eMap) {
			return false
		}
		for k, av := range aMap {
			ev, exists := eMap[k]
			if !exists || !jsonValuesEqual(av, ev) {
				return false
			}
		}
		return true
	}
	return fmt.Sprintf("%#v", actual) == fmt.Sprintf("%#v", expected)
}

func toAnySlice(v any) ([]any, bool) {
	switch s := v.(type) {
	case []any:
		return s, true
	case []string:
		out := make([]any, len(s))
		for i, item := range s {
			out[i] = item
		}
		return out, true
	case []map[string]any:
		out := make([]any, len(s))
		for i, item := range s {
			out[i] = item
		}
		return out, true
	default:
		return nil, false
	}
}

func toStringAnyMap(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

func normalizeSetKeywords(node any) any {
	switch typed := node.(type) {
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = normalizeSetKeywords(item)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(typed))
		for k, v := range typed {
			out[k] = normalizeSetKeywords(v)
		}
		for _, kw := range []string{"enum", "required"} {
			if arr, ok := out[kw].([]any); ok {
				cp := append([]any(nil), arr...)
				sort.Slice(cp, func(i, j int) bool {
					bi, _ := json.Marshal(cp[i])
					bj, _ := json.Marshal(cp[j])
					return string(bi) < string(bj)
				})
				out[kw] = cp
			}
		}
		return out
	default:
		return node
	}
}

func resolveProtocolVersionFromCase(caseMap map[string]any) string {
	if pv, ok := caseMap["protocolVersion"].(string); ok && pv != "" {
		return pv
	}
	catSpec, _ := caseMap["catalog"].(map[string]any)
	if pv, ok := catSpec["protocolVersion"].(string); ok && pv != "" {
		return pv
	}
	cSchema, _ := caseMap["catalogSchema"].(map[string]any)
	if pv, ok := cSchema["protocolVersion"].(string); ok && pv != "" {
		return pv
	}
	if catList, ok := caseMap["catalogs"].([]any); ok {
		for _, rawCat := range catList {
			if cm, ok := rawCat.(map[string]any); ok {
				if pv, ok := cm["protocolVersion"].(string); ok && pv != "" {
					return pv
				}
			}
		}
	}
	catID := resolveCatalogIDFromCase(caseMap)
	if catID == "" {
		if s, ok := cSchema["catalogId"].(string); ok {
			catID = s
		}
	}
	if strings.Contains(catID, "v08") || strings.Contains(catID, "v0_8") {
		return "v0.8"
	}
	if strings.Contains(catID, "v09") || strings.Contains(catID, "v0_9") {
		return "v0.9"
	}
	if strings.Contains(catID, "v10") || strings.Contains(catID, "v1_0") || strings.Contains(catID, "v1.0") {
		return "1.0"
	}
	return "v0.9"
}

func resolveCatalogIDFromCase(caseMap map[string]any) string {
	if s, ok := caseMap["catalogId"].(string); ok && s != "" {
		return s
	}
	catSpec, _ := caseMap["catalog"].(map[string]any)
	if s, ok := catSpec["catalogId"].(string); ok && s != "" {
		return s
	}
	innerSchema, _ := catSpec["catalogSchema"].(map[string]any)
	if s, ok := innerSchema["catalogId"].(string); ok && s != "" {
		return s
	}
	return ""
}

func extractA2UIBaseError(err error) *core.A2UIError {
	var base *core.A2UIError
	if errors.As(err, &base) {
		return base
	}
	return nil
}

func errorMatchesCategory(err error, category string) bool {
	if err == nil {
		return false
	}
	switch category {
	case "", "A2uiError":
		return true
	case "ParseError":
		var pe *core.ParseError
		var ee *core.ExpressionError
		return errors.As(err, &pe) || errors.As(err, &ee)
	case "ValidationError":
		var ve *core.ValidationError
		return errors.As(err, &ve)
	case "CatalogError":
		var ce *core.CatalogError
		return errors.As(err, &ce)
	case "IntegrityError":
		var ie *core.IntegrityError
		var re *core.RecursionError
		return errors.As(err, &ie) || errors.As(err, &re)
	case "RecursionError":
		var re *core.RecursionError
		return errors.As(err, &re)
	case "DataError":
		var de *core.DataError
		return errors.As(err, &de)
	case "StateError":
		var se *core.StateError
		return errors.As(err, &se)
	case "ExpressionError":
		var ee *core.ExpressionError
		return errors.As(err, &ee)
	default:
		return true
	}
}

func errorMessageMatches(expected, actual string) bool {
	expM := strings.ReplaceAll(strings.ReplaceAll(strings.ToLower(expected), `"`, `'`), `','`, `', '`)
	actM := strings.ReplaceAll(strings.ReplaceAll(strings.ToLower(actual), `"`, `'`), `','`, `', '`)
	if strings.Contains(actM, expM) {
		return true
	}
	if strings.Contains(expM, "not of type") && (strings.Contains(actM, "input should be") || strings.Contains(actM, "type_mismatch") || strings.Contains(actM, "must be") || strings.Contains(actM, "got ")) {
		return true
	}
	if strings.Contains(expM, "is a required property") && (strings.Contains(actM, "field required") || strings.Contains(actM, "missing")) {
		return true
	}
	if strings.Contains(expM, "non-dict") && (strings.Contains(actM, "primitive") || strings.Contains(actM, "non-dict")) {
		return true
	}
	if strings.Contains(expM, "orphan") && (strings.Contains(actM, "orphan") || strings.Contains(actM, "not reachable")) {
		return true
	}
	if strings.Contains(expM, "circular") && (strings.Contains(actM, "circular") || strings.Contains(actM, "self-reference")) {
		return true
	}
	if strings.Contains(expM, "additional properties are not allowed") && (strings.Contains(actM, "extra") || strings.Contains(actM, "additionalproperties") || strings.Contains(actM, "unevaluatedproperties")) {
		return true
	}
	if strings.Contains(expM, "was unexpected") && (strings.Contains(actM, "unrecognized") || strings.Contains(actM, "unexpected") || strings.Contains(actM, "not allowed")) {
		return true
	}
	if (strings.Contains(expM, "protocol version mismatch") || strings.Contains(expM, "mismatched protocol")) &&
		(strings.Contains(actM, "mismatched protocol") || strings.Contains(actM, "protocol version mismatch") || strings.Contains(actM, "does not match message protocol version")) {
		return true
	}
	return false
}

func dotToJSONPointer(p string) string {
	if p == "" {
		return ""
	}
	if strings.HasPrefix(p, "/") {
		return p
	}
	expanded := strings.ReplaceAll(p, "[", ".")
	expanded = strings.ReplaceAll(expanded, "]", "")
	segs := strings.Split(expanded, ".")
	var b strings.Builder
	for _, s := range segs {
		if s == "" {
			continue
		}
		b.WriteByte('/')
		b.WriteString(escapePtrToken(s))
	}
	return b.String()
}

var missingReqPropRe = regexp.MustCompile(`^'([^']+)' is a required property`)

func detailMatchesExpected(d core.ErrorDetail, exp map[string]any) bool {
	if expPath, hasPath := exp["path"].(string); hasPath {
		candidates := []string{d.Path}
		if d.Code == "missing_field" {
			if m := missingReqPropRe.FindStringSubmatch(d.Message); len(m) == 2 {
				if d.Path != "" {
					candidates = append(candidates, d.Path+"."+m[1])
				} else {
					candidates = append(candidates, m[1])
				}
			}
		}
		pathOK := false
		for _, cand := range candidates {
			if cand == expPath || dotToJSONPointer(cand) == dotToJSONPointer(expPath) {
				pathOK = true
				break
			}
			if strings.HasPrefix(cand, "components.") {
				parts := strings.Split(cand, ".")
				if len(parts) > 2 {
					rel := strings.Join(parts[2:], ".")
					if rel == expPath || dotToJSONPointer(rel) == expPath {
						pathOK = true
						break
					}
				}
			}
		}
		if !pathOK {
			return false
		}
	}
	if expCode, hasCode := exp["code"].(string); hasCode && expCode != "" {
		codeOK := d.Code == expCode || (expCode == "invalid_value" && (d.Code == "type_mismatch" || d.Code == "unrecognized_component"))
		if !codeOK {
			return false
		}
	}
	if expMsg, hasMsg := exp["message"].(string); hasMsg && expMsg != "" {
		if !strings.Contains(strings.ToLower(d.Message), strings.ToLower(expMsg)) && !errorMessageMatches(expMsg, d.Message) {
			return false
		}
	}
	return true
}

var (
	outboundSchemaOnce sync.Once
	outboundSchemaErr  error
	v10OutboundSchema  *jsonschema.Schema
	v09OutboundSchema  *jsonschema.Schema
)

func validateOutboundErrorSchema(t *testing.T, repoRoot string, msg map[string]any) {
	t.Helper()
	outboundSchemaOnce.Do(func() {
		loadJSON := func(rel string) map[string]any {
			b, err := os.ReadFile(filepath.Join(repoRoot, rel))
			if err != nil {
				return nil
			}
			var m map[string]any
			_ = json.Unmarshal(b, &m)
			return m
		}
		placeholderCatalog := map[string]any{
			"$schema": "https://json-schema.org/draft/2020-12/schema",
			"$defs":   map[string]any{"anyComponent": map[string]any{}, "anyFunction": map[string]any{}, "theme": map[string]any{}},
		}
		c10 := schemaengine.NewCompiler(map[string]any{
			"https://a2ui.org/specification/v1_0/renderer_to_agent.json": loadJSON("specification/v1_0/json/renderer_to_agent.json"),
			"https://a2ui.org/specification/v1_0/common_types.json":      loadJSON("specification/v1_0/json/common_types.json"),
			"https://a2ui.org/specification/v1_0/catalog.json":           placeholderCatalog,
		})
		var err error
		if v10OutboundSchema, err = c10.Compile("https://a2ui.org/specification/v1_0/renderer_to_agent.json"); err != nil {
			outboundSchemaErr = fmt.Errorf("compile v1.0 renderer_to_agent.json: %w", err)
			return
		}
		c09 := schemaengine.NewCompiler(map[string]any{
			"https://a2ui.org/specification/v0_9/client_to_server.json": loadJSON("specification/v0_9/json/client_to_server.json"),
			"https://a2ui.org/specification/v0_9/common_types.json":     loadJSON("specification/v0_9/json/common_types.json"),
			"https://a2ui.org/specification/v0_9/catalog.json":          placeholderCatalog,
		})
		if v09OutboundSchema, err = c09.Compile("https://a2ui.org/specification/v0_9/client_to_server.json"); err != nil {
			outboundSchemaErr = fmt.Errorf("compile v0.9 client_to_server.json: %w", err)
		}
	})
	if outboundSchemaErr != nil {
		t.Fatalf("%v", outboundSchemaErr)
	}

	rawBytes, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal rendererError: %v", err)
	}
	var norm any
	_ = json.Unmarshal(rawBytes, &norm)
	schema := v09OutboundSchema
	label := "v0.9"
	if ver, _ := msg["version"].(string); strings.Contains(ver, "1.0") {
		schema = v10OutboundSchema
		label = "v1.0"
	}
	if err := schema.Validate(norm); err != nil {
		t.Fatalf("rendererError failed %s schema validation: %v\npayload=%s", label, err, string(rawBytes))
	}
}

func assertRendererError(t *testing.T, caseKey string, expRE map[string]any, captured []map[string]any, details []core.ErrorDetail) {
	t.Helper()
	if inner, hasInner := expRE["error"].(map[string]any); hasInner {
		assertKnownKeys(t, expRE, rendererErrorEnvelopeKeys, "rendererError key", caseKey)
		assertKnownKeys(t, inner, rendererErrorBodyKeys, "rendererError.error key", caseKey)
	} else {
		assertKnownKeys(t, expRE, rendererErrorBodyKeys, "rendererError key", caseKey)
	}
	if len(captured) == 0 {
		t.Fatalf("%s: expected rendererError %v to be emitted, but none was captured", caseKey, expRE)
	}
	msg := captured[len(captured)-1]
	validateOutboundErrorSchema(t, repoRootDir(t), msg)
	if expVer, ok := expRE["version"].(string); ok {
		if gotVer, _ := msg["version"].(string); gotVer != expVer {
			t.Fatalf("%s: rendererError.version got %q, want %q", caseKey, gotVer, expVer)
		}
	}
	expErr := expRE
	if inner, ok := expRE["error"].(map[string]any); ok {
		expErr = inner
	}
	errObj, _ := msg["error"].(map[string]any)
	for _, k := range []string{"code", "surfaceId", "functionCallId"} {
		if expVal, exists := expErr[k]; exists {
			if !jsonValuesEqual(errObj[k], expVal) {
				t.Fatalf("%s: rendererError.%s got %v, want %v (full=%v)", caseKey, k, errObj[k], expVal, msg)
			}
		}
	}
	if expPath, ok := expErr["path"].(string); ok {
		actPath, _ := errObj["path"].(string)
		pathOK := actPath == expPath
		if !pathOK {
			for _, d := range details {
				if d.Code == "missing_field" {
					if m := missingReqPropRe.FindStringSubmatch(d.Message); len(m) == 2 && actPath == expPath+"/"+m[1] {
						pathOK = true
						break
					}
				}
			}
		}
		if !pathOK {
			t.Fatalf("%s: rendererError.path got %q, want %q", caseKey, actPath, expPath)
		}
	}
	if _, hasFC := expErr["functionCallId"]; hasFC {
		if _, hasSurf := expErr["surfaceId"]; !hasSurf {
			if sid, present := errObj["surfaceId"]; present && sid != nil {
				t.Fatalf("%s: rendererError.surfaceId expected absent for function call error, got %v", caseKey, sid)
			}
		}
	}
	if expMsg, ok := expErr["message"].(string); ok && expMsg != "" {
		actMsg, _ := errObj["message"].(string)
		if !errorMessageMatches(expMsg, actMsg) {
			t.Fatalf("%s: rendererError.message expected %q in %q", caseKey, expMsg, actMsg)
		}
	}
}

func assertErrorExpectation(t *testing.T, caseKey string, expectError any, err error, capturedRendererErrors []map[string]any) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: expected error %v, got nil", caseKey, expectError)
	}
	expMap, isMap := expectError.(map[string]any)
	var expMsg string
	if isMap {
		assertKnownKeys(t, expMap, expectErrorKeys, "expectError key", caseKey)
		cat, _ := expMap["category"].(string)
		if !errorMatchesCategory(err, cat) {
			t.Fatalf("%s: expected error category %q, got %T (%v)", caseKey, cat, err, err)
		}
		expMsg, _ = expMap["message"].(string)
	} else if s, ok := expectError.(string); ok {
		expMsg = s
	}

	base := extractA2UIBaseError(err)
	var details []core.ErrorDetail
	var errCode, errPath, errSurfaceID, errFCID string
	if base != nil {
		details = base.Details
		errCode = base.Code
		errPath = base.Path
		errSurfaceID = base.SurfaceID
		errFCID = base.FunctionCallID
	}

	if isMap {
		if expCode, ok := expMap["code"].(string); ok && expCode != "" {
			found := errCode == expCode || strings.Contains(err.Error(), expCode)
			for _, d := range details {
				if d.Code == expCode {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("%s: expected error code %q, got code=%q err=%q details=%v", caseKey, expCode, errCode, err.Error(), details)
			}
		}
		if rawPath, exists := expMap["path"]; exists && rawPath != nil {
			expPath, _ := rawPath.(string)
			found := errPath == expPath
			for _, d := range details {
				if d.Path == expPath {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("%s: expected error path %q, got path=%q details=%v", caseKey, expPath, errPath, details)
			}
		}
		if rawSID, exists := expMap["surfaceId"]; exists && rawSID != nil {
			expSID, _ := rawSID.(string)
			found := errSurfaceID == expSID
			for _, d := range details {
				if d.SurfaceID == expSID {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("%s: expected error surfaceId %q, got %q", caseKey, expSID, errSurfaceID)
			}
		}
		if rawFC, exists := expMap["functionCallId"]; exists && rawFC != nil {
			expFC, _ := rawFC.(string)
			if errFCID != expFC {
				t.Fatalf("%s: expected error functionCallId %q, got %q", caseKey, expFC, errFCID)
			}
		}
		if rawDetails, ok := expMap["details"].([]any); ok {
			for _, rawD := range rawDetails {
				dm, ok := rawD.(map[string]any)
				if !ok {
					continue
				}
				assertKnownKeys(t, dm, expectErrorDetailKeys, "expectError.details[] key", caseKey)
				matched := false
				for _, actualD := range details {
					if detailMatchesExpected(actualD, dm) {
						matched = true
						break
					}
				}
				if !matched {
					t.Fatalf("%s: expected detail %v not found in %v", caseKey, dm, details)
				}
			}
		}
		if reMap, ok := expMap["rendererError"].(map[string]any); ok {
			assertRendererError(t, caseKey, reMap, capturedRendererErrors, details)
		}
	}

	if expMsg != "" {
		var combined strings.Builder
		combined.WriteString(err.Error())
		for _, d := range details {
			combined.WriteByte(' ')
			combined.WriteString(d.Message)
		}
		fullStr := combined.String()
		matched := errorMessageMatches(expMsg, fullStr)
		if !matched {
			for _, d := range details {
				if strings.Contains(d.Message, expMsg) {
					matched = true
					break
				}
			}
		}
		if !matched {
			if re, compErr := regexp.Compile(expMsg); compErr == nil && re.MatchString(err.Error()) {
				matched = true
			}
		}
		if !matched {
			t.Fatalf("%s: expected error message matching %q, got %q (details=%v)", caseKey, expMsg, err.Error(), details)
		}
	}
}

func writeTimingPayload(t *testing.T, caseKey string, payloadSegs []any, size int) string {
	t.Helper()
	var b strings.Builder
	for _, seg := range payloadSegs {
		switch typed := seg.(type) {
		case string:
			b.WriteString(typed)
		case map[string]any:
			rep, ok := typed["repeat"].(string)
			if !ok {
				t.Fatalf("%s: invalid timing payload segment %v", caseKey, seg)
			}
			sep, _ := typed["separator"].(string)
			for i := 0; i < size; i++ {
				if i > 0 {
					b.WriteString(sep)
				}
				b.WriteString(strings.ReplaceAll(rep, "{i}", strconv.Itoa(i)))
			}
		default:
			t.Fatalf("%s: unknown timing payload segment %T", caseKey, seg)
		}
	}
	return b.String()
}

func prepareTimedProcessing(t *testing.T, caseKey string, caseMap map[string]any) func(payload string) func() {
	t.Helper()
	assertKnownKeys(t, caseMap, measureGrowthCaseKeys, "case key", caseKey)
	argsMap, _ := caseMap["args"].(map[string]any)
	assertKnownKeys(t, argsMap, timingArgsKeys, "args key", caseKey)
	rawPaths, _ := caseMap["catalogPaths"].([]any)
	var catalogs []*core.Catalog
	for _, rp := range rawPaths {
		pStr, _ := rp.(string)
		catalogs = append(catalogs, loadCatalogPathForCase(t, pStr))
	}
	valMode, _ := argsMap["validation_config"].(string)
	var valCfg *core.ValidationConfig
	switch valMode {
	case "none":
		valCfg = nil
	case "relaxed":
		c := core.RelaxedValidation()
		valCfg = &c
	default:
		t.Fatalf("%s: unknown validation_config %q", caseKey, valMode)
	}
	opts := &core.MessageProcessorOptions{ValidationConfig: valCfg}
	return func(payload string) func() {
		var messages any
		if err := json.Unmarshal([]byte(payload), &messages); err != nil {
			t.Fatalf("%s: decode timing payload: %v", caseKey, err)
		}
		return func() {
			proc, err := core.NewMessageProcessor(catalogs, opts)
			if err != nil {
				t.Fatalf("%s: NewMessageProcessor: %v", caseKey, err)
			}
			if err := proc.ProcessPayload(messages, nil); err != nil {
				t.Fatalf("%s: ProcessPayload: %v", caseKey, err)
			}
		}
	}
}

func runMeasureGrowthCase(t *testing.T, caseKey string, caseMap map[string]any) {
	t.Helper()
	op, _ := caseMap["operation"].(string)
	if op != "process_messages" {
		t.Fatalf("%s: unsupported timing operation %q", caseKey, op)
	}
	prepare := prepareTimedProcessing(t, caseKey, caseMap)
	sizesRaw, _ := caseMap["sizes"].([]any)
	if len(sizesRaw) != 2 {
		t.Fatalf("%s: expected 2 sizes, got %v", caseKey, sizesRaw)
	}
	smallerF, _ := toFloatNumeric(sizesRaw[0])
	largerF, _ := toFloatNumeric(sizesRaw[1])
	smaller, larger := int(smallerF), int(largerF)
	maxRatio, _ := toFloatNumeric(caseMap["max_ratio"])
	payloadSegs, _ := caseMap["payload"].([]any)

	baseline := prepare(writeTimingPayload(t, caseKey, payloadSegs, smaller))
	measured := prepare(writeTimingPayload(t, caseKey, payloadSegs, larger))

	baseline()
	measured()

	const runs = 5
	baseTimes := make([]int64, runs)
	measTimes := make([]int64, runs)
	timeOnce := func(fn func()) int64 {
		runtime.GC()
		start := time.Now()
		fn()
		return time.Since(start).Nanoseconds()
	}
	for i := 0; i < runs; i++ {
		baseTimes[i] = timeOnce(baseline)
		measTimes[i] = timeOnce(measured)
	}
	sort.Slice(baseTimes, func(i, j int) bool { return baseTimes[i] < baseTimes[j] })
	sort.Slice(measTimes, func(i, j int) bool { return measTimes[i] < measTimes[j] })
	baseMedian := baseTimes[runs/2]
	if baseMedian < 1 {
		baseMedian = 1
	}
	measMedian := measTimes[runs/2]
	ratio := float64(measMedian) / float64(baseMedian)
	if ratio > maxRatio {
		t.Fatalf("%s: median time at %d (%d ns) vs %d (%d ns) gave ratio %.2f > max_ratio %.2f",
			caseKey, larger, measMedian, smaller, baseMedian, ratio, maxRatio)
	}
}

func dispatchConformanceCase(t *testing.T, lc loadedConformanceCase) {
	t.Helper()
	caseKey := lc.relPath + "#" + lc.name
	action, _ := lc.data["action"].(string)
	if action == "" {
		t.Fatalf("%s: missing required 'action' field", caseKey)
	}
	checkActionAllowedInSuite(t, lc.relPath, action, caseKey)
	switch action {
	case "agent_to_renderer_schema":
		validateAgentToRendererSchemaCase(t, caseKey, lc.data)
	case "common_types_schema":
		validateCommonTypesSchemaCase(t, caseKey, lc.data)
	case "data_model":
		validateDataModelCase(t, caseKey, lc.data)
	case "derive":
		validateDeriveCase(t, caseKey, lc.data)
	case "dispatch_action":
		validateDispatchActionCase(t, caseKey, lc.data, lc.keyOrder)
	case "evaluate_function":
		validateEvaluateFunctionCase(t, caseKey, lc.data)
	case "from_json":
		validateFromJSONCase(t, caseKey, lc.data)
	case "get_client_capabilities", "get_renderer_capabilities":
		validateCapabilitiesCase(t, caseKey, lc.data)
	case "get_client_data_model", "get_renderer_data_model":
		validateGetRendererDataModelCase(t, caseKey, lc.data)
	case "handle_rpc":
		validateHandleRPCCase(t, caseKey, lc.data)
	case "parse_expression_template":
		validateParseExpressionTemplateCase(t, caseKey, lc.data)
	case "process_messages":
		validateProcessMessagesCase(t, caseKey, lc.data)
	case "resolve_nodes":
		validateResolveNodesCase(t, caseKey, lc.data)
	case "resolve_path":
		validateResolvePathCase(t, caseKey, lc.data)
	case "round_trip":
		validateRoundTripCase(t, caseKey, lc.data)
	case "route_agent_function":
		validateRouteAgentFunctionCase(t, caseKey, lc.data, lc.keyOrder)
	case "select_catalog":
		validateSelectCatalogCase(t, caseKey, lc.data)
	case "to_json":
		validateToJSONCase(t, caseKey, lc.data)
	case "validate":
		validatePureValidationCase(t, caseKey, lc.data)
	case "validate_common_type":
		validateCommonTypeCase(t, caseKey, lc.data)
	case "validation_schema":
		validateValidationSchemaCase(t, caseKey, lc.data)
	default:
		t.Fatalf("%s: action %q has no handler in the Go core conformance harness", caseKey, action)
	}
}

func TestConformanceSuite(t *testing.T) {
	cases, loadErrs := loadAllCoreConformanceCases(t)
	if len(loadErrs) > 0 {
		t.Fatalf("conformance suites failed to load:\n%s", strings.Join(loadErrs, "\n"))
	}
	recorder := newManifestRecorder()
	t.Cleanup(func() { recorder.flush(t) })

	runTiming := os.Getenv("A2UI_RUN_TIMING") == "1"

	for _, lc := range cases {
		lc := lc
		caseKey := lc.relPath + "#" + lc.name
		t.Run(lc.testID, func(t *testing.T) {
			ver := resolveProtocolVersionFromCase(lc.data)
			if ver != "" && !supportedProtocolVersions[ver] {
				recorder.record(lc.relPath, lc.name, "failed", "")
				t.Fatalf("%s: unsupported protocol version %q", caseKey, ver)
			}
			if reason, skipSuite := unrunnableSuites[lc.relPath]; skipSuite {
				recorder.record(lc.relPath, lc.name, "skipped", reason)
				t.Skip(reason)
			}
			if reason, skipCase := unsupportedCases[caseKey]; skipCase {
				recorder.record(lc.relPath, lc.name, "skipped", reason)
				t.Skip(reason)
			}
			action, _ := lc.data["action"].(string)
			if action == "measure_growth" || action == "measure_overhead" {
				// Validate keys unconditionally so schema drift is caught even without A2UI_RUN_TIMING=1.
				_ = prepareTimedProcessing(t, caseKey, lc.data)
				if !runTiming {
					const reason = "performance: runs when A2UI_RUN_TIMING=1"
					recorder.record(lc.relPath, lc.name, "skipped", reason)
					t.Skip(reason)
				}
				t.Cleanup(func() {
					if t.Failed() {
						recorder.record(lc.relPath, lc.name, "failed", "")
					} else if !t.Skipped() {
						recorder.record(lc.relPath, lc.name, "passed", "")
					}
				})
				runMeasureGrowthCase(t, caseKey, lc.data)
				return
			}

			t.Cleanup(func() {
				if t.Skipped() {
					return
				}
				if t.Failed() {
					recorder.record(lc.relPath, lc.name, "failed", "")
				} else {
					recorder.record(lc.relPath, lc.name, "passed", "")
				}
			})
			dispatchConformanceCase(t, lc)
		})
	}
}

// fatalRecorder captures the first Fatalf of a harness check so a test can assert that the check rejects bad input.
type fatalRecorder struct {
	testing.TB
	msg string
}

func (r *fatalRecorder) Helper() {}

func (r *fatalRecorder) Fatalf(format string, args ...any) {
	r.msg = fmt.Sprintf(format, args...)
	runtime.Goexit()
}

// captureFatal runs check on its own goroutine and returns the message it failed with, or "" if it passed.
func captureFatal(t *testing.T, check func(tb testing.TB)) string {
	t.Helper()
	rec := &fatalRecorder{TB: t}
	done := make(chan struct{})
	go func() {
		defer close(done)
		check(rec)
	}()
	<-done
	return rec.msg
}

func TestUnknownConformanceKeyIsRejected(t *testing.T) {
	msg := captureFatal(t, func(tb testing.TB) {
		assertKnownKeys(tb, map[string]any{"name": "stray", "action": "handle_rpc", "unexpectedBogusKey": true},
			handleRPCCaseKeys, "case key", "core/rpc_functions.yaml#stray")
	})
	if !strings.Contains(msg, "unexpectedBogusKey") {
		t.Fatalf("assertKnownKeys accepted an unknown key; got message %q", msg)
	}
}

func TestResolveNodesOutsideItsSuiteIsRejected(t *testing.T) {
	msg := captureFatal(t, func(tb testing.TB) {
		checkActionAllowedInSuite(tb, "core/data_model.yaml", "resolve_nodes", "core/data_model.yaml#stray")
	})
	if !strings.Contains(msg, "resolve_nodes is only supported") {
		t.Fatalf("resolve_nodes outside core/node_resolution.yaml was accepted; got message %q", msg)
	}
	if msg := captureFatal(t, func(tb testing.TB) {
		checkActionAllowedInSuite(tb, "core/node_resolution.yaml", "resolve_nodes", "core/node_resolution.yaml#ok")
	}); msg != "" {
		t.Fatalf("resolve_nodes in core/node_resolution.yaml was rejected: %s", msg)
	}
}

func TestUnsupportedEntriesAreUsed(t *testing.T) {
	cases, loadErrs := loadAllCoreConformanceCases(t)
	if len(loadErrs) > 0 {
		t.Fatalf("load errors: %v", loadErrs)
	}
	suites := map[string]bool{}
	keys := map[string]bool{}
	for _, lc := range cases {
		suites[lc.relPath] = true
		keys[lc.relPath+"#"+lc.name] = true
	}
	for s := range unrunnableSuites {
		if !suites[s] {
			t.Fatalf("unused unrunnableSuites entry: %s", s)
		}
	}
	for k := range unsupportedCases {
		if !keys[k] {
			t.Fatalf("unused unsupportedCases entry: %s", k)
		}
	}
}

func TestCatalogConformanceCoversPublishedCatalogs(t *testing.T) {
	root := repoRootDir(t)
	var published []string
	for _, pat := range []string{"specification/*/catalogs/*/catalog.json", "catalogs/*/v*/catalog.json"} {
		matches, err := filepath.Glob(filepath.Join(root, pat))
		if err != nil {
			t.Fatalf("glob %s: %v", pat, err)
		}
		for _, m := range matches {
			rel, _ := filepath.Rel(root, m)
			published = append(published, filepath.ToSlash(rel))
		}
	}
	sort.Strings(published)
	if len(published) == 0 {
		t.Fatalf("no published catalogs found under %s", root)
	}

	raw, err := os.ReadFile(filepath.Join(conformanceRoot(t), "core", "catalog.yaml"))
	if err != nil {
		t.Fatalf("read catalog.yaml: %v", err)
	}
	parsed, _, err := decodeYAMLBytesWithKeyOrder(raw)
	if err != nil {
		t.Fatalf("parse catalog.yaml: %v", err)
	}
	covered := map[string]bool{}
	for _, item := range parsed.([]any) {
		cm, _ := item.(map[string]any)
		if cm["action"] == "from_json" {
			if cp, ok := cm["catalogPath"].(string); ok {
				if exp, ok := cm["expect"].(map[string]any); ok && exp["selfContained"] == true {
					covered[cp] = true
				}
			}
		}
	}
	for _, pub := range published {
		if !covered[pub] {
			t.Fatalf("published catalog %s missing from_json selfContained case in conformance/core/catalog.yaml", pub)
		}
	}
}

func TestConcurrentCoreSafety(t *testing.T) {
	cat, err := core.BasicCatalog(core.Version1_0)
	if err != nil {
		t.Fatalf("BasicCatalog: %v", err)
	}
	strict := core.StrictValidation()
	sharedValidator := core.NewPayloadValidator(cat, &strict)

	const workers = 8
	const iters = 16
	var wg sync.WaitGroup
	wg.Add(workers)
	for w := 0; w < workers; w++ {
		w := w
		go func() {
			defer wg.Done()
			for i := 0; i < iters; i++ {
				_ = cat.ToJSON()
				_ = cat.ValidationSchema()
				_ = cat.ComponentRefMap()
				if err := core.ValidateCommonType(core.Version1_0, "DynamicString", "hello"); err != nil {
					t.Errorf("ValidateCommonType: %v", err)
				}
				if err := sharedValidator.ValidateComponent(map[string]any{
					"id":        fmt.Sprintf("txt_%d_%d", w, i),
					"component": "Text",
					"text":      "Hello",
				}, "main"); err != nil {
					t.Errorf("ValidateComponent: %v", err)
				}
				if _, err := core.ParseExpressionTemplate("Hello ${/user/name}!"); err != nil {
					t.Errorf("ParseExpressionTemplate: %v", err)
				}
				if ok, _, err := core.RegexTest(`^(?=.*\d).{4,}$`, "abc1"); err != nil || !ok {
					t.Errorf("RegexTest got (%v, %v)", ok, err)
				}
				proc, err := core.NewMessageProcessor([]*core.Catalog{cat}, &core.MessageProcessorOptions{
					ValidationConfig: &strict,
				})
				if err != nil {
					t.Errorf("NewMessageProcessor: %v", err)
					return
				}
				sid := fmt.Sprintf("surf_%d_%d", w, i)
				if err := proc.ProcessPayload([]any{
					map[string]any{
						"version": "1.0",
						"createSurface": map[string]any{
							"surfaceId": sid,
							"catalogId": cat.CatalogID(),
							"components": []any{
								map[string]any{"id": "root", "component": "Text", "text": map[string]any{"@path": "/msg"}},
							},
							"dataModel": map[string]any{"msg": "hi"},
						},
					},
				}, nil); err != nil {
					t.Errorf("ProcessPayload: %v", err)
				}
				surf := proc.Model.Surface(sid)
				nr := core.NewNodeResolver(surf, cat)
				if nr.Root() == nil {
					t.Errorf("expected mounted root node")
				}
				nr.Dispose()
				proc.Dispose()
			}
		}()
	}
	wg.Wait()
}
