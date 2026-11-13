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

package express

import (
	"fmt"
	"maps"
	"reflect"
	"slices"
	"strings"

	"github.com/a2ui-project/a2ui/go/agent/internal/envelope"
	"github.com/a2ui-project/a2ui/go/agent/internal/schemahelper"
)

type propArgPair struct {
	prop string
	val  any
}

func (c *Compiler) compileASTNode(
	varName string,
	ast any,
	rawSymbols map[string]any,
	ctx *compileContext,
) (map[string]any, error) {
	call, ok := ast.(*CallNode)
	if !ok || call == nil {
		return nil, nil
	}

	compName := call.Name
	args := call.Args
	kwargs := slices.Clone(call.Kwargs)

	if strings.HasPrefix(compName, "@") {
		if _, err := c.systemFunctionHelper(compName, kwargs, ctx); err != nil {
			return nil, err
		}
		return nil, nil
	}

	var compCatID any
	hasCompCatID := false
	filteredKwargs := make([]NamedArg, 0, len(kwargs))
	for _, kw := range kwargs {
		if kw.Name == "catalogId" {
			compCatID = kw.Value
			hasCompCatID = true
			continue
		}
		filteredKwargs = append(filteredKwargs, kw)
	}
	kwargs = filteredKwargs

	if !c.definesComponent(compName, compCatID) &&
		(((compName == "Event" || compName == "_template") && (!hasCompCatID || compCatID == nil)) ||
			c.definesFunction(compName, compCatID)) {
		return nil, nil
	}

	compHelper, writeCatID, err := c.resolve(
		"component",
		compName,
		compCatID,
		hasCompCatID,
		ctx,
		fmt.Sprintf("Component '%s'", compName),
		"component",
	)
	if err != nil {
		return nil, err
	}

	properties := compHelper.ComponentProperties(compName)
	propSet := make(map[string]bool, len(properties))
	for _, p := range properties {
		propSet[p] = true
	}

	compID, err := componentIDOf(varName, call, ctx.atLeastV10)
	if err != nil {
		return nil, err
	}

	var rawExtensions any
	hasRawExtensions := false
	remainingKwargs := make([]NamedArg, 0, len(kwargs))
	for _, kw := range kwargs {
		if kw.Name == idKey {
			continue
		}
		if kw.Name == extensionsKey && !propSet[extensionsKey] {
			rawExtensions = kw.Value
			hasRawExtensions = true
			continue
		}
		remainingKwargs = append(remainingKwargs, kw)
	}
	kwargs = remainingKwargs

	compDict := map[string]any{
		"id":        compID,
		"component": compName,
	}
	if writeCatID != nil {
		compDict[envelope.Key("catalogId", ctx.atLeastV10)] = *writeCatID
	}
	if hasRawExtensions && rawExtensions != nil {
		compiledExt, extErr := c.compileExtensions(rawExtensions, rawSymbols, fmt.Sprintf("Component '%s'", compName), ctx)
		if extErr != nil {
			return nil, extErr
		}
		compDict[envelope.Key("metadata", ctx.atLeastV10)] = map[string]any{"extensions": compiledExt}
	} else if hasRawExtensions && rawExtensions == nil {
		if _, extErr := c.compileExtensions(nil, rawSymbols, fmt.Sprintf("Component '%s'", compName), ctx); extErr != nil {
			return nil, extErr
		}
	}

	custom := compHelper.CustomEnvelopeProperties(compName)
	var nonCheckProperties []string
	for _, p := range properties {
		if p != "checks" || custom["checks"] {
			nonCheckProperties = append(nonCheckProperties, p)
		}
	}

	var rawChecks []any
	var posArgs []any
	for _, arg := range args {
		if isCheckExpression(arg) {
			if list, isList := arg.([]any); isList {
				rawChecks = append(rawChecks, list...)
			} else {
				rawChecks = append(rawChecks, arg)
			}
			continue
		}
		posArgs = append(posArgs, arg)
	}

	kwargSet := make(map[string]bool, len(kwargs))
	for _, kw := range kwargs {
		kwargSet[kw.Name] = true
	}
	requiredProps := make(map[string]bool)
	for _, r := range compHelper.ComponentRequired(compName) {
		requiredProps[r] = true
	}

	var propArgPairs []propArgPair
	propIdx := 0
	for argIdx, arg := range posArgs {
		if propIdx >= len(nonCheckProperties) {
			return nil, NewValidationError(
				fmt.Sprintf(
					"%s takes at most %d positional arguments (%s), but component '%s' passes %d.",
					compName, len(nonCheckProperties), strings.Join(nonCheckProperties, ", "), compID, len(posArgs),
				),
				"",
			)
		}
		if isNumericASTLiteral(arg) && !compHelper.AcceptsNumber(compHelper.PropertySchema(compName, nonCheckProperties[propIdx])) {
			moved := false
			if argIdx == len(posArgs)-1 {
				var numericLater []int
				for laterIdx := propIdx + 1; laterIdx < len(nonCheckProperties); laterIdx++ {
					laterProp := nonCheckProperties[laterIdx]
					if !kwargSet[laterProp] && compHelper.AcceptsNumber(compHelper.PropertySchema(compName, laterProp)) {
						numericLater = append(numericLater, laterIdx)
					}
				}
				if len(numericLater) == 1 {
					targetIdx := numericLater[0]
					allOptionalEnum := true
					for idx := propIdx; idx < targetIdx; idx++ {
						midProp := nonCheckProperties[idx]
						if requiredProps[midProp] || len(compHelper.PropertyEnum(compName, midProp)) == 0 {
							allOptionalEnum = false
							break
						}
					}
					if allOptionalEnum {
						propIdx = targetIdx
						moved = true
					}
				}
			}
			if !moved && !requiredProps[nonCheckProperties[propIdx]] && compHelper.CommonTypesLoaded {
				return nil, NewValidationError(
					fmt.Sprintf(
						"Positional argument %d for component '%s' is a number, which is not valid for optional property '%s'.",
						argIdx+1, compName, nonCheckProperties[propIdx],
					),
					"",
				)
			}
		}
		propArgPairs = append(propArgPairs, propArgPair{prop: nonCheckProperties[propIdx], val: arg})
		propIdx++
	}

	for _, kw := range kwargs {
		if isCheckExpression(kw.Value) {
			if list, isList := kw.Value.([]any); isList {
				rawChecks = append(rawChecks, list...)
			} else {
				rawChecks = append(rawChecks, kw.Value)
			}
			continue
		}
		propArgPairs = append(propArgPairs, propArgPair{prop: kw.Name, val: kw.Value})
	}

	var siblingValuePath map[string]any
	seenProperties := make(map[string]bool)
	for _, pair := range propArgPairs {
		propName := pair.prop
		arg := pair.val
		if !propSet[propName] {
			return nil, NewUnknownPropertyError(compName, propName, properties)
		}
		if seenProperties[propName] {
			return nil, NewDuplicatePropertyError(compName, propName)
		}
		seenProperties[propName] = true
		if _, isSkip := arg.(SkippedNode); isSkip {
			compDict[propName] = nil
			continue
		}

		propSchema := compHelper.PropertySchema(compName, propName)
		propType := compHelper.PropertyType(compName, propName)
		if propType == "" && !compHelper.CommonTypesLoaded {
			if propName == "child" {
				propType = "Child"
			} else if propName == "children" {
				propType = "ChildList"
			}
		}

		_, argIsList := arg.([]any)
		var slot *valueSlot
		if propSchema != nil {
			slot = &valueSlot{schema: propSchema, helper: compHelper}
		}
		mappedVal, vErr := c.compileValue(arg, rawSymbols, ctx, valueCompileOpts{
			isAction:               schemahelper.IsActionSlot(propSchema),
			parentID:               compID,
			parentProp:             propName,
			allowComponentRef:      propType == "Child",
			allowListComponentRefs: propType == "ChildList" && argIsList,
			slot:                   slot,
		})
		if vErr != nil {
			return nil, vErr
		}

		if propSchema != nil && !schemaAllowsDatabinding(propSchema) {
			if hasDatabinding(arg, rawSymbols, nil) {
				return nil, NewForbiddenDatabindingError(compName, propName)
			}
			if mappedList, ok := mappedVal.([]any); ok && schemahelper.ExpectsOptionObjects(propSchema) {
				coerced := make([]any, len(mappedList))
				for i, opt := range mappedList {
					if optStr, isStr := opt.(string); isStr {
						m := map[string]any{"label": optStr, "value": optStr}
						schemahelper.SetMapKeyOrder(m, []string{"label", "value"})
						coerced[i] = m
					} else {
						coerced[i] = opt
					}
				}
				mappedVal = coerced
			}
		}

		enumVals := compHelper.PropertyEnum(compName, propName)
		if len(enumVals) > 0 {
			_, isMap := mappedVal.(map[string]any)
			_, isSlice := mappedVal.([]any)
			if !isMap && !isSlice && !enumContainsValue(enumVals, mappedVal) {
				return nil, NewValidationError(
					fmt.Sprintf(
						"Value '%v' is not a valid enum choice for property '%s' of component '%s'. Allowed values are: %v",
						mappedVal, propName, compName, enumVals,
					),
					"",
				)
			}
		}
		compDict[propName] = mappedVal

		if propName == "value" && resolvesToPath(arg, rawSymbols) {
			if mp, ok := mappedVal.(map[string]any); ok {
				siblingValuePath = mp
			}
		}
	}

	if len(rawChecks) > 0 && !propSet["checks"] && !compHelper.IsCheckable(compName) {
		return nil, NewValidationError(
			fmt.Sprintf("Component '%s' does not declare a 'checks' property, so it cannot take checks.", compName),
			"",
		)
	}

	ctx.activeValuePath = siblingValuePath
	if len(rawChecks) > 0 {
		var compiledChecks []any
		for _, rcRaw := range rawChecks {
			if rc, ok := rcRaw.(CheckNode); ok {
				cond, msg, chkErr := c.compileCheck(rc, rawSymbols, ctx, false)
				if chkErr != nil {
					ctx.activeValuePath = nil
					return nil, chkErr
				}
				rule := map[string]any{"condition": cond, "message": msg}
				schemahelper.SetMapKeyOrder(rule, []string{"condition", "message"})
				compiledChecks = append(compiledChecks, rule)
			}
		}
		if len(compiledChecks) > 0 {
			compDict[envelope.Key("checks", ctx.atLeastV10)] = compiledChecks
		}
	}
	ctx.activeValuePath = nil

	for _, reqProp := range compHelper.ComponentRequired(compName) {
		if reqProp == "component" || reqProp == "id" {
			continue
		}
		if (reqProp == "checks" || reqProp == "@checks") && !custom[reqProp] {
			continue
		}
		if v, exists := compDict[reqProp]; !exists || v == nil {
			return nil, NewValidationError(
				fmt.Sprintf("Component '%s' missing required property '%s'.", compName, reqProp),
				"",
			)
		}
	}

	cleaned := make(map[string]any, len(compDict))
	for k, v := range compDict {
		if v != nil {
			cleaned[k] = v
		}
	}
	return cleaned, nil
}

