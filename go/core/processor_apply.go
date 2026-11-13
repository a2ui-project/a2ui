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
	"fmt"
	"sort"
	"strings"
)

func (p *MessageProcessor) applyOperationWithResponse(op internalOp, execCtx *ExecutionContext) (map[string]any, error) {
	valCfg := p.effectiveValidationConfig(execCtx)
	switch typed := op.(type) {
	case internalCreateSurfaceOp:
		return nil, p.applyCreateSurface(typed, valCfg)
	case internalDeleteSurfaceOp:
		delete(p.v08PendingComps, typed.surfaceID)
		delete(p.v08PendingData, typed.surfaceID)
		p.Model.DeleteSurface(typed.surfaceID)
		return nil, nil
	case internalUpdateComponentsOp:
		return nil, p.applyUpdateComponents(typed, valCfg)
	case internalUpdateDataOp:
		return nil, p.applyUpdateData(typed)
	case internalCallRendererFnOp:
		isUserAct := execCtx != nil && execCtx.IsUserActivated
		var dataCtx *DataContext
		if typed.surfaceID != nil {
			if surf := p.Model.Surface(*typed.surfaceID); surf != nil {
				dataCtx = NewDataContext(surf, "/")
			}
		} else if cat := p.resolveCatalog(typed.catalogID); cat != nil {
			fallback := p.newFallbackSurface("_rpc_fallback_"+typed.functionCallID, cat)
			dataCtx = NewDataContext(fallback, "/")
		}
		return p.RPC.HandleCallRendererFunction(CallRendererFunctionPayload{
			SurfaceID: func() string {
				if typed.surfaceID != nil {
					return *typed.surfaceID
				}
				return ""
			}(),
			FunctionCallID: typed.functionCallID,
			CallFunction: CallFunctionPayload{
				Call:      typed.call,
				CatalogID: typed.catalogID,
				Args:      typed.args,
			},
		}, typed.surfaceID != nil, dataCtx, isUserAct)
	case internalAgentFnResponseOp:
		p.RPC.HandleAgentFunctionResponse(FunctionResponsePayload{
			FunctionCallID: typed.functionCallID,
			Value:          typed.value,
			HasValue:       typed.hasValue,
			Error: func() *FunctionResponseError {
				if typed.errObj == nil {
					return nil
				}
				c, _ := typed.errObj["code"].(string)
				m, _ := typed.errObj["message"].(string)
				return &FunctionResponseError{Code: c, Message: m}
			}(),
		})
		return nil, nil
	}
	return nil, nil
}

func (p *MessageProcessor) newFallbackSurface(id string, defaultCat *Catalog) *SurfaceModel {
	s := NewSurfaceModel(id, defaultCat.CatalogID(), defaultCat)
	s.MaxAgentCallCacheEntries = p.Options.MaxAgentCallCacheEntries
	for _, cat := range p.Catalogs {
		if cat != nil && isCatalogVersionCompatible(string(cat.ProtocolVersion()), string(defaultCat.ProtocolVersion())) {
			s.AvailableCatalogs[cat.CatalogID()] = cat
		}
	}
	return s
}

