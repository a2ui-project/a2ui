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
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/a2ui-project/a2ui/go/agent/internal/schemahelper"
	"github.com/a2ui-project/a2ui/go/core"
)

var exampleMessageKeys = []string{
	"createSurface",
	"updateComponents",
	"updateDataModel",
	"deleteSurface",
	"callFunction",
	"callRendererFunction",
}

const eventRuleV10 = `8. Action events: represent server-side actions using the Event helper, ` + "`Event(name, context?, userMessage=...)`" + `:
   Event("save_deal", {rep: $/form/rep})
   Event("reply", userMessage="Replying now")
   Event("save_deal", {rep: $/form/rep}, userMessage=$/form/summary)
   The context map is optional. Pass ` + "`userMessage=`" + ` as a keyword argument (a string, ` + "`$path`" + ` binding, or function call) to set the message shown on the user's behalf when the event fires.`

const eventRulePreV10 = `8. Action events: represent server-side actions using the Event helper:
   Event("save_deal", {rep: $/form/rep})`

const expressRulesPrefix = "# A2UI Express DSL Output Contract\n\n" +
	"You must output the user interface using A2UI Express.\n\n" +
	"IMPORTANT: You MUST always surround the entire A2UI Express block with the literal sentinel tags `<a2ui>` and `</a2ui>` (always include both the opening and closing tags; do NOT wrap the tags in backticks or replace the opening tag with a markdown code fence such as ```a2ui).\n\n" +
	"The host compiler will compile your A2UI Express output into the correct JSON envelopes automatically.\n\n" +
	"## Grammar Rules\n\n" +
	"1. Component constructors can be assigned to variables or nested inline inside parent component arguments:\n" +
	"   header = ComponentA(prop1=\"val1\")\n" +
	"   root = ComponentB([header, ComponentC(\"Click\", action=Event(\"submit\"))])\n\n" +
	"   Keyword arguments (`param=value`) and positional arguments with `_` placeholders are supported.\n\n" +
	"   Variable names MUST start with a letter or underscore, and only contain letters, digits, and underscores.\n\n" +
	"2. The interface tree must have a single entry point assigned to the reserved variable 'root'.\n\n" +
	"3. Primitives:\n" +
	"   - Strings: Quoted with `\"` or `\"\"\"`. Support for `\\n`, `\\t`, `\\\\`, and `\\\"` escapes.\n" +
	"     Raw Strings: Prefaced by `r` (e.g., `r\"...\"` or `r\"\"\"...\"\"\"`), with no escape processing.\n" +
	"   - Numbers: write as integers or decimals, e.g., 42\n" +
	"   - Booleans: write true or false\n" +
	"   - Null values: write null\n" +
	"   - Dates & Times: Values for date-time inputs (e.g. in DateTimeInput) must strictly use RFC 3339 format with a timezone offset (e.g. \"2026-03-14T00:00:00Z\").\n\n" +
	"4. Lists: represent as arrays, e.g., [child1, child2].\n\n" +
	"5. Maps: represent as key-value blocks, e.g., {title: \"Overview\", child: contentCol}. Map keys are always literal strings (dynamic variable resolution is not supported for keys).\n\n" +
	"6. Data bindings: prefix absolute paths in the data model with '$', e.g., $/user/firstName.\n" +
	"   Prefix relative list scopes with '$', e.g., $firstName.\n" +
	"   A lone '$' represents an empty relative path which resolves to the root of the current context (e.g. inside a template, representing the entire item itself).\n\n" +
	"7. Logic and validation: prefix client check rules with '?', e.g., ?required or ?regex(\"^[0-9]{5}$\"). To specify a custom error message for validation failures, append it as an extra string argument, e.g. ?regex(\"^[0-9]{5}$\", \"Postal code must be 5 digits\")."

