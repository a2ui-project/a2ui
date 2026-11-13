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

package a2aext_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/a2aproject/a2a-go/a2a"
	"gopkg.in/yaml.v3"

	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/core"
)

const (
	a2aHarnessID = "go-a2a"
	a2aSuitePath = "extensions/a2a/a2a_integration.yaml"
)

var (
	a2aUnsupported      = map[string]string{}
	a2aExpectedFailures = map[string]string{}

	a2aKnownKeys = map[string]map[string]bool{
		"case": {
			"name": true, "description": true, "features": true,
			"action": true, "args": true, "expect": true,
		},
		"create_a2ui_part.args":       {"data": true, "version": true},
		"create_a2ui_part.expect":     {"mimeType": true},
		"is_a2ui_part.args":           {"mimeType": true},
		"try_activate_extension.args": {"uris": true},
		"get_extension.args":          {"version": true, "acceptsInlineCatalogs": true, "supportedCatalogIds": true},
		"get_extension.expect":        {"uri": true, "params": true},
		"try_activate.args":           {"requested": true, "advertised": true},
		"try_activate.expect":         {"activated": true, "version": true},
		"select_newest.args":          {"requested": true, "advertised": true},
		"select_newest.expect":        {"newest": true},
	}

	a2aManifestMu   sync.Mutex
	a2aManifestOnce sync.Once
)

type manifestRecord struct {
	Harness string `json:"harness"`
	Suite   string `json:"suite"`
	Case    string `json:"case"`
	Status  string `json:"status"`
	Reason  string `json:"reason,omitempty"`
}

type unknownKeyError struct {
	msg string
}

func (e *unknownKeyError) Error() string { return e.msg }

func locateConformanceRoot(t testing.TB) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd failed: %v", err)
	}
	for {
		candidate := filepath.Join(dir, "conformance", "conformance_schema.json")
		if _, statErr := os.Stat(candidate); statErr == nil {
			return filepath.Join(dir, "conformance")
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("could not locate conformance/conformance_schema.json walking up from %q", dir)
		}
		dir = parent
	}
}

func loadA2AConformanceCases(t testing.TB) []map[string]any {
	t.Helper()
	fullPath := filepath.Join(locateConformanceRoot(t), filepath.FromSlash(a2aSuitePath))
	raw, err := os.ReadFile(fullPath)
	if err != nil {
		t.Fatalf("read %s: %v", fullPath, err)
	}
	var cases []map[string]any
	if err := yaml.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("yaml unmarshal %s: %v", fullPath, err)
	}
	if len(cases) == 0 {
		t.Fatalf("no cases loaded from %s", fullPath)
	}
	return cases
}

func appendA2AManifest(caseName, status, reason string) error {
	dir := os.Getenv("A2UI_CONFORMANCE_MANIFEST_DIR")
	if dir == "" {
		return nil
	}
	a2aManifestMu.Lock()
	defer a2aManifestMu.Unlock()

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, a2aHarnessID+".jsonl")
	var initErr error
	a2aManifestOnce.Do(func() {
		initErr = os.WriteFile(path, nil, 0o644)
	})
	if initErr != nil {
		return initErr
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()

	rec := manifestRecord{
		Harness: a2aHarnessID,
		Suite:   a2aSuitePath,
		Case:    caseName,
		Status:  status,
		Reason:  reason,
	}
	line, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	_, err = f.Write(append(line, '\n'))
	return err
}

func assertKnownKeys(obj map[string]any, allowed map[string]bool, where, caseKey string) error {
	for k := range obj {
		if !allowed[k] {
			return &unknownKeyError{msg: fmt.Sprintf("Unknown %s '%s' in %s", where, k, caseKey)}
		}
	}
	return nil
}

func hasNestedKeyPath(obj map[string]any, dotted string) bool {
	var cur any = obj
	for _, seg := range strings.Split(dotted, ".") {
		m, ok := cur.(map[string]any)
		if !ok {
			return false
		}
		val, exists := m[seg]
		if !exists {
			return false
		}
		cur = val
	}
	return cur != nil
}