func (p *MessageProcessor) applyCreateSurface(op internalCreateSurfaceOp, valCfg *ValidationConfig) error {
	surfaceID := op.surfaceID
	noDefaultCatalog := op.catalogID == nil && op.version != "" && IsAtLeastVersion(op.version, Version1_0)

	var surfaceCatalog *Catalog
	if noDefaultCatalog {
		surfaceCatalog = nil
	} else if op.catalogID == nil {
		if len(p.Catalogs) > 0 {
			surfaceCatalog = p.Catalogs[0]
		}
	} else {
		surfaceCatalog = p.resolveCatalog(*op.catalogID)
	}
	if surfaceCatalog == nil && !noDefaultCatalog {
		if op.catalogID != nil {
			ce := NewCatalogErrorf("Catalog not found: %s", *op.catalogID)
			ce.SurfaceID = surfaceID
			return ce
		}
		ce := NewCatalogError("No default catalog available for surface.")
		ce.SurfaceID = surfaceID
		return ce
	}

	if p.Model.Surface(surfaceID) != nil {
		ie := NewIntegrityErrorf("Surface %s already exists.", surfaceID)
		ie.SurfaceID = surfaceID
		return ie
	}

	if len(op.theme) > 0 && surfaceCatalog != nil {
		if err := NewPayloadValidator(surfaceCatalog, valCfg).ValidateTheme(op.theme); err != nil {
			var details []ErrorDetail
			errPath := "/theme"
			if ve, ok := err.(*ValidationError); ok {
				details = ve.Details
				if ve.Path != "" {
					errPath = ve.Path
				}
			}
			wrapped := NewValidationError(
				fmt.Sprintf("Validation failed for theme on surface '%s': %v", surfaceID, err),
				details...,
			)
			wrapped.Path = errPath
			wrapped.SurfaceID = surfaceID
			return wrapped
		}
	}

	var surfaceProtoVer ProtocolVersion
	if surfaceCatalog != nil {
		surfaceProtoVer = surfaceCatalog.ProtocolVersion()
	} else if noDefaultCatalog && op.version != "" {
		surfaceProtoVer, _ = ToProtocolVersion(op.version)
	}

	if surfaceCatalog != nil && surfaceProtoVer != "" && op.version != "" && !isCatalogVersionCompatible(string(surfaceProtoVer), op.version) {
		catName := surfaceCatalog.CatalogID()
		if op.catalogID != nil {
			catName = *op.catalogID
		}
		return newCatalogVersionMismatchError(
			fmt.Sprintf(
				"Surface '%s' catalog '%s' specification version (%s) does not match message protocol version (%s).",
				surfaceID, catName, surfaceProtoVer, op.version,
			),
			surfaceID,
		)
	}

	catIDStr := ""
	if op.catalogID != nil {
		catIDStr = *op.catalogID
	} else if surfaceCatalog != nil {
		catIDStr = surfaceCatalog.CatalogID()
	}
	newSurf := NewSurfaceModel(surfaceID, catIDStr, surfaceCatalog)
	newSurf.ProtocolVersion = surfaceProtoVer
	newSurf.SendDataModel = op.sendDataModel
	newSurf.MaxAgentCallCacheEntries = p.Options.MaxAgentCallCacheEntries
	if op.theme != nil {
		newSurf.Theme, _ = CloneJSONValue(op.theme).(map[string]any)
	} else {
		newSurf.Theme = map[string]any{}
	}
	if op.metadata != nil {
		if err := ValidateMetadata(op.metadata, surfaceProtoVer); err != nil {
			return attachSurfaceID(err, surfaceID)
		}
		newSurf.Metadata = normalizeComponentMetadata(op.metadata)
	}
	if op.root != "" {
		newSurf.RootID = op.root
	}
	for _, cat := range p.Catalogs {
		if cat != nil && isCatalogVersionCompatible(string(cat.ProtocolVersion()), string(surfaceProtoVer)) {
			newSurf.AvailableCatalogs[cat.CatalogID()] = cat
		}
	}
	if p.Options.OutboundListener != nil && IsAtLeastVersion(string(surfaceProtoVer), Version1_0) {
		newSurf.AgentCallExecutor = p.makeSurfaceAgentCallExecutor(newSurf)
	}

	p.Model.AddSurface(newSurf)

	rollback := func(err error) error {
		p.Model.DeleteSurface(surfaceID)
		return err
	}

	if op.hasDataModel && op.dataModel != nil {
		isV10 := IsAtLeastVersion(string(surfaceProtoVer), Version1_0)
		for key, val := range op.dataModel {
			ptr := "/" + escapeJSONPointerToken(key)
			if key == "" {
				rootMap, _, _ := newSurf.DataModel.Get("/")
				rm, _ := rootMap.(map[string]any)
				if rm == nil {
					rm = map[string]any{}
				}
				normVal := CloneJSONValue(val)
				if normVal == nil && isV10 {
					delete(rm, "")
				} else {
					rm[""] = normVal
				}
				if err := newSurf.DataModel.Set("/", rm); err != nil {
					return rollback(attachSurfaceID(err, surfaceID))
				}
				continue
			}
			if err := newSurf.DataModel.Set(ptr, val); err != nil {
				if de, ok := err.(*DataError); ok && de.Path == "" {
					de.Path = ptr
				}
				return rollback(attachSurfaceID(err, surfaceID))
			}
		}
	}

	// Replay any v0.8 buffered updates that arrived prior to beginRendering.
	if pendingData := p.v08PendingData[surfaceID]; len(pendingData) > 0 {
		delete(p.v08PendingData, surfaceID)
		for _, dop := range pendingData {
			if err := p.applyUpdateData(dop); err != nil {
				return rollback(err)
			}
		}
	}
	if pendingComps := p.v08PendingComps[surfaceID]; len(pendingComps) > 0 {
		delete(p.v08PendingComps, surfaceID)
		anySlice := make([]any, len(pendingComps))
		for i, c := range pendingComps {
			anySlice[i] = c
		}
		if err := p.applyUpdateComponents(internalUpdateComponentsOp{surfaceID: surfaceID, components: anySlice}, valCfg); err != nil {
			return rollback(err)
		}
	}

	if op.hasComponents && op.components != nil {
		if err := p.applyUpdateComponents(internalUpdateComponentsOp{surfaceID: surfaceID, components: op.components}, valCfg); err != nil {
			return rollback(err)
		}
	}
	return nil
}