const expressRulesSuffix = "9. Nested functions: call client functions directly using catalog signatures, for example myFunction(\"value\").\n\n" +
	"10. Data model population: Assign a value directly to an absolute data path (e.g. $/path/to/key = \"value\") to populate or initialize values inside the shared dataModel. The value can be a primitive, array, or map.\n\n" +
	"11. Dynamic list templates: If a component expects a template child list, represent it using the _template helper:\n" +
	"    _template($/path/to/list, itemTemplate)\n" +
	"    And define the template component variable on another line, utilizing relative path references prefixed with $:\n" +
	"    itemTemplate = Image($url)\n\n" +
	"12. To delete a user interface surface, output the standalone `deleteSurface(surfaceId)` command (no variable assignment):\n" +
	"    deleteSurface(\"dashboard-surface-1\")\n\n" +
	"13. Static properties: Arguments annotated with '(static)' in the signatures below MUST be defined as literal values or arrays inline. You CANNOT use a dynamic data binding path (prefixed by $) for these arguments.\n\n" +
	"14. Required actions: Parameters named 'action' (or annotated in component signatures) are strictly required. You must pass a valid Event (e.g. Event(\"click\")) or function call. If no specific action is described in the user request, you must provide a dummy click event like Event(\"click\") instead of passing null or omitting the parameter.\n\n" +
	"15. Surface targeting: Output `surface(surfaceId)` to specify or target a user interface surface:\n" +
	"    surface(\"dashboard-surface-1\")\n" +
	"    root = ComponentA(...)"

// ExpressRules is the canonical v1.0+ A2UI Express system prompt rule contract.
const ExpressRules = expressRulesPrefix + "\n\n" + eventRuleV10 + "\n\n" + expressRulesSuffix

const expressRulesPreV10 = expressRulesPrefix + "\n\n" + eventRulePreV10 + "\n\n" + expressRulesSuffix

const rootExampleLine = "root = ComponentA(...)"

var jsonCodeBlockRe = regexp.MustCompile("(?s)```json\\s*\\n(.*?)\\n```")

// ValidatePayloadFunc validates an A2UI example payload against active catalogs.
type ValidatePayloadFunc func(catalogs []*core.Catalog, messages []core.AgentToRendererMessage) error

