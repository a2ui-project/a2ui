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

package core

import (
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/a2ui-project/a2ui/go/core/internal/schemaengine"
)

type catalogVersionMismatchError struct {
	*CatalogError
	validationErr *ValidationError
}

func (e *catalogVersionMismatchError) ErrorCategory() ErrorCategory { return CategoryCatalog }

func (e *catalogVersionMismatchError) Unwrap() []error {
	return []error{e.CatalogError, e.validationErr}
}

func newCatalogVersionMismatchError(msg, surfaceID string) *catalogVersionMismatchError {
	base := &A2UIError{
		Message:   msg,
		Code:      "CATALOG_NOT_FOUND",
		SurfaceID: surfaceID,
	}
	return &catalogVersionMismatchError{
		CatalogError:  &CatalogError{A2UIError: base},
		validationErr: &ValidationError{A2UIError: base},
	}
}

// OutboundListener receives outbound protocol messages (errors, actions, RPC envelopes).
type OutboundListener func(message map[string]any)

// MessageProcessorOptions configures a MessageProcessor.
type MessageProcessorOptions struct {
	ValidationConfig         *ValidationConfig
	OutboundListener         OutboundListener
	DefaultTimeout           time.Duration
	ErrorHandler             func(errEnvelope map[string]any)
	ActionHandler            func(actionEnvelope map[string]any)
	ReportErrorsOnly         bool
	MaxAgentCallCacheEntries int
}

// ExecutionContext provides per-call execution overrides to MessageProcessor.ProcessMessages.
type ExecutionContext struct {
	ValidationConfig *ValidationConfig
	IsUserActivated  bool
}

// CapabilitiesOptions configures MessageProcessor.RendererCapabilities.
type CapabilitiesOptions struct {
	Versions              []ProtocolVersion
	RawVersions           []string
	IncludeInlineCatalogs bool
	ComponentEnvelopeRef  string
}

// MessageProcessor validates and applies A2UI messages against a SurfaceGroupModel.
type MessageProcessor struct {
	Catalogs []*Catalog
	Model    *SurfaceGroupModel
	Options  MessageProcessorOptions
	RPC      *RPCHandler

	v08PendingComps map[string][]map[string]any
	v08PendingData  map[string][]internalUpdateDataOp
}

// NewMessageProcessor creates a MessageProcessor configured with catalogs and optional options.
func NewMessageProcessor(catalogs []*Catalog, opts *MessageProcessorOptions) (*MessageProcessor, error) {
	if len(catalogs) == 0 {
		return nil, NewCatalogError("at least one catalog must be provided")
	}
	var resolvedOpts MessageProcessorOptions
	if opts != nil {
		resolvedOpts = *opts
	}
	if resolvedOpts.DefaultTimeout <= 0 {
		resolvedOpts.DefaultTimeout = DefaultAgentCallTimeout
	}
	if resolvedOpts.MaxAgentCallCacheEntries == 0 {
		resolvedOpts.MaxAgentCallCacheEntries = 256
	} else if resolvedOpts.MaxAgentCallCacheEntries < 0 {
		return nil, NewValidationError("maxAgentCallCacheEntries must be a positive integer")
	}

	model := NewSurfaceGroupModel()
	if resolvedOpts.ErrorHandler != nil {
		model.OnError = append(model.OnError, resolvedOpts.ErrorHandler)
	}
	if resolvedOpts.ActionHandler != nil {
		model.OnAction = append(model.OnAction, resolvedOpts.ActionHandler)
	}

	rpc := NewRPCHandler(catalogs, &RPCHandlerOptions{
		OutboundListener: resolvedOpts.OutboundListener,
		DefaultTimeout:   resolvedOpts.DefaultTimeout,
	})
	model.OnSurfaceDeleted = append(model.OnSurfaceDeleted, rpc.CancelSurfaceCalls)

	return &MessageProcessor{
		Catalogs:        append([]*Catalog(nil), catalogs...),
		Model:           model,
		Options:         resolvedOpts,
		RPC:             rpc,
		v08PendingComps: map[string][]map[string]any{},
		v08PendingData:  map[string][]internalUpdateDataOp{},
	}, nil
}

// ProcessMessages validates and applies a slice of AgentToRendererMessage envelopes in order.
func (p *MessageProcessor) ProcessMessages(messages []AgentToRendererMessage, execCtx *ExecutionContext) error {
	raw := make([]any, len(messages))
	for i, m := range messages {
		if m == nil {
			raw[i] = nil
		} else {
			raw[i] = map[string]any(m)
		}
	}
	return p.ProcessPayload(raw, execCtx)
}

func normalizeProcessorPayload(payload any) any {
	if payload == nil {
		return nil
	}
	rv := reflect.ValueOf(payload)
	switch rv.Kind() {
	case reflect.Slice:
		if rv.Type() != reflect.TypeFor[[]byte]() && rv.IsNil() {
			return []any{}
		}
	case reflect.Map:
		if rv.Type().Key().Kind() == reflect.String && rv.IsNil() {
			return (map[string]any)(nil)
		}
	}
	return CloneJSONValue(payload)
}

// ProcessPayload validates and applies an A2UI message payload (slice, wrapper object, or single envelope).
func (p *MessageProcessor) ProcessPayload(payload any, execCtx *ExecutionContext) error {
	_, err := p.ProcessPayloadWithResponses(payload, execCtx)
	return err
}

