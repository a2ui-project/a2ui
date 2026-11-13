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

package adk_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"iter"
	"maps"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/a2aproject/a2a-go/a2a"
	adkagent "google.golang.org/adk/v2/agent"
	"google.golang.org/adk/v2/memory"
	"google.golang.org/adk/v2/session"
	"google.golang.org/adk/v2/tool/toolconfirmation"
	"google.golang.org/genai"
	"gopkg.in/yaml.v3"

	"github.com/a2ui-project/a2ui/go/a2aext"
	"github.com/a2ui-project/a2ui/go/adk"
	"github.com/a2ui-project/a2ui/go/agent"
	"github.com/a2ui-project/a2ui/go/core"
)

const (
	adkHarnessID = "go-adk"
	adkSuitePath = "extensions/adk/adk_extensions.yaml"
)

var (
	adkUnsupported      = map[string]string{}
	adkExpectedFailures = map[string]string{}

	adkSubagentArgKeys = map[string]bool{
		"subagent": true, "surfaceId": true, "state": true, "message": true,
	}
	adkConverterArgKeys = map[string]bool{
		"errorCode": true, "errorMessage": true, "contentText": true, "hasCatalog": true,
	}

	adkKnownKeys = map[string]map[string]bool{
		"execute_tool.case": {
			"name": true, "description": true, "features": true,
			"action": true, "args": true, "expect": true,
		},
		"execute_tool.args":   {"a2uiJson": true, "wrongArg": true},
		"execute_tool.expect": {"success": true, "containsValidatedJson": true, "errorContains": true},
		"convert_event.subagent_case": {
			"name": true, "description": true, "features": true,
			"action": true, "args": true, "expect": true, "expectError": true,
		},
		"convert_event.subagent_args":   adkSubagentArgKeys,
		"convert_event.subagent_expect": {"stateDelta": true},
		"convert_event.expect_error":    {"category": true, "message": true},
		"convert_event.converter_case": {
			"name": true, "description": true, "features": true,
			"action": true, "args": true, "expect": true, "expectEmpty": true,
		},
		"convert_event.converter_args":   adkConverterArgKeys,
		"convert_event.converter_expect": {"type": true, "state": true, "message": true},
		"data_model.case": {
			"name": true, "description": true, "features": true,
			"action": true, "args": true, "expect": true,
		},
		"data_model.args":   {"subagent": true, "state": true, "clientDataModel": true},
		"data_model.expect": {"clientDataModel": true},
	}

	adkManifestMu   sync.Mutex
	adkManifestOnce sync.Once
)

type adkManifestRecord struct {
	Harness string `json:"harness"`
	Suite   string `json:"suite"`
	Case    string `json:"case"`
	Status  string `json:"status"`
	Reason  string `json:"reason,omitempty"`
}

type adkUnknownKeyError struct {
	msg string
}

func (e *adkUnknownKeyError) Error() string { return e.msg }

type fakeState struct {
	data map[string]any
}

func newFakeState(initial map[string]any) *fakeState {
	cloned := make(map[string]any, len(initial))
	maps.Copy(cloned, initial)
	return &fakeState{data: cloned}
}

func (s *fakeState) Get(key string) (any, error) {
	val, ok := s.data[key]
	if !ok {
		return nil, session.ErrStateKeyNotExist
	}
	return val, nil
}

func (s *fakeState) Set(key string, val any) error {
	s.data[key] = val
	return nil
}

func (s *fakeState) All() iter.Seq2[string, any] {
	return func(yield func(string, any) bool) {
		for k, v := range s.data {
			if !yield(k, v) {
				return
			}
		}
	}
}

type fakeSession struct {
	id    string
	state *fakeState
}

func (s *fakeSession) ID() string                { return s.id }
func (s *fakeSession) AppName() string           { return "test-app" }
func (s *fakeSession) UserID() string            { return "test-user" }
func (s *fakeSession) State() session.State      { return s.state }
func (s *fakeSession) Events() session.Events    { return nil }
func (s *fakeSession) LastUpdateTime() time.Time { return time.Time{} }