func findUnsupportedReason(tc map[string]any) (string, bool) {
	name, _ := tc["name"].(string)
	caseKey := a2aSuitePath + "#" + name
	if r, ok := a2aUnsupported[caseKey]; ok {
		return r, true
	}
	action, _ := tc["action"].(string)
	if r, ok := a2aUnsupported[action]; ok {
		return r, true
	}
	prefix := action + "."
	for k, r := range a2aUnsupported {
		if strings.HasPrefix(k, prefix) && hasNestedKeyPath(tc, strings.TrimPrefix(k, prefix)) {
			return r, true
		}
	}
	return "", false
}

func asMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func toStringSlice(v any) ([]string, error) {
	if v == nil {
		return nil, nil
	}
	list, ok := v.([]any)
	if !ok {
		return nil, fmt.Errorf("expected string list, got %T", v)
	}
	out := make([]string, len(list))
	for i, item := range list {
		s, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("expected string at index %d, got %T", i, item)
		}
		out[i] = s
	}
	return out, nil
}

func normalizeJSONComparable(v any) any {
	raw, err := json.Marshal(v)
	if err != nil {
		return v
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		return v
	}
	return out
}

func runA2ACase(tc map[string]any, caseKey string) error {
	if err := assertKnownKeys(tc, a2aKnownKeys["case"], "case key", caseKey); err != nil {
		return err
	}
	action, _ := tc["action"].(string)
	args := asMap(tc["args"])

	switch action {
	case "create_a2ui_part":
		expect := asMap(tc["expect"])
		if err := assertKnownKeys(args, a2aKnownKeys["create_a2ui_part.args"], "args key", caseKey); err != nil {
			return err
		}
		if err := assertKnownKeys(expect, a2aKnownKeys["create_a2ui_part.expect"], "expect key", caseKey); err != nil {
			return err
		}
		version, err := optionalProtocolVersion(args["version"])
		if err != nil {
			return err
		}
		part := a2aext.CreateA2UIPart(asMap(args["data"]), version)
		if !a2aext.IsA2UIPart(part) {
			return fmt.Errorf("expected IsA2UIPart(part) == true")
		}
		dp, ok := a2aext.A2UIDataPart(part)
		if !ok || dp == nil {
			return fmt.Errorf("expected non-nil DataPart from A2UIDataPart")
		}
		gotMime, _ := dp.Metadata[a2aext.MIMETypeKey].(string)
		wantMime, _ := expect["mimeType"].(string)
		if gotMime != wantMime {
			return fmt.Errorf("mimeType = %q, want %q", gotMime, wantMime)
		}
		return nil

	case "is_a2ui_part":
		if err := assertKnownKeys(args, a2aKnownKeys["is_a2ui_part.args"], "args key", caseKey); err != nil {
			return err
		}
		expectBool, ok := tc["expect"].(bool)
		if !ok {
			return fmt.Errorf("expected boolean expect, got %T", tc["expect"])
		}
		mime, _ := args["mimeType"].(string)
		part := a2a.DataPart{
			Data:     map[string]any{},
			Metadata: map[string]any{a2aext.MIMETypeKey: mime},
		}
		if got := a2aext.IsA2UIPart(part); got != expectBool {
			return fmt.Errorf("IsA2UIPart = %v, want %v", got, expectBool)
		}
		return nil

	case "try_activate_extension":
		if err := assertKnownKeys(args, a2aKnownKeys["try_activate_extension.args"], "args key", caseKey); err != nil {
			return err
		}
		expectBool, ok := tc["expect"].(bool)
		if !ok {
			return fmt.Errorf("expected boolean expect, got %T", tc["expect"])
		}
		uris, err := toStringSlice(args["uris"])
		if err != nil {
			return err
		}
		extCtx := &fakeExtensionContext{requested: uris}
		card := &a2a.AgentCard{
			Capabilities: a2a.AgentCapabilities{
				Extensions: []a2a.AgentExtension{
					{URI: a2aext.ExtensionURI(core.Version0_8)},
					{URI: a2aext.ExtensionURI(core.Version0_9)},
					{URI: a2aext.ExtensionURI(core.Version1_0)},
				},
			},
		}
		_, activated := a2aext.ActivateExtension(extCtx, nil, card)
		if activated != expectBool {
			return fmt.Errorf("activated = %v, want %v", activated, expectBool)
		}
		activatedURIs := extCtx.activated
		if expectBool && len(activatedURIs) != 1 {
			return fmt.Errorf("expected 1 activated URI, got %v", activatedURIs)
		}
		if !expectBool && len(activatedURIs) != 0 {
			return fmt.Errorf("expected 0 activated URIs, got %v", activatedURIs)
		}
		return nil

	case "get_extension":
		expect := asMap(tc["expect"])
		if err := assertKnownKeys(args, a2aKnownKeys["get_extension.args"], "args key", caseKey); err != nil {
			return err
		}
		if err := assertKnownKeys(expect, a2aKnownKeys["get_extension.expect"], "expect key", caseKey); err != nil {
			return err
		}
		var opts a2aext.AgentExtensionOptions
		if inline, ok := args["acceptsInlineCatalogs"].(bool); ok {
			opts.AcceptsInlineCatalogs = inline
		}
		if ids, err := toStringSlice(args["supportedCatalogIds"]); err != nil {
			return err
		} else {
			opts.SupportedCatalogIDs = ids
		}
		ver, err := optionalProtocolVersion(args["version"])
		if err != nil {
			return err
		}
		ext := a2aext.AgentExtension(ver, &opts)
		wantURI, _ := expect["uri"].(string)
		if ext.URI != wantURI {
			return fmt.Errorf("URI = %q, want %q", ext.URI, wantURI)
		}
		if expect["params"] == nil {
			if ext.Params != nil {
				return fmt.Errorf("Params = %#v, want nil", ext.Params)
			}
		} else if !reflect.DeepEqual(normalizeJSONComparable(ext.Params), normalizeJSONComparable(expect["params"])) {
			return fmt.Errorf("Params = %#v, want %#v", ext.Params, expect["params"])
		}
		return nil

	case "try_activate":
		expect := asMap(tc["expect"])
		if err := assertKnownKeys(args, a2aKnownKeys["try_activate.args"], "args key", caseKey); err != nil {
			return err
		}
		if err := assertKnownKeys(expect, a2aKnownKeys["try_activate.expect"], "expect key", caseKey); err != nil {
			return err
		}
		requested, err := toStringSlice(args["requested"])
		if err != nil {
			return err
		}
		advertised, err := toStringSlice(args["advertised"])
		if err != nil {
			return err
		}
		extCtx := &fakeExtensionContext{requested: requested}
		cardExts := make([]a2a.AgentExtension, len(advertised))
		for i, uri := range advertised {
			cardExts[i] = a2a.AgentExtension{URI: uri}
		}
		card := &a2a.AgentCard{
			Capabilities: a2a.AgentCapabilities{Extensions: cardExts},
		}
		gotVer, ok := a2aext.ActivateExtension(extCtx, nil, card)
		activatedURIs := extCtx.activated
		if expect["activated"] == nil {
			if ok || len(activatedURIs) != 0 {
				return fmt.Errorf("expected no activation, got ver=%q ok=%v uris=%v", gotVer, ok, activatedURIs)
			}
			return nil
		}
		wantURI, _ := expect["activated"].(string)
		wantVerRaw, _ := expect["version"].(string)
		wantVer, err := core.ToProtocolVersion(wantVerRaw)
		if err != nil {
			return err
		}
		if !ok || gotVer != wantVer {
			return fmt.Errorf("got (%q, %v), want (%q, true)", gotVer, ok, wantVer)
		}
		if !reflect.DeepEqual(activatedURIs, []string{wantURI}) {
			return fmt.Errorf("activatedURIs = %v, want [%q]", activatedURIs, wantURI)
		}
		return nil

	case "select_newest":
		expect := asMap(tc["expect"])
		if err := assertKnownKeys(args, a2aKnownKeys["select_newest.args"], "args key", caseKey); err != nil {
			return err
		}
		if err := assertKnownKeys(expect, a2aKnownKeys["select_newest.expect"], "expect key", caseKey); err != nil {
			return err
		}
		requested, err := toStringSlice(args["requested"])
		if err != nil {
			return err
		}
		advertised, err := toStringSlice(args["advertised"])
		if err != nil {
			return err
		}
		got := a2aext.SelectNewestExtensionURI(requested, advertised)
		if expect["newest"] == nil {
			if got != "" {
				return fmt.Errorf("SelectNewestExtensionURI = %q, want empty", got)
			}
			return nil
		}
		want, _ := expect["newest"].(string)
		if got != want {
			return fmt.Errorf("SelectNewestExtensionURI = %q, want %q", got, want)
		}
		return nil

	default:
		return &unknownKeyError{msg: fmt.Sprintf("Unknown action '%s' in %s", action, caseKey)}
	}
}