// ProcessPayloadWithResponses validates and applies payload, returning any synchronously generated rendererFunctionResponse envelopes.
func (p *MessageProcessor) ProcessPayloadWithResponses(payload any, execCtx *ExecutionContext) ([]map[string]any, error) {
	normPayload := normalizeProcessorPayload(payload)
	ops, err := extractOperationsFromPayload(normPayload, p.effectiveValidationConfig(execCtx))
	if err != nil {
		p.reportError(err, normPayload)
		if p.Options.ReportErrorsOnly {
			return nil, nil
		}
		return nil, err
	}
	var responses []map[string]any
	for _, op := range ops {
		resp, err := p.applyOperationWithResponse(op, execCtx)
		if err != nil {
			p.reportError(err, normPayload)
			if p.Options.ReportErrorsOnly {
				return responses, nil
			}
			return responses, err
		}
		if resp != nil {
			responses = append(responses, resp)
		}
	}
	return responses, nil
}

// AddCatalog registers an additional Catalog on both the MessageProcessor and its RPCHandler.
func (p *MessageProcessor) AddCatalog(cat *Catalog) {
	if p == nil || cat == nil {
		return
	}
	p.Catalogs = append(p.Catalogs, cat)
	if p.RPC != nil {
		p.RPC.AddCatalog(cat)
	}
}

func (p *MessageProcessor) effectiveValidationConfig(execCtx *ExecutionContext) *ValidationConfig {
	if execCtx != nil && execCtx.ValidationConfig != nil {
		return execCtx.ValidationConfig
	}
	return p.Options.ValidationConfig
}

func (p *MessageProcessor) reportError(err error, rawPayload any) map[string]any {
	env := mapErrorToRendererMessageFromPayload(err, rawPayload)
	errObj, _ := env["error"].(map[string]any)
	populateErrorFieldsFromEnvelope(err, errObj)

	if sid, ok := errObj["surfaceId"].(string); ok && sid != "" {
		if surf := p.Model.Surface(sid); surf != nil {
			surf.DispatchError(CloneJSONValue(errObj).(map[string]any))
		}
	}
	p.Model.EmitError(env)
	if p.Options.OutboundListener != nil {
		p.Options.OutboundListener(env)
	}
	return env
}

func populateErrorFieldsFromEnvelope(err error, errObj map[string]any) {
	if errObj == nil {
		return
	}
	var base *A2UIError
	if !errors.As(err, &base) || base == nil {
		return
	}
	if base.Code == "" {
		if c, ok := errObj["code"].(string); ok {
			base.Code = c
		}
	}
	if base.SurfaceID == "" {
		if s, ok := errObj["surfaceId"].(string); ok {
			base.SurfaceID = s
		}
	}
	if base.Path == "" {
		if pt, ok := errObj["path"].(string); ok {
			base.Path = pt
		}
	}
	if base.FunctionCallID == "" {
		if fc, ok := errObj["functionCallId"].(string); ok {
			base.FunctionCallID = fc
		}
	}
}

func (p *MessageProcessor) resolveCatalog(catalogID string) *Catalog {
	for _, cat := range p.Catalogs {
		if cat != nil && cat.CatalogID() == catalogID {
			return cat
		}
	}
	return nil
}

// RendererCapabilities constructs a version-keyed capabilities payload for the registered catalogs.
func (p *MessageProcessor) RendererCapabilities(opts *CapabilitiesOptions) (map[string]any, error) {
	var rawVers []string
	includeInline := false
	envelopeRef := "common_types.json#/$defs/ComponentCommon"
	if opts != nil {
		includeInline = opts.IncludeInlineCatalogs
		if opts.ComponentEnvelopeRef != "" {
			envelopeRef = opts.ComponentEnvelopeRef
		}
		for _, v := range opts.Versions {
			if v != "" {
				rawVers = append(rawVers, string(v))
			}
		}
		for _, rv := range opts.RawVersions {
			if rv != "" {
				rawVers = append(rawVers, rv)
			}
		}
	}
	if len(rawVers) == 0 {
		return nil, NewValidationError("At least one protocol version must be provided in CapabilitiesOptions to generate renderer capabilities.")
	}

	out := make(map[string]any, len(rawVers))
	for _, verStr := range rawVers {
		var catIDs []any
		for _, cat := range p.Catalogs {
			if cat != nil && cat.CatalogID() != "" {
				catIDs = append(catIDs, cat.CatalogID())
			}
		}
		if catIDs == nil {
			catIDs = []any{}
		}
		entry := map[string]any{
			"supportedCatalogIds": catIDs,
		}
		if includeInline {
			inlineList := make([]any, 0, len(p.Catalogs))
			isV10 := IsAtLeastVersion(verStr, Version1_0)
			for _, cat := range p.Catalogs {
				if cat == nil {
					continue
				}
				if isV10 {
					inlineList = append(inlineList, generateV10InlineCatalog(cat))
				} else {
					inlineList = append(inlineList, generateV09InlineCatalog(cat, envelopeRef))
				}
			}
			entry["inlineCatalogs"] = inlineList
		}
		out[verStr] = entry
	}
	return out, nil
}

func generateV10InlineCatalog(cat *Catalog) map[string]any {
	doc := cat.ToJSON()
	if cat.CatalogID() != "" {
		doc["catalogId"] = cat.CatalogID()
	}
	ver, _ := doc["protocolVersion"].(string)
	ver = strings.TrimSpace(ver)
	if ver == "" {
		ver = string(cat.ProtocolVersion())
	}
	ver = stripLeadingVBeforeDigit(ver)
	if ver != "" {
		doc["protocolVersion"] = ver
	} else {
		delete(doc, "protocolVersion")
	}
	return doc
}