type fakeSessionService struct {
	appended []*session.Event
}

func (s *fakeSessionService) Create(context.Context, *session.CreateRequest) (*session.CreateResponse, error) {
	return nil, nil
}
func (s *fakeSessionService) Get(context.Context, *session.GetRequest) (*session.GetResponse, error) {
	return nil, nil
}
func (s *fakeSessionService) List(context.Context, *session.ListRequest) (*session.ListResponse, error) {
	return nil, nil
}
func (s *fakeSessionService) Delete(context.Context, *session.DeleteRequest) error {
	return nil
}
func (s *fakeSessionService) AppendEvent(_ context.Context, sess session.Session, ev *session.Event) error {
	s.appended = append(s.appended, ev)
	if sess != nil && ev != nil {
		for k, v := range ev.Actions.StateDelta {
			_ = sess.State().Set(k, v)
		}
	}
	return nil
}

type fakeToolContext struct {
	// StrictContextMock implements the rest of adkagent.Context and panics on
	// any method a test calls without overriding it.
	adkagent.StrictContextMock
	sessionID   string
	invID       string
	branch      string
	agentName   string
	userContent *genai.Content
	state       *fakeState
	actions     *session.EventActions
}

func newFakeToolContext(sessionID string, state map[string]any) *fakeToolContext {
	return &fakeToolContext{
		StrictContextMock: adkagent.StrictContextMock{Ctx: context.Background()},
		sessionID:         sessionID,
		invID:             "inv-1",
		agentName:         "agent",
		state:             newFakeState(state),
		actions:           &session.EventActions{StateDelta: map[string]any{}},
	}
}

func (c *fakeToolContext) UserContent() *genai.Content          { return c.userContent }
func (c *fakeToolContext) InvocationID() string                 { return c.invID }
func (c *fakeToolContext) AgentName() string                    { return c.agentName }
func (c *fakeToolContext) ReadonlyState() session.ReadonlyState { return c.state }
func (c *fakeToolContext) UserID() string                       { return "user-1" }
func (c *fakeToolContext) AppName() string                      { return "app-1" }
func (c *fakeToolContext) SessionID() string                    { return c.sessionID }
func (c *fakeToolContext) Branch() string                       { return c.branch }
func (c *fakeToolContext) Artifacts() adkagent.Artifacts        { return nil }
func (c *fakeToolContext) State() session.State                 { return c.state }
func (c *fakeToolContext) FunctionCallID() string               { return "fc-1" }
func (c *fakeToolContext) Actions() *session.EventActions       { return c.actions }
func (c *fakeToolContext) SearchMemory(context.Context, string) (*memory.SearchResponse, error) {
	return nil, nil
}
func (c *fakeToolContext) ToolConfirmation() *toolconfirmation.ToolConfirmation { return nil }
func (c *fakeToolContext) RequestConfirmation(string, any) error                { return nil }