func TestA2AUnsupportedAndExpectedFailuresAreUsed(t *testing.T) {
	cases := loadA2AConformanceCases(t)
	matchedUnsupported := make(map[string]bool)
	loadedKeys := make(map[string]bool)

	for _, tc := range cases {
		name, _ := tc["name"].(string)
		caseKey := a2aSuitePath + "#" + name
		loadedKeys[caseKey] = true
		action, _ := tc["action"].(string)
		if _, ok := a2aUnsupported[caseKey]; ok {
			matchedUnsupported[caseKey] = true
		}
		if _, ok := a2aUnsupported[action]; ok {
			matchedUnsupported[action] = true
		}
		prefix := action + "."
		for k := range a2aUnsupported {
			if strings.HasPrefix(k, prefix) && hasNestedKeyPath(tc, strings.TrimPrefix(k, prefix)) {
				matchedUnsupported[k] = true
			}
		}
	}

	var unusedUnsupported []string
	for k := range a2aUnsupported {
		if !matchedUnsupported[k] {
			unusedUnsupported = append(unusedUnsupported, k)
		}
	}
	sort.Strings(unusedUnsupported)
	if len(unusedUnsupported) > 0 {
		t.Fatalf("Unused UNSUPPORTED entries: %v", unusedUnsupported)
	}

	var unusedXfails []string
	for k := range a2aExpectedFailures {
		if !loadedKeys[k] {
			unusedXfails = append(unusedXfails, k)
		}
	}
	sort.Strings(unusedXfails)
	if len(unusedXfails) > 0 {
		t.Fatalf("Unused EXPECTED_FAILURES entries: %v", unusedXfails)
	}
}