func (c *Compiler) compileCheck(
	rc CheckNode,
	rawSymbols map[string]any,
	ctx *compileContext,
	isAction bool,
) (map[string]any, string, error) {
	checkName := rc.Name
	var explicitArgs []any
	var chkCatID any
	hasChkCatID := false

	for _, argItem := range rc.Args {
		if argMap, ok := argItem.(map[string]any); ok {
			if rawCat, hasCat := argMap["catalogId"]; hasCat {
				var otherKeys []string
				for _, k := range schemahelper.OrderedKeys(argMap) {
					if k != "catalogId" {
						otherKeys = append(otherKeys, k)
					}
				}
				if len(otherKeys) > 0 {
					return nil, "", NewValidationError(
						fmt.Sprintf("Unsupported key(s) in check options for '?%s': %s. Only 'catalogId' is allowed.",
							checkName, strings.Join(otherKeys, ", ")),
						"",
					)
				}
				if rawCat == nil {
					return nil, "", NewValidationError(
						fmt.Sprintf("Check '%s' catalogId must be a string, got: None", checkName),
						"",
					)
				}
				if hasChkCatID && !reflect.DeepEqual(chkCatID, rawCat) {
					return nil, "", NewValidationError(
						fmt.Sprintf("Check '?%s' specifies conflicting catalogId values.", checkName),
						"",
					)
				}
				chkCatID = rawCat
				hasChkCatID = true
				continue
			}
		}
		explicitArgs = append(explicitArgs, argItem)
	}

	chkHelper, writeCatID, err := c.resolve(
		"function",
		checkName,
		chkCatID,
		hasChkCatID,
		ctx,
		fmt.Sprintf("Check '%s'", checkName),
		"check function",
	)
	if err != nil {
		return nil, "", err
	}

	checkProps := chkHelper.FunctionProperties(checkName)
	messageVal := capitalizeCheckName(checkName) + " check failed"
	compiledArgs := make(map[string]any)
	var argOrder []string

	isValueInjected := false
	if len(checkProps) > 0 && checkProps[0] == "value" {
		hasExplicitBinding := false
		if len(explicitArgs) > 0 {
			_, hasExplicitBinding = explicitArgs[0].(PathNode)
		}
		if !hasExplicitBinding && ctx.activeValuePath != nil {
			compiledArgs["value"] = ctx.activeValuePath
			argOrder = append(argOrder, "value")
			isValueInjected = true
		}
	}

	startPropIdx := 0
	if isValueInjected {
		startPropIdx = 1
	}
	for cIdx, cArg := range explicitArgs {
		propTargetIdx := cIdx + startPropIdx
		if propTargetIdx >= len(checkProps) {
			if s, ok := cArg.(string); ok {
				messageVal = s
			}
			continue
		}
		propName := checkProps[propTargetIdx]
		propSchema := chkHelper.FunctionPropertySchema(checkName, propName)
		if s, isStr := cArg.(string); isStr && propSchema != nil {
			if st, ok := propSchema["type"].(string); ok && (st == "integer" || st == "number" || st == "boolean") {
				messageVal = s
				break
			}
		}
		if _, isSkip := cArg.(SkippedNode); isSkip {
			continue
		}
		val, vErr := c.compileValue(cArg, rawSymbols, ctx, valueCompileOpts{isAction: isAction})
		if vErr != nil {
			return nil, "", vErr
		}
		compiledArgs[propName] = val
		argOrder = append(argOrder, propName)
	}
	schemahelper.SetMapKeyOrder(compiledArgs, argOrder)

	condition := map[string]any{ctx.callKey: checkName}
	if writeCatID != nil {
		condition["catalogId"] = *writeCatID
	}
	condition["args"] = compiledArgs
	return condition, messageVal, nil
}