func locateADKConformanceRoot(t *testing.T) string {
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

func loadADKConformanceCases(t *testing.T) []map[string]any {
	t.Helper()
	fullPath := filepath.Join(locateADKConformanceRoot(t), filepath.FromSlash(adkSuitePath))
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

func appendADKManifest(caseName, status, reason string) error {
	dir := os.Getenv("A2UI_CONFORMANCE_MANIFEST_DIR")
	if dir == "" {
		return nil
	}
	adkManifestMu.Lock()
	defer adkManifestMu.Unlock()

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, adkHarnessID+".jsonl")
	var initErr error
	adkManifestOnce.Do(func() {
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

	rec := adkManifestRecord{
		Harness: adkHarnessID,
		Suite:   adkSuitePath,
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

func assertADKKnownKeys(obj map[string]any, allowed map[string]bool, where, caseKey string) error {
	for k := range obj {
		if !allowed[k] {
			return &adkUnknownKeyError{msg: fmt.Sprintf("Unknown %s '%s' in %s", where, k, caseKey)}
		}
	}
	return nil
}

func adkHasNestedKeyPath(obj map[string]any, dotted string) bool {
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

func findADKUnsupportedReason(tc map[string]any) (string, bool) {
	name, _ := tc["name"].(string)
	caseKey := adkSuitePath + "#" + name
	if r, ok := adkUnsupported[caseKey]; ok {
		return r, true
	}
	action, _ := tc["action"].(string)
	if r, ok := adkUnsupported[action]; ok {
		return r, true
	}
	prefix := action + "."
	for k, r := range adkUnsupported {
		if strings.HasPrefix(k, prefix) && adkHasNestedKeyPath(tc, strings.TrimPrefix(k, prefix)) {
			return r, true
		}
	}
	return "", false
}

func adkAsMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func adkNormalizeJSON(v any) any {
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

func runExecuteToolCase(tc map[string]any, caseKey string) error {
	if err := assertADKKnownKeys(tc, adkKnownKeys["execute_tool.case"], "case key", caseKey); err != nil {
		return err
	}
	args := adkAsMap(tc["args"])
	expect := adkAsMap(tc["expect"])
	if err := assertADKKnownKeys(args, adkKnownKeys["execute_tool.args"], "args key", caseKey); err != nil {
		return err
	}
	if err := assertADKKnownKeys(expect, adkKnownKeys["execute_tool.expect"], "expect key", caseKey); err != nil {
		return err
	}

	var toolArgs map[string]any
	if a2uiJSON, ok := args["a2uiJson"].(string); ok {
		toolArgs = map[string]any{adk.A2UIPayloadArgName: a2uiJSON}
	} else {
		toolArgs = args
	}

	cat, err := core.BasicCatalog(core.Version0_8)
	if err != nil {
		return err
	}
	proc, err := agent.NewRequestProcessor([]*core.Catalog{cat}, &agent.RequestProcessorOptions{
		FormatFactory: agent.NewDirectJSONFormatFactory(nil),
	})
	if err != nil {
		return err
	}
	toolset := adk.NewSendA2UIToClientToolset(adk.ToolsetConfig{
		ProcessorProvider: func(adkagent.ReadonlyContext) (*agent.RequestProcessor, error) {
			return proc, nil
		},
	})
	// Like the Python harness, which patches validate_payload, this case checks the
	// tool's wiring rather than the payload's schema validity.
	adk.SetToolPayloadValidator(toolset.Tool(), func([]*core.Catalog, []core.AgentToRendererMessage) error {
		return nil
	})

	tctx := newFakeToolContext("session-1", nil)
	res, err := toolset.Tool().Run(tctx, toolArgs)
	if err != nil {
		return err
	}

	expectSuccess, ok := expect["success"].(bool)
	if !ok {
		return fmt.Errorf("expected bool expect.success, got %T", expect["success"])
	}
	if expectSuccess {
		if _, hasErr := res[adk.A2UIToolErrorKey]; hasErr {
			return fmt.Errorf("unexpected tool error: %v", res[adk.A2UIToolErrorKey])
		}
		validated, hasVal := res[adk.ValidatedA2UIJSONKey]
		if !hasVal {
			return fmt.Errorf("missing %q in result: %#v", adk.ValidatedA2UIJSONKey, res)
		}
		if contains, _ := expect["containsValidatedJson"].(bool); contains {
			encoded, _ := json.Marshal(validated)
			if !strings.Contains(string(encoded), "beginRendering") {
				return fmt.Errorf("expected beginRendering in %s", string(encoded))
			}
		}
		return nil
	}

	errMsg, hasErr := res[adk.A2UIToolErrorKey].(string)
	if !hasErr {
		return fmt.Errorf("expected error in result, got %#v", res)
	}
	if substr, ok := expect["errorContains"].(string); ok && substr != "" {
		if !strings.Contains(errMsg, substr) {
			return fmt.Errorf("error %q does not contain %q", errMsg, substr)
		}
	}
	return nil
}

func runSubagentEventCase(tc map[string]any, caseKey string) error {
	if err := assertADKKnownKeys(tc, adkKnownKeys["convert_event.subagent_case"], "case key", caseKey); err != nil {
		return err
	}
	args := adkAsMap(tc["args"])
	if err := assertADKKnownKeys(args, adkKnownKeys["convert_event.subagent_args"], "args key", caseKey); err != nil {
		return err
	}
	subagent, _ := args["subagent"].(string)
	initialState := adkAsMap(args["state"])
	message := adkAsMap(args["message"])
	part := a2aext.CreateA2UIPart(message, "")

	svc := &fakeSessionService{}
	sess := &fakeSession{id: "session-1", state: newFakeState(initialState)}
	if rawExpectErr, hasExpectErr := tc["expectError"]; hasExpectErr && rawExpectErr != nil {
		var wantCategory, wantSubstr string
		if errMap, ok := rawExpectErr.(map[string]any); ok {
			if err := assertADKKnownKeys(errMap, adkKnownKeys["convert_event.expect_error"], "expectError key", caseKey); err != nil {
				return err
			}
			wantCategory, _ = errMap["category"].(string)
			wantSubstr, _ = errMap["message"].(string)
		} else {
			wantSubstr = fmt.Sprintf("%v", rawExpectErr)
		}

		err := adk.UpdateSurfaceOwnership(context.Background(), svc, sess, part, subagent)
		if err == nil {
			return fmt.Errorf("expected SurfaceIDAlreadyExistsError, got nil")
		}
		var existsErr *adk.SurfaceIDAlreadyExistsError
		if !errors.As(err, &existsErr) {
			return fmt.Errorf("expected *SurfaceIDAlreadyExistsError, got %T (%v)", err, err)
		}
		if wantCategory != "" && string(existsErr.ErrorCategory()) != wantCategory {
			return fmt.Errorf("ErrorCategory = %q, want %q", existsErr.ErrorCategory(), wantCategory)
		}
		if wantSubstr != "" && !strings.Contains(err.Error(), wantSubstr) {
			return fmt.Errorf("error %q does not contain %q", err.Error(), wantSubstr)
		}
		return nil
	}

	if err := adk.UpdateSurfaceOwnership(context.Background(), svc, sess, part, subagent); err != nil {
		return fmt.Errorf("unexpected error: %v", err)
	}
	expect := adkAsMap(tc["expect"])
	if err := assertADKKnownKeys(expect, adkKnownKeys["convert_event.subagent_expect"], "expect key", caseKey); err != nil {
		return err
	}
	if len(svc.appended) != 1 {
		return fmt.Errorf("expected 1 appended event, got %d", len(svc.appended))
	}
	gotDelta := svc.appended[0].Actions.StateDelta
	wantDelta := adkAsMap(expect["stateDelta"])
	if !reflect.DeepEqual(adkNormalizeJSON(gotDelta), adkNormalizeJSON(wantDelta)) {
		return fmt.Errorf("stateDelta = %#v, want %#v", gotDelta, wantDelta)
	}
	return nil
}

func runConverterEventCase(tc map[string]any, caseKey string) error {
	if err := assertADKKnownKeys(tc, adkKnownKeys["convert_event.converter_case"], "case key", caseKey); err != nil {
		return err
	}
	args := adkAsMap(tc["args"])
	if err := assertADKKnownKeys(args, adkKnownKeys["convert_event.converter_args"], "args key", caseKey); err != nil {
		return err
	}

	ev := &session.Event{
		Author: "agent",
	}
	ev.ErrorCode, _ = args["errorCode"].(string)
	ev.ErrorMessage, _ = args["errorMessage"].(string)
	if text, hasText := args["contentText"].(string); hasText {
		ev.Content = &genai.Content{
			Role:  genai.RoleModel,
			Parts: []*genai.Part{genai.NewPartFromText(text)},
		}
	}

	var proc *agent.RequestProcessor
	if hasCat, _ := args["hasCatalog"].(bool); hasCat {
		cat, err := core.BasicCatalog(core.Version0_8)
		if err != nil {
			return err
		}
		proc, err = agent.NewRequestProcessor([]*core.Catalog{cat}, &agent.RequestProcessorOptions{
			FormatFactory: agent.NewDirectJSONFormatFactory(nil),
		})
		if err != nil {
			return err
		}
	}

	converter := adk.NewEventConverter(adk.EventConverterConfig{
		ProcessorProvider: func(context.Context, string) (*agent.RequestProcessor, error) {
			return proc, nil
		},
	})
	events, err := converter.ConvertEvent(context.Background(), "session-1", ev, "task-1", "context-1")
	if err != nil {
		return err
	}

	if expectEmpty, _ := tc["expectEmpty"].(bool); expectEmpty {
		if len(events) != 0 {
			return fmt.Errorf("expected empty events, got %#v", events)
		}
		return nil
	}

	expect := adkAsMap(tc["expect"])
	if err := assertADKKnownKeys(expect, adkKnownKeys["convert_event.converter_expect"], "expect key", caseKey); err != nil {
		return err
	}
	if len(events) != 1 {
		return fmt.Errorf("expected 1 event, got %d", len(events))
	}
	statusEvt, ok := events[0].(*a2a.TaskStatusUpdateEvent)
	if !ok {
		return fmt.Errorf("expected *TaskStatusUpdateEvent, got %T", events[0])
	}
	if wantType, _ := expect["type"].(string); wantType != "TaskStatusUpdateEvent" {
		return fmt.Errorf("unsupported expected event type %q", wantType)
	}
	wantState, _ := expect["state"].(string)
	if gotState := strings.ToUpper(string(statusEvt.Status.State)); gotState != wantState {
		return fmt.Errorf("state = %q, want %q", gotState, wantState)
	}
	if statusEvt.Status.Message == nil || len(statusEvt.Status.Message.Parts) == 0 {
		return fmt.Errorf("expected status message with at least 1 part")
	}
	tp, ok := statusEvt.Status.Message.Parts[0].(a2a.TextPart)
	if !ok {
		return fmt.Errorf("expected TextPart, got %T", statusEvt.Status.Message.Parts[0])
	}
	wantMsg, _ := expect["message"].(string)
	if tp.Text != wantMsg {
		return fmt.Errorf("message text = %q, want %q", tp.Text, wantMsg)
	}
	return nil
}

func runDataModelCase(tc map[string]any, caseKey string) error {
	if err := assertADKKnownKeys(tc, adkKnownKeys["data_model.case"], "case key", caseKey); err != nil {
		return err
	}
	args := adkAsMap(tc["args"])
	expect := adkAsMap(tc["expect"])
	if err := assertADKKnownKeys(args, adkKnownKeys["data_model.args"], "args key", caseKey); err != nil {
		return err
	}
	if err := assertADKKnownKeys(expect, adkKnownKeys["data_model.expect"], "expect key", caseKey); err != nil {
		return err
	}
	subagent, _ := args["subagent"].(string)
	st := newFakeState(adkAsMap(args["state"]))
	clonedModel, _ := core.CloneJSONValue(adkAsMap(args["clientDataModel"])).(map[string]any)

	adk.StripUnownedSurfaces(st, subagent, clonedModel)

	wantModel := expect["clientDataModel"]
	if !reflect.DeepEqual(adkNormalizeJSON(clonedModel), adkNormalizeJSON(wantModel)) {
		return fmt.Errorf("clientDataModel = %#v, want %#v", clonedModel, wantModel)
	}
	return nil
}

func runADKCase(tc map[string]any, caseKey string) error {
	action, _ := tc["action"].(string)
	switch action {
	case "execute_tool":
		return runExecuteToolCase(tc, caseKey)
	case "convert_event":
		args := adkAsMap(tc["args"])
		_, hasSub := args["subagent"]
		_, hasMsg := args["message"]
		isSubagent := hasSub && hasMsg
		isConverter := false
		for k := range adkConverterArgKeys {
			if _, exists := args[k]; exists {
				isConverter = true
				break
			}
		}
		if isSubagent && !isConverter {
			return runSubagentEventCase(tc, caseKey)
		}
		if isConverter && !isSubagent {
			return runConverterEventCase(tc, caseKey)
		}
		return fmt.Errorf("convert_event args in %s do not match subagent or converter key sets", caseKey)
	case "data_model":
		return runDataModelCase(tc, caseKey)
	default:
		return &adkUnknownKeyError{msg: fmt.Sprintf("Unknown action '%s' in %s", action, caseKey)}
	}
}

func TestADKUnsupportedAndExpectedFailuresAreUsed(t *testing.T) {
	cases := loadADKConformanceCases(t)
	matchedUnsupported := make(map[string]bool)
	loadedKeys := make(map[string]bool)

	for _, tc := range cases {
		name, _ := tc["name"].(string)
		caseKey := adkSuitePath + "#" + name
		loadedKeys[caseKey] = true
		action, _ := tc["action"].(string)
		if _, ok := adkUnsupported[caseKey]; ok {
			matchedUnsupported[caseKey] = true
		}
		if _, ok := adkUnsupported[action]; ok {
			matchedUnsupported[action] = true
		}
		prefix := action + "."
		for k := range adkUnsupported {
			if strings.HasPrefix(k, prefix) && adkHasNestedKeyPath(tc, strings.TrimPrefix(k, prefix)) {
				matchedUnsupported[k] = true
			}
		}
	}

	var unusedUnsupported []string
	for k := range adkUnsupported {
		if !matchedUnsupported[k] {
			unusedUnsupported = append(unusedUnsupported, k)
		}
	}
	sort.Strings(unusedUnsupported)
	if len(unusedUnsupported) > 0 {
		t.Fatalf("Unused UNSUPPORTED entries: %v", unusedUnsupported)
	}

	var unusedXfails []string
	for k := range adkExpectedFailures {
		if !loadedKeys[k] {
			unusedXfails = append(unusedXfails, k)
		}
	}
	sort.Strings(unusedXfails)
	if len(unusedXfails) > 0 {
		t.Fatalf("Unused EXPECTED_FAILURES entries: %v", unusedXfails)
	}
}

func TestADKExtensionsConformance(t *testing.T) {
	cases := loadADKConformanceCases(t)
	for _, tc := range cases {
		tc := tc
		name, _ := tc["name"].(string)
		caseKey := adkSuitePath + "#" + name
		t.Run(name, func(t *testing.T) {
			if reason, ok := findADKUnsupportedReason(tc); ok {
				if err := appendADKManifest(name, "skipped", reason); err != nil {
					t.Fatalf("write manifest: %v", err)
				}
				t.Skip(reason)
			}

			err := runADKCase(tc, caseKey)
			if xfailReason, isXfail := adkExpectedFailures[caseKey]; isXfail {
				if _, isUnknown := err.(*adkUnknownKeyError); isUnknown {
					_ = appendADKManifest(name, "failed", "")
					t.Fatalf("%v", err)
				}
				if err != nil {
					if mErr := appendADKManifest(name, "xfailed", xfailReason); mErr != nil {
						t.Fatalf("write manifest: %v", mErr)
					}
					t.Skipf("xfailed: %s (%v)", xfailReason, err)
				}
				_ = appendADKManifest(name, "failed", "")
				t.Fatalf("Expected failure %q passed unexpectedly", caseKey)
			}

			if err != nil {
				_ = appendADKManifest(name, "failed", "")
				t.Fatalf("%v", err)
			}
			if mErr := appendADKManifest(name, "passed", ""); mErr != nil {
				t.Fatalf("write manifest: %v", mErr)
			}
		})
	}
}
