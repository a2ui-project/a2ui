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
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"slices"
	"strconv"
	"strings"

	"github.com/a2ui-project/a2ui/go/agent/internal/envelope"
	"github.com/a2ui-project/a2ui/go/agent/internal/schemahelper"
	"github.com/a2ui-project/a2ui/go/core"
)

const (
	defaultDecompileSurfaceID = "default_surface"
	openSentinelTag           = "<a2ui>"
	closeSentinelTag          = "</a2ui>"
)

func isExpressVariableName(name string) bool {
	if !core.IsValidUAX31Identifier(name) {
		return false
	}
	switch name {
	case "_", "true", "false", "null":
		return false
	default:
		return true
	}
}

func deriveVariableName(componentID string) string {
	var b strings.Builder
	for _, r := range componentID {
		if core.IsValidUAX31Identifier("_" + string(r)) {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	base := b.String()
	for !isExpressVariableName(base) {
		base = "_" + base
	}
	return base
}

func assignVariableNames(componentIDs []string) map[string]string {
	names := make(map[string]string, len(componentIDs))
	taken := make(map[string]bool, len(componentIDs))
	for _, cid := range componentIDs {
		if isExpressVariableName(cid) {
			names[cid] = cid
			taken[cid] = true
		}
	}
	for _, cid := range componentIDs {
		if _, exists := names[cid]; exists {
			continue
		}
		base := deriveVariableName(cid)
		name := base
		suffix := 2
		for taken[name] {
			name = fmt.Sprintf("%s_%d", base, suffix)
			suffix++
		}
		names[cid] = name
		taken[name] = true
	}
	return names
}

func shortestDigits(val float64) (string, int) {
	formatted := strconv.FormatFloat(val, 'e', -1, 64)
	mantissa, expText, _ := strings.Cut(formatted, "e")
	intPart, fracPart, _ := strings.Cut(mantissa, ".")
	rawDigits := intPart + fracPart
	digits := strings.TrimLeft(rawDigits, "0")
	if digits == "" {
		return "0", 1
	}
	expInt, _ := strconv.Atoi(expText)
	exponent := expInt + len(intPart) - (len(rawDigits) - len(digits))
	return strings.TrimRight(digits, "0"), exponent
}

// ecmascriptNotation spells a decimal the way ECMAScript Number.prototype.toString does,
// except that an integral value written in plain decimal keeps a ".0" suffix so that it
// reads back as a float (matching the Python and Dart decompilers).
func ecmascriptNotation(negative bool, digits string, exponent int) string {
	k := len(digits)
	n := exponent
	var text string
	switch {
	case k <= n && n <= 21:
		text = digits + strings.Repeat("0", n-k) + ".0"
	case 0 < n && n <= 21:
		text = digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		text = "0." + strings.Repeat("0", -n) + digits
	default:
		fraction := ""
		if k > 1 {
			fraction = "." + digits[1:]
		}
		expVal := n - 1
		sign := "+"
		if expVal < 0 {
			sign = "-"
			expVal = -expVal
		}
		text = digits[:1] + fraction + "e" + sign + strconv.Itoa(expVal)
	}
	if negative {
		return "-" + text
	}
	return text
}

// DecompileNumber writes a number the way every A2UI Express decompiler spells it: an integer
// as its digits, and a finite float in ECMAScript Number.prototype.toString notation with ".0"
// kept on integral doubles and -0.0 written as "-0.0". JSON text must therefore be decoded with
// integers and floats kept distinct (int64 vs float64), as Python's json.loads does.
func DecompileNumber(val any) (string, error) {
	switch v := val.(type) {
	case int:
		return strconv.Itoa(v), nil
	case int64:
		return strconv.FormatInt(v, 10), nil
	case int32:
		return strconv.FormatInt(int64(v), 10), nil
	case int16:
		return strconv.FormatInt(int64(v), 10), nil
	case int8:
		return strconv.FormatInt(int64(v), 10), nil
	case uint:
		return strconv.FormatUint(uint64(v), 10), nil
	case uint64:
		return strconv.FormatUint(v, 10), nil
	case uint32:
		return strconv.FormatUint(uint64(v), 10), nil
	case uint16:
		return strconv.FormatUint(uint64(v), 10), nil
	case uint8:
		return strconv.FormatUint(uint64(v), 10), nil
	case json.Number:
		s := v.String()
		if !strings.ContainsAny(s, ".eE") {
			if iv, err := v.Int64(); err == nil {
				return strconv.FormatInt(iv, 10), nil
			}
		}
		fv, err := v.Float64()
		if err != nil {
			return "", NewValidationError(fmt.Sprintf("The number %v has no Express notation.", s), "")
		}
		return decompileFloat64(fv)
	case float32:
		return decompileFloat64(float64(v))
	case float64:
		return decompileFloat64(v)
	default:
		return fmt.Sprint(val), nil
	}
}

func decompileFloat64(val float64) (string, error) {
	if math.IsNaN(val) || math.IsInf(val, 0) {
		return "", NewValidationError(fmt.Sprintf("The number %v has no Express notation.", val), "")
	}
	negative := math.Signbit(val)
	if val == 0 {
		if negative {
			return "-0.0", nil
		}
		return "0", nil
	}
	digits, exponent := shortestDigits(math.Abs(val))
	return ecmascriptNotation(negative, digits, exponent), nil
}

var expressEscapedStringReplacer = strings.NewReplacer(
	`\`, `\\`,
	`"`, `\"`,
	"\n", `\n`,
	"\r", `\r`,
	"\t", `\t`,
)

func decompileString(val string) string {
	hasNewline := strings.ContainsAny(val, "\n\r")
	hasTab := strings.Contains(val, "\t")
	hasQuote := strings.Contains(val, `"`)
	hasBackslash := strings.Contains(val, `\`)

	if hasNewline && !strings.HasSuffix(val, `"`) && !strings.Contains(val, `"""`) {
		if hasBackslash && !hasTab {
			return `r"""` + val + `"""`
		}
		escaped := strings.ReplaceAll(val, `\`, `\\`)
		escaped = strings.ReplaceAll(escaped, "\t", `\t`)
		return `"""` + escaped + `"""`
	}

	if hasBackslash && !hasNewline && !hasTab && !hasQuote {
		return `r"` + val + `"`
	}

	return `"` + expressEscapedStringReplacer.Replace(val) + `"`
}

func decompileKey(key string) string {
	if isExpressVariableName(key) {
		return key
	}
	return decompileString(key)
}

func decompilePath(pathStr string) string {
	if strings.HasPrefix(pathStr, "/") {
		return "$/" + pathStr[1:]
	}
	return "$" + pathStr
}

func decompileReference(componentID any, varNames map[string]string) string {
	cid, ok := componentID.(string)
	if !ok {
		return decompileString(fmt.Sprint(componentID))
	}
	if mapped, exists := varNames[cid]; exists {
		return mapped
	}
	usedByOther := false
	for _, v := range varNames {
		if v == cid {
			usedByOther = true
			break
		}
	}
	if isExpressVariableName(cid) && !usedByOther {
		return cid
	}
	return decompileString(cid)
}

type pathValuePair struct {
	path string
	val  any
}

func flattenDataModel(dataDict map[string]any) []pathValuePair {
	var results []pathValuePair
	var recurse func(current any, path string)
	recurse = func(current any, path string) {
		if m, ok := current.(map[string]any); ok && len(m) > 0 {
			for _, k := range schemahelper.OrderedKeys(m) {
				recurse(m[k], path+"/"+k)
			}
			return
		}
		results = append(results, pathValuePair{path: path, val: current})
	}
	recurse(dataDict, "")
	return results
}

func isComponentReferenceProperty(propSchema map[string]any) bool {
	if propSchema == nil {
		return false
	}
	if ref, ok := propSchema["$ref"].(string); ok {
		if strings.Contains(ref, "ComponentId") || strings.Contains(ref, "Child") || strings.Contains(ref, "ChildList") {
			return true
		}
	}
	for _, combKey := range []string{"oneOf", "anyOf", "allOf"} {
		if subs, ok := propSchema[combKey].([]any); ok {
			for _, sub := range subs {
				if subMap, ok := sub.(map[string]any); ok && isComponentReferenceProperty(subMap) {
					return true
				}
			}
		}
	}
	if propSchema["type"] == "array" {
		if items, ok := propSchema["items"].(map[string]any); ok {
			return isComponentReferenceProperty(items)
		}
	}
	return false
}

func hasReservedKey(val map[string]any, name string) bool {
	if _, ok := val["@"+name]; ok {
		return true
	}
	_, ok := val[name]
	return ok
}

func reservedValue(val map[string]any, name string) any {
	if v, ok := val["@"+name]; ok {
		return v
	}
	return val[name]
}

func isRendererCallMessage(envelope map[string]any) bool {
	if _, ok := envelope["callRendererFunction"]; ok {
		return true
	}
	_, ok := envelope["callFunction"]
	return ok
}

func stripTrailingPlaceholders(args []string) []string {
	for len(args) > 0 && args[len(args)-1] == "_" {
		args = args[:len(args)-1]
	}
	return args
}

// Decompiler converts A2UI wire JSON envelopes back into A2UI Express DSL text.
type Decompiler struct {
	catalogs      []*core.Catalog
	helpers       map[string]*schemahelper.CatalogSchemaHelper
	helperOrder   []string
	soleCatalogID *string
	v1            bool
	pathKey       string
	callKey       string
}

// NewDecompiler constructs an Express Decompiler for one or more catalogs.
func NewDecompiler(catalogs []*core.Catalog, version string) (*Decompiler, error) {
	checked, err := schemahelper.CheckMixedCatalogs(catalogs)
	if err != nil {
		return nil, err
	}
	targetVersion := version
	if targetVersion == "" {
		catVer, verErr := schemahelper.CatalogsProtocolVersion(checked)
		if verErr != nil {
			return nil, verErr
		}
		targetVersion = catVer
	}
	order, helpers, err := schemahelper.BuildCatalogHelpers(checked, targetVersion)
	if err != nil {
		return nil, err
	}
	v1 := core.IsAtLeastVersion(targetVersion, core.Version1_0)
	pathKey := "path"
	callKey := "call"
	if v1 {
		pathKey = "@path"
		callKey = "@call"
	}
	var soleCatPtr *string
	if sole := schemahelper.SurfaceCatalogID(checked); sole != "" {
		soleCatPtr = &sole
	}
	return &Decompiler{
		catalogs:      checked,
		helpers:       helpers,
		helperOrder:   order,
		soleCatalogID: soleCatPtr,
		v1:            v1,
		pathKey:       pathKey,
		callKey:       callKey,
	}, nil
}

// Catalogs returns a shallow copy of the decompiler's catalogs.
func (d *Decompiler) Catalogs() []*core.Catalog {
	return slices.Clone(d.catalogs)
}

// WrapDecompiledBlocks encloses decompiled Express blocks in `<a2ui>` sentinel tags.
func (d *Decompiler) WrapDecompiledBlocks(blocks []string) string {
	return openSentinelTag + "\n" + strings.Join(blocks, "\n") + "\n" + closeSentinelTag
}

// Decompile converts A2UI messages into A2UI Express DSL statements.
func (d *Decompiler) Decompile(payload []core.AgentToRendererMessage, useKeywordArgs bool) (string, error) {
	coalesced := schemahelper.CoalesceSurfaceMessages(payload)
	var blocks []string
	callCount := 0
	for idx, item := range coalesced {
		if len(item.Message) == 0 {
			continue
		}
		var (
			block string
			err   error
		)
		if isRendererCallMessage(item.Message) {
			callCount++
			block, err = d.decompileRendererCall(item.Message, callCount)
		} else {
			block, err = d.decompileItem(item, useKeywordArgs, idx == 0)
		}
		if err != nil {
			return "", err
		}
		if block != "" {
			blocks = append(blocks, block)
		}
	}
	return strings.Join(blocks, "\n"), nil
}

func (d *Decompiler) isFunctionCall(val map[string]any) bool {
	if d.v1 {
		_, ok := val[d.callKey].(string)
		return ok
	}
	_, isCallStr := val["call"].(string)
	if !isCallStr {
		return false
	}
	_, hasArgs := val["args"]
	_, hasCat := val["catalogId"]
	return hasArgs || hasCat
}

func (d *Decompiler) checkComponentIDs(componentIDs []string) error {
	if !d.v1 {
		return nil
	}
	var details []core.ErrorDetail
	for _, cid := range componentIDs {
		if !core.IsValidUAX31Identifier(cid) {
			details = append(details, core.ErrorDetail{
				Path:    fmt.Sprintf("components.%s.id", cid),
				Code:    "invalid_identifier",
				Message: fmt.Sprintf("Component id '%s' must be a valid UAX #31 identifier", cid),
			})
		}
	}
	if len(details) > 0 {
		return core.NewValidationError(details[0].Message, details...)
	}
	return nil
}

func (d *Decompiler) helperFor(catalogID string) (*schemahelper.CatalogSchemaHelper, error) {
	h, ok := d.helpers[catalogID]
	if !ok {
		return nil, NewValidationError(
			fmt.Sprintf("Unknown catalog '%s'. Available catalogs: [%s]", catalogID, strings.Join(d.helperOrder, ", ")),
			"",
		)
	}
	return h, nil
}

func (d *Decompiler) surfaceCatalog(catalogID *string) (*string, error) {
	if d.soleCatalogID == nil {
		return catalogID, nil
	}
	if catalogID != nil && *catalogID != "" {
		if _, err := d.helperFor(*catalogID); err != nil {
			return nil, err
		}
	}
	return d.soleCatalogID, nil
}

func (d *Decompiler) resolve(
	kind string,
	name string,
	catalogID *string,
	surfaceCatID *string,
	label string,
) (*schemahelper.CatalogSchemaHelper, *string, error) {
	var actual string
	if catalogID != nil && *catalogID != "" {
		actual = *catalogID
	} else if surfaceCatID != nil && *surfaceCatID != "" {
		actual = *surfaceCatID
	}
	if actual == "" {
		capLabel := label
		if len(capLabel) > 0 {
			capLabel = strings.ToUpper(capLabel[:1]) + capLabel[1:]
		}
		return nil, nil, NewValidationError(
			fmt.Sprintf("%s '%s' names no catalogId, and its surface has no catalog.", capLabel, name),
			"",
		)
	}
	helper, err := d.helperFor(actual)
	if err != nil {
		return nil, nil, err
	}
	defined := false
	if kind == "component" {
		_, defined = helper.Components[name]
	} else {
		_, defined = helper.Functions[name]
	}
	if !defined {
		return nil, nil, NewValidationError(
			fmt.Sprintf("Unknown %s '%s' not defined in catalog '%s'.", label, name, actual),
			"",
		)
	}
	if d.soleCatalogID != nil {
		return helper, nil, nil
	}
	found := schemahelper.CatalogsDefining(d.helperOrder, d.helpers, kind, name)
	if len(found) == 1 && found[0] == actual {
		return helper, nil, nil
	}
	catCopy := actual
	return helper, &catCopy, nil
}

func (d *Decompiler) systemFunctionHelper(fn map[string]any, name string) (*schemahelper.CatalogSchemaHelper, error) {
	if len(d.helperOrder) == 0 {
		return nil, core.NewValidationError(fmt.Sprintf("Unknown system function '%s'.", name))
	}
	helper := d.helpers[d.helperOrder[0]]
	if _, ok := helper.SystemFunctions[name]; !ok {
		return nil, core.NewValidationError(fmt.Sprintf("Unknown system function '%s'.", name))
	}
	if _, hasCat := fn["catalogId"]; hasCat {
		return nil, core.NewValidationError(
			fmt.Sprintf("System function '%s' is defined by the protocol, not a catalog, so it takes no catalogId.", name),
		)
	}
	return helper, nil
}

func (d *Decompiler) surfaceHeader(surfaceID string) string {
	return fmt.Sprintf("surface(%s)", decompileString(surfaceID))
}

func (d *Decompiler) decompileItem(item schemahelper.CoalescedMessage, useKeywordArgs bool, isFirst bool) (string, error) {
	envelope := item.Message

	if delMap, ok := envelope[opDelete].(map[string]any); ok {
		sid, _ := delMap["surfaceId"].(string)
		return fmt.Sprintf("deleteSurface(%s)", decompileString(sid)), nil
	}

	if item.IsUpdate() {
		return d.decompileUpdate(item, useKeywordArgs, isFirst)
	}

	createSurface, _ := envelope[opCreate].(map[string]any)
	if createSurface == nil {
		createSurface = map[string]any{}
	}
	surfaceID, _ := createSurface["surfaceId"].(string)
	if surfaceID == "" {
		surfaceID = defaultDecompileSurfaceID
	}

	var rawCatID *string
	if cid, ok := createSurface["catalogId"].(string); ok && cid != "" {
		rawCatID = &cid
	} else if item.SurfaceCatalogID != "" {
		cid := item.SurfaceCatalogID
		rawCatID = &cid
	}
	catalogID, err := d.surfaceCatalog(rawCatID)
	if err != nil {
		return "", err
	}

	_, hasSendDataModel := createSurface["sendDataModel"]
	sendDataModelVal, _ := createSurface["sendDataModel"].(bool)

	var surfaceExtensions map[string]any
	if d.v1 {
		if meta, ok := createSurface["metadata"].(map[string]any); ok {
			if ext, ok := meta["extensions"].(map[string]any); ok {
				surfaceExtensions = ext
			}
		}
	}

	var dslLines []string
	if !(isFirst && surfaceID == defaultDecompileSurfaceID && !hasSendDataModel && surfaceExtensions == nil) {
		header := d.surfaceHeader(surfaceID)
		if hasSendDataModel {
			flag := "false"
			if sendDataModelVal {
				flag = "true"
			}
			header = header[:len(header)-1] + ", sendDataModel=" + flag + ")"
		}
		if surfaceExtensions != nil {
			extStr, extErr := d.decompileValue(surfaceExtensions, nil, false, catalogID)
			if extErr != nil {
				return "", extErr
			}
			header = header[:len(header)-1] + ", extensions=" + extStr + ")"
		}
		dslLines = append(dslLines, header)
	}

	if dm, ok := createSurface["dataModel"].(map[string]any); ok && len(dm) > 0 {
		pairs := flattenDataModel(dm)
		slices.SortFunc(pairs, func(a, b pathValuePair) int {
			return strings.Compare(a.path, b.path)
		})
		for _, pair := range pairs {
			valStr, valErr := d.decompileValue(pair.val, nil, false, catalogID)
			if valErr != nil {
				return "", valErr
			}
			dslLines = append(dslLines, fmt.Sprintf("$%s = %s", pair.path, valStr))
		}
	}

	components := extractMapSlice(createSurface["components"])
	compLines, err := d.decompileComponents(components, catalogID, useKeywordArgs)
	if err != nil {
		return "", err
	}
	dslLines = append(dslLines, compLines...)
	return strings.Join(dslLines, "\n"), nil
}

func (d *Decompiler) decompileUpdate(item schemahelper.CoalescedMessage, useKeywordArgs bool, isFirst bool) (string, error) {
	op := item.Operation()
	if op == "" {
		return "", NewValidationError("Expected a surface update operation key in message.", "")
	}
	body, _ := item.Message[op].(map[string]any)
	if body == nil {
		body = map[string]any{}
	}
	surfaceID, _ := body["surfaceId"].(string)
	if surfaceID == "" {
		surfaceID = defaultDecompileSurfaceID
	}
	var rawCatID *string
	if item.SurfaceCatalogID != "" {
		cid := item.SurfaceCatalogID
		rawCatID = &cid
	}
	catalogID, err := d.surfaceCatalog(rawCatID)
	if err != nil {
		return "", err
	}

	var components []map[string]any
	if op == opUpdateComponents {
		components = extractMapSlice(body["components"])
	}
	hasRoot := false
	for _, c := range components {
		if idStr, _ := c["id"].(string); idStr == "root" {
			hasRoot = true
			break
		}
	}
	header := d.surfaceHeader(surfaceID)
	if hasRoot {
		header = header[:len(header)-1] + ", update=true)"
	}

	var dslLines []string
	if hasRoot || !(isFirst && surfaceID == defaultDecompileSurfaceID) {
		dslLines = append(dslLines, header)
	}

	if op == opUpdateComponents {
		compLines, compErr := d.decompileComponents(components, catalogID, useKeywordArgs)
		if compErr != nil {
			return "", compErr
		}
		dslLines = append(dslLines, compLines...)
	} else {
		rawPath, _ := body["path"].(string)
		if rawPath == "" {
			rawPath = "/"
		}
		valStr, valErr := d.decompileValue(body["value"], nil, false, catalogID)
		if valErr != nil {
			return "", valErr
		}
		dslLines = append(dslLines, fmt.Sprintf("%s = %s", decompilePath(rawPath), valStr))
	}
	return strings.Join(dslLines, "\n"), nil
}

func (d *Decompiler) decompileRendererCall(envelope map[string]any, callIndex int) (string, error) {
	var funcOp map[string]any
	var functionCallID string
	if rc, ok := envelope["callRendererFunction"].(map[string]any); ok {
		if cf, ok := rc["callFunction"].(map[string]any); ok {
			funcOp = cf
			functionCallID, _ = rc["functionCallId"].(string)
		}
	}
	if funcOp == nil {
		funcOp, _ = envelope["callFunction"].(map[string]any)
	}
	if funcOp == nil {
		funcOp = map[string]any{}
	}
	callRepr, err := d.decompileCall(funcOp, nil, d.soleCatalogID)
	if err != nil {
		return "", err
	}
	if functionCallID != "" && functionCallID != fmt.Sprintf("call_%d", callIndex) {
		idArg := "functionCallId=" + decompileString(functionCallID)
		sep := ", "
		if strings.HasSuffix(callRepr, "()") {
			sep = ""
		}
		callRepr = callRepr[:len(callRepr)-1] + sep + idArg + ")"
	}
	return callRepr, nil
}

func (d *Decompiler) decompileComponents(
	components []map[string]any,
	surfaceCatID *string,
	useKeywordArgs bool,
) ([]string, error) {
	componentIDs := make([]string, 0, len(components))
	for _, c := range components {
		cid, _ := c["id"].(string)
		componentIDs = append(componentIDs, cid)
	}
	if err := d.checkComponentIDs(componentIDs); err != nil {
		return nil, err
	}
	varNames := assignVariableNames(componentIDs)
	dslLines := make([]string, 0, len(components))

	for _, c := range components {
		compID, _ := c["id"].(string)
		varName := varNames[compID]
		compName, _ := c["component"].(string)
		explicitCat, err := d.componentCatalogID(c, surfaceCatID)
		if err != nil {
			return nil, err
		}
		compHelper, writeCatID, err := d.resolve("component", compName, explicitCat, surfaceCatID, "component")
		if err != nil {
			return nil, err
		}

		properties := compHelper.ComponentProperties(compName)
		custom := compHelper.CustomEnvelopeProperties(compName)
		checkable := compHelper.IsCheckable(compName)
		var argsReprs []string
		// The catalogId= keyword names the component's catalog, so a property the
		// component declares as catalogId is written positionally, along with every
		// property before it.
		positionalUntil := -1
		if _, hasBareCatalogID := c["catalogId"]; useKeywordArgs && hasBareCatalogID {
			positionalUntil = slices.Index(properties, "catalogId")
		}

		for idx, propName := range properties {
			keyword := useKeywordArgs && idx > positionalUntil
			if propName == "checks" && !custom["checks"] && checkable {
				checksRepr, chkErr := d.decompileChecks(c, custom, varNames, surfaceCatID)
				if chkErr != nil {
					return nil, chkErr
				}
				if checksRepr == "" {
					checksRepr = "_"
				}
				argsReprs = append(argsReprs, checksRepr)
				continue
			}

			if val, exists := c[propName]; exists {
				pSchema := compHelper.PropertySchema(compName, propName)
				valStr, valErr := d.decompileValue(val, varNames, isComponentReferenceProperty(pSchema), surfaceCatID)
				if valErr != nil {
					return nil, valErr
				}
				if keyword {
					argsReprs = append(argsReprs, propName+"="+valStr)
				} else {
					argsReprs = append(argsReprs, valStr)
				}
			} else if !keyword {
				hasLater := false
				for _, later := range properties[idx+1:] {
					if later != "checks" || custom["checks"] {
						if _, ok := c[later]; ok {
							hasLater = true
							break
						}
					}
				}
				if hasLater {
					argsReprs = append(argsReprs, "_")
				}
			}
		}

		argsReprs = stripTrailingPlaceholders(argsReprs)

		// A component whose own checks property is not a list of check rules takes
		// its check rules after its positional properties.
		if custom["checks"] && checkable {
			checksRepr, chkErr := d.decompileChecks(c, custom, varNames, surfaceCatID)
			if chkErr != nil {
				return nil, chkErr
			}
			if checksRepr != "" {
				argsReprs = append(argsReprs, checksRepr)
			}
		}
		if writeCatID != nil {
			argsReprs = append(argsReprs, "catalogId="+decompileString(*writeCatID))
		}
		if varName != compID {
			argsReprs = append(argsReprs, "id="+decompileString(compID))
		}
		if d.v1 {
			if compMeta, ok := envelope.Value(c, "metadata", true, custom).(map[string]any); ok {
				if ext, ok := compMeta["extensions"].(map[string]any); ok {
					extStr, extErr := d.decompileValue(ext, varNames, false, surfaceCatID)
					if extErr != nil {
						return nil, extErr
					}
					argsReprs = append(argsReprs, "extensions="+extStr)
				}
			}
		}

		dslLines = append(dslLines, fmt.Sprintf("%s = %s(%s)", varName, compName, strings.Join(argsReprs, ", ")))
	}
	return dslLines, nil
}

// decompileChecks writes the check rules of component c, read from its checks
// envelope property, as one check or a list of checks. It returns "" when the
// component has no check rules.
func (d *Decompiler) decompileChecks(
	c map[string]any,
	custom map[string]bool,
	varNames map[string]string,
	surfaceCatID *string,
) (string, error) {
	checksVal := extractMapSlice(envelope.Value(c, "checks", d.v1, custom))
	if len(checksVal) == 0 {
		return "", nil
	}
	checkReprs := make([]string, 0, len(checksVal))
	for _, rc := range checksVal {
		cr, err := d.decompileCheck(rc, c, varNames, surfaceCatID)
		if err != nil {
			return "", err
		}
		checkReprs = append(checkReprs, cr)
	}
	if len(checkReprs) == 1 {
		return checkReprs[0], nil
	}
	return "[" + strings.Join(checkReprs, ", ") + "]", nil
}

// componentCatalogID returns the catalog override of component, or nil when it
// names none.
//
// From v1.0 the override is @catalogId. A bare catalogId, which v1.0 payloads used
// before the cutover, is read too, unless the catalog that defines the component
// declares catalogId as a property of the component.
func (d *Decompiler) componentCatalogID(component map[string]any, surfaceCatID *string) (*string, error) {
	if d.v1 {
		if raw, ok := component["@catalogId"]; ok {
			override, isStr := raw.(string)
			if !isStr || override == "" {
				id, hasID := component["id"].(string)
				if !hasID {
					id = "<unknown>"
				}
				return nil, NewValidationError(
					fmt.Sprintf("Component '%s' has an invalid '@catalogId': %#v.", id, raw),
					"",
				)
			}
			return &override, nil
		}
	}
	legacy, ok := component["catalogId"].(string)
	if !ok || legacy == "" {
		return nil, nil
	}
	if d.v1 && d.declaresCustomCatalogID(component, surfaceCatID) {
		return nil, nil
	}
	return &legacy, nil
}

// declaresCustomCatalogID reports whether the catalog that defines component
// declares catalogId as one of the component's own properties. It consults the
// surface's catalog when that catalog defines the component, and otherwise every
// catalog that defines it.
func (d *Decompiler) declaresCustomCatalogID(component map[string]any, surfaceCatID *string) bool {
	compName, ok := component["component"].(string)
	if !ok {
		return false
	}
	if surfaceCatID != nil && *surfaceCatID != "" {
		if home, ok := d.helpers[*surfaceCatID]; ok {
			if _, defines := home.Components[compName]; defines {
				return home.CustomEnvelopeProperties(compName)["catalogId"]
			}
		}
	}
	declaring := 0
	for _, catID := range d.helperOrder {
		helper := d.helpers[catID]
		if _, defines := helper.Components[compName]; !defines {
			continue
		}
		if !helper.CustomEnvelopeProperties(compName)["catalogId"] {
			return false
		}
		declaring++
	}
	return declaring > 0
}

func (d *Decompiler) decompileCheck(
	rule map[string]any,
	component map[string]any,
	varNames map[string]string,
	surfaceCatID *string,
) (string, error) {
	if _, hasCond := rule["condition"]; !hasCond && hasReservedKey(rule, "call") {
		rule = map[string]any{"condition": rule}
	}
	condition, ok := rule["condition"].(map[string]any)
	if !ok || !hasReservedKey(condition, "call") {
		return "", NewValidationError(
			fmt.Sprintf("Express cannot write a check whose condition is not a function call: %v", rule["condition"]),
			"",
		)
	}
	checkName, _ := reservedValue(condition, "call").(string)
	checkArgs, _ := condition["args"].(map[string]any)
	if checkArgs == nil {
		checkArgs = map[string]any{}
	}
	var explicitCat *string
	if catStr, ok := condition["catalogId"].(string); ok && catStr != "" {
		explicitCat = &catStr
	}
	chkHelper, writeCatID, err := d.resolve("function", checkName, explicitCat, surfaceCatID, "check function")
	if err != nil {
		return "", err
	}
	checkProps := chkHelper.FunctionProperties(checkName)

	componentValue, compValIsMap := component["value"].(map[string]any)
	startIdx := 0
	if len(checkProps) > 0 && checkProps[0] == "value" && compValIsMap && hasReservedKey(componentValue, "path") && reflect.DeepEqual(checkArgs["value"], componentValue) {
		startIdx = 1
	}

	var argsReprs []string
	for _, p := range checkProps[startIdx:] {
		if argVal, exists := checkArgs[p]; exists {
			s, valErr := d.decompileValue(argVal, varNames, false, surfaceCatID)
			if valErr != nil {
				return "", valErr
			}
			argsReprs = append(argsReprs, s)
		} else {
			argsReprs = append(argsReprs, "_")
		}
	}

	message, _ := rule["message"].(string)
	defaultMessage := capitalizeCheckName(checkName) + " check failed"
	if message != "" && message != defaultMessage {
		argsReprs = append(argsReprs, decompileString(message))
	} else {
		argsReprs = stripTrailingPlaceholders(argsReprs)
	}

	if writeCatID != nil {
		argsReprs = append(argsReprs, fmt.Sprintf("{catalogId: %s}", decompileString(*writeCatID)))
	}

	if len(argsReprs) > 0 {
		return fmt.Sprintf("?%s(%s)", checkName, strings.Join(argsReprs, ", ")), nil
	}
	return "?" + checkName, nil
}

func (d *Decompiler) decompileCall(
	fn map[string]any,
	varNames map[string]string,
	surfaceCatID *string,
) (string, error) {
	name, _ := reservedValue(fn, "call").(string)
	rawArgs := fn["args"]

	var (
		fnHelper   *schemahelper.CatalogSchemaHelper
		writeCatID *string
		err        error
	)
	if strings.HasPrefix(name, "@") {
		fnHelper, err = d.systemFunctionHelper(fn, name)
		if err != nil {
			return "", err
		}
	} else {
		var explicitCat *string
		if catStr, ok := fn["catalogId"].(string); ok && catStr != "" {
			explicitCat = &catStr
		}
		fnHelper, writeCatID, err = d.resolve("function", name, explicitCat, surfaceCatID, "function")
		if err != nil {
			return "", err
		}
	}

	fnProps := fnHelper.FunctionProperties(name)
	var argsReprs []string
	argsMap, isMap := rawArgs.(map[string]any)
	argsSlice, isSlice := rawArgs.([]any)

	for idx, p := range fnProps {
		var (
			present bool
			argVal  any
		)
		switch {
		case isMap:
			argVal, present = argsMap[p]
		case isSlice:
			if idx < len(argsSlice) {
				present = true
				argVal = argsSlice[idx]
			}
		}
		if present {
			s, valErr := d.decompileValue(argVal, varNames, false, surfaceCatID)
			if valErr != nil {
				return "", valErr
			}
			argsReprs = append(argsReprs, s)
		} else {
			argsReprs = append(argsReprs, "_")
		}
	}
	argsReprs = stripTrailingPlaceholders(argsReprs)

	if writeCatID != nil {
		argsReprs = append(argsReprs, "catalogId="+decompileString(*writeCatID))
	}
	return fmt.Sprintf("%s(%s)", name, strings.Join(argsReprs, ", ")), nil
}

func (d *Decompiler) decompileValue(
	val any,
	varNames map[string]string,
	isRef bool,
	surfaceCatID *string,
) (string, error) {
	if val == nil {
		return "null", nil
	}
	switch v := val.(type) {
	case map[string]any:
		return d.decompileMapValue(v, varNames, isRef, surfaceCatID)
	case []any:
		items := make([]string, 0, len(v))
		for _, item := range v {
			s, err := d.decompileValue(item, varNames, isRef, surfaceCatID)
			if err != nil {
				return "", err
			}
			items = append(items, s)
		}
		return "[" + strings.Join(items, ", ") + "]", nil
	case []string:
		items := make([]string, 0, len(v))
		for _, item := range v {
			s, err := d.decompileValue(item, varNames, isRef, surfaceCatID)
			if err != nil {
				return "", err
			}
			items = append(items, s)
		}
		return "[" + strings.Join(items, ", ") + "]", nil
	case string:
		if isRef {
			return decompileReference(v, varNames), nil
		}
		return decompileString(v), nil
	case bool:
		if v {
			return "true", nil
		}
		return "false", nil
	case int, int64, int32, int16, int8, uint, uint64, uint32, uint16, uint8, float32, float64, json.Number:
		return DecompileNumber(v)
	default:
		rv := reflect.ValueOf(val)
		if rv.Kind() == reflect.Slice {
			items := make([]string, 0, rv.Len())
			for i := range rv.Len() {
				s, err := d.decompileValue(rv.Index(i).Interface(), varNames, isRef, surfaceCatID)
				if err != nil {
					return "", err
				}
				items = append(items, s)
			}
			return "[" + strings.Join(items, ", ") + "]", nil
		}
		return fmt.Sprint(val), nil
	}
}

func (d *Decompiler) decompileMapValue(
	val map[string]any,
	varNames map[string]string,
	isRef bool,
	surfaceCatID *string,
) (string, error) {
	if compID, hasCompID := val["componentId"]; hasCompID {
		if pathStr, hasPath := val["path"].(string); hasPath {
			return fmt.Sprintf("_template(%s, %s)", decompilePath(pathStr), decompileReference(compID, varNames)), nil
		}
	}
	if boundPath, ok := val[d.pathKey].(string); ok && len(val) == 1 {
		return decompilePath(boundPath), nil
	}
	if evt, ok := val["event"].(map[string]any); ok && (d.v1 || evt["userMessage"] == nil) {
		evtName, _ := evt["name"].(string)
		eventArgs := []string{decompileString(evtName)}
		if rawCtx, hasCtx := evt["context"]; hasCtx {
			ctxMap, _ := rawCtx.(map[string]any)
			var ctxReprs []string
			for _, k := range schemahelper.OrderedKeys(ctxMap) {
				s, err := d.decompileValue(ctxMap[k], varNames, false, surfaceCatID)
				if err != nil {
					return "", err
				}
				ctxReprs = append(ctxReprs, fmt.Sprintf("%s: %s", decompileKey(k), s))
			}
			eventArgs = append(eventArgs, "{"+strings.Join(ctxReprs, ", ")+"}")
		}
		if userMsg := evt["userMessage"]; userMsg != nil {
			s, err := d.decompileValue(userMsg, varNames, false, surfaceCatID)
			if err != nil {
				return "", err
			}
			eventArgs = append(eventArgs, "userMessage="+s)
		}
		return fmt.Sprintf("Event(%s)", strings.Join(eventArgs, ", ")), nil
	}
	if fnCall, ok := val["functionCall"].(map[string]any); ok {
		return d.decompileCall(fnCall, varNames, surfaceCatID)
	}
	if d.isFunctionCall(val) {
		return d.decompileCall(val, varNames, surfaceCatID)
	}

	keys := schemahelper.OrderedKeys(val)
	itemsReprs := make([]string, 0, len(keys))
	for _, k := range keys {
		itemIsRef := isRef || k == "child" || k == "componentId"
		vRepr, err := d.decompileValue(val[k], varNames, itemIsRef, surfaceCatID)
		if err != nil {
			return "", err
		}
		itemsReprs = append(itemsReprs, fmt.Sprintf("%s: %s", decompileKey(k), vRepr))
	}
	return "{" + strings.Join(itemsReprs, ", ") + "}", nil
}

func extractMapSlice(raw any) []map[string]any {
	switch v := raw.(type) {
	case []map[string]any:
		return v
	case []any:
		out := make([]map[string]any, 0, len(v))
		for _, item := range v {
			if m, ok := item.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}