func (c *Compiler) compileEventCall(val *CallNode, rawSymbols map[string]any, ctx *compileContext) (map[string]any, error) {
	if len(val.Args) > 2 {
		return nil, NewValidationError(
			fmt.Sprintf("Event accepts at most 2 positional arguments (name, context), got %d.", len(val.Args)),
			"",
		)
	}
	for _, kw := range val.Kwargs {
		if !slices.Contains(eventKeywords, kw.Name) {
			return nil, NewInvalidParamError("Event", kw.Name, eventKeywords)
		}
	}
	_, hasCtxKw := val.Kwarg("context")
	if len(val.Args) == 2 && hasCtxKw {
		return nil, NewDuplicateParamError("Event", "context")
	}

	var compiledEventName any = ""
	if len(val.Args) > 0 {
		v, err := c.compileValue(val.Args[0], rawSymbols, ctx, valueCompileOpts{})
		if err != nil {
			return nil, err
		}
		compiledEventName = v
	}
	eventDict := map[string]any{"name": compiledEventName}

	if rawUM, hasUM := val.Kwarg("userMessage"); hasUM {
		if !ctx.atLeastV10 {
			return nil, NewValidationError(
				fmt.Sprintf("Event userMessage requires protocol v1.0 or later; the target version %s has no userMessage field.", ctx.version),
				"",
			)
		}
		userMessage, err := c.compileValue(rawUM, rawSymbols, ctx, valueCompileOpts{})
		if err != nil {
			return nil, err
		}
		isBindingOrCall := false
		if umMap, ok := userMessage.(map[string]any); ok {
			_, hasP := umMap[ctx.pathKey]
			_, hasC := umMap[ctx.callKey]
			isBindingOrCall = hasP || hasC
		}
		if _, isStr := userMessage.(string); !isStr && !isBindingOrCall {
			return nil, NewValidationError(
				fmt.Sprintf("Event userMessage must be a string, a $path data binding or a function call, got %s.", describeExpressValue(rawUM)),
				"",
			)
		}
		eventDict["userMessage"] = userMessage
	}

	var contextNode any
	hasContext := false
	if len(val.Args) == 2 {
		contextNode = val.Args[1]
		hasContext = true
	} else if ctxKw, ok := val.Kwarg("context"); ok {
		contextNode = ctxKw
		hasContext = true
	}
	if !hasContext {
		return map[string]any{"event": eventDict}, nil
	}

	rawContext, err := c.compileValue(contextNode, rawSymbols, ctx, valueCompileOpts{})
	if err != nil {
		return nil, err
	}
	compiledContext := make(map[string]any)
	var ctxKeys []string
	switch rc := rawContext.(type) {
	case map[string]any:
		for _, k := range schemahelper.OrderedKeys(rc) {
			compiledContext[k] = rc[k]
			ctxKeys = append(ctxKeys, k)
		}
	case []any:
		for _, item := range rc {
			if im, ok := item.(map[string]any); ok {
				for _, k := range schemahelper.OrderedKeys(im) {
					if _, exists := compiledContext[k]; !exists {
						ctxKeys = append(ctxKeys, k)
					}
					compiledContext[k] = im[k]
				}
			}
		}
	}
	schemahelper.SetMapKeyOrder(compiledContext, ctxKeys)
	eventDict["context"] = compiledContext
	return map[string]any{"event": eventDict}, nil
}

