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

package builder_test

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/a2ui-project/a2ui/go/agent/builder"
	v09 "github.com/a2ui-project/a2ui/go/agent/builder/v09"
	v1 "github.com/a2ui-project/a2ui/go/agent/builder/v1"
	"github.com/a2ui-project/a2ui/go/core"
)

const builderSuiteRelPath = "agent/builder/builder.yaml"

var (
	knownBuilderSuiteKeys = map[string]bool{
		"suite":   true,
		"version": true,
		"tests":   true,
	}
	knownBuilderCaseKeys = map[string]bool{
		"id":          true,
		"features":    true,
		"description": true,
		"golden":      true,
		"surface_id":  true,
		"version":     true,
		"root_id":     true,
		"catalog_id":  true,
		"data_model":  true,
		"validation":  true,
		"input":       true,
	}
	knownBuilderValidationKeys = map[string]bool{
		"allow_missing_root":        true,
		"allow_orphan_components":   true,
		"allow_dangling_references": true,
	}
	knownDCLKeys = map[string]bool{
		"path":     true,
		"template": true,
	}
	knownCheckRuleKeys = map[string]bool{
		"condition": true,
		"message":   true,
	}
	knownActionKeys = map[string]bool{
		"event":        true,
		"functionCall": true,
	}
	knownActionEventKeys = map[string]bool{
		"name":        true,
		"userMessage": true,
		"context":     true,
	}
	knownA11yKeys = map[string]bool{
		"label":       true,
		"description": true,
		"live":        true,
		"hidden":      true,
	}
	knownFunctionCallKeys = map[string]bool{
		"call":       true,
		"args":       true,
		"catalogId":  true,
		"returnType": true,
	}
)

type builderValidationProfile struct {
	AllowMissingRoot        bool
	AllowOrphanComponents   bool
	AllowDanglingReferences bool
}

func (vp builderValidationProfile) toConfig() core.ValidationConfig {
	return core.ValidationConfig{
		RootID:                  "root",
		AllowMissingRoot:        vp.AllowMissingRoot,
		AllowOrphanComponents:   vp.AllowOrphanComponents,
		AllowDanglingReferences: vp.AllowDanglingReferences,
	}
}

type builderCase struct {
	ID          string
	Description string
	Golden      string
	SurfaceID   string
	Version     string
	RootID      string
	CatalogID   string
	DataModel   []dataModelEntry
	Validation  builderValidationProfile
	Input       any
}

type dataModelEntry struct {
	Path  string
	Value any
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

func loadBuilderCases(t *testing.T, suitePath string) []builderCase {
	t.Helper()
	rawBytes, err := os.ReadFile(suitePath)
	if err != nil {
		t.Fatalf("failed reading %s: %v", suitePath, err)
	}
	var rootNode yaml.Node
	if err := yaml.Unmarshal(rawBytes, &rootNode); err != nil {
		t.Fatalf("failed parsing YAML %s: %v", suitePath, err)
	}
	var rawSuite map[string]any
	if err := rootNode.Decode(&rawSuite); err != nil {
		t.Fatalf("failed decoding YAML map %s: %v", suitePath, err)
	}
	if err := assertKnownKeys(rawSuite, knownBuilderSuiteKeys, "suite key", builderSuiteRelPath); err != nil {
		t.Fatal(err)
	}
	defaultVer, _ := rawSuite["version"].(string)
	if defaultVer == "" {
		defaultVer = "v0.9"
	}

	// Also locate tests node in rootNode to preserve ordered data_model entries.
	var testsNode *yaml.Node
	if len(rootNode.Content) > 0 && rootNode.Content[0].Kind == yaml.MappingNode {
		doc := rootNode.Content[0]
		for i := 0; i+1 < len(doc.Content); i += 2 {
			if doc.Content[i].Value == "tests" {
				testsNode = doc.Content[i+1]
				break
			}
		}
	}

	rawTests, ok := rawSuite["tests"].([]any)
	if !ok {
		t.Fatalf("expected tests list in %s", suitePath)
	}
	cases := make([]builderCase, 0, len(rawTests))
	for idx, item := range rawTests {
		rawCase, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("test[%d] must be a mapping", idx)
		}
		caseID, _ := rawCase["id"].(string)
		caseCtx := fmt.Sprintf("%s#%s", builderSuiteRelPath, caseID)
		if err := assertKnownKeys(rawCase, knownBuilderCaseKeys, "case key", caseCtx); err != nil {
			t.Fatal(err)
		}

		ver, _ := rawCase["version"].(string)
		if ver == "" {
			ver = defaultVer
		}
		desc, _ := rawCase["description"].(string)
		golden, _ := rawCase["golden"].(string)
		surfaceID, _ := rawCase["surface_id"].(string)
		rootID, _ := rawCase["root_id"].(string)
		catalogID, _ := rawCase["catalog_id"].(string)

		var vp builderValidationProfile
		if rawVal, ok := rawCase["validation"].(map[string]any); ok {
			if err := assertKnownKeys(rawVal, knownBuilderValidationKeys, "validation key", caseCtx); err != nil {
				t.Fatal(err)
			}
			vp.AllowMissingRoot, _ = rawVal["allow_missing_root"].(bool)
			vp.AllowOrphanComponents, _ = rawVal["allow_orphan_components"].(bool)
			vp.AllowDanglingReferences, _ = rawVal["allow_dangling_references"].(bool)
		}

		var dmEntries []dataModelEntry
		if testsNode != nil && idx < len(testsNode.Content) {
			caseNode := testsNode.Content[idx]
			for i := 0; i+1 < len(caseNode.Content); i += 2 {
				if caseNode.Content[i].Value == "data_model" && caseNode.Content[i+1].Kind == yaml.MappingNode {
					dmMap := caseNode.Content[i+1]
					for j := 0; j+1 < len(dmMap.Content); j += 2 {
						var val any
						if err := dmMap.Content[j+1].Decode(&val); err != nil {
							t.Fatalf("failed decoding data_model entry in %s: %v", caseCtx, err)
						}
						dmEntries = append(dmEntries, dataModelEntry{
							Path:  dmMap.Content[j].Value,
							Value: val,
						})
					}
				}
			}
		}

		cases = append(cases, builderCase{
			ID:          caseID,
			Description: desc,
			Golden:      golden,
			SurfaceID:   surfaceID,
			Version:     ver,
			RootID:      rootID,
			CatalogID:   catalogID,
			DataModel:   dmEntries,
			Validation:  vp,
			Input:       rawCase["input"],
		})
	}
	return cases
}