func generateV09InlineCatalog(cat *Catalog, envelopeRef string) map[string]any {
	components := map[string]any{}
	for _, name := range cat.ComponentNames() {
		resolved := cat.ResolvedComponentSchema(name)
		if resolved == nil {
			resolved = cat.components[name].Schema
		}
		sCopy, _ := CloneJSONValue(resolved).(map[string]any)
		props := map[string]any{}
		if pMap, ok := sCopy["properties"].(map[string]any); ok {
			for k, v := range pMap {
				if k != "id" && k != "component" {
					props[k] = v
				}
			}
		}
		var req []any
		if reqArr, ok := toStringSlice(sCopy["required"]); ok {
			for _, r := range reqArr {
				if r != "id" && r != "component" {
					req = append(req, r)
				}
			}
		}
		innerProps := map[string]any{"component": map[string]any{"const": name}}
		for k, v := range props {
			innerProps[k] = v
		}
		components[name] = map[string]any{
			"allOf": []any{
				map[string]any{"$ref": envelopeRef},
				map[string]any{
					"properties": innerProps,
					"required":   append([]any{"component"}, req...),
				},
			},
		}
	}

	var functions []any
	for _, name := range cat.FunctionNames() {
		fn, _ := cat.functionByName(name)
		resolved := cat.ResolvedFunctionSchema(name)
		sCopy, _ := CloneJSONValue(resolved).(map[string]any)
		var params map[string]any
		if p, ok := sCopy["parameters"].(map[string]any); ok {
			params = p
		} else if props, ok := sCopy["properties"].(map[string]any); ok {
			if a, ok := props["args"].(map[string]any); ok {
				params = a
			}
		}
		if params == nil {
			if len(sCopy) > 0 {
				params = sCopy
			} else {
				params = map[string]any{"type": "object", "properties": map[string]any{}}
			}
		}
		rt := string(fn.ReturnType)
		if rt == "" {
			rt = "any"
		}
		fnEntry := map[string]any{
			"name":       name,
			"returnType": rt,
			"parameters": params,
		}
		if fn.Description != "" {
			fnEntry["description"] = fn.Description
		}
		functions = append(functions, fnEntry)
	}

	res := map[string]any{
		"catalogId": cat.CatalogID(),
	}
	if len(components) > 0 {
		res["components"] = components
	}
	if len(functions) > 0 {
		res["functions"] = functions
	}
	if theme := cat.ThemeSchema(); len(theme) > 0 {
		if props, ok := theme["properties"].(map[string]any); ok {
			res["theme"] = props
		} else {
			res["theme"] = theme
		}
	}
	return res
}

// RendererDataModel returns the synchronized renderer data model metadata payload, or nil if no surfaces opt in.
func (p *MessageProcessor) RendererDataModel() map[string]any {
	res, _ := p.RendererDataModelForVersion("")
	return res
}

// RendererDataModelForVersion aggregates active surfaces with SendDataModel=true, optionally filtered by version.
func (p *MessageProcessor) RendererDataModelForVersion(version ProtocolVersion) (map[string]any, error) {
	var enabled []*SurfaceModel
	for _, id := range p.Model.SurfaceIDs() {
		s := p.Model.Surface(id)
		if s != nil && s.SendDataModel {
			enabled = append(enabled, s)
		}
	}
	if len(enabled) == 0 {
		return nil, nil
	}

	if version != "" {
		wireVer := string(version)
		if norm, err := ToProtocolVersion(wireVer); err == nil {
			wireVer = versionWireOrLabel(norm)
		}
		surfaces := map[string]any{}
		for _, s := range enabled {
			if s.ProtocolVersion == "" || isCatalogVersionCompatible(string(s.ProtocolVersion), string(version)) {
				rootVal, _, _ := s.DataModel.Get("/")
				surfaces[s.ID] = rootVal
			}
		}
		if len(surfaces) == 0 {
			return nil, nil
		}
		return map[string]any{"version": wireVer, "surfaces": surfaces}, nil
	}

	versionSet := map[string]bool{}
	for _, s := range enabled {
		if s.ProtocolVersion != "" {
			versionSet[versionWireOrLabel(s.ProtocolVersion)] = true
		}
	}
	if len(versionSet) > 1 {
		var list []string
		for v := range versionSet {
			list = append(list, v)
		}
		sort.Strings(list)
		return nil, NewValidationErrorf(
			"Multiple protocol versions detected among active surfaces: %v. Specify a target protocol version.",
			list,
		)
	}
	verStr := "1.0"
	for v := range versionSet {
		verStr = v
	}
	surfaces := map[string]any{}
	for _, s := range enabled {
		rootVal, _, _ := s.DataModel.Get("/")
		surfaces[s.ID] = rootVal
	}
	return map[string]any{"version": verStr, "surfaces": surfaces}, nil
}

// Dispose disposes all active surfaces and cancels pending RPC calls.
func (p *MessageProcessor) Dispose() {
	if p.Model != nil {
		p.Model.Dispose()
	}
	if p.RPC != nil {
		p.RPC.Dispose()
	}
}

func versionWireOrLabel(v ProtocolVersion) string {
	if v == Version0_8 {
		return "v0.8"
	}
	return v.WireVersion()
}

// Internal Operations & Envelope Extraction

type internalOp interface {
	opSurfaceID() string
}

type internalCreateSurfaceOp struct {
	surfaceID     string
	catalogID     *string
	theme         map[string]any
	sendDataModel bool
	components    []any
	hasComponents bool
	dataModel     map[string]any
	hasDataModel  bool
	metadata      map[string]any
	root          string
	version       string
}

func (o internalCreateSurfaceOp) opSurfaceID() string { return o.surfaceID }

type internalUpdateComponentsOp struct {
	surfaceID  string
	components any
}

func (o internalUpdateComponentsOp) opSurfaceID() string { return o.surfaceID }