type valueCompileOpts struct {
	isAction               bool
	parentID               string
	parentProp             string
	listIndex              *int
	allowComponentRef      bool
	allowListComponentRefs bool
	slot                   *valueSlot
}

func (c *Compiler) compileValue(val any, rawSymbols map[string]any, ctx *compileContext, opts valueCompileOpts) (any, error) {
	switch v := val.(type) {
	case PathNode:
		return map[string]any{ctx.pathKey: v.Path}, nil

	case VariableNode:
		refName := v.Name
		ctx.referencedVars[refName] = true
		symbolVal, exists := rawSymbols[refName]
		if !exists {
			if !opts.allowComponentRef {
				if ctx.allowPending {
					return nil, &pendingVariableError{name: refName}
				}
				return nil, NewValidationError(fmt.Sprintf("Variable '%s' is not assigned in surface.", refName), "")
			}
			return refName, nil
		}
		if callVal, ok := symbolVal.(*CallNode); ok && callVal != nil {
			symCatID, _ := callVal.Kwarg("catalogId")
			if c.definesComponent(callVal.Name, symCatID) {
				return componentIDOf(refName, callVal, ctx.atLeastV10)
			}
		}
		if ctx.resolving[refName] {
			return nil, NewValidationError(fmt.Sprintf("Variable '%s' refers to itself through its own value.", refName), "")
		}
		ctx.resolving[refName] = true
		defer delete(ctx.resolving, refName)
		return c.compileValue(symbolVal, rawSymbols, ctx, valueCompileOpts{
			isAction:               opts.isAction,
			allowComponentRef:      opts.allowComponentRef,
			allowListComponentRefs: opts.allowListComponentRefs,
			slot:                   opts.slot,
		})

	case CheckNode:
		cond, _, err := c.compileCheck(v, rawSymbols, ctx, opts.isAction)
		return cond, err

	case *CallNode:
		return c.compileCall(v, rawSymbols, ctx, opts)

	case SkippedNode:
		return nil, NewValidationError("'_' can only stand in for an argument.", "")

	case map[string]any:
		keys := schemahelper.OrderedKeys(v)
		dictRes := make(map[string]any, len(v))
		for _, k := range keys {
			entryVal := v[k]
			entrySlot := propertySlot(opts.slot, k)
			entryRefType := ""
			if entrySlot != nil {
				entryRefType = schemahelper.SchemaRefType(entrySlot.schema)
				if entryRefType == "" && !entrySlot.helper.CommonTypesLoaded {
					if k == "child" {
						entryRefType = "Child"
					} else if k == "children" {
						entryRefType = "ChildList"
					}
				}
			}
			entryIsAction := opts.isAction || (entrySlot != nil && schemahelper.IsActionSlot(entrySlot.schema))
			_, isList := entryVal.([]any)
			compiledEntry, err := c.compileValue(entryVal, rawSymbols, ctx, valueCompileOpts{
				isAction:               entryIsAction,
				allowComponentRef:      entryRefType == "Child",
				allowListComponentRefs: entryRefType == "ChildList" && isList,
				slot:                   entrySlot,
			})
			if err != nil {
				return nil, err
			}
			dictRes[k] = compiledEntry
		}
		schemahelper.SetMapKeyOrder(dictRes, keys)
		return dictRes, nil

	case []any:
		iSlot := itemSlot(opts.slot)
		itemRefType := ""
		if iSlot != nil {
			itemRefType = schemahelper.SchemaRefType(iSlot.schema)
		}
		itemIsAction := opts.isAction || (iSlot != nil && schemahelper.IsActionSlot(iSlot.schema))
		out := make([]any, len(v))
		for idx, item := range v {
			idxCopy := idx
			compiledItem, err := c.compileValue(item, rawSymbols, ctx, valueCompileOpts{
				isAction:          itemIsAction,
				parentID:          opts.parentID,
				parentProp:        opts.parentProp,
				listIndex:         &idxCopy,
				allowComponentRef: opts.allowListComponentRefs || itemRefType == "Child",
				slot:              iSlot,
			})
			if err != nil {
				return nil, err
			}
			out[idx] = compiledItem
		}
		return out, nil

	default:
		return val, nil
	}
}