func buildV1NodeList(raw any, caseCtx string) ([]builder.Node, error) {
	list, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("expected component list in %s, got %T", caseCtx, raw)
	}
	out := make([]builder.Node, 0, len(list))
	for _, item := range list {
		n, err := buildV1Node(item, caseCtx)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, nil
}

func buildV1ChildList(raw any, caseCtx string) (v1.ChildList, error) {
	if m, ok := raw.(map[string]any); ok {
		if dclRaw, has := m["$dynamicChildList"]; has && len(m) == 1 {
			spec, ok := dclRaw.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("$dynamicChildList must be map in %s", caseCtx)
			}
			if err := assertKnownKeys(spec, knownDCLKeys, "$dynamicChildList key", caseCtx); err != nil {
				return nil, err
			}
			path, _ := spec["path"].(string)
			tmpl, err := buildV1Node(spec["template"], caseCtx)
			if err != nil {
				return nil, err
			}
			return v1.NewDynamicChildList(path, tmpl), nil
		}
	}
	nodes, err := buildV1NodeList(raw, caseCtx)
	if err != nil {
		return nil, err
	}
	return v1.Children(nodes...), nil
}

func buildV1DynamicString(raw any, caseCtx string) (v1.DynamicString, error) {
	switch val := raw.(type) {
	case string:
		return v1.Str(val), nil
	case map[string]any:
		if b, has := val["$bind"]; has && len(val) == 1 {
			p, _ := b.(string)
			return v1.Bind(p), nil
		}
		if _, has := val["call"]; has {
			return buildV1FunctionCall(val, caseCtx)
		}
	}
	return nil, fmt.Errorf("unsupported v1.0 DynamicString %#v in %s", raw, caseCtx)
}

func buildV1DynamicBoolean(raw any, caseCtx string) (v1.DynamicBoolean, error) {
	switch val := raw.(type) {
	case bool:
		return v1.Bool(val), nil
	case map[string]any:
		if b, has := val["$bind"]; has && len(val) == 1 {
			p, _ := b.(string)
			return v1.Bind(p), nil
		}
		if _, has := val["call"]; has {
			return buildV1FunctionCall(val, caseCtx)
		}
	}
	return nil, fmt.Errorf("unsupported v1.0 DynamicBoolean %#v in %s", raw, caseCtx)
}

func buildV1DynamicValue(raw any, caseCtx string) (v1.DynamicValue, error) {
	switch val := raw.(type) {
	case string:
		return v1.Str(val), nil
	case int:
		return v1.Int(val), nil
	case float64:
		return v1.Num(val), nil
	case bool:
		return v1.Bool(val), nil
	case []any:
		items := make([]any, 0, len(val))
		for _, elem := range val {
			dv, err := buildV1DynamicValue(elem, caseCtx)
			if err != nil {
				return nil, err
			}
			items = append(items, dv)
		}
		return v1.Arr(items...), nil
	case map[string]any:
		if b, has := val["$bind"]; has && len(val) == 1 {
			p, _ := b.(string)
			return v1.Bind(p), nil
		}
		if _, has := val["call"]; has {
			return buildV1FunctionCall(val, caseCtx)
		}
		obj := make(map[string]any, len(val))
		for k, elem := range val {
			dv, err := buildV1DynamicValue(elem, caseCtx)
			if err != nil {
				return nil, err
			}
			obj[k] = dv
		}
		return v1.Obj(obj), nil
	}
	return nil, fmt.Errorf("unsupported v1.0 DynamicValue %#v in %s", raw, caseCtx)
}