func TestA2AIntegrationConformance(t *testing.T) {
	cases := loadA2AConformanceCases(t)
	for _, tc := range cases {
		tc := tc
		name, _ := tc["name"].(string)
		caseKey := a2aSuitePath + "#" + name
		t.Run(name, func(t *testing.T) {
			if reason, ok := findUnsupportedReason(tc); ok {
				if err := appendA2AManifest(name, "skipped", reason); err != nil {
					t.Fatalf("write manifest: %v", err)
				}
				t.Skip(reason)
			}

			err := runA2ACase(tc, caseKey)
			if xfailReason, isXfail := a2aExpectedFailures[caseKey]; isXfail {
				if _, isUnknown := err.(*unknownKeyError); isUnknown {
					_ = appendA2AManifest(name, "failed", "")
					t.Fatalf("%v", err)
				}
				if err != nil {
					if mErr := appendA2AManifest(name, "xfailed", xfailReason); mErr != nil {
						t.Fatalf("write manifest: %v", mErr)
					}
					t.Skipf("xfailed: %s (%v)", xfailReason, err)
				}
				_ = appendA2AManifest(name, "failed", "")
				t.Fatalf("Expected failure %q passed unexpectedly", caseKey)
			}

			if err != nil {
				_ = appendA2AManifest(name, "failed", "")
				t.Fatalf("%v", err)
			}
			if mErr := appendA2AManifest(name, "passed", ""); mErr != nil {
				t.Fatalf("write manifest: %v", mErr)
			}
		})
	}
}

// optionalProtocolVersion converts a case's optional raw version string to a ProtocolVersion.
func optionalProtocolVersion(raw any) (core.ProtocolVersion, error) {
	s, _ := raw.(string)
	if s == "" {
		return "", nil
	}
	return core.ToProtocolVersion(s)
}