func (c *Compiler) compileCall(val *CallNode, rawSymbols map[string]any, ctx *compileContext, opts valueCompileOpts) (any, error) {
	fnName := val.Name
	fnArgs := val.Args

	if fnName == "_template" {
		if len(fnArgs) < 2 {
			return nil, NewParseError("_template helper requires exactly 2 arguments: path and templateComponent.", 0, 0, "")
		}
		pathVal, err := c.compileValue(fnArgs[0], rawSymbols, ctx, valueCompileOpts{isAction: opts.isAction})
		if err != nil {
			return nil, err
		}
		templatePath, ok := bindingPath(pathVal, ctx.pathKey)
		if !ok {
			return nil, NewParseError(
				fmt.Sprintf("The first argument to _template must be a dynamic data binding path (prefixed by $), got: %v", fnArgs[0]),
				0, 0, "",
			)
		}
		compIDVal, err := c.compileValue(fnArgs[1], rawSymbols, ctx, valueCompileOpts{
			isAction:          opts.isAction,
			allowComponentRef: true,
		})
		if err != nil {
			return nil, err
		}
		tpl := map[string]any{"path": templatePath, "componentId": compIDVal}
		schemahelper.SetMapKeyOrder(tpl, []string{"path", "componentId"})
		return tpl, nil
	}

	if fnName == "Event" {
		return c.compileEventCall(val, rawSymbols, ctx)
	}

	if strings.HasPrefix(fnName, "@") {
		return c.compileSystemCall(fnName, fnArgs, val.Kwargs, rawSymbols, ctx, opts.isAction)
	}

	strippedCall, callCatID, hasCallCatID := val.WithoutKwarg("catalogId")
	if c.definesComponent(fnName, callCatID) {
		var inlineID string
		if opts.parentID != "" && opts.parentProp != "" {
			if opts.listIndex != nil {
				inlineID = fmt.Sprintf("%s_%s_%d", opts.parentID, opts.parentProp, *opts.listIndex)
			} else {
				inlineID = fmt.Sprintf("%s_%s", opts.parentID, opts.parentProp)
			}
		} else {
			ctx.inlineCounter++
			inlineID = fmt.Sprintf("_inline_%d", ctx.inlineCounter)
		}

		actualID, err := componentIDOf(inlineID, val, ctx.atLeastV10)
		if err != nil {
			return nil, err
		}
		if ctx.usedIDs[actualID] {
			return nil, NewValidationError(fmt.Sprintf("Duplicate component ID '%s'.", actualID), "")
		}
		ctx.usedIDs[actualID] = true

		prevExtras := ctx.extraComponents
		ctx.extraComponents = nil
		compiledInline, err := c.compileASTNode(inlineID, val, rawSymbols, ctx)
		childExtras := ctx.extraComponents
		ctx.extraComponents = prevExtras
		if err != nil {
			return nil, err
		}
		if compiledInline != nil {
			ctx.extraComponents = append(ctx.extraComponents, compiledInline)
			ctx.extraComponents = append(ctx.extraComponents, childExtras...)
			return compiledInline["id"], nil
		}
		return inlineID, nil
	}

	callHelper, writeCatID, err := c.resolve(
		"function",
		fnName,
		callCatID,
		hasCallCatID,
		ctx,
		fmt.Sprintf("Call '%s'", fnName),
		"function",
	)
	if err != nil {
		return nil, err
	}
	compiledArgs, err := c.compileCallArgs(callHelper, fnName, fnArgs, strippedCall.Kwargs, rawSymbols, ctx, opts.isAction)
	if err != nil {
		return nil, err
	}

	resExpr := map[string]any{ctx.callKey: fnName}
	if writeCatID != nil {
		resExpr["catalogId"] = *writeCatID
	}
	resExpr["args"] = compiledArgs
	if opts.isAction {
		return map[string]any{"functionCall": resExpr}, nil
	}
	return resExpr, nil
}