func buildV1FunctionCall(m map[string]any, caseCtx string) (v1.FunctionCall, error) {
	if err := assertKnownKeys(m, knownFunctionCallKeys, "functionCall key", caseCtx); err != nil {
		return v1.FunctionCall{}, err
	}
	callName, _ := m["call"].(string)
	var args map[string]any
	if rawArgs, ok := m["args"].(map[string]any); ok {
		args = make(map[string]any, len(rawArgs))
		for k, v := range rawArgs {
			dv, err := buildV1DynamicValue(v, caseCtx)
			if err != nil {
				return v1.FunctionCall{}, err
			}
			args[k] = dv
		}
	}
	fc := v1.NewFunctionCall(callName, args)
	if cid, ok := m["catalogId"].(string); ok && cid != "" {
		fc = fc.WithCatalogID(cid)
	}
	return fc, nil
}

func buildV1Action(raw any, caseCtx string) (v1.Action, error) {
	outer, ok := raw.(map[string]any)
	if !ok {
		return v1.Action{}, fmt.Errorf("expected $action map in %s", caseCtx)
	}
	actRaw, has := outer["$action"]
	if !has || len(outer) != 1 {
		return v1.Action{}, fmt.Errorf("expected {$action: ...} in %s", caseCtx)
	}
	spec, ok := actRaw.(map[string]any)
	if !ok {
		return v1.Action{}, fmt.Errorf("$action body must be map in %s", caseCtx)
	}
	if err := assertKnownKeys(spec, knownActionKeys, "$action key", caseCtx); err != nil {
		return v1.Action{}, err
	}
	if evRaw, hasEv := spec["event"]; hasEv {
		if evName, isStr := evRaw.(string); isStr {
			return v1.EventAction(evName, nil), nil
		}
		evMap, ok := evRaw.(map[string]any)
		if !ok {
			return v1.Action{}, fmt.Errorf("event body must be string or map in %s", caseCtx)
		}
		if err := assertKnownKeys(evMap, knownActionEventKeys, "event key", caseCtx); err != nil {
			return v1.Action{}, err
		}
		name, _ := evMap["name"].(string)
		ev := v1.ActionEvent{Name: name}
		if umRaw, hasUM := evMap["userMessage"]; hasUM {
			um, err := buildV1DynamicString(umRaw, caseCtx)
			if err != nil {
				return v1.Action{}, err
			}
			ev.UserMessage = um
		}
		if ctxRaw, ok := evMap["context"].(map[string]any); ok {
			ev.Context = make(map[string]v1.DynamicValue, len(ctxRaw))
			for k, v := range ctxRaw {
				dv, err := buildV1DynamicValue(v, caseCtx)
				if err != nil {
					return v1.Action{}, err
				}
				ev.Context[k] = dv
			}
		}
		return v1.Action{Event: &ev}, nil
	}
	fcMap, ok := spec["functionCall"].(map[string]any)
	if !ok {
		return v1.Action{}, fmt.Errorf("functionCall must be map in %s", caseCtx)
	}
	fc, err := buildV1FunctionCall(fcMap, caseCtx)
	if err != nil {
		return v1.Action{}, err
	}
	return v1.FunctionAction(fc), nil
}

func buildV1A11y(raw any, caseCtx string) (*v1.AccessibilityAttributes, error) {
	outer, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("expected $accessibility map in %s", caseCtx)
	}
	specRaw, has := outer["$accessibility"]
	if !has || len(outer) != 1 {
		return nil, fmt.Errorf("expected {$accessibility: ...} in %s", caseCtx)
	}
	spec, ok := specRaw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("$accessibility body must be map in %s", caseCtx)
	}
	if err := assertKnownKeys(spec, knownA11yKeys, "$accessibility key", caseCtx); err != nil {
		return nil, err
	}
	var a v1.AccessibilityAttributes
	if v, has := spec["label"]; has {
		ds, err := buildV1DynamicString(v, caseCtx)
		if err != nil {
			return nil, err
		}
		a.Label = ds
	}
	if v, has := spec["description"]; has {
		ds, err := buildV1DynamicString(v, caseCtx)
		if err != nil {
			return nil, err
		}
		a.Description = ds
	}
	if v, ok := spec["live"].(string); ok {
		a.Live = v1.AccessibilityLive(v)
	}
	if v, has := spec["hidden"]; has {
		db, err := buildV1DynamicBoolean(v, caseCtx)
		if err != nil {
			return nil, err
		}
		a.Hidden = db
	}
	return &a, nil
}

func buildV1Checks(raw any, caseCtx string) ([]v1.CheckRule, error) {
	list, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("checks must be list in %s", caseCtx)
	}
	out := make([]v1.CheckRule, 0, len(list))
	for _, item := range list {
		outer, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("check entry must be map in %s", caseCtx)
		}
		specRaw, has := outer["$checkRule"]
		if !has || len(outer) != 1 {
			return nil, fmt.Errorf("expected {$checkRule: ...} in %s", caseCtx)
		}
		spec, ok := specRaw.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("$checkRule body must be map in %s", caseCtx)
		}
		if err := assertKnownKeys(spec, knownCheckRuleKeys, "$checkRule key", caseCtx); err != nil {
			return nil, err
		}
		condMap, ok := spec["condition"].(map[string]any)
		if !ok {
			return nil, fmt.Errorf("v1.0 check condition must be map in %s", caseCtx)
		}
		var cond v1.CheckCondition
		if b, has := condMap["$bind"]; has && len(condMap) == 1 {
			p, _ := b.(string)
			cond = v1.Bind(p)
		} else {
			fc, err := buildV1FunctionCall(condMap, caseCtx)
			if err != nil {
				return nil, err
			}
			cond = fc
		}
		msg, _ := spec["message"].(string)
		out = append(out, v1.NewCheckRule(cond, msg))
	}
	return out, nil
}