func exampleRootComponent(catalogs []*core.Catalog) string {
	for _, cat := range catalogs {
		refMap := cat.ComponentRefMap()
		names := cat.ComponentNames()
		if len(names) == 0 {
			names = sortedKeys(cat.Components())
		}
		for _, name := range names {
			if spec, ok := refMap[name]; ok && len(spec.SingleRefs) > 0 {
				return name
			}
		}
	}
	for _, cat := range catalogs {
		names := cat.ComponentNames()
		if len(names) == 0 {
			names = sortedKeys(cat.Components())
		}
		if len(names) > 0 {
			return names[0]
		}
	}
	return ""
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

func multiCatalogRules(helpers map[string]*schemahelper.CatalogSchemaHelper, helperOrder []string) string {
	exampleID := helperOrder[len(helperOrder)-1]
	listingLines := make([]string, 0, len(helperOrder))
	for _, id := range helperOrder {
		listingLines = append(listingLines, fmt.Sprintf("- `%s`", id))
	}
	rules := []string{
		"## Multiple Catalogs",
		"",
		"Several component catalogs are active. Each is identified by its catalog ID, and the signatures below are grouped by catalog:",
		strings.Join(listingLines, "\n"),
		"",
		"16. A surface has no catalog of its own: do not name a catalog on a `surface` line. Each component and function call, including checks, actions, nested function calls and inline child components, is found by its name in whichever catalog defines it.",
		"",
		"17. When several catalogs define the same component or function name, you MUST say which one you mean: add a `catalogId` keyword argument to the component or function call, or a `{catalogId: ...}` argument to a check. Do not add `catalogId` to any other name:",
		fmt.Sprintf(`    widget = ComponentName(..., catalogId="%s")`, exampleID),
		fmt.Sprintf(`    action = functionName(..., catalogId="%s")`, exampleID),
		fmt.Sprintf(`    ?checkName(..., {catalogId: "%s"})`, exampleID),
	}

	var shared []string
	type kindSpec struct {
		kind  string
		label string
	}
	for _, ks := range []kindSpec{{"component", "Component"}, {"function", "Function"}} {
		nameSet := make(map[string]bool)
		for _, id := range helperOrder {
			h := helpers[id]
			if ks.kind == "component" {
				for n := range h.Components {
					nameSet[n] = true
				}
			} else {
				for n := range h.Functions {
					nameSet[n] = true
				}
			}
		}
		for _, name := range sortedKeys(nameSet) {
			defining := schemahelper.CatalogsDefining(helperOrder, helpers, ks.kind, name)
			if len(defining) > 1 {
				formatted := make([]string, 0, len(defining))
				for _, cid := range defining {
					formatted = append(formatted, fmt.Sprintf("`%s`", cid))
				}
				shared = append(shared, fmt.Sprintf("- %s `%s`: %s", ks.label, name, strings.Join(formatted, ", ")))
			}
		}
	}
	if len(shared) > 0 {
		rules = append(rules, "", "These names are defined in several catalogs and need a `catalogId`:")
		rules = append(rules, shared...)
	}
	return strings.Join(rules, "\n")
}

func promptSchemaAllowsDatabinding(propSchema map[string]any) bool {
	if propSchema == nil {
		return false
	}
	if ref, ok := propSchema["$ref"].(string); ok {
		if strings.Contains(ref, "DataBinding") || strings.Contains(ref, "Dynamic") || strings.Contains(ref, "ChildList") {
			return true
		}
	}
	for _, combKey := range []string{"oneOf", "anyOf", "allOf"} {
		if subs, ok := propSchema[combKey].([]any); ok {
			for _, sub := range subs {
				if subMap, ok := sub.(map[string]any); ok && promptSchemaAllowsDatabinding(subMap) {
					return true
				}
			}
		}
	}
	return false
}

func getSchemaEnum(propSchema map[string]any) []string {
	if propSchema == nil {
		return nil
	}
	if enumSlice, ok := propSchema["enum"].([]any); ok {
		out := make([]string, 0, len(enumSlice))
		for _, item := range enumSlice {
			out = append(out, fmt.Sprint(item))
		}
		return out
	}
	for _, combKey := range []string{"oneOf", "anyOf"} {
		if subs, ok := propSchema[combKey].([]any); ok {
			for _, sub := range subs {
				if subMap, ok := sub.(map[string]any); ok {
					if res := getSchemaEnum(subMap); len(res) > 0 {
						return res
					}
				}
			}
		}
	}
	return nil
}

func rendererCallRule(callableFns []string) string {
	formatted := make([]string, 0, len(callableFns))
	for _, name := range callableFns {
		formatted = append(formatted, fmt.Sprintf("`%s`", name))
	}
	return fmt.Sprintf(
		"To have the renderer run a function right away, output the call as a standalone command (no variable assignment):\n%s(...)\nOnly these functions can be called this way: %s.",
		callableFns[0],
		strings.Join(formatted, ", "),
	)
}

func parseRulePrefixLen(s string) int {
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	if i == 0 || i+1 >= len(s) || s[i] != '.' || s[i+1] != ' ' {
		return 0
	}
	return i + 2
}

func stripRulePrefix(rule string) string {
	pLen := parseRulePrefixLen(rule)
	if pLen == 0 {
		return rule
	}
	body := rule[pLen:]
	indent := "\n" + strings.Repeat(" ", pLen)
	return strings.ReplaceAll(body, indent, "\n")
}

func splitRuleBlocks(rulesBlock string) []string {
	s := strings.TrimSpace(rulesBlock)
	if s == "" {
		return nil
	}
	var blocks []string
	start := 0
	for i := 0; i+2 < len(s); i++ {
		if s[i] == '\n' && s[i+1] == '\n' && parseRulePrefixLen(s[i+2:]) > 0 {
			blocks = append(blocks, s[start:i])
			start = i + 2
			i++
		}
	}
	blocks = append(blocks, s[start:])
	return blocks
}

func indentNonEmptyNewlines(body string, indentSpaces int) string {
	indent := strings.Repeat(" ", indentSpaces)
	lines := strings.Split(body, "\n")
	for i := 1; i < len(lines); i++ {
		if lines[i] != "" {
			lines[i] = indent + lines[i]
		}
	}
	return strings.Join(lines, "\n")
}

func renumberRules(text string) string {
	var b strings.Builder
	ruleIndex := 0
	i := 0
	for i < len(text) {
		if i >= 2 && text[i-2] == '\n' && text[i-1] == '\n' {
			if pLen := parseRulePrefixLen(text[i:]); pLen > 0 {
				ruleIndex++
				oldPrefix := text[i : i+pLen]
				bodyStart := i + pLen
				bodyEnd := bodyStart
				for bodyEnd < len(text) {
					if bodyEnd+1 < len(text) && text[bodyEnd] == '\n' && text[bodyEnd+1] == '\n' {
						break
					}
					bodyEnd++
				}
				body := text[bodyStart:bodyEnd]
				newPrefix := strconv.Itoa(ruleIndex) + ". "
				if len(oldPrefix) != len(newPrefix) {
					body = strings.ReplaceAll(
						body,
						"\n"+strings.Repeat(" ", len(oldPrefix)),
						"\n"+strings.Repeat(" ", len(newPrefix)),
					)
				}
				b.WriteString(newPrefix)
				b.WriteString(body)
				i = bodyEnd
				continue
			}
		}
		b.WriteByte(text[i])
		i++
	}
	return b.String()
}

func filterExpressRules(allowedMessages []string, hasAllowed bool, callableFns []string, rulesSource string) string {
	rulesSource = strings.ReplaceAll(rulesSource, "\r\n", "\n")
	creates, components, data, del, callRenderer := true, true, true, true, true
	if hasAllowed {
		allowed := make(map[string]bool, len(allowedMessages))
		for _, m := range allowedMessages {
			allowed[m] = true
		}
		creates = allowed["createSurface"] || allowed["CreateSurfaceMessage"]
		components = creates || allowed["updateComponents"] || allowed["UpdateComponentsMessage"]
		data = allowed["updateDataModel"] || allowed["UpdateDataModelMessage"]
		del = allowed["deleteSurface"] || allowed["DeleteSurfaceMessage"]
		callRenderer = allowed["callRendererFunction"] || allowed["CallRendererFunctionMessage"]
	}

	contract, rulesBlock, _ := strings.Cut(rulesSource, "## Grammar Rules\n\n")
	rawRules := splitRuleBlocks(rulesBlock)
	ruleBodies := make([]string, len(rawRules))
	for i, r := range rawRules {
		ruleBodies[i] = stripRulePrefix(r)
	}
	if len(ruleBodies) < 15 {
		return rulesSource
	}

	var selected []string
	if components {
		selected = append(selected, ruleBodies[0])
	}
	if creates {
		selected = append(selected, ruleBodies[1])
	}
	selected = append(selected, ruleBodies[2:6]...)
	if components {
		selected = append(selected, ruleBodies[6:9]...)
	}
	if data {
		selected = append(selected, ruleBodies[9])
	}
	if components {
		selected = append(selected, ruleBodies[10])
	}
	if del {
		selected = append(selected, ruleBodies[11])
	}
	if callRenderer && len(callableFns) > 0 {
		selected = append(selected, rendererCallRule(callableFns))
	}
	if components {
		selected = append(selected, ruleBodies[12:14]...)
	}
	if components || data {
		surfaceRule := ruleBodies[14]
		if !creates {
			lines := strings.Split(surfaceRule, "\n")
			if len(lines) > 1 {
				surfaceRule = strings.Join(lines[:len(lines)-1], "\n")
			}
		}
		selected = append(selected, surfaceRule)
	}

	out := make([]string, 0, len(selected)+1)
	out = append(out, contract+"## Grammar Rules")
	for idx, body := range selected {
		prefix := fmt.Sprintf("%d. ", idx+1)
		indented := indentNonEmptyNewlines(body, len(prefix))
		out = append(out, prefix+indented)
	}
	return strings.Join(out, "\n\n")
}

// PromptGenerator compiles A2UI catalog schemas into Express system prompt contracts.
type PromptGenerator struct {
	catalogs        []*core.Catalog
	examples        [][]core.AgentToRendererMessage
	allowedMessages []string
	version         string
	helpers         map[string]*schemahelper.CatalogSchemaHelper
	helperOrder     []string
	decompiler      *Decompiler
	validateFn      ValidatePayloadFunc
}

// PromptGeneratorOptions configures NewPromptGenerator.
type PromptGeneratorOptions struct {
	// Examples are few-shot turns decompiled into the prompt.
	Examples [][]core.AgentToRendererMessage
	// AllowedMessages limits the envelopes the prompt teaches when non-empty.
	AllowedMessages []string
	// Version overrides the protocol version the catalogs target.
	Version string
	// Validate checks example turns when GenerateExamples is asked to validate them.
	Validate ValidatePayloadFunc
}

// GenerateOptions selects the sections Generate assembles.
type GenerateOptions struct {
	IncludeSchema    bool
	IncludeExamples  bool
	ValidateExamples bool
	// AllowedMessages overrides the generator's allowlist when non-empty.
	AllowedMessages []string
}

// NewPromptGenerator constructs a catalog-agnostic Express PromptGenerator.
func NewPromptGenerator(catalogs []*core.Catalog, opts PromptGeneratorOptions) (*PromptGenerator, error) {
	examples := opts.Examples
	allowedMessages := opts.AllowedMessages
	version := opts.Version
	validateFn := opts.Validate
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
	decompiler, err := NewDecompiler(checked, targetVersion)
	if err != nil {
		return nil, err
	}
	var clonedExamples [][]core.AgentToRendererMessage
	if examples != nil {
		clonedExamples = make([][]core.AgentToRendererMessage, len(examples))
		for i, turn := range examples {
			clonedExamples[i] = slices.Clone(turn)
		}
	}
	var clonedAllowed []string
	if len(allowedMessages) > 0 {
		clonedAllowed = slices.Clone(allowedMessages)
	}
	return &PromptGenerator{
		catalogs:        checked,
		examples:        clonedExamples,
		allowedMessages: clonedAllowed,
		version:         targetVersion,
		helpers:         helpers,
		helperOrder:     order,
		decompiler:      decompiler,
		validateFn:      validateFn,
	}, nil
}

// Catalogs returns a shallow copy of the prompt generator's catalogs.
func (pg *PromptGenerator) Catalogs() []*core.Catalog {
	return slices.Clone(pg.catalogs)
}

// Generate assembles the complete Express system prompt.
func (pg *PromptGenerator) Generate(opts GenerateOptions) (string, error) {
	baseRules := pg.GenerateBaseRules(opts.AllowedMessages)
	parts := []string{baseRules}

	if opts.IncludeSchema {
		catInst := pg.GenerateCatalogInstructions(true, nil)
		if catInst != "" {
			parts = append(parts, catInst)
		}
	}
	if opts.IncludeExamples {
		exStr, err := pg.GenerateExamples(nil, opts.ValidateExamples)
		if err != nil {
			return "", err
		}
		if exStr != "" {
			parts = append(parts, "### Examples:\n\n"+exStr)
		}
	}
	return strings.Join(parts, "\n\n"), nil
}

// GenerateBaseRules generates the core syntax contract, multi-catalog rules, and system function signatures.
func (pg *PromptGenerator) GenerateBaseRules(allowedMessages []string) string {
	effAllowed := pg.allowedMessages
	if len(allowedMessages) > 0 {
		effAllowed = allowedMessages
	}
	effHasAllowed := len(effAllowed) > 0

	atLeastV10 := core.IsAtLeastVersion(pg.version, core.Version1_0)
	var callableFns []string
	if atLeastV10 {
		callableFns = schemahelper.AgentCallableFunctions(pg.catalogs)
	}
	sourceRules := expressRulesPreV10
	if atLeastV10 {
		sourceRules = ExpressRules
	}
	sourceRules = strings.ReplaceAll(sourceRules, "\r\n", "\n")

	base := sourceRules
	if effHasAllowed || len(callableFns) > 0 {
		base = filterExpressRules(effAllowed, effHasAllowed, callableFns, sourceRules)
	}
	if rootComp := exampleRootComponent(pg.catalogs); rootComp != "" {
		base = strings.ReplaceAll(base, rootExampleLine, fmt.Sprintf("root = %s(...)", rootComp))
	}

	allows := func(msgs ...string) bool {
		if !effHasAllowed {
			return true
		}
		for _, want := range msgs {
			if slices.Contains(effAllowed, want) {
				return true
			}
		}
		return false
	}

	componentMessages := []string{"createSurface", "CreateSurfaceMessage", "updateComponents", "UpdateComponentsMessage"}
	allSurfaceMessages := append(slices.Clone(componentMessages), "updateDataModel", "UpdateDataModelMessage")

	prompt := base
	if len(pg.catalogs) > 1 && allows(allSurfaceMessages...) {
		prompt = renumberRules(base + "\n\n" + multiCatalogRules(pg.helpers, pg.helperOrder))
	}
	sections := []string{prompt}
	if allows(componentMessages...) {
		if sysFns := pg.generateSystemFunctionSignatures(); sysFns != "" {
			sections = append(sections, sysFns)
		}
	}
	return strings.Join(sections, "\n\n")
}

func (pg *PromptGenerator) generateSystemFunctionSignatures() string {
	if len(pg.helperOrder) == 0 {
		return ""
	}
	h := pg.helpers[pg.helperOrder[0]]
	if h == nil || len(h.SystemFunctions) == 0 {
		return ""
	}
	sigs := formatFunctionSignatures(h, sortedKeys(h.SystemFunctions))
	return "## System Functions\n\nThese functions are defined by the A2UI protocol, not by a catalog. Call them by their `@` name, like any function, and never add a `catalogId` to them:\n" + sigs
}

// GenerateCatalogInstructions renders positional component and function signatures for one or all catalogs.
func (pg *PromptGenerator) GenerateCatalogInstructions(includeSchema bool, catalog *core.Catalog) string {
	if !includeSchema {
		return ""
	}
	if catalog != nil {
		return pg.catalogDescription(true, catalog)
	}
	if len(pg.catalogs) <= 1 {
		return pg.catalogDescription(true, nil)
	}
	sections := make([]string, 0, len(pg.catalogs))
	for _, cat := range pg.catalogs {
		desc := pg.catalogDescription(true, cat)
		sections = append(sections, fmt.Sprintf("# Catalog `%s`\n\n%s", cat.CatalogID(), desc))
	}
	return strings.Join(sections, "\n\n")
}

// GenerateExamples formats few-shot Express DSL example turns.
func (pg *PromptGenerator) GenerateExamples(catalog *core.Catalog, validate bool) (string, error) {
	if len(pg.examples) == 0 {
		return "", nil
	}
	activeCatalogs := slices.Clone(pg.catalogs)
	if catalog != nil {
		reordered := []*core.Catalog{catalog}
		for _, c := range activeCatalogs {
			if c != catalog {
				reordered = append(reordered, c)
			}
		}
		activeCatalogs = reordered
	}
	blocks := make([]string, 0, len(pg.examples))
	for _, turn := range pg.examples {
		if validate && pg.validateFn != nil {
			if err := pg.validateFn(activeCatalogs, turn); err != nil {
				return "", err
			}
		}
		dsl, err := pg.decompiler.Decompile(turn, false)
		if err != nil {
			return "", err
		}
		blocks = append(blocks, pg.decompiler.WrapDecompiledBlocks([]string{dsl}))
	}
	return strings.Join(blocks, "\n\n"), nil
}

func (pg *PromptGenerator) catalogDescription(includeSchema bool, catalog *core.Catalog) string {
	if !includeSchema {
		return ""
	}
	var h *schemahelper.CatalogSchemaHelper
	if catalog != nil {
		h = pg.helpers[catalog.CatalogID()]
		if h == nil {
			h = schemahelper.NewCatalogSchemaHelper(catalog, pg.version)
		}
	} else if len(pg.helperOrder) > 0 {
		h = pg.helpers[pg.helperOrder[0]]
	}

	compSigs := generateComponentSignatures(h)
	funcSigs := generateFunctionSignatures(h)
	catalogInstructions := ""
	if h != nil {
		catalogInstructions, _ = h.CatalogDoc["instructions"].(string)
	}
	if catalogInstructions != "" && h != nil {
		instructionsCatID := h.CatalogModel.CatalogID()
		catalogInstructions = jsonCodeBlockRe.ReplaceAllStringFunc(catalogInstructions, func(match string) string {
			sub := jsonCodeBlockRe.FindStringSubmatch(match)
			if len(sub) < 2 {
				return match
			}
			dsl, ok := pg.decompileExampleMessages(strings.TrimSpace(sub[1]), instructionsCatID)
			if !ok {
				return match
			}
			return "```\n" + pg.decompiler.WrapDecompiledBlocks([]string{dsl}) + "\n```"
		})
	}
	instructionsBlock := ""
	if catalogInstructions != "" {
		instructionsBlock = "\n\n## Catalog Instructions\n\n" + catalogInstructions
	}
	return fmt.Sprintf(
		"## Positional Component Signatures\n\nUse these exact positional signatures to instantiate components. Do not output property keys:\n%s\n\n## Positional Function Signatures\n\nUse these exact positional signatures to instantiate check rules or logic functions:\n%s%s",
		compSigs,
		funcSigs,
		instructionsBlock,
	)
}

func generateComponentSignatures(h *schemahelper.CatalogSchemaHelper) string {
	if h == nil {
		return ""
	}
	names := sortedKeys(h.Components)
	signatures := make([]string, 0, len(names))
	for _, name := range names {
		props := h.ComponentProperties(name)
		reqs := h.ComponentRequired(name)
		compDesc := h.ComponentDescription(name)

		orderedArgs := make([]string, 0, len(props))
		var propDetails []string
		for _, p := range props {
			optSuffix := "?"
			if slices.Contains(reqs, p) {
				optSuffix = ""
			}
			pSchema := h.PropertySchema(name, p)
			argLabel := p + optSuffix

			isComponentID := false
			if pSchema != nil {
				if ref, ok := pSchema["$ref"].(string); ok && strings.Contains(ref, "ComponentId") {
					isComponentID = true
				}
			}
			if isComponentID {
				argLabel += " (component ID)"
			} else if !promptSchemaAllowsDatabinding(pSchema) {
				argLabel += " (static)"
			}
			orderedArgs = append(orderedArgs, argLabel)

			var pDesc string
			if pSchema != nil {
				pDesc, _ = pSchema["description"].(string)
			}
			enumVals := getSchemaEnum(pSchema)

			if pDesc != "" || len(enumVals) > 0 {
				var lineParts []string
				if pDesc != "" {
					lineParts = append(lineParts, pDesc)
				}
				if len(enumVals) > 0 {
					quoted := make([]string, 0, len(enumVals))
					for _, v := range enumVals {
						quoted = append(quoted, fmt.Sprintf("'%s'", v))
					}
					lineParts = append(lineParts, "Must be one of: "+strings.Join(quoted, ", "))
				}
				propDetails = append(propDetails, fmt.Sprintf("  - %s: %s", p, strings.Join(lineParts, " ")))
			}

			if pSchema != nil {
				if pSchema["type"] == "object" {
					if nestedProps, ok := pSchema["properties"].(map[string]any); ok {
						subKeys := formatNestedSubKeys(nestedProps)
						prefix := fmt.Sprintf("  - %s:", p)
						if len(propDetails) > 0 && strings.HasPrefix(propDetails[len(propDetails)-1], prefix) {
							propDetails[len(propDetails)-1] += "\n    Map keys:\n" + strings.Join(subKeys, "\n")
						} else {
							propDetails = append(propDetails, fmt.Sprintf("  - %s: Map with keys:\n%s", p, strings.Join(subKeys, "\n")))
						}
					}
				} else if pSchema["type"] == "array" {
					if itemsSchema, ok := pSchema["items"].(map[string]any); ok && itemsSchema["type"] == "object" {
						if nestedProps, ok := itemsSchema["properties"].(map[string]any); ok {
							subKeys := formatNestedSubKeys(nestedProps)
							prefix := fmt.Sprintf("  - %s:", p)
							if len(propDetails) > 0 && strings.HasPrefix(propDetails[len(propDetails)-1], prefix) {
								propDetails[len(propDetails)-1] += "\n    List of maps keys:\n" + strings.Join(subKeys, "\n")
							} else {
								propDetails = append(propDetails, fmt.Sprintf("  - %s: List of maps with keys:\n%s", p, strings.Join(subKeys, "\n")))
							}
						}
					}
				}
			}
		}

		sig := fmt.Sprintf("• %s(%s)", name, strings.Join(orderedArgs, ", "))
		if compDesc != "" {
			descIndented := strings.ReplaceAll(compDesc, "\n", "\n    ")
			sig += "\n  - Description: " + descIndented
		}
		if len(propDetails) > 0 {
			sig += "\n" + strings.Join(propDetails, "\n")
		}
		signatures = append(signatures, sig)
	}
	return strings.Join(signatures, "\n")
}

func formatNestedSubKeys(nestedProps map[string]any) []string {
	keys := schemahelper.OrderedKeys(nestedProps)
	out := make([]string, 0, len(keys))
	for _, subK := range keys {
		descSuffix := ""
		if subMap, ok := nestedProps[subK].(map[string]any); ok {
			if d, _ := subMap["description"].(string); d != "" {
				descSuffix = " - " + d
			}
		}
		out = append(out, fmt.Sprintf("    * %s%s", subK, descSuffix))
	}
	return out
}

func generateFunctionSignatures(h *schemahelper.CatalogSchemaHelper) string {
	if h == nil {
		return ""
	}
	return formatFunctionSignatures(h, sortedKeys(h.Functions))
}

func formatFunctionSignatures(h *schemahelper.CatalogSchemaHelper, names []string) string {
	signatures := make([]string, 0, len(names))
	for _, name := range names {
		props := h.FunctionProperties(name)
		reqs := h.FunctionRequired(name)
		fDesc := h.FunctionDescription(name)

		var argsProperties map[string]any
		funcSchema := h.Functions[name]
		if funcSchema == nil {
			funcSchema = h.SystemFunctions[name]
		}
		if funcSchema != nil {
			if pMap, ok := funcSchema["properties"].(map[string]any); ok {
				if aMap, ok := pMap["args"].(map[string]any); ok {
					argsProperties, _ = aMap["properties"].(map[string]any)
				}
			}
		}

		orderedArgs := make([]string, 0, len(props))
		var propDetails []string
		for _, p := range props {
			optSuffix := "?"
			if slices.Contains(reqs, p) {
				optSuffix = ""
			}
			orderedArgs = append(orderedArgs, p+optSuffix)
			if argsProperties != nil {
				if pSchema, ok := argsProperties[p].(map[string]any); ok {
					if pDesc, _ := pSchema["description"].(string); pDesc != "" {
						propDetails = append(propDetails, fmt.Sprintf("  - %s: %s", p, pDesc))
					}
				}
			}
		}

		sig := fmt.Sprintf("• %s(%s)", name, strings.Join(orderedArgs, ", "))
		if fDesc != "" {
			descIndented := strings.ReplaceAll(fDesc, "\n", "\n    ")
			sig += "\n  - Description: " + descIndented
		}
		if len(propDetails) > 0 {
			sig += "\n" + strings.Join(propDetails, "\n")
		}
		signatures = append(signatures, sig)
	}
	return strings.Join(signatures, "\n")
}

func (pg *PromptGenerator) decompileExampleMessages(jsonContent string, defaultCatalogID string) (string, bool) {
	parsed, _, err := schemahelper.UnmarshalJSONPreservingOrder([]byte(jsonContent))
	if err != nil {
		return "", false
	}
	var messages []map[string]any
	switch v := parsed.(type) {
	case map[string]any:
		messages = []map[string]any{v}
	case []any:
		if len(v) == 0 {
			return "", false
		}
		for _, item := range v {
			m, ok := item.(map[string]any)
			if !ok {
				return "", false
			}
			messages = append(messages, m)
		}
	default:
		return "", false
	}
	if len(messages) == 0 {
		return "", false
	}
	for _, msg := range messages {
		hasKey := false
		for _, k := range exampleMessageKeys {
			if _, exists := msg[k]; exists {
				hasKey = true
				break
			}
		}
		if !hasKey {
			return "", false
		}
	}
	defCat := defaultCatalogID
	if defCat == "" {
		defCat = schemahelper.SurfaceCatalogID(pg.catalogs)
	}
	normalized, err := schemahelper.NormalizePromptExampleMessages(messages, pg.version, defCat, "")
	if err != nil {
		return "", false
	}
	dsl, err := pg.decompiler.Decompile(normalized, false)
	if err != nil {
		return "", false
	}
	return dsl, true
}

// TransformExamples converts ```json and ---BEGIN <name>---...---END <name>--- JSON example blocks into Express DSL.
func (pg *PromptGenerator) TransformExamples(rawExamplesMarkdown string) string {
	result := jsonCodeBlockRe.ReplaceAllStringFunc(rawExamplesMarkdown, func(match string) string {
		sub := jsonCodeBlockRe.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		dsl, ok := pg.decompileExampleMessages(strings.TrimSpace(sub[1]), "")
		if !ok {
			return match
		}
		return pg.decompiler.WrapDecompiledBlocks([]string{dsl})
	})

	return replaceBeginEndBlocks(result, func(name, body string) (string, bool) {
		dsl, ok := pg.decompileExampleMessages(strings.TrimSpace(body), "")
		if !ok {
			return "", false
		}
		wrapped := pg.decompiler.WrapDecompiledBlocks([]string{dsl})
		return fmt.Sprintf("---BEGIN %s---\n%s\n---END %s---", name, wrapped, name), true
	})
}

func replaceBeginEndBlocks(s string, fn func(name, body string) (string, bool)) string {
	const beginPrefix = "---BEGIN "
	const markerSuffix = "---\n"
	var out strings.Builder
	pos := 0
	for {
		idx := strings.Index(s[pos:], beginPrefix)
		if idx < 0 {
			out.WriteString(s[pos:])
			break
		}
		start := pos + idx
		nameStart := start + len(beginPrefix)
		nlRel := strings.Index(s[nameStart:], markerSuffix)
		if nlRel < 0 || strings.Contains(s[nameStart:nameStart+nlRel], "\n") {
			out.WriteString(s[pos : start+len(beginPrefix)])
			pos = start + len(beginPrefix)
			continue
		}
		name := s[nameStart : nameStart+nlRel]
		bodyStart := nameStart + nlRel + len(markerSuffix)
		endMarker := "\n---END " + name + "---"
		endRel := strings.Index(s[bodyStart:], endMarker)
		if endRel < 0 {
			out.WriteString(s[pos : start+len(beginPrefix)])
			pos = start + len(beginPrefix)
			continue
		}
		body := s[bodyStart : bodyStart+endRel]
		blockEnd := bodyStart + endRel + len(endMarker)
		out.WriteString(s[pos:start])
		if repl, ok := fn(name, body); ok {
			out.WriteString(repl)
		} else {
			out.WriteString(s[start:blockEnd])
		}
		pos = blockEnd
	}
	return out.String()
}