func (c *Compiler) compileSystemCall(
	fnName string,
	fnArgs []any,
	rawKwargs []NamedArg,
	rawSymbols map[string]any,
	ctx *compileContext,
	isAction bool,
) (map[string]any, error) {
	helper, err := c.systemFunctionHelper(fnName, rawKwargs, ctx)
	if err != nil {
		return nil, err
	}
	compiledArgs, err := c.compileCallArgs(helper, fnName, fnArgs, rawKwargs, rawSymbols, ctx, isAction)
	if err != nil {
		return nil, err
	}
	resExpr := map[string]any{ctx.callKey: fnName}
	if len(compiledArgs) > 0 {
		resExpr["args"] = compiledArgs
	}
	if isAction {
		return map[string]any{"functionCall": resExpr}, nil
	}
	return resExpr, nil
}

func (c *Compiler) systemFunctionHelper(fnName string, rawKwargs []NamedArg, ctx *compileContext) (*schemahelper.CatalogSchemaHelper, error) {
	var helper *schemahelper.CatalogSchemaHelper
	if ctx.version == c.Version {
		helper = c.Helpers[c.CatalogOrder[0]]
	} else {
		c.sysFuncMu.RLock()
		cached, ok := c.sysFuncHelperByVr[ctx.version]
		c.sysFuncMu.RUnlock()
		if ok {
			helper = cached
		} else {
			built := schemahelper.NewCatalogSchemaHelper(c.catalogs[0], ctx.version)
			c.sysFuncMu.Lock()
			if existing, exists := c.sysFuncHelperByVr[ctx.version]; exists {
				helper = existing
			} else {
				c.sysFuncHelperByVr[ctx.version] = built
				helper = built
			}
			c.sysFuncMu.Unlock()
		}
	}

	if _, ok := helper.SystemFunctions[fnName]; !ok {
		sysNames := slices.Sorted(maps.Keys(helper.SystemFunctions))
		listDesc := "none"
		if len(sysNames) > 0 {
			listDesc = strings.Join(sysNames, ", ")
		}
		return nil, NewValidationError(
			fmt.Sprintf("Unknown system function '%s' in A2UI %s. System functions: %s.", fnName, ctx.version, listDesc),
			"",
		)
	}
	for _, kw := range rawKwargs {
		if kw.Name == "catalogId" {
			return nil, NewValidationError(
				fmt.Sprintf("System function '%s' is defined by the protocol, not a catalog, so it takes no catalogId.", fnName),
				"",
			)
		}
	}
	return helper, nil
}