func buildV1CommonNode(m map[string]any, caseCtx string) (v1.ComponentNode, error) {
	var cn v1.ComponentNode
	if id, ok := m["id"].(string); ok {
		cn.ID = id
	}
	if cid, ok := m["catalogId"].(string); ok {
		cn.CatalogID = cid
	}
	if a11yRaw, has := m["accessibility"]; has {
		a, err := buildV1A11y(a11yRaw, caseCtx)
		if err != nil {
			return cn, err
		}
		cn.Accessibility = a
	}
	return cn, nil
}

func buildV1Node(raw any, caseCtx string) (builder.Node, error) {
	m, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("expected component or sentinel map in %s, got %T", caseCtx, raw)
	}
	if refRaw, has := m["$componentRef"]; has && len(m) == 1 {
		refID, _ := refRaw.(string)
		return builder.NewComponentRef(refID), nil
	}
	compName, _ := m["component"].(string)
	cn, err := buildV1CommonNode(m, caseCtx)
	if err != nil {
		return nil, err
	}
	switch compName {
	case "Text":
		txt, err := buildV1DynamicString(m["text"], caseCtx)
		if err != nil {
			return nil, err
		}
		n := &v1.Text{ComponentNode: cn, Text: txt}
		if v, ok := m["variant"].(string); ok {
			n.Variant = v1.TextVariant(v)
		}
		return n, nil
	case "Divider":
		n := &v1.Divider{ComponentNode: cn}
		if v, ok := m["axis"].(string); ok {
			n.Axis = v1.DividerAxis(v)
		}
		return n, nil
	case "Icon":
		var name v1.IconNameValue
		if s, ok := m["name"].(string); ok {
			name = v1.IconName(s)
		} else if nm, ok := m["name"].(map[string]any); ok {
			if b, has := nm["$bind"]; has && len(nm) == 1 {
				p, _ := b.(string)
				name = v1.Bind(p)
			} else if _, has := nm["call"]; has {
				fc, err := buildV1FunctionCall(nm, caseCtx)
				if err != nil {
					return nil, err
				}
				name = fc
			} else if svgRaw, has := nm["svgPath"]; has && len(nm) == 1 {
				ds, err := buildV1DynamicString(svgRaw, caseCtx)
				if err != nil {
					return nil, err
				}
				name = v1.NewIconNameSVGPath(ds)
			} else {
				return nil, fmt.Errorf("unsupported v1.0 Icon.name %#v in %s", m["name"], caseCtx)
			}
		} else {
			return nil, fmt.Errorf("unsupported v1.0 Icon.name %#v in %s", m["name"], caseCtx)
		}
		return &v1.Icon{ComponentNode: cn, Name: name}, nil
	case "Card":
		ch, err := buildV1Node(m["child"], caseCtx)
		if err != nil {
			return nil, err
		}
		return &v1.Card{ComponentNode: cn, Child: ch}, nil
	case "Row":
		cl, err := buildV1ChildList(m["children"], caseCtx)
		if err != nil {
			return nil, err
		}
		n := &v1.Row{ComponentNode: cn, Children: cl}
		if v, ok := m["justify"].(string); ok {
			n.Justify = v1.FlexJustify(v)
		}
		if v, ok := m["align"].(string); ok {
			n.Align = v1.FlexAlign(v)
		}
		return n, nil
	case "Column":
		cl, err := buildV1ChildList(m["children"], caseCtx)
		if err != nil {
			return nil, err
		}
		n := &v1.Column{ComponentNode: cn, Children: cl}
		if v, ok := m["justify"].(string); ok {
			n.Justify = v1.FlexJustify(v)
		}
		if v, ok := m["align"].(string); ok {
			n.Align = v1.FlexAlign(v)
		}
		return n, nil
	case "List":
		cl, err := buildV1ChildList(m["children"], caseCtx)
		if err != nil {
			return nil, err
		}
		n := &v1.List{ComponentNode: cn, Children: cl}
		if v, ok := m["direction"].(string); ok {
			n.Direction = v1.ListDirection(v)
		}
		if v, ok := m["align"].(string); ok {
			n.Align = v1.ListAlign(v)
		}
		return n, nil
	case "Button":
		ch, err := buildV1Node(m["child"], caseCtx)
		if err != nil {
			return nil, err
		}
		act, err := buildV1Action(m["action"], caseCtx)
		if err != nil {
			return nil, err
		}
		n := &v1.Button{ComponentNode: cn, Child: ch, Action: act}
		if v, ok := m["variant"].(string); ok {
			n.Variant = v1.ButtonVariant(v)
		}
		if chkRaw, has := m["checks"]; has {
			chks, err := buildV1Checks(chkRaw, caseCtx)
			if err != nil {
				return nil, err
			}
			n.Checks = chks
		}
		return n, nil
	case "TextField":
		lbl, err := buildV1DynamicString(m["label"], caseCtx)
		if err != nil {
			return nil, err
		}
		val, err := buildV1DynamicString(m["value"], caseCtx)
		if err != nil {
			return nil, err
		}
		n := &v1.TextField{ComponentNode: cn, Label: lbl, Value: val}
		if phRaw, has := m["placeholder"]; has {
			ph, err := buildV1DynamicString(phRaw, caseCtx)
			if err != nil {
				return nil, err
			}
			n.Placeholder = ph
		}
		if v, ok := m["variant"].(string); ok {
			n.Variant = v1.TextFieldVariant(v)
		}
		if chkRaw, has := m["checks"]; has {
			chks, err := buildV1Checks(chkRaw, caseCtx)
			if err != nil {
				return nil, err
			}
			n.Checks = chks
		}
		return n, nil
	default:
		return nil, fmt.Errorf("unsupported v1.0 builder conformance component %q in %s", compName, caseCtx)
	}
}