type internalUpdateDataOp struct {
	surfaceID string
	path      string
	hasPath   bool
	value     any
}

func (o internalUpdateDataOp) opSurfaceID() string { return o.surfaceID }

type internalDeleteSurfaceOp struct {
	surfaceID string
}

func (o internalDeleteSurfaceOp) opSurfaceID() string { return o.surfaceID }

type internalCallRendererFnOp struct {
	functionCallID string
	call           string
	version        string
	surfaceID      *string
	catalogID      string
	args           map[string]any
}

func (o internalCallRendererFnOp) opSurfaceID() string {
	if o.surfaceID != nil {
		return *o.surfaceID
	}
	return ""
}

type internalAgentFnResponseOp struct {
	functionCallID string
	version        string
	value          any
	hasValue       bool
	errObj         map[string]any
}

func (o internalAgentFnResponseOp) opSurfaceID() string { return "" }

var (
	v10Actions = []string{"agentFunctionResponse", "callRendererFunction", "createSurface", "deleteSurface", "updateComponents", "updateDataModel"}
	v09Actions = []string{"createSurface", "deleteSurface", "updateComponents", "updateDataModel"}
	v08Actions = []string{"beginRendering", "dataModelUpdate", "deleteSurface", "surfaceUpdate"}
	allActions = map[string]bool{
		"createSurface": true, "updateComponents": true, "updateDataModel": true,
		"deleteSurface": true, "callRendererFunction": true, "agentFunctionResponse": true,
		"beginRendering": true, "surfaceUpdate": true, "dataModelUpdate": true,
	}
)

var envelopeSchemasOnce sync.Once
var (
	v10EnvelopeSchema *jsonschema.Schema
	v09EnvelopeSchema *jsonschema.Schema
	v08EnvelopeSchema *jsonschema.Schema
)

func initEnvelopeSchemas() {
	envelopeSchemasOnce.Do(func() {
		// v1.0
		if msgMap, err := agentToRendererSchemaMap(Version1_0); err == nil {
			commonMap, _ := CommonTypesSchemaMap(Version1_0)
			commonForEnv := relaxV10EnvelopeComponentCommon(commonMap)
			placeholder := map[string]any{
				"$schema": jsonSchemaDraft202012,
				"$defs": map[string]any{
					"anyComponent": map[string]any{"type": "object", "additionalProperties": true},
					"anyFunction": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"@call": map[string]any{"not": map[string]any{"pattern": "^@"}},
							"args":  map[string]any{"type": "object"},
						},
					},
				},
			}
			c := schemaengine.NewCompiler(map[string]any{
				"https://a2ui.org/specification/v1_0/agent_to_renderer.json": msgMap,
				"https://a2ui.org/specification/v1_0/common_types.json":      commonForEnv,
				"https://a2ui.org/specification/v1_0/catalog.json":           placeholder,
			})
			v10EnvelopeSchema, _ = c.Compile("https://a2ui.org/specification/v1_0/agent_to_renderer.json")
		}
		// v0.9 / v0.9.1
		if msgMap, err := agentToRendererSchemaMap(Version0_9_1); err == nil {
			commonMap, _ := CommonTypesSchemaMap(Version0_9_1)
			placeholder := map[string]any{
				"$schema": jsonSchemaDraft202012,
				"$defs": map[string]any{
					"theme":        map[string]any{"type": "object", "additionalProperties": true},
					"anyComponent": map[string]any{"type": "object", "additionalProperties": true},
					"anyFunction":  map[string]any{"type": "object", "additionalProperties": true},
				},
			}
			c := schemaengine.NewCompiler(map[string]any{
				"https://a2ui.org/specification/v0_9/server_to_client.json": msgMap,
				"https://a2ui.org/specification/v0_9/common_types.json":     commonMap,
				"https://a2ui.org/specification/v0_9/catalog.json":          placeholder,
			})
			v09EnvelopeSchema, _ = c.Compile("https://a2ui.org/specification/v0_9/server_to_client.json")
		}
		// v0.8
		if msgMap, err := agentToRendererSchemaMap(Version0_8); err == nil {
			// Allow recursive valueMap in v0.8 dataModelUpdate contents.
			patched, _ := CloneJSONValue(msgMap).(map[string]any)
			patched["$schema"] = jsonSchemaDraft202012
			if props, ok := patched["properties"].(map[string]any); ok {
				if dmu, ok := props["dataModelUpdate"].(map[string]any); ok {
					if dmuProps, ok := dmu["properties"].(map[string]any); ok {
						if contents, ok := dmuProps["contents"].(map[string]any); ok {
							if items, ok := contents["items"].(map[string]any); ok {
								if ip, ok := items["properties"].(map[string]any); ok {
									ip["valueMap"] = map[string]any{
										"type":  "array",
										"items": map[string]any{"$ref": "#/properties/dataModelUpdate/properties/contents/items"},
									}
								}
							}
						}
					}
				}
			}
			v08EnvelopeSchema, _ = schemaengine.CompileInline("https://a2ui.org/specification/v0_8/server_to_client.json", patched, nil)
		}
	})
}