func (c *Compiler) compileCallArgs(
	helper *schemahelper.CatalogSchemaHelper,
	fnName string,
	fnArgs []any,
	rawKwargs []NamedArg,
	rawSymbols map[string]any,
	ctx *compileContext,
	isAction bool,
) (map[string]any, error) {
	fnProps := helper.FunctionProperties(fnName)
	propSet := make(map[string]bool, len(fnProps))
	for _, p := range fnProps {
		propSet[p] = true
	}

	compiledArgs := make(map[string]any)
	var argOrder []string

	for idx, arg := range fnArgs {
		if idx >= len(fnProps) {
			continue
		}
		if _, isSkip := arg.(SkippedNode); isSkip {
			continue
		}
		valItem, err := c.compileValue(arg, rawSymbols, ctx, valueCompileOpts{isAction: isAction})
		if err != nil {
			return nil, err
		}
		if valItem != nil {
			compiledArgs[fnProps[idx]] = valItem
			argOrder = append(argOrder, fnProps[idx])
		}
	}

	for _, kw := range rawKwargs {
		if !propSet[kw.Name] {
			return nil, NewInvalidParamError(fnName, kw.Name, fnProps)
		}
		if _, dup := compiledArgs[kw.Name]; dup {
			return nil, NewDuplicateParamError(fnName, kw.Name)
		}
		if _, isSkip := kw.Value.(SkippedNode); isSkip {
			continue
		}
		valItem, err := c.compileValue(kw.Value, rawSymbols, ctx, valueCompileOpts{isAction: isAction})
		if err != nil {
			return nil, err
		}
		if valItem != nil {
			compiledArgs[kw.Name] = valItem
			argOrder = append(argOrder, kw.Name)
		}
	}

	schemahelper.SetMapKeyOrder(compiledArgs, argOrder)
	return compiledArgs, nil
}