// --- v0.9 AST construction ---

func buildV09NodeList(raw any, caseCtx string) ([]builder.Node, error) {
	list, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("expected component list in %s, got %T", caseCtx, raw)
	}
	out := make([]builder.Node, 0, len(list))
	for _, item := range list {
		n, err := buildV09Node(item, caseCtx)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, nil
}

func buildV09ChildList(raw any, caseCtx string) (v09.ChildList, error) {
	if m, ok := raw.(map[string]any); ok {
		if dclRaw, has := m["$dynamicChildList"]; has && len(m) == 1 {
			spec, ok := dclRaw.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("$dynamicChildList must be map in %s", caseCtx)
			}
			if err := assertKnownKeys(spec, knownDCLKeys, "$dynamicChildList key", caseCtx); err != nil {
				return nil, err
			}
			path, _ := spec["path"].(string)
			tmpl, err := buildV09Node(spec["template"], caseCtx)
			if err != nil {
				return nil, err
			}
			return v09.NewDynamicChildList(path, tmpl), nil
		}
	}
	nodes, err := buildV09NodeList(raw, caseCtx)
	if err != nil {
		return nil, err
	}
	return v09.Children(nodes...), nil
}

func buildV09DynamicString(raw any, caseCtx string) (v09.DynamicString, error) {
	switch val := raw.(type) {
	case string:
		return v09.Str(val), nil
	case map[string]any:
		if b, has := val["$bind"]; has && len(val) == 1 {
			p, _ := b.(string)
			return v09.Bind(p), nil
		}
		if _, has := val["call"]; has {
			return buildV09FunctionCall(val, caseCtx)
		}
	}
	return nil, fmt.Errorf("unsupported v0.9 DynamicString %#v in %s", raw, caseCtx)
}

func buildV09DynamicBoolean(raw any, caseCtx string) (v09.DynamicBoolean, error) {
	switch val := raw.(type) {
	case bool:
		return v09.Bool(val), nil
	case map[string]any:
		if b, has := val["$bind"]; has && len(val) == 1 {
			p, _ := b.(string)
			return v09.Bind(p), nil
		}
		if _, has := val["call"]; has {
			return buildV09FunctionCall(val, caseCtx)
		}
	}
	return nil, fmt.Errorf("unsupported v0.9 DynamicBoolean %#v in %s", raw, caseCtx)
}

func buildV09DynamicValue(raw any, caseCtx string) (v09.DynamicValue, error) {
	switch val := raw.(type) {
	case string:
		return v09.Str(val), nil
	case int:
		return v09.Int(val), nil
	case float64:
		return v09.Num(val), nil
	case bool:
		return v09.Bool(val), nil
	case []any:
		items := make([]any, 0, len(val))
		for _, elem := range val {
			dv, err := buildV09DynamicValue(elem, caseCtx)
			if err != nil {
				return nil, err
			}
			items = append(items, dv)
		}
		return v09.Arr(items...), nil
	case map[string]any:
		if b, has := val["$bind"]; has && len(val) == 1 {
			p, _ := b.(string)
			return v09.Bind(p), nil
		}
		if _, has := val["call"]; has {
			return buildV09FunctionCall(val, caseCtx)
		}
	}
	return nil, fmt.Errorf("unsupported v0.9 DynamicValue %#v in %s", raw, caseCtx)
}

func buildV09FunctionCall(m map[string]any, caseCtx string) (v09.FunctionCall, error) {
	if err := assertKnownKeys(m, knownFunctionCallKeys, "functionCall key", caseCtx); err != nil {
		return v09.FunctionCall{}, err
	}
	callName, _ := m["call"].(string)
	var args map[string]any
	if rawArgs, ok := m["args"].(map[string]any); ok {
		args = make(map[string]any, len(rawArgs))
		for k, v := range rawArgs {
			dv, err := buildV09DynamicValue(v, caseCtx)
			if err != nil {
				return v09.FunctionCall{}, err
			}
			args[k] = dv
		}
	}
	fc := v09.NewFunctionCall(callName, args)
	if rt, ok := m["returnType"].(string); ok && rt != "" {
		fc = fc.WithReturnType(rt)
	}
	return fc, nil
}