func resolveAdapterVersionFromPayload(payload any) (ProtocolVersion, error) {
	norm := normalizeProcessorPayload(payload)
	switch typed := norm.(type) {
	case []any:
		if len(typed) == 0 {
			return "", NewValidationError(
				"[VersionAdapterFactory] Message payload is missing a valid 'version' string: message list is empty.",
				ErrorDetail{Path: "messages.0.version", Code: "empty_payload", Message: "Message list is empty"},
			)
		}
		return resolveAdapterFromItem(typed[0], 0)
	case map[string]any:
		if typed != nil {
			if msgs, ok := typed["messages"].([]any); ok {
				return resolveAdapterVersionFromPayload(msgs)
			}
		}
		return resolveAdapterFromItem(typed, 0)
	default:
		return "", NewValidationError(
			fmt.Sprintf("[VersionAdapterFactory] Message payload is missing a valid 'version' string: expected object or list, got %T.", payload),
			ErrorDetail{Path: "messages.0.version", Code: "invalid_payload_type", Message: fmt.Sprintf("Expected object or list, got %T", payload)},
		)
	}
}

func resolveAdapterFromItem(item any, idx int) (ProtocolVersion, error) {
	m, ok := item.(map[string]any)
	if !ok || m == nil {
		return "", NewValidationError(
			fmt.Sprintf("[VersionAdapterFactory] Message payload is missing a valid 'version' string: message item at index %d is not an object.", idx),
			ErrorDetail{Path: fmt.Sprintf("messages.%d.version", idx), Code: "invalid_payload_type", Message: "Message item is not an object"},
		)
	}
	if rawVer, exists := m["version"]; exists {
		verStr, ok := rawVer.(string)
		if !ok {
			return "", NewValidationError(
				fmt.Sprintf("[VersionAdapterFactory] Message payload is missing a valid 'version' string: 'version' property must be a string, got %T.", rawVer),
				ErrorDetail{Path: fmt.Sprintf("messages.%d.version", idx), Code: "type_mismatch", Message: "Expected string for 'version'"},
			)
		}
		norm, err := ToProtocolVersion(verStr)
		if err != nil {
			return "", NewValidationErrorf("[VersionAdapterFactory] Unsupported protocol version '%s'. Supported versions: v0.8, v0.9, v0.9.1, v1.0.", verStr)
		}
		if norm == Version0_9_1 {
			return Version0_9, nil
		}
		return norm, nil
	}
	for _, k := range v08Actions {
		if hasKey(m, k) {
			return Version0_8, nil
		}
	}
	return "", NewValidationError(
		"[VersionAdapterFactory] Message payload is missing a valid 'version' string: no version header or legacy v0.8 action found.",
		ErrorDetail{Path: fmt.Sprintf("messages.%d.version", idx), Code: "missing_field", Message: "Missing required version field"},
	)
}

func extractOperationsFromPayload(payload any, cfg *ValidationConfig) ([]internalOp, error) {
	if payload == nil {
		return nil, nil
	}
	payload = normalizeProcessorPayload(payload)
	adapterVer, err := resolveAdapterVersionFromPayload(payload)
	if err != nil {
		return nil, err
	}
	if err := ValidateRecursionAndPaths(payload); err != nil {
		return nil, err
	}

	var items []any
	switch typed := payload.(type) {
	case []any:
		items = typed
	case map[string]any:
		if msgs, ok := typed["messages"].([]any); ok {
			items = msgs
		} else {
			items = []any{typed}
		}
	}

	validActions := v09Actions
	switch adapterVer {
	case Version1_0:
		validActions = v10Actions
	case Version0_8:
		validActions = v08Actions
	}

	// First pass: check single valid action on every object item (matches Python adapter order).
	for _, rawItem := range items {
		if m, ok := rawItem.(map[string]any); ok {
			if _, err := extractSingleAction(m, adapterVer, validActions); err != nil {
				return nil, err
			}
		}
	}

	initEnvelopeSchemas()

	var ops []internalOp
	for idx, rawItem := range items {
		m, ok := rawItem.(map[string]any)
		if !ok || m == nil {
			return nil, NewValidationError(
				fmt.Sprintf("Message item at index %d is not an object.", idx),
				ErrorDetail{Path: fmt.Sprintf("messages.%d", idx), Code: "invalid_payload_type", Message: "Message item is not an object"},
			)
		}
		action, err := extractSingleAction(m, adapterVer, validActions)
		if err != nil {
			return nil, err
		}
		if cfg != nil && len(cfg.AllowedMessages) > 0 && !containsString(cfg.AllowedMessages, action) {
			return nil, NewValidationErrorf("Message action '%s' is not in allowedMessages: %v", action, cfg.AllowedMessages)
		}
		actionBody, ok := m[action].(map[string]any)
		if !ok || actionBody == nil {
			return nil, NewValidationErrorf("Payload for action '%s' must be an object", action)
		}

		if err := validateEnvelopeVersionHeader(m, adapterVer); err != nil {
			return nil, err
		}
		allowUnknown := cfg != nil && cfg.AllowUnknownElements
		if err := validateMessageEnvelopeSchema(m, action, actionBody, adapterVer, allowUnknown); err != nil {
			return nil, err
		}

		extracted, err := buildOpsForAction(adapterVer, action, m, actionBody)
		if err != nil {
			return nil, err
		}
		ops = append(ops, extracted...)
	}
	return ops, nil
}