func (p *MessageProcessor) applyUpdateComponents(op internalUpdateComponentsOp, valCfg *ValidationConfig) error {
	surfaceID := op.surfaceID
	surface := p.Model.Surface(surfaceID)
	if surface == nil {
		// In v0.8, surfaceUpdate can arrive BEFORE beginRendering! Check if processor only has v0.8 catalogs or if v0.8 buffering applies.
		ie := NewIntegrityErrorf("Surface not found for message: %s", surfaceID)
		ie.SurfaceID = surfaceID
		return ie
	}

	components, ok := CloneJSONValue(op.components).([]any)
	if !ok {
		ve := NewValidationError("Components payload must be a list.")
		ve.Path = "/components"
		ve.SurfaceID = surfaceID
		return ve
	}

	atLeastV10 := surface.ProtocolVersion != "" && IsAtLeastVersion(string(surface.ProtocolVersion), Version1_0)
	newModels := make([]*ComponentModel, 0, len(components))

	for compIdx, rawComp := range components {
		compDict, ok := rawComp.(map[string]any)
		if !ok {
			ve := NewValidationError("Component must be an object")
			ve.Path = fmt.Sprintf("/components/%d", compIdx)
			ve.SurfaceID = surfaceID
			return ve
		}
		cID, _ := compDict["id"].(string)
		if cID == "" {
			ve := NewValidationError("Component update payload is missing an 'id' / missing required 'id' field.")
			ve.Path = fmt.Sprintf("/components/%d/id", compIdx)
			ve.SurfaceID = surfaceID
			return ve
		}

		existing := surface.ComponentsModel.Get(cID)
		compTypeRaw, _ := compDict["component"].(string)
		if existing == nil && compTypeRaw == "" {
			ve := NewValidationErrorf("Cannot create component %s without a type.", cID)
			ve.Path = fmt.Sprintf("/components/%d/component", compIdx)
			ve.SurfaceID = surfaceID
			return ve
		}
		if atLeastV10 && compTypeRaw == "" {
			ve := NewValidationError(
				fmt.Sprintf("Component %s is missing the required 'component' field.", cID),
				ErrorDetail{
					Path:      fmt.Sprintf("components.%s.component", cID),
					Code:      "missing_field",
					Message:   "'component' is a required property",
					SurfaceID: surfaceID,
				},
			)
			ve.Path = fmt.Sprintf("/components/%d/component", compIdx)
			ve.SurfaceID = surfaceID
			return ve
		}
		cType := compTypeRaw
		if cType == "" && existing != nil {
			cType = existing.Type
		}

		var compCatalog *Catalog
		var rawMetadata map[string]any
		properties := map[string]any{}

		if !atLeastV10 {
			if existing != nil && (compTypeRaw == "" || compTypeRaw == existing.Type) {
				compCatalog = existing.Catalog
			} else if surface.Catalog != nil {
				compCatalog = surface.Catalog
			} else {
				ce := NewCatalogErrorf("Component %s names no catalogId and surface %s has no default catalogId.", cID, surfaceID)
				ce.SurfaceID = surfaceID
				return ce
			}
			declared := getDeclaredComponentProperties(compCatalog, cType)
			for _, atKey := range []string{"@metadata", "@catalogId", "@accessibility", "@checks"} {
				if hasKey(compDict, atKey) && !declared[atKey] {
					ve := NewValidationError(
						fmt.Sprintf("Component '%s' does not allow '%s' before v1.0.", cID, atKey),
						ErrorDetail{
							Path:      fmt.Sprintf("components.%s.%s", cID, atKey),
							Code:      "extra_field",
							Message:   fmt.Sprintf("Additional properties are not allowed ('%s' was unexpected)", atKey),
							SurfaceID: surfaceID,
						},
					)
					ve.Path = fmt.Sprintf("/components/%d/%s", compIdx, atKey)
					ve.SurfaceID = surfaceID
					return ve
				}
			}
			for k, v := range compDict {
				if k != "id" && k != "component" {
					properties[k] = CloneJSONValue(v)
				}
			}
		} else {
			hasAtCat := hasKey(compDict, "@catalogId")
			hasBareCat := hasKey(compDict, "catalogId")
			defaultCustom := getCustomEnvelopeProperties(surface.Catalog, cType, true)
			bareCatIsCustom := hasBareCat && defaultCustom["catalogId"]

			var compCatID any
			var catIDKey string
			namesCatalog := false
			if hasAtCat {
				compCatID = compDict["@catalogId"]
				catIDKey = "@catalogId"
				namesCatalog = true
			} else if hasBareCat && !bareCatIsCustom {
				compCatID = compDict["catalogId"]
				catIDKey = "catalogId"
				namesCatalog = true
			}

			if namesCatalog {
				catIDStr, isStr := compCatID.(string)
				if !isStr {
					ve := NewValidationError(
						fmt.Sprintf("Component %s has a non-string '%s'.", cID, catIDKey),
						ErrorDetail{
							Path:      fmt.Sprintf("components.%s.%s", cID, catIDKey),
							Code:      "type_mismatch",
							Message:   fmt.Sprintf("'%s' must be a string", catIDKey),
							SurfaceID: surfaceID,
						},
					)
					ve.Path = fmt.Sprintf("/components/%d/%s", compIdx, catIDKey)
					ve.SurfaceID = surfaceID
					return ve
				}
				compCatalog = p.resolveCatalog(catIDStr)
				if hasAtCat && hasBareCat {
					checkCat := compCatalog
					if checkCat == nil {
						checkCat = surface.Catalog
					}
					if !getCustomEnvelopeProperties(checkCat, cType, true)["catalogId"] {
						msg := fmt.Sprintf("Component '%s' cannot specify both '@catalogId' and legacy 'catalogId'.", cID)
						ve := NewValidationError(msg, ErrorDetail{
							Path:      fmt.Sprintf("components.%s.@catalogId", cID),
							Code:      "conflicting_properties",
							Message:   msg,
							SurfaceID: surfaceID,
						})
						ve.Path = fmt.Sprintf("/components/%d/@catalogId", compIdx)
						ve.SurfaceID = surfaceID
						return ve
					}
				}
				if compCatalog == nil {
					ce := NewCatalogErrorf("Catalog not found: %s", catIDStr)
					ce.SurfaceID = surfaceID
					return ce
				}
				if compCatalog.ProtocolVersion() != "" && surface.ProtocolVersion != "" &&
					!isCatalogVersionCompatible(string(compCatalog.ProtocolVersion()), string(surface.ProtocolVersion)) {
					ce := NewCatalogErrorf(
						"Component %s catalog '%s' has different protocol version %s than surface %s (%s).",
						cID, catIDStr, versionWireOrLabel(compCatalog.ProtocolVersion()), surfaceID, versionWireOrLabel(surface.ProtocolVersion),
					)
					ce.SurfaceID = surfaceID
					return ce
				}
			} else if surface.Catalog != nil {
				compCatalog = surface.Catalog
			} else {
				ce := NewCatalogErrorf("Component %s names no catalogId and surface %s has no default catalogId.", cID, surfaceID)
				ce.SurfaceID = surfaceID
				return ce
			}

			customProps := getCustomEnvelopeProperties(compCatalog, cType, true)
			if hasBareCat && !hasAtCat && !bareCatIsCustom {
				delete(customProps, "catalogId")
			}
			for _, pair := range [][2]string{
				{"metadata", "@metadata"},
				{"catalogId", "@catalogId"},
				{"accessibility", "@accessibility"},
				{"checks", "@checks"},
			} {
				bareKey, atKey := pair[0], pair[1]
				if hasKey(compDict, atKey) && hasKey(compDict, bareKey) && !customProps[bareKey] {
					msg := fmt.Sprintf("Component '%s' cannot specify both '%s' and legacy '%s'.", cID, atKey, bareKey)
					ve := NewValidationError(msg, ErrorDetail{
						Path:      fmt.Sprintf("components.%s.%s", cID, atKey),
						Code:      "conflicting_properties",
						Message:   msg,
						SurfaceID: surfaceID,
					})
					ve.Path = fmt.Sprintf("/components/%d/%s", compIdx, atKey)
					ve.SurfaceID = surfaceID
					return ve
				}
			}

			var metaKey string
			var rawMetaAny any
			if hasKey(compDict, "@metadata") {
				metaKey = "@metadata"
				rawMetaAny = compDict["@metadata"]
			} else if hasKey(compDict, "metadata") && !customProps["metadata"] {
				metaKey = "metadata"
				rawMetaAny = compDict["metadata"]
			}
			if metaKey != "" {
				metaMap, isMap := rawMetaAny.(map[string]any)
				if !isMap || rawMetaAny == nil {
					ve := NewValidationError(
						fmt.Sprintf("Component '%s' %s must be an object.", cID, metaKey),
						ErrorDetail{
							Path:      fmt.Sprintf("components.%s.%s", cID, metaKey),
							Code:      "type_mismatch",
							Message:   fmt.Sprintf("'%s' must be an object", metaKey),
							SurfaceID: surfaceID,
						},
					)
					ve.Path = fmt.Sprintf("/components/%d/%s", compIdx, metaKey)
					ve.SurfaceID = surfaceID
					return ve
				}
				if err := ValidateMetadata(metaMap, Version1_0); err != nil {
					ve := NewValidationError(err.Error(), ErrorDetail{
						Path:      fmt.Sprintf("components.%s.%s", cID, metaKey),
						Code:      "invalid_metadata",
						Message:   err.Error(),
						SurfaceID: surfaceID,
					})
					ve.Path = fmt.Sprintf("/components/%d/%s", compIdx, metaKey)
					ve.SurfaceID = surfaceID
					return ve
				}
				rawMetadata = metaMap
			}

			isCheckable := isComponentCheckable(compCatalog, cType)
			for k, v := range compDict {
				if k == "id" || k == "component" || k == "@catalogId" || k == "@metadata" {
					continue
				}
				if k == "catalogId" && !customProps["catalogId"] {
					continue
				}
				if k == "metadata" && !customProps["metadata"] {
					continue
				}
				if k == "accessibility" && !customProps["accessibility"] {
					properties["@accessibility"] = CloneJSONValue(v)
					continue
				}
				if k == "checks" && !customProps["checks"] && isCheckable {
					properties["@checks"] = CloneJSONValue(v)
					continue
				}
				properties[k] = CloneJSONValue(v)
			}
		}

		cm, err := NewComponentModel(cID, cType, compCatalog, properties, rawMetadata)
		if err != nil {
			return attachSurfaceID(err, surfaceID)
		}
		newModels = append(newModels, cm)
	}

	var nestedErr *ValidationError
	if atLeastV10 {
		if err := p.validateSurfaceNestedFunctionCalls(surface, newModels, valCfg); err != nil {
			if ve, ok := err.(*ValidationError); ok {
				nestedErr = ve
			} else {
				return err
			}
		}
	}

	if err := surface.ComponentsModel.ValidateComponentsUpdate(newModels, surface.RootID, valCfg, surfaceID); err != nil {
		if nestedErr == nil {
			return err
		}
		// Only merge pure *ValidationError (not *IntegrityError / *RecursionError).
		if ve, ok := err.(*ValidationError); ok {
			return mergeValidationErrors(nestedErr, ve)
		}
		return nestedErr
	}
	if nestedErr != nil {
		surface.ComponentsModel.pendingBound = nil
		surface.ComponentsModel.pendingBoundAt = -1
		return nestedErr
	}

	for _, comp := range newModels {
		surface.ComponentsModel.Upsert(comp)
	}
	surface.ComponentsModel.commitValidatedUpdate()
	return nil
}