func buildV09Action(raw any, caseCtx string) (v09.Action, error) {
	outer, ok := raw.(map[string]any)
	if !ok {
		return v09.Action{}, fmt.Errorf("expected $action map in %s", caseCtx)
	}
	actRaw, has := outer["$action"]
	if !has || len(outer) != 1 {
		return v09.Action{}, fmt.Errorf("expected {$action: ...} in %s", caseCtx)
	}
	spec, ok := actRaw.(map[string]any)
	if !ok {
		return v09.Action{}, fmt.Errorf("$action body must be map in %s", caseCtx)
	}
	if err := assertKnownKeys(spec, knownActionKeys, "$action key", caseCtx); err != nil {
		return v09.Action{}, err
	}
	if evRaw, hasEv := spec["event"]; hasEv {
		if evName, isStr := evRaw.(string); isStr {
			return v09.EventAction(evName, nil), nil
		}
		evMap, ok := evRaw.(map[string]any)
		if !ok {
			return v09.Action{}, fmt.Errorf("event body must be string or map in %s", caseCtx)
		}
		if err := assertKnownKeys(evMap, knownActionEventKeys, "event key", caseCtx); err != nil {
			return v09.Action{}, err
		}
		name, _ := evMap["name"].(string)
		ev := v09.ActionEvent{Name: name}
		if ctxRaw, ok := evMap["context"].(map[string]any); ok {
			ev.Context = make(map[string]v09.DynamicValue, len(ctxRaw))
			for k, v := range ctxRaw {
				dv, err := buildV09DynamicValue(v, caseCtx)
				if err != nil {
					return v09.Action{}, err
				}
				ev.Context[k] = dv
			}
		}
		return v09.Action{Event: &ev}, nil
	}
	fcMap, ok := spec["functionCall"].(map[string]any)
	if !ok {
		return v09.Action{}, fmt.Errorf("functionCall must be map in %s", caseCtx)
	}
	fc, err := buildV09FunctionCall(fcMap, caseCtx)
	if err != nil {
		return v09.Action{}, err
	}
	return v09.FunctionAction(fc), nil
}

func buildV09A11y(raw any, caseCtx string) (*v09.AccessibilityAttributes, error) {
	outer, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("expected $accessibility map in %s", caseCtx)
	}
	specRaw, has := outer["$accessibility"]
	if !has || len(outer) != 1 {
		return nil, fmt.Errorf("expected {$accessibility: ...} in %s", caseCtx)
	}
	spec, ok := specRaw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("$accessibility body must be map in %s", caseCtx)
	}
	if err := assertKnownKeys(spec, knownA11yKeys, "$accessibility key", caseCtx); err != nil {
		return nil, err
	}
	var a v09.AccessibilityAttributes
	if v, has := spec["label"]; has {
		ds, err := buildV09DynamicString(v, caseCtx)
		if err != nil {
			return nil, err
		}
		a.Label = ds
	}
	if v, has := spec["description"]; has {
		ds, err := buildV09DynamicString(v, caseCtx)
		if err != nil {
			return nil, err
		}
		a.Description = ds
	}
	return &a, nil
}

func buildV09Checks(raw any, caseCtx string) ([]v09.CheckRule, error) {
	list, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("checks must be list in %s", caseCtx)
	}
	out := make([]v09.CheckRule, 0, len(list))
	for _, item := range list {
		outer, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("check entry must be map in %s", caseCtx)
		}
		specRaw, has := outer["$checkRule"]
		if !has || len(outer) != 1 {
			return nil, fmt.Errorf("expected {$checkRule: ...} in %s", caseCtx)
		}
		spec, ok := specRaw.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("$checkRule body must be map in %s", caseCtx)
		}
		if err := assertKnownKeys(spec, knownCheckRuleKeys, "$checkRule key", caseCtx); err != nil {
			return nil, err
		}
		cond, err := buildV09DynamicBoolean(spec["condition"], caseCtx)
		if err != nil {
			return nil, err
		}
		msg, _ := spec["message"].(string)
		out = append(out, v09.NewCheckRule(cond, msg))
	}
	return out, nil
}

func buildV09CommonNode(m map[string]any, caseCtx string) (v09.ComponentNode, error) {
	var cn v09.ComponentNode
	if id, ok := m["id"].(string); ok {
		cn.ID = id
	}
	if a11yRaw, has := m["accessibility"]; has {
		a, err := buildV09A11y(a11yRaw, caseCtx)
		if err != nil {
			return cn, err
		}
		cn.Accessibility = a
	}
	return cn, nil
}