func extractSingleAction(message map[string]any, adapterVer ProtocolVersion, validActions []string) (string, error) {
	var matched []string
	for _, k := range validActions {
		if hasKey(message, k) {
			matched = append(matched, k)
		}
	}
	sort.Strings(matched)
	if len(matched) > 1 {
		return "", NewValidationErrorf("Message contains multiple conflicting update actions: %s.", strings.Join(matched, ", "))
	}
	if len(matched) == 0 {
		verStr := string(adapterVer)
		for k := range message {
			if allActions[k] {
				msg := fmt.Sprintf(
					"Invalid %s message: action '%s' is not supported in protocol version %s. Allowed actions: %s.",
					verStr, k, verStr, strings.Join(validActions, ", "),
				)
				var details []ErrorDetail
				if hasKey(message, "version") {
					details = append(details, ErrorDetail{Path: "messages.0.version", Code: "invalid_value", Message: msg})
				}
				ve := NewValidationError(msg, details...)
				if hasKey(message, "version") {
					ve.Path = "/version"
				}
				return "", ve
			}
		}
		return "", NewValidationErrorf(
			"Invalid %s message: message must contain exactly one update action: %s.",
			verStr, strings.Join(validActions, ", "),
		)
	}
	action := matched[0]
	if body, ok := message[action].(map[string]any); ok {
		if rawSID, hasSID := body["surfaceId"]; hasSID {
			if _, isStr := rawSID.(string); !isStr {
				ve := NewValidationError("surfaceId must be a string", ErrorDetail{
					Path:    fmt.Sprintf("messages.0.%s.surfaceId", action),
					Code:    "type_mismatch",
					Message: "surfaceId must be a string",
				})
				ve.Path = "/surfaceId"
				return "", ve
			}
		}
	}
	return action, nil
}

func validateEnvelopeVersionHeader(msg map[string]any, adapterVer ProtocolVersion) error {
	if adapterVer == Version0_8 {
		return nil
	}
	rawVer, hasVer := msg["version"]
	if !hasVer {
		errMsg := fmt.Sprintf("Invalid %s message: version: 'version' is a required property", adapterVer)
		ve := NewValidationError(errMsg, ErrorDetail{
			Path:    "messages.0.version",
			Code:    "missing_field",
			Message: "'version' is a required property",
		})
		ve.Path = "/version"
		return ve
	}
	verStr, isStr := rawVer.(string)
	if !isStr {
		ve := NewValidationError("Invalid message: 'version' must be a string", ErrorDetail{
			Path:    "messages.0.version",
			Code:    "type_mismatch",
			Message: "'version' must be a string",
		})
		ve.Path = "/version"
		return ve
	}
	norm, err := ToProtocolVersion(verStr)
	if err != nil || !AreVersionsCompatible(norm, adapterVer) || (adapterVer == Version1_0 && verStr != "1.0") {
		// Note: In v1.0 wire format, "version" MUST be "1.0" (not "v1.0") per agent_to_renderer.json const: "1.0"!
		// Wait: check if v0.9 allows "0.9" normalized or requires "v0.9"/"v0.9.1". Python normalizes "0.9" -> "v0.9" in prepare_payload_for_validation, while v1.0 requires "1.0"!
		if adapterVer == Version1_0 {
			errMsg := "Invalid 1.0 message: version: Input should be '1.0'"
			ve := NewValidationError(errMsg, ErrorDetail{
				Path:    "messages.0.version",
				Code:    "invalid_value",
				Message: "Input should be '1.0'",
			})
			ve.Path = "/version"
			return ve
		}
		errMsg := "Invalid v0.9 message: version: Input should be one of ['v0.9', 'v0.9.1']"
		ve := NewValidationError(errMsg, ErrorDetail{
			Path:    "messages.0.version",
			Code:    "invalid_value",
			Message: "Input should be one of ['v0.9', 'v0.9.1']",
		})
		ve.Path = "/version"
		return ve
	}
	return nil
}

func validateMessageEnvelopeSchema(msg map[string]any, action string, actionBody map[string]any, adapterVer ProtocolVersion, allowUnknownElements bool) error {
	prepared, _ := CloneJSONValue(msg).(map[string]any)
	var schema *jsonschema.Schema
	switch adapterVer {
	case Version1_0:
		if allowUnknownElements && action == "createSurface" {
			if cs, ok := prepared["createSurface"].(map[string]any); ok {
				delete(cs, "theme")
			}
		}
		schema = v10EnvelopeSchema
	case Version0_9:
		if v, ok := prepared["version"].(string); ok && !strings.HasPrefix(v, "v") {
			prepared["version"] = "v" + v
		}
		schema = v09EnvelopeSchema
	case Version0_8:
		delete(prepared, "version")
		schema = v08EnvelopeSchema
	}
	if schema == nil {
		return nil
	}

	// Select the exact action subschema in v1.0 / v0.9 so error paths point directly into the active action rather than failing generic oneOf!
	var sErr error
	if adapterVer == Version1_0 || adapterVer == Version0_9 {
		defName := actionDefName(action)
		baseURL := "https://a2ui.org/specification/v0_9/server_to_client.json"
		if adapterVer == Version1_0 {
			baseURL = "https://a2ui.org/specification/v1_0/agent_to_renderer.json"
		}
		sErr = validateSpecificEnvelopeDef(baseURL, defName, adapterVer, prepared)
	} else {
		sErr = schema.Validate(schemaengine.NormalizeJSON(prepared))
	}
	if sErr == nil {
		return nil
	}

	sid, _ := actionBody["surfaceId"].(string)
	fcID, _ := actionBody["functionCallId"].(string)
	issues := schemaengine.ExtractIssues(sErr)
	var details []ErrorDetail
	for _, iss := range issues {
		loc := append([]string{"messages", "0"}, iss.Location...)
		details = append(details, ErrorDetail{
			Path:      strings.Join(loc, "."),
			Code:      iss.Code,
			Message:   iss.Message,
			SurfaceID: sid,
		})
	}
	var errPath string
	if len(issues) > 0 {
		relLoc := issues[0].Location
		// Strip leading action key (e.g. "createSurface.theme" -> "/theme", "updateComponents.components.0" -> "/components/0")
		if len(relLoc) > 1 && relLoc[0] == action {
			relLoc = relLoc[1:]
		}
		if issues[0].Code == "missing_field" {
			if m := missingFieldMsgRe.FindStringSubmatch(issues[0].Message); len(m) == 2 {
				if len(relLoc) == 1 && relLoc[0] == action {
					relLoc = []string{m[1]}
				} else {
					relLoc = append(append([]string(nil), relLoc...), m[1])
				}
			}
		} else if issues[0].Code == "extra_field" {
			if m := extraFieldMsgRe.FindStringSubmatch(issues[0].Message); len(m) == 2 {
				if len(relLoc) == 1 && relLoc[0] == action {
					relLoc = []string{m[1]}
				} else {
					relLoc = append(append([]string(nil), relLoc...), m[1])
				}
			}
		}
		if len(relLoc) > 0 {
			errPath = toJSONPointer(strings.Join(relLoc, "."))
		}
	}
	var summary string
	if len(details) > 0 {
		summary = details[0].Message
	} else {
		summary = sErr.Error()
	}
	ve := NewValidationError(fmt.Sprintf("Invalid %s message: %s", adapterVer, summary), details...)
	if action == "callRendererFunction" {
		ve.Code = "INVALID_FUNCTION_CALL"
	}
	ve.Path = errPath
	ve.SurfaceID = sid
	ve.FunctionCallID = fcID
	return ve
}