func (p *MessageProcessor) validateSurfaceNestedFunctionCalls(
	surface *SurfaceModel,
	components []*ComponentModel,
	valCfg *ValidationConfig,
) error {
	var errors []ErrorDetail
	var summaries []string

	var visit func(comp *ComponentModel, node any, path string) error
	visit = func(comp *ComponentModel, node any, path string) error {
		switch typed := node.(type) {
		case []any:
			for idx, item := range typed {
				if err := visit(comp, item, fmt.Sprintf("%s.%d", path, idx)); err != nil {
					return err
				}
			}
		case map[string]any:
			if fnName, ok := typed["@call"].(string); ok && !strings.HasPrefix(fnName, "@") {
				if err := p.checkOneNestedSurfaceCall(surface, comp, fnName, typed, path, valCfg, &errors, &summaries); err != nil {
					return err
				}
			}
			keys := make([]string, 0, len(typed))
			for k := range typed {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, k := range keys {
				if err := visit(comp, typed[k], path+"."+k); err != nil {
					return err
				}
			}
		}
		return nil
	}

	for _, comp := range components {
		keys := make([]string, 0, len(comp.Properties))
		for k := range comp.Properties {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			if err := visit(comp, comp.Properties[k], k); err != nil {
				return err
			}
		}
	}

	if len(errors) > 0 {
		var firstPath string
		for _, d := range errors {
			for idx, comp := range components {
				if strings.HasPrefix(d.Path, "components."+comp.ID+".") {
					idxCopy := idx
					firstPath = resolveComponentErrorPath(d, comp.ID, &idxCopy)
					break
				}
			}
			if firstPath != "" {
				break
			}
		}
		ve := NewValidationError(strings.Join(summaries, "\n"), errors...)
		ve.Path = firstPath
		ve.SurfaceID = surface.ID
		return ve
	}
	return nil
}

func (p *MessageProcessor) checkOneNestedSurfaceCall(
	surface *SurfaceModel,
	comp *ComponentModel,
	fnName string,
	call map[string]any,
	path string,
	valCfg *ValidationConfig,
	errors *[]ErrorDetail,
	summaries *[]string,
) error {
	callPath := fmt.Sprintf("components.%s.%s", comp.ID, path)
	var catIDPtr *string
	if rawCat, hasCat := call["catalogId"]; hasCat {
		catStr, ok := rawCat.(string)
		if !ok {
			if valCfg != nil {
				return nil
			}
			*summaries = append(*summaries, fmt.Sprintf("Function call '%s' in component '%s' has a non-string 'catalogId'.", fnName, comp.ID))
			*errors = append(*errors, ErrorDetail{
				Path:      callPath + ".catalogId",
				Code:      "type_mismatch",
				Message:   "'catalogId' must be a string",
				SurfaceID: surface.ID,
			})
			return nil
		}
		catIDPtr = &catStr
	}

	subject := fmt.Sprintf("Function call '%s' in component '%s'", fnName, comp.ID)
	targetCat, err := surface.ResolveCatalog(catIDPtr, subject)
	if err != nil {
		if catIDPtr != nil && p.resolveCatalog(*catIDPtr) != nil {
			ce := NewCatalogErrorf(
				"Catalog '%s' is not available on surface %s: its protocol version does not match the surface (%s).",
				*catIDPtr, surface.ID, versionWireOrLabel(surface.ProtocolVersion),
			)
			ce.SurfaceID = surface.ID
			return ce
		}
		return attachSurfaceID(err, surface.ID)
	}

	if valCfg == nil {
		return nil
	}
	runsInCompCat := false
	if catIDPtr == nil {
		runsInCompCat = (comp.Catalog == surface.Catalog)
	} else if comp.Catalog != nil {
		runsInCompCat = (*catIDPtr == comp.Catalog.CatalogID())
	}
	if runsInCompCat {
		return nil
	}

	checkErr := checkRendererMayCall(targetCat, fnName)
	if checkErr == nil {
		_, checkErr = NewPayloadValidator(targetCat, valCfg).ValidateFunctionArgs(fnName, call["args"])
	}
	if checkErr != nil {
		if ve, ok := checkErr.(*ValidationError); ok {
			*summaries = append(*summaries, fmt.Sprintf("Validation failed for function call '%s' in component '%s': %v", fnName, comp.ID, ve))
			rebased := rebaseFunctionErrorDetails(ve, fnName, callPath, "invalid_function_call")
			for i := range rebased {
				rebased[i].SurfaceID = surface.ID
			}
			*errors = append(*errors, rebased...)
		}
	}
	return nil
}

func (p *MessageProcessor) applyUpdateData(op internalUpdateDataOp) error {
	surfaceID := op.surfaceID
	surface := p.Model.Surface(surfaceID)
	if surface == nil {
		ie := NewIntegrityErrorf("Surface not found for message: %s", surfaceID)
		ie.SurfaceID = surfaceID
		return ie
	}
	if op.hasPath && op.path != "" && (!strings.HasPrefix(op.path, "/") || !relaxedPathPattern.MatchString(op.path)) {
		msg := fmt.Sprintf("Invalid path syntax: '%s' (path must be a valid RFC 6901 JSON Pointer starting with '/')", op.path)
		ve := NewValidationError(msg, ErrorDetail{
			Path:      "/path",
			Code:      "invalid_value",
			Message:   msg,
			SurfaceID: surfaceID,
		})
		ve.Path = "/path"
		ve.SurfaceID = surfaceID
		return ve
	}
	ptr := op.path
	if ptr == "" {
		ptr = "/"
	}
	if err := surface.DataModel.Set(ptr, op.value); err != nil {
		if de, ok := err.(*DataError); ok {
			if de.Path == "" {
				de.Path = ptr
			}
			de.SurfaceID = surfaceID
		}
		return attachSurfaceID(err, surfaceID)
	}
	return nil
}

func mergeValidationErrors(first, second *ValidationError) *ValidationError {
	type key struct{ path, code, msg string }
	seen := map[key]bool{}
	var details []ErrorDetail
	var added []ErrorDetail
	for _, d := range first.Details {
		k := key{d.Path, d.Code, d.Message}
		if !seen[k] {
			seen[k] = true
			details = append(details, d)
		}
	}
	for _, d := range second.Details {
		k := key{d.Path, d.Code, d.Message}
		if !seen[k] {
			seen[k] = true
			details = append(details, d)
			added = append(added, d)
		}
	}
	msg := first.Message
	if len(added) == len(second.Details) {
		msg = first.Message + "\n" + second.Message
	} else if len(added) > 0 {
		var lines []string
		for _, d := range added {
			lines = append(lines, fmt.Sprintf("%s: %s", d.Path, d.Message))
		}
		msg = first.Message + "\nValidation failed for component:\n" + strings.Join(lines, "\n")
	}
	out := NewValidationError(msg, details...)
	out.Code = first.Code
	if out.Code == "" {
		out.Code = second.Code
	}
	out.Path = first.Path
	if out.Path == "" {
		out.Path = second.Path
	}
	out.SurfaceID = first.SurfaceID
	if out.SurfaceID == "" {
		out.SurfaceID = second.SurfaceID
	}
	out.FunctionCallID = first.FunctionCallID
	if out.FunctionCallID == "" {
		out.FunctionCallID = second.FunctionCallID
	}
	return out
}

func isCatalogVersionCompatible(catVer, msgVer string) bool {
	if catVer == "" || msgVer == "" {
		return false
	}
	cv, ok1 := ParseSemVer(catVer)
	mv, ok2 := ParseSemVer(msgVer)
	if ok1 && ok2 {
		if cv == mv {
			return true
		}
		if cv.Major == 0 && mv.Major == 0 && cv.Minor == 9 && mv.Minor == 9 &&
			(cv.Patch == 0 || cv.Patch == 1) && (mv.Patch == 0 || mv.Patch == 1) {
			return true
		}
		if cv.Major >= 1 && cv.Major == mv.Major {
			return true
		}
		return false
	}
	return strings.EqualFold(strings.TrimPrefix(catVer, "v"), strings.TrimPrefix(msgVer, "v"))
}

// Error Mapping

type errorEnvelopeContext struct {
	version        string
	action         string
	surfaceID      string
	functionCallID string
}

func extractErrorContextFromPayload(raw any) errorEnvelopeContext {
	ctx := errorEnvelopeContext{version: "1.0"}
	if raw == nil {
		return ctx
	}
	switch typed := normalizeProcessorPayload(raw).(type) {
	case []any:
		if len(typed) > 0 {
			return extractErrorContextFromPayload(typed[len(typed)-1])
		}
	case map[string]any:
		if typed == nil {
			return ctx
		}
		if msgs, ok := typed["messages"].([]any); ok && len(msgs) > 0 {
			return extractErrorContextFromPayload(msgs[len(msgs)-1])
		}
		for _, k := range []string{"createSurface", "updateComponents", "updateDataModel", "deleteSurface", "callRendererFunction", "beginRendering", "surfaceUpdate", "dataModelUpdate"} {
			if hasKey(typed, k) {
				ctx.action = k
				break
			}
		}
		if rawVer, ok := typed["version"].(string); ok {
			if norm, err := ToProtocolVersion(rawVer); err == nil {
				ctx.version = versionWireOrLabel(norm)
			}
		} else if ctx.action == "beginRendering" || ctx.action == "surfaceUpdate" || ctx.action == "dataModelUpdate" {
			ctx.version = "v0.8"
		}
		if ctx.action != "" {
			if inner, ok := typed[ctx.action].(map[string]any); ok {
				ctx.surfaceID, _ = inner["surfaceId"].(string)
				ctx.functionCallID, _ = inner["functionCallId"].(string)
			}
		}
	}
	return ctx
}

// MapErrorToRendererMessage converts an A2UI error into a protocol error envelope.
func MapErrorToRendererMessage(err error, version ProtocolVersion, surfaceID string, functionCallID string) map[string]any {
	ctx := errorEnvelopeContext{
		version:        versionWireOrLabel(version),
		surfaceID:      surfaceID,
		functionCallID: functionCallID,
	}
	if ctx.version == "" {
		ctx.version = "1.0"
	}
	return mapErrorWithContext(err, ctx)
}

func mapErrorToRendererMessageFromPayload(err error, rawPayload any) map[string]any {
	return mapErrorWithContext(err, extractErrorContextFromPayload(rawPayload))
}

func mapErrorWithContext(err error, ctx errorEnvelopeContext) map[string]any {
	if err == nil {
		return nil
	}
	code, msg, sid, fcID, errPath := classifyErrorForWire(err, ctx)
	errBody := map[string]any{
		"code":    code,
		"message": msg,
	}
	if code == "INVALID_FUNCTION_CALL" {
		errBody["functionCallId"] = fcID
	} else {
		errBody["surfaceId"] = sid
		if errPath != "" {
			errBody["path"] = errPath
		}
	}
	return map[string]any{
		"version": ctx.version,
		"error":   errBody,
	}
}

func classifyErrorForWire(err error, ctx errorEnvelopeContext) (code, msg, sid, fcID, path string) {
	msg = err.Error()
	sid = ctx.surfaceID
	fcID = ctx.functionCallID

	switch e := err.(type) {
	case *catalogVersionMismatchError:
		code = e.Code
		if code == "" {
			code = "CATALOG_NOT_FOUND"
		}
		if e.SurfaceID != "" {
			sid = e.SurfaceID
		}
		if e.Path != "" {
			path = toJSONPointer(e.Path)
		}
	case *RecursionError:
		code = e.Code
		if code == "" {
			code = "RECURSION_LIMIT_EXCEEDED"
		}
		if e.SurfaceID != "" {
			sid = e.SurfaceID
		}
		if e.Path != "" {
			path = toJSONPointer(e.Path)
		}
	case *IntegrityError:
		code = e.Code
		if code == "" {
			code = "INTEGRITY_ERROR"
		}
		if e.SurfaceID != "" {
			sid = e.SurfaceID
		}
		if e.Path != "" {
			path = toJSONPointer(e.Path)
		}
	case *CatalogError:
		code = e.Code
		if code == "" {
			code = "CATALOG_NOT_FOUND"
		}
		if e.SurfaceID != "" {
			sid = e.SurfaceID
		}
	case *StateError:
		code = e.Code
		if code == "" {
			code = "SURFACE_NOT_FOUND"
		}
		if e.SurfaceID != "" {
			sid = e.SurfaceID
		}
	case *DataError:
		code = e.Code
		if code == "" {
			code = "DATA_ERROR"
		}
		if e.SurfaceID != "" {
			sid = e.SurfaceID
		}
		if e.Path != "" {
			path = toJSONPointer(e.Path)
		}
	case *ExpressionError:
		code = e.Code
		if code == "" {
			code = "EXPRESSION_ERROR"
		}
		if e.SurfaceID != "" {
			sid = e.SurfaceID
		}
	case *RPCError:
		code = string(e.RPCCode)
		if code == "" {
			code = "INVALID_FUNCTION_CALL"
		}
		if e.FunctionCallID != "" {
			fcID = e.FunctionCallID
		}
		if e.SurfaceID != "" {
			sid = e.SurfaceID
		}
	case *ValidationError:
		code = e.Code
		if code == "" {
			if ctx.action == "callRendererFunction" {
				code = "INVALID_FUNCTION_CALL"
			} else {
				code = "VALIDATION_FAILED"
			}
		}
		if e.SurfaceID != "" {
			sid = e.SurfaceID
		}
		if e.FunctionCallID != "" {
			fcID = e.FunctionCallID
		}
		if e.Path != "" {
			path = toJSONPointer(e.Path)
		} else if len(e.Details) > 0 && e.Details[0].Path != "" {
			path = toJSONPointer(e.Details[0].Path)
		}
	default:
		if ctx.action == "callRendererFunction" {
			code = "INVALID_FUNCTION_CALL"
		} else {
			code = "INTERNAL_ERROR"
		}
	}
	return code, msg, sid, fcID, path
}