func buildV09Node(raw any, caseCtx string) (builder.Node, error) {
	m, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("expected component or sentinel map in %s, got %T", caseCtx, raw)
	}
	if refRaw, has := m["$componentRef"]; has && len(m) == 1 {
		refID, _ := refRaw.(string)
		return builder.NewComponentRef(refID), nil
	}
	compName, _ := m["component"].(string)
	cn, err := buildV09CommonNode(m, caseCtx)
	if err != nil {
		return nil, err
	}
	switch compName {
	case "Text":
		txt, err := buildV09DynamicString(m["text"], caseCtx)
		if err != nil {
			return nil, err
		}
		n := &v09.Text{ComponentNode: cn, Text: txt}
		if v, ok := m["variant"].(string); ok {
			n.Variant = v09.TextVariant(v)
		}
		return n, nil
	case "Divider":
		n := &v09.Divider{ComponentNode: cn}
		if v, ok := m["axis"].(string); ok {
			n.Axis = v09.DividerAxis(v)
		}
		return n, nil
	case "Icon":
		var name v09.IconNameValue
		if s, ok := m["name"].(string); ok {
			name = v09.IconName(s)
		} else if nm, ok := m["name"].(map[string]any); ok {
			if b, has := nm["$bind"]; has && len(nm) == 1 {
				p, _ := b.(string)
				name = v09.Bind(p)
			} else if _, has := nm["call"]; has {
				fc, err := buildV09FunctionCall(nm, caseCtx)
				if err != nil {
					return nil, err
				}
				name = fc
			} else if svg, ok := nm["svgPath"].(string); ok && len(nm) == 1 {
				name = v09.NewIconNameSVGPath(svg)
			} else {
				return nil, fmt.Errorf("unsupported v0.9 Icon.name %#v in %s", m["name"], caseCtx)
			}
		} else {
			return nil, fmt.Errorf("unsupported v0.9 Icon.name %#v in %s", m["name"], caseCtx)
		}
		return &v09.Icon{ComponentNode: cn, Name: name}, nil
	case "Card":
		ch, err := buildV09Node(m["child"], caseCtx)
		if err != nil {
			return nil, err
		}
		return &v09.Card{ComponentNode: cn, Child: ch}, nil
	case "Row":
		cl, err := buildV09ChildList(m["children"], caseCtx)
		if err != nil {
			return nil, err
		}
		n := &v09.Row{ComponentNode: cn, Children: cl}
		if v, ok := m["justify"].(string); ok {
			n.Justify = v09.FlexJustify(v)
		}
		if v, ok := m["align"].(string); ok {
			n.Align = v09.FlexAlign(v)
		}
		return n, nil
	case "Column":
		cl, err := buildV09ChildList(m["children"], caseCtx)
		if err != nil {
			return nil, err
		}
		n := &v09.Column{ComponentNode: cn, Children: cl}
		if v, ok := m["justify"].(string); ok {
			n.Justify = v09.FlexJustify(v)
		}
		if v, ok := m["align"].(string); ok {
			n.Align = v09.FlexAlign(v)
		}
		return n, nil
	case "List":
		cl, err := buildV09ChildList(m["children"], caseCtx)
		if err != nil {
			return nil, err
		}
		n := &v09.List{ComponentNode: cn, Children: cl}
		if v, ok := m["direction"].(string); ok {
			n.Direction = v09.ListDirection(v)
		}
		if v, ok := m["align"].(string); ok {
			n.Align = v09.ListAlign(v)
		}
		return n, nil
	case "Button":
		ch, err := buildV09Node(m["child"], caseCtx)
		if err != nil {
			return nil, err
		}
		act, err := buildV09Action(m["action"], caseCtx)
		if err != nil {
			return nil, err
		}
		n := &v09.Button{ComponentNode: cn, Child: ch, Action: act}
		if v, ok := m["variant"].(string); ok {
			n.Variant = v09.ButtonVariant(v)
		}
		if chkRaw, has := m["checks"]; has {
			chks, err := buildV09Checks(chkRaw, caseCtx)
			if err != nil {
				return nil, err
			}
			n.Checks = chks
		}
		return n, nil
	case "TextField":
		lbl, err := buildV09DynamicString(m["label"], caseCtx)
		if err != nil {
			return nil, err
		}
		n := &v09.TextField{ComponentNode: cn, Label: lbl}
		if valRaw, has := m["value"]; has {
			val, err := buildV09DynamicString(valRaw, caseCtx)
			if err != nil {
				return nil, err
			}
			n.Value = val
		}
		if v, ok := m["variant"].(string); ok {
			n.Variant = v09.TextFieldVariant(v)
		}
		if re, ok := m["validationRegexp"].(string); ok {
			n.ValidationRegexp = &re
		}
		if chkRaw, has := m["checks"]; has {
			chks, err := buildV09Checks(chkRaw, caseCtx)
			if err != nil {
				return nil, err
			}
			n.Checks = chks
		}
		return n, nil
	default:
		return nil, fmt.Errorf("unsupported v0.9 builder conformance component %q in %s", compName, caseCtx)
	}
}