var specificEnvelopeDefCache sync.Map // map[string]*jsonschema.Schema

func validateSpecificEnvelopeDef(baseURL, defName string, adapterVer ProtocolVersion, prepared map[string]any) error {
	targetURL := baseURL + "#/$defs/" + defName
	if cached, ok := specificEnvelopeDefCache.Load(targetURL); ok {
		return cached.(*jsonschema.Schema).Validate(schemaengine.NormalizeJSON(prepared))
	}
	var msgMap, commonMap, placeholder map[string]any
	var commonURL, catURL string
	if adapterVer == Version1_0 {
		msgMap, _ = agentToRendererSchemaMap(Version1_0)
		rawCommon, _ := CommonTypesSchemaMap(Version1_0)
		commonMap = relaxV10EnvelopeComponentCommon(rawCommon)
		commonURL = "https://a2ui.org/specification/v1_0/common_types.json"
		catURL = "https://a2ui.org/specification/v1_0/catalog.json"
		placeholder = map[string]any{
			"$schema": jsonSchemaDraft202012,
			"$defs": map[string]any{
				"anyComponent": map[string]any{"type": "object", "additionalProperties": true},
				"anyFunction": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"@call": map[string]any{"not": map[string]any{"pattern": "^@"}},
						"args":  map[string]any{"type": "object"},
					},
				},
			},
		}
	} else {
		msgMap, _ = agentToRendererSchemaMap(Version0_9_1)
		commonMap, _ = CommonTypesSchemaMap(Version0_9_1)
		commonURL = "https://a2ui.org/specification/v0_9/common_types.json"
		catURL = "https://a2ui.org/specification/v0_9/catalog.json"
		placeholder = map[string]any{
			"$schema": jsonSchemaDraft202012,
			"$defs": map[string]any{
				"theme":        map[string]any{"type": "object", "additionalProperties": true},
				"anyComponent": map[string]any{"type": "object", "additionalProperties": true},
				"anyFunction":  map[string]any{"type": "object", "additionalProperties": true},
			},
		}
	}
	c := schemaengine.NewCompiler(map[string]any{
		baseURL:   msgMap,
		commonURL: commonMap,
		catURL:    placeholder,
	})
	compiled, err := c.Compile(targetURL)
	if err != nil {
		return nil
	}
	specificEnvelopeDefCache.Store(targetURL, compiled)
	return compiled.Validate(schemaengine.NormalizeJSON(prepared))
}

// relaxV10EnvelopeComponentCommon keeps required 'id' on ComponentCommon for outer message envelope validation
// while deferring bare catalogId/metadata/accessibility checks to catalog-aware component processing.
func relaxV10EnvelopeComponentCommon(commonMap map[string]any) map[string]any {
	copied, _ := CloneJSONValue(commonMap).(map[string]any)
	if defs, ok := copied["$defs"].(map[string]any); ok {
		defs["ComponentCommon"] = map[string]any{
			"type": "object",
			"properties": map[string]any{
				"id": map[string]any{"$ref": "#/$defs/ComponentId"},
			},
			"required": []any{"id"},
		}
	}
	return copied
}

func actionDefName(action string) string {
	switch action {
	case "createSurface":
		return "CreateSurfaceMessage"
	case "updateComponents":
		return "UpdateComponentsMessage"
	case "updateDataModel":
		return "UpdateDataModelMessage"
	case "deleteSurface":
		return "DeleteSurfaceMessage"
	case "callRendererFunction":
		return "CallRendererFunctionMessage"
	case "agentFunctionResponse":
		return "AgentFunctionResponseMessage"
	default:
		return ""
	}
}

func buildOpsForAction(adapterVer ProtocolVersion, action string, msg map[string]any, body map[string]any) ([]internalOp, error) {
	msgVer, _ := msg["version"].(string)
	if msgVer == "" {
		msgVer = string(adapterVer)
	}
	sid, _ := body["surfaceId"].(string)

	switch action {
	case "createSurface":
		var catIDPtr *string
		if cid, ok := body["catalogId"].(string); ok {
			catIDPtr = &cid
		}
		var theme map[string]any
		if adapterVer != Version1_0 {
			theme, _ = body["theme"].(map[string]any)
		}
		sendDM, _ := body["sendDataModel"].(bool)
		comps, hasComps := body["components"].([]any)
		dm, hasDM := body["dataModel"].(map[string]any)
		meta, _ := body["metadata"].(map[string]any)
		return []internalOp{internalCreateSurfaceOp{
			surfaceID:     sid,
			catalogID:     catIDPtr,
			theme:         theme,
			sendDataModel: sendDM,
			components:    comps,
			hasComponents: hasComps,
			dataModel:     dm,
			hasDataModel:  hasDM,
			metadata:      meta,
			version:       msgVer,
		}}, nil

	case "beginRendering":
		var catIDPtr *string
		if cid, ok := body["catalogId"].(string); ok {
			catIDPtr = &cid
		}
		theme, _ := body["theme"].(map[string]any)
		if theme == nil {
			theme, _ = body["styles"].(map[string]any)
		}
		sendDM, _ := body["sendDataModel"].(bool)
		root, _ := body["root"].(string)
		return []internalOp{internalCreateSurfaceOp{
			surfaceID:     sid,
			catalogID:     catIDPtr,
			theme:         theme,
			sendDataModel: sendDM,
			root:          root,
			version:       string(Version0_8),
		}}, nil

	case "updateComponents":
		return []internalOp{internalUpdateComponentsOp{
			surfaceID:  sid,
			components: body["components"],
		}}, nil

	case "surfaceUpdate":
		rawComps, _ := body["components"].([]any)
		normComps := make([]any, 0, len(rawComps))
		for _, item := range rawComps {
			cm, ok := item.(map[string]any)
			if !ok {
				continue
			}
			out := map[string]any{"id": cm["id"]}
			if w, hasW := cm["weight"]; hasW {
				out["weight"] = w
			}
			switch compField := cm["component"].(type) {
			case map[string]any:
				for compType, rawProps := range compField {
					out["component"] = compType
					if pm, ok := rawProps.(map[string]any); ok {
						for pk, pv := range pm {
							out[pk] = pv
						}
					}
					break
				}
			case string:
				out["component"] = compField
				for pk, pv := range cm {
					if pk != "id" && pk != "component" {
						out[pk] = pv
					}
				}
			}
			normComps = append(normComps, out)
		}
		return []internalOp{internalUpdateComponentsOp{
			surfaceID:  sid,
			components: normComps,
		}}, nil

	case "updateDataModel":
		p, hasP := body["path"].(string)
		if !hasP || p == "" {
			if !hasP {
				p = "/"
			}
		}
		return []internalOp{internalUpdateDataOp{
			surfaceID: sid,
			path:      p,
			hasPath:   hasP,
			value:     body["value"],
		}}, nil

	case "dataModelUpdate":
		rawPath, _ := body["path"].(string)
		basePath := ""
		stripped := strings.TrimSpace(rawPath)
		if stripped != "" && stripped != "/" {
			if !strings.HasPrefix(stripped, "/") {
				basePath = "/" + stripped
			} else {
				basePath = stripped
			}
			basePath = strings.TrimRight(basePath, "/")
		}
		if contents, ok := body["contents"].([]any); ok {
			var ops []internalOp
			for _, item := range contents {
				entry, ok := item.(map[string]any)
				if !ok {
					continue
				}
				key, ok := entry["key"].(string)
				if !ok {
					continue
				}
				itemKey := strings.TrimLeft(key, "/")
				fullPath := basePath + "/" + itemKey
				if itemKey == "" || itemKey == "." {
					if basePath != "" {
						fullPath = basePath
					} else {
						fullPath = "/"
					}
				}
				ops = append(ops, internalUpdateDataOp{
					surfaceID: sid,
					path:      fullPath,
					hasPath:   true,
					value:     extractV08ContentValue(entry),
				})
			}
			return ops, nil
		}
		p, hasP := body["path"].(string)
		if !hasP {
			p = "/"
		}
		return []internalOp{internalUpdateDataOp{
			surfaceID: sid,
			path:      p,
			hasPath:   hasP,
			value:     body["value"],
		}}, nil

	case "deleteSurface":
		return []internalOp{internalDeleteSurfaceOp{surfaceID: sid}}, nil

	case "callRendererFunction":
		fcID, _ := body["functionCallId"].(string)
		cf, _ := body["callFunction"].(map[string]any)
		callName, _ := cf["@call"].(string)
		catID, _ := cf["catalogId"].(string)
		args, _ := cf["args"].(map[string]any)
		if args == nil {
			args = map[string]any{}
		}
		var sidPtr *string
		if s, ok := body["surfaceId"].(string); ok {
			sidPtr = &s
		}
		return []internalOp{internalCallRendererFnOp{
			functionCallID: fcID,
			call:           callName,
			version:        "1.0",
			surfaceID:      sidPtr,
			catalogID:      catID,
			args:           args,
		}}, nil

	case "agentFunctionResponse":
		fcID, _ := body["functionCallId"].(string)
		val, hasVal := body["value"]
		errObj, _ := body["error"].(map[string]any)
		return []internalOp{internalAgentFnResponseOp{
			functionCallID: fcID,
			version:        "1.0",
			value:          val,
			hasValue:       hasVal,
			errObj:         errObj,
		}}, nil
	}
	return nil, nil
}

func extractV08ContentValue(entry map[string]any) any {
	for _, k := range []string{"valueNumber", "valueString", "valueBoolean", "valueObject", "valueArray"} {
		if v, ok := entry[k]; ok {
			return v
		}
	}
	if vm, ok := entry["valueMap"].([]any); ok {
		nested := map[string]any{}
		for _, sub := range vm {
			if sm, ok := sub.(map[string]any); ok {
				if sk, ok := sm["key"].(string); ok {
					nested[sk] = extractV08ContentValue(sm)
				}
			}
		}
		return nested
	}
	return entry["value"]
}