func runBuilderCase(bc builderCase) ([]core.AgentToRendererMessage, error) {
	caseCtx := fmt.Sprintf("%s#%s", builderSuiteRelPath, bc.ID)
	isV1 := bc.Version == "v1.0" || bc.Version == "1.0"

	var components []map[string]any
	if _, isList := bc.Input.([]any); isList {
		var roots []builder.Node
		var err error
		if isV1 {
			roots, err = buildV1NodeList(bc.Input, caseCtx)
		} else {
			roots, err = buildV09NodeList(bc.Input, caseCtx)
		}
		if err != nil {
			return nil, err
		}
		components, err = builder.FlattenComponentForest(roots, bc.RootID)
		if err != nil {
			return nil, err
		}
	} else {
		var root builder.Node
		var err error
		if isV1 {
			root, err = buildV1Node(bc.Input, caseCtx)
		} else {
			root, err = buildV09Node(bc.Input, caseCtx)
		}
		if err != nil {
			return nil, err
		}
		components, err = builder.FlattenComponentTree(root, bc.RootID)
		if err != nil {
			return nil, err
		}
	}

	if isV1 {
		if bc.CatalogID != "" {
			create, err := v1.CreateSurface(v1.CreateSurfaceOptions{SurfaceID: bc.SurfaceID, CatalogID: bc.CatalogID})
			if err != nil {
				return nil, err
			}
			msgs := []core.AgentToRendererMessage{create, v1.UpdateComponents(bc.SurfaceID, components)}
			for _, dm := range bc.DataModel {
				msgs = append(msgs, v1.UpdateDataModel(bc.SurfaceID, dm.Path, dm.Value))
			}
			return msgs, nil
		}
		return []core.AgentToRendererMessage{
			v1.UpdateComponents(bc.SurfaceID, components),
		}, nil
	}

	if bc.CatalogID != "" {
		create, err := v09.CreateSurface(v09.CreateSurfaceOptions{SurfaceID: bc.SurfaceID, CatalogID: bc.CatalogID})
		if err != nil {
			return nil, err
		}
		msgs := []core.AgentToRendererMessage{create, v09.UpdateComponents(bc.SurfaceID, components)}
		for _, dm := range bc.DataModel {
			msgs = append(msgs, v09.UpdateDataModel(bc.SurfaceID, dm.Path, dm.Value))
		}
		return msgs, nil
	}
	return []core.AgentToRendererMessage{
		v09.UpdateComponents(bc.SurfaceID, components),
	}, nil
}

func normalizeViaJSON(v any) (any, error) {
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

func validateBuilderPayload(payload []core.AgentToRendererMessage, bc builderCase) error {
	protoVer := core.Version0_9_1
	if bc.Version == "v1.0" || bc.Version == "1.0" {
		protoVer = core.Version1_0
	}
	cat, err := core.BasicCatalog(protoVer)
	if err != nil {
		return fmt.Errorf("BasicCatalog(%s): %w", protoVer, err)
	}
	cfg := bc.Validation.toConfig()
	proc, err := core.NewMessageProcessor([]*core.Catalog{cat}, &core.MessageProcessorOptions{
		ValidationConfig: &cfg,
	})
	if err != nil {
		return fmt.Errorf("NewMessageProcessor: %w", err)
	}
	hasCreate := false
	for _, msg := range payload {
		if _, ok := msg["createSurface"]; ok {
			hasCreate = true
			break
		}
	}
	if !hasCreate {
		proc.Model.AddSurface(core.NewSurfaceModel(bc.SurfaceID, cat.CatalogID(), cat))
	}
	return proc.ProcessMessages(payload, &core.ExecutionContext{ValidationConfig: &cfg})
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
	for _, rec := range records {
		if err := enc.Encode(rec); err != nil {
			t.Fatalf("failed encoding manifest record: %v", err)
		}
	}
}

func TestBuilderConformance(t *testing.T) {
	confRoot := findConformanceRoot(t)
	builderDir := filepath.Join(confRoot, "agent", "builder")
	goldenDir := filepath.Join(builderDir, "golden")
	suitePath := filepath.Join(builderDir, "builder.yaml")

	cases := loadBuilderCases(t, suitePath)
	if len(cases) == 0 {
		t.Fatal("expected non-empty builder conformance cases")
	}

	records := make([]manifestRecord, 0, len(cases))
	for _, bc := range cases {
		status := "passed"
		ok := t.Run(bc.ID, func(t *testing.T) {
			actualMsgs, err := runBuilderCase(bc)
			if err != nil {
				t.Fatalf("runBuilderCase(%s) failed: %v", bc.ID, err)
			}
			actualNorm, err := normalizeViaJSON(actualMsgs)
			if err != nil {
				t.Fatalf("normalizeViaJSON failed: %v", err)
			}

			goldenPath := filepath.Join(goldenDir, filepath.FromSlash(bc.Golden))
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
				t.Fatalf("%s mismatch:\ngot:\n%s\nwant:\n%s", bc.Description, gotJSON, wantJSON)
			}

			if err := validateBuilderPayload(actualMsgs, bc); err != nil {
				t.Fatalf("validateBuilderPayload(%s) failed: %v", bc.ID, err)
			}
		})
		if !ok {
			status = "failed"
		}
		records = append(records, manifestRecord{
			Harness: "go-agent",
			Suite:   builderSuiteRelPath,
			Case:    bc.ID,
			Status:  status,
		})
	}

	writeManifestRecords(t, "go-agent-builder.jsonl", records)

	t.Run("SuiteCoversEveryGolden", func(t *testing.T) {
		declared := make(map[string]bool, len(cases))
		for _, bc := range cases {
			declared[bc.Golden] = true
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
		if !reflect.DeepEqual(onDisk, declared) {
			t.Fatalf("golden files mismatch: onDisk=%v declared=%v", onDisk, declared)
		}
	})
}
