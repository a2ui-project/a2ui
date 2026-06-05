// Command a2uigen generates Go source code for the a2ui and a2uibuild
// packages from the A2UI JSON Schema specification.
//
// Usage:
//
//	go run ./cmd/a2uigen -schemas path/to/json -out .
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"go/format"
	"io/fs"
	"log"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"strings"
	"text/template"
	"unicode"

	_ "embed"

	"golang.org/x/tools/txtar"
)

//go:embed templates/types.go.txtar
var templateData []byte

func main() {
	schemas := flag.String("schemas", "", "path to JSON schemas directory")
	out := flag.String("out", "", "output directory")
	pkg := flag.String("pkg", "a2ui", "Go package name for generated type files")
	module := flag.String("module", "", "Go module path for generated imports (default: module containing -out)")
	a2uiDir := flag.String("a2ui-dir", "a2ui", "directory for generated a2ui package, relative to -out")
	buildDir := flag.String("build-dir", "a2uibuild", "directory for generated a2uibuild package, relative to -out")
	oldBuildDir := flag.String("a2uibuild-dir", "", "alias for -build-dir")
	a2uiImport := flag.String("a2ui-import", "", "import path for generated a2ui package (default: derived from -module and -a2ui-dir)")
	sdk := flag.Bool("sdk", false, "generate the complete Go SDK, including static support files")
	specRoot := flag.String("spec-root", "", "A2UI specification root for -sdk mode (default: inferred from generator checkout)")
	sdkRoot := flag.String("sdk-root", "", "Go SDK source root for -sdk mode (default: inferred from generator)")
	stable := flag.Bool("stable", false, "also generate a2ui/a2ui.go alias file")
	flag.Parse()
	if *out == "" || (!*sdk && *schemas == "") {
		flag.Usage()
		os.Exit(1)
	}
	if *oldBuildDir != "" {
		*buildDir = *oldBuildDir
	}

	if *sdk {
		if err := generateSDK(*out, *module, *a2uiDir, *buildDir, *a2uiImport, *specRoot, *sdkRoot); err != nil {
			log.Fatal(err)
		}
		return
	}

	if err := generateFromSchemas(*schemas, *out, *pkg, *module, *a2uiDir, *buildDir, *a2uiImport, *stable); err != nil {
		log.Fatal(err)
	}
}

func generateFromSchemas(schemas, out, pkg, module, a2uiDir, buildDir, a2uiImport string, stable bool) error {
	catalogPath, err := findBasicCatalog(schemas)
	if err != nil {
		return err
	}
	catalog, err := parseCatalog(catalogPath)
	if err != nil {
		return err
	}
	commonTypes, err := parseCommonTypes(filepath.Join(schemas, "common_types.json"))
	if err != nil {
		return err
	}
	wrappers, err := parseWrappers(schemas)
	if err != nil {
		return err
	}
	outConfig, err := resolveOutputConfig(out, module, a2uiDir, buildDir, a2uiImport, pkg)
	if err != nil {
		return err
	}

	data, err := buildTemplateData(catalog, commonTypes)
	if err != nil {
		return err
	}
	data.Wrappers = wrappers
	data.Pkg = pkg
	data.A2UIImport = outConfig.A2UIImport
	data.VersionImport = outConfig.VersionImport
	data.Stable = stable

	ar := txtar.Parse(templateData)

	funcMap := template.FuncMap{
		"pascalCase":         pascalCase,
		"goFieldName":        goFieldName,
		"qualifyBuilderType": qualifyBuilderType,
		"sub":                func(a, b int) int { return a - b },
		"add":                func(a, b int) int { return a + b },
		"lower":              strings.ToLower,
		"join":               strings.Join,
	}

	for _, f := range ar.Files {
		name := strings.TrimSpace(f.Name)

		// Stable facade files are only rendered when -stable is set.
		if (name == "a2ui.go" || strings.Contains(name, "builders")) && !stable {
			continue
		}

		tmpl, err := template.New(name).Funcs(funcMap).Parse(string(f.Data))
		if err != nil {
			return fmt.Errorf("parsing template %s: %w", name, err)
		}
		var buf bytes.Buffer
		if err := tmpl.Execute(&buf, data); err != nil {
			return fmt.Errorf("executing template %s: %w", name, err)
		}
		formatted, err := format.Source(buf.Bytes())
		if err != nil {
			return fmt.Errorf("formatting %s: %w\n%s", name, err, buf.String())
		}

		// Determine output directory.
		outDir := filepath.Join(out, outConfig.A2UIDir)
		if name == "a2ui.go" {
			// Alias file always goes to the stable a2ui package.
			outDir = filepath.Join(out, outConfig.A2UIDir)
		} else if strings.Contains(name, "builders") {
			outDir = filepath.Join(out, outConfig.A2UIBuildDir)
		} else if pkg != "a2ui" {
			// Type files go into {a2uiDir}/{pkg}/.
			outDir = filepath.Join(out, outConfig.A2UIDir, pkg)
		}
		if err := os.MkdirAll(outDir, 0o755); err != nil {
			return err
		}
		outPath := filepath.Join(outDir, name)
		if err := os.WriteFile(outPath, formatted, 0o644); err != nil {
			return err
		}
		fmt.Println(outPath)
	}
	return nil
}

// Schema types for parsing the JSON schemas.

type catalogFile struct {
	Components map[string]json.RawMessage `json:"components"`
	Functions  map[string]json.RawMessage `json:"functions"`
}

type componentSchema struct {
	AllOf []json.RawMessage `json:"allOf"`
}

type allOfItem struct {
	Ref        string                    `json:"$ref"`
	Properties map[string]propertySchema `json:"properties"`
	Required   []string                  `json:"required"`
}

type propertySchema struct {
	Ref         string                    `json:"$ref"`
	Type        string                    `json:"type"`
	Enum        []string                  `json:"enum"`
	Const       any                       `json:"const"`
	Items       *propertySchema           `json:"items"`
	OneOf       []propertySchema          `json:"oneOf"`
	AllOf       []propertySchema          `json:"allOf"`
	Description string                    `json:"description"`
	Properties  map[string]propertySchema `json:"properties"`
}

type functionSchema struct {
	Properties struct {
		Call struct {
			Const string `json:"const"`
		} `json:"call"`
		Args struct {
			Properties map[string]propertySchema `json:"properties"`
			Required   []string                  `json:"required"`
		} `json:"args"`
		ReturnType struct {
			Const string `json:"const"`
		} `json:"returnType"`
	} `json:"properties"`
	Description string `json:"description"`
}

type commonTypesFile struct {
	Defs map[string]json.RawMessage `json:"$defs"`
}

// Parsed data types.

type Component struct {
	Name           string
	Fields         []Field
	RequiredFields []Field
	Checkable      bool
}

type Field struct {
	Name     string // JSON field name
	GoName   string // Exported Go field name
	GoType   string // Go type
	JSONType string // for json tag
	Required bool
	Pointer  bool // use pointer for optional fields
	Enum     []string
}

type EnumType struct {
	Name   string
	Values []EnumValue
}

type EnumValue struct {
	Name  string // Go const name
	Value string // JSON string value
}

type FuncDef struct {
	Name             string // JSON name (camelCase)
	GoName           string // PascalCase
	Args             []FuncArg
	ReturnType       string // Go type for return
	ReturnEnum       string // JSON return type string
	ReturnEnumPascal string // PascalCase version for const ref
	Desc             string
}

type FuncArg struct {
	Name     string
	GoName   string
	GoType   string
	Required bool
}

// WrapDynamicValue returns a Go expression that wraps this arg into a DynamicValue.
func (a FuncArg) WrapDynamicValue() string {
	switch a.GoType {
	case "DynamicString":
		return "dynamicStringToValue(" + a.Name + ")"
	case "DynamicNumber":
		return "dynamicNumberToValue(" + a.Name + ")"
	case "DynamicBoolean":
		return "dynamicBoolToValue(" + a.Name + ")"
	case "DynamicValue":
		return a.Name
	case "string":
		return "ValueString(" + a.Name + ")"
	case "float64":
		return "ValueNumber(" + a.Name + ")"
	case "int":
		return "ValueNumber(float64(" + a.Name + "))"
	case "bool":
		return "ValueBool(" + a.Name + ")"
	case "[]DynamicBoolean":
		return "dynamicBoolSliceToValue(" + a.Name + ")"
	default:
		return "ValueString(fmt.Sprint(" + a.Name + "))"
	}
}

type TemplateData struct {
	Components  []Component
	Enums       []EnumType
	Icons       []EnumValue
	Functions   []FuncDef
	ReturnTypes []EnumValue
	Wrappers    []Wrapper

	Pkg           string // Go package name for generated types (default "a2ui")
	A2UIImport    string // import path for the stable a2ui package
	VersionImport string // import path for the generated version package
	Stable        bool   // generate alias file
}

type outputConfig struct {
	A2UIDir       string
	A2UIBuildDir  string
	A2UIImport    string
	VersionImport string
}

func resolveOutputConfig(out, module, a2uiDir, buildDir, a2uiImport, pkg string) (outputConfig, error) {
	a2uiDir, err := cleanRelDir("-a2ui-dir", a2uiDir)
	if err != nil {
		return outputConfig{}, err
	}
	buildDir, err = cleanRelDir("-build-dir", buildDir)
	if err != nil {
		return outputConfig{}, err
	}

	absOut, err := filepath.Abs(out)
	if err != nil {
		return outputConfig{}, err
	}
	if a2uiImport == "" {
		modulePath, moduleRoot, err := resolveModule(module, absOut)
		if err != nil {
			return outputConfig{}, err
		}
		a2uiImport, err = importPathForDir(modulePath, moduleRoot, filepath.Join(absOut, a2uiDir))
		if err != nil {
			return outputConfig{}, err
		}
	}
	if err := checkImportPath("-a2ui-import", a2uiImport); err != nil {
		return outputConfig{}, err
	}
	return outputConfig{
		A2UIDir:       a2uiDir,
		A2UIBuildDir:  buildDir,
		A2UIImport:    a2uiImport,
		VersionImport: joinImportPath(a2uiImport, pkg),
	}, nil
}

func cleanRelDir(flag, dir string) (string, error) {
	if dir == "" {
		return "", fmt.Errorf("%s is empty", flag)
	}
	dir = filepath.Clean(filepath.FromSlash(dir))
	if filepath.IsAbs(dir) || dir == ".." || strings.HasPrefix(dir, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%s must be relative to -out", flag)
	}
	return dir, nil
}

func resolveModule(module, out string) (modulePath, moduleRoot string, err error) {
	modulePath = strings.TrimSpace(module)
	root, found := findModuleRoot(out)
	if found {
		moduleRoot = root
	}
	if modulePath == "" {
		if !found {
			return "", "", fmt.Errorf("-module is required when -out is not inside a Go module")
		}
		modulePath, err = readModulePath(filepath.Join(root, "go.mod"))
		if err != nil {
			return "", "", err
		}
	}
	if err := checkImportPath("-module", modulePath); err != nil {
		return "", "", err
	}
	if moduleRoot == "" {
		moduleRoot = out
	}
	return modulePath, moduleRoot, nil
}

func findModuleRoot(dir string) (string, bool) {
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

func readModulePath(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "module ") {
			module := strings.TrimSpace(strings.TrimPrefix(line, "module "))
			if module == "" {
				return "", fmt.Errorf("%s has empty module path", path)
			}
			return module, nil
		}
	}
	return "", fmt.Errorf("%s has no module directive", path)
}

func importPathForDir(modulePath, moduleRoot, dir string) (string, error) {
	rel, err := filepath.Rel(moduleRoot, dir)
	if err != nil {
		return "", err
	}
	if rel == "." {
		return modulePath, nil
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("output directory %s is outside module root %s", dir, moduleRoot)
	}
	return joinImportPath(modulePath, filepath.ToSlash(rel)), nil
}

func joinImportPath(elem ...string) string {
	var parts []string
	for _, e := range elem {
		e = strings.Trim(e, "/")
		if e != "" && e != "." {
			parts = append(parts, e)
		}
	}
	return path.Join(parts...)
}

func checkImportPath(flag, importPath string) error {
	if importPath == "" {
		return fmt.Errorf("%s is empty", flag)
	}
	if strings.ContainsAny(importPath, " \t\r\n") {
		return fmt.Errorf("%s contains whitespace", flag)
	}
	return nil
}

func generateSDK(out, module, a2uiDir, buildDir, a2uiImport, specRoot, sdkRoot string) error {
	if sdkRoot == "" {
		root, err := inferSDKRoot()
		if err != nil {
			return err
		}
		sdkRoot = root
	}
	if specRoot == "" {
		specRoot = filepath.Join(sdkRoot, "..", "..", "specification")
	}
	if info, err := os.Stat(specRoot); err != nil || !info.IsDir() {
		if err == nil {
			err = fmt.Errorf("not a directory")
		}
		return fmt.Errorf("spec root %s: %w", specRoot, err)
	}

	absOut, err := filepath.Abs(out)
	if err != nil {
		return err
	}
	modulePath, moduleRoot, err := resolveModule(module, absOut)
	if err != nil {
		return err
	}
	outConfig, err := resolveOutputConfig(out, module, a2uiDir, buildDir, a2uiImport, "v09")
	if err != nil {
		return err
	}
	sourceModule, err := readModulePath(filepath.Join(sdkRoot, "go.mod"))
	if err != nil {
		return err
	}

	if err := copyStaticSDK(sdkRoot, specRoot, out, outConfig); err != nil {
		return err
	}
	for _, v := range []struct {
		spec   string
		pkg    string
		stable bool
	}{
		{spec: "v0_10", pkg: "v010"},
		{spec: "v0_9_1", pkg: "v091"},
		{spec: "v0_9", pkg: "v09", stable: true},
	} {
		if err := generateFromSchemas(
			filepath.Join(specRoot, v.spec, "json"),
			out,
			v.pkg,
			module,
			a2uiDir,
			buildDir,
			a2uiImport,
			v.stable,
		); err != nil {
			return err
		}
	}

	if err := rewriteSDKImports(absOut, modulePath, moduleRoot, sourceModule, outConfig); err != nil {
		return err
	}
	return gofmtTree(absOut)
}

func inferSDKRoot() (string, error) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return "", fmt.Errorf("cannot locate a2uigen source")
	}
	dir := filepath.Dir(file)
	for {
		if _, err := os.Stat(filepath.Join(dir, "cmd", "a2uigen")); err == nil {
			if _, err := os.Stat(filepath.Join(dir, "a2ui", "v09")); err == nil {
				return dir, nil
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("cannot infer Go SDK root from %s", file)
		}
		dir = parent
	}
}

func copyStaticSDK(sdkRoot, specRoot, out string, cfg outputConfig) error {
	stableDir := filepath.Join(out, cfg.A2UIDir)
	if err := os.MkdirAll(stableDir, 0o755); err != nil {
		return err
	}
	for _, name := range []string{"doc.go", "example_test.go"} {
		if err := copyFile(filepath.Join(sdkRoot, "a2ui", name), filepath.Join(stableDir, name)); err != nil {
			return err
		}
	}
	for _, v := range []struct {
		spec string
		pkg  string
	}{
		{spec: "v0_9", pkg: "v09"},
		{spec: "v0_9_1", pkg: "v091"},
		{spec: "v0_10", pkg: "v010"},
	} {
		dst := filepath.Join(stableDir, v.pkg)
		if err := os.RemoveAll(dst); err != nil {
			return err
		}
		if err := copyDir(filepath.Join(sdkRoot, "a2ui", v.pkg), dst, func(rel string, d fs.DirEntry) bool {
			base := filepath.Base(rel)
			if d.IsDir() {
				return base == "testdata"
			}
			return base == "gen.go" || strings.HasPrefix(base, "zz_")
		}); err != nil {
			return err
		}
		examples := filepath.Join(dst, "testdata", v.spec, "catalogs", "basic", "examples")
		if err := os.MkdirAll(examples, 0o755); err != nil {
			return err
		}
		if err := copyDir(filepath.Join(specRoot, v.spec, "catalogs", "basic", "examples"), examples, nil); err != nil {
			return err
		}
	}

	for _, pkg := range []string{"a2a", "a2uiadk", "a2uibuild", "a2uischema", "a2uistream"} {
		dst := filepath.Join(out, pkg)
		if err := os.RemoveAll(dst); err != nil {
			return err
		}
		if err := copyDir(filepath.Join(sdkRoot, pkg), dst, nil); err != nil {
			return err
		}
	}
	for _, pkg := range []string{"build", "schema", "stream"} {
		if err := os.RemoveAll(filepath.Join(out, pkg)); err != nil {
			return err
		}
	}
	return nil
}

func copyDir(src, dst string, skip func(rel string, d fs.DirEntry) bool) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		if skip != nil && skip(rel, d) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return copyFile(path, target)
	})
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0o644)
}

func rewriteSDKImports(root, modulePath, moduleRoot, sourceModule string, cfg outputConfig) error {
	helperImport := func(name string) (string, error) {
		return importPathForDir(modulePath, moduleRoot, filepath.Join(root, name))
	}
	buildImport, err := helperImport(cfg.A2UIBuildDir)
	if err != nil {
		return err
	}
	adkImport, err := helperImport("a2uiadk")
	if err != nil {
		return err
	}
	schemaImport, err := helperImport("a2uischema")
	if err != nil {
		return err
	}
	streamImport, err := helperImport("a2uistream")
	if err != nil {
		return err
	}

	replacements := []struct{ old, new string }{
		{sourceModule + "/a2ui/v010", cfg.A2UIImport + "/v010"},
		{sourceModule + "/a2ui/v091", cfg.A2UIImport + "/v091"},
		{sourceModule + "/a2ui/v09", cfg.A2UIImport + "/v09"},
		{sourceModule + "/a2uiadk", adkImport},
		{sourceModule + "/a2uibuild", buildImport},
		{sourceModule + "/a2uischema", schemaImport},
		{sourceModule + "/a2uistream", streamImport},
		{sourceModule + "/a2ui", cfg.A2UIImport},
		{sourceModule, modulePath},
	}
	return rewriteTree(root, replacements)
}

func rewriteTree(root string, replacements []struct{ old, new string }) error {
	return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		switch filepath.Ext(path) {
		case ".go", ".md":
		default:
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		text := string(data)
		updated := text
		for _, r := range replacements {
			updated = strings.ReplaceAll(updated, r.old, r.new)
		}
		if updated == text {
			return nil
		}
		return os.WriteFile(path, []byte(updated), 0o644)
	})
}

func gofmtTree(root string) error {
	return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.Ext(path) != ".go" {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		formatted, err := format.Source(data)
		if err != nil {
			return fmt.Errorf("formatting %s: %w", path, err)
		}
		return os.WriteFile(path, formatted, 0o644)
	})
}

// Wrapper describes a top-level list-wrapper schema such as
// server_to_client_list_wrapper.json, which envelopes a message list in
// {messages: [...]} for protocols that cannot carry a top-level array.
type Wrapper struct {
	GoName     string // Go type name, e.g. "ServerMessageListWrapper"
	ItemGoType string // element Go type, e.g. "ServerMessage"
	Field      string // Go field name for the list, e.g. "Messages"
	JSONField  string // JSON field name, e.g. "messages"
}

func parseCatalog(path string) (*catalogFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cat catalogFile
	if err := json.Unmarshal(data, &cat); err != nil {
		return nil, err
	}
	return &cat, nil
}

func findBasicCatalog(schemaDir string) (string, error) {
	candidates := []string{
		filepath.Join(schemaDir, "basic_catalog.json"),
		filepath.Join(filepath.Dir(schemaDir), "catalogs", "basic", "catalog.json"),
	}
	for _, path := range candidates {
		info, err := os.Stat(path)
		if err == nil && !info.IsDir() {
			return path, nil
		}
	}
	return "", fmt.Errorf("basic catalog not found near %s", schemaDir)
}

func parseCommonTypes(path string) (*commonTypesFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var ct commonTypesFile
	if err := json.Unmarshal(data, &ct); err != nil {
		return nil, err
	}
	return &ct, nil
}

func buildTemplateData(cat *catalogFile, ct *commonTypesFile) (*TemplateData, error) {
	td := &TemplateData{}

	// Parse components in a stable order.
	compNames := sortedKeys(cat.Components)
	enumSeen := map[string]*EnumType{}

	for _, name := range compNames {
		raw := cat.Components[name]
		comp, err := parseComponent(name, raw, enumSeen)
		if err != nil {
			return nil, err
		}
		td.Components = append(td.Components, comp)
	}

	// Collect enums sorted by name.
	for _, e := range enumSeen {
		td.Enums = append(td.Enums, *e)
	}
	sort.Slice(td.Enums, func(i, j int) bool {
		return td.Enums[i].Name < td.Enums[j].Name
	})

	// Parse icons.
	icons, err := parseIcons(cat.Components["Icon"])
	if err != nil {
		return nil, err
	}
	td.Icons = icons

	// Parse functions.
	funcNames := sortedKeys(cat.Functions)
	for _, name := range funcNames {
		fd, err := parseFunction(name, cat.Functions[name])
		if err != nil {
			return nil, err
		}
		td.Functions = append(td.Functions, fd)
	}

	// Parse ReturnType enum from common_types.
	returnTypes, err := parseReturnTypes(ct)
	if err != nil {
		return nil, err
	}
	td.ReturnTypes = returnTypes

	return td, nil
}

func parseComponent(name string, raw json.RawMessage, enumSeen map[string]*EnumType) (Component, error) {
	var cs componentSchema
	if err := json.Unmarshal(raw, &cs); err != nil {
		return Component{}, fmt.Errorf("parse component %s: %w", name, err)
	}

	comp := Component{Name: name}

	for _, itemRaw := range cs.AllOf {
		var item allOfItem
		if err := json.Unmarshal(itemRaw, &item); err != nil {
			return Component{}, fmt.Errorf("parse component %s allOf item: %w", name, err)
		}

		if item.Ref != "" {
			if strings.Contains(item.Ref, "Checkable") {
				comp.Checkable = true
			}
			continue
		}

		required := map[string]bool{}
		for _, r := range item.Required {
			required[r] = true
		}

		propNames := sortedKeys(item.Properties)
		for _, fname := range propNames {
			prop := item.Properties[fname]
			if fname == "component" {
				continue
			}
			f := Field{
				Name:     fname,
				GoName:   goFieldName(fname),
				Required: required[fname],
				JSONType: fname,
			}
			f.GoType = resolveGoType(prop, name, fname)

			// Handle enums.
			enumValues := prop.Enum
			if len(enumValues) > 0 {
				enumTypeName := resolveEnumTypeName(name, fname, enumValues, enumSeen)
				f.GoType = enumTypeName
			}

			// Optional non-required fields with value types get pointer.
			if !f.Required && needsPointer(f.GoType) {
				f.Pointer = true
			}

			comp.Fields = append(comp.Fields, f)
			if f.Required {
				comp.RequiredFields = append(comp.RequiredFields, f)
			}
		}
	}

	return comp, nil
}

// resolveEnumTypeName determines the Go enum type name. If another component
// already defined an enum with exactly the same values, they share the type.
func resolveEnumTypeName(compName, fieldName string, values []string, seen map[string]*EnumType) string {
	// Check for shared enums by matching values.
	sortedVals := make([]string, len(values))
	copy(sortedVals, values)
	sort.Strings(sortedVals)
	valKey := strings.Join(sortedVals, "|")

	// Mapping of known shared enum names by field name.
	sharedNames := map[string]string{
		"justify": "LayoutJustify",
		"align":   "LayoutAlign",
	}

	// Determine the type name.
	typeName := compName + pascalCase(fieldName)
	if shared, ok := sharedNames[fieldName]; ok {
		// Check if existing enum with same field name has same values.
		if existing, ok := seen[shared]; ok {
			existingVals := make([]string, len(existing.Values))
			for i, v := range existing.Values {
				existingVals[i] = v.Value
			}
			sort.Strings(existingVals)
			if strings.Join(existingVals, "|") == valKey {
				return shared
			}
		}
		typeName = shared
	}

	if _, ok := seen[typeName]; ok {
		return typeName
	}

	// Create enum values with prefixed const names.
	et := &EnumType{Name: typeName}
	for _, v := range values {
		constName := typeName + pascalCase(v)
		et.Values = append(et.Values, EnumValue{Name: constName, Value: v})
	}
	seen[typeName] = et
	return typeName
}

func resolveGoType(prop propertySchema, compName, fieldName string) string {
	if prop.Ref != "" {
		return refToGoType(prop.Ref)
	}

	// Handle allOf with a $ref (like DateTimeInput min/max).
	if len(prop.AllOf) > 0 {
		for _, item := range prop.AllOf {
			if item.Ref != "" {
				return refToGoType(item.Ref)
			}
		}
	}

	// Handle oneOf for Icon name field.
	if len(prop.OneOf) > 0 {
		// Icon name has oneOf with enum string and object.
		if fieldName == "name" && compName == "Icon" {
			return "IconNameOrPath"
		}
	}

	switch prop.Type {
	case "string":
		return "string"
	case "number":
		return "float64"
	case "integer":
		return "int"
	case "boolean":
		return "bool"
	case "array":
		if prop.Items != nil {
			if prop.Items.Type == "object" {
				// Special inline struct types.
				if compName == "Tabs" {
					return "[]TabDef"
				}
				if compName == "ChoicePicker" {
					return "[]ChoiceOption"
				}
			}
			itemType := resolveGoType(*prop.Items, compName, fieldName)
			return "[]" + itemType
		}
		return "[]any"
	default:
		return "any"
	}
}

func refToGoType(ref string) string {
	// common_types.json#/$defs/DynamicString → DynamicString
	if idx := strings.LastIndex(ref, "/"); idx >= 0 {
		typeName := ref[idx+1:]
		switch typeName {
		case "ComponentId":
			return "string"
		default:
			return typeName
		}
	}
	return "any"
}

func needsPointer(goType string) bool {
	switch goType {
	case "bool", "float64", "int",
		"DynamicString", "DynamicNumber", "DynamicBoolean",
		"DynamicStringList", "DynamicValue", "Action", "IconNameOrPath":
		return true
	default:
		return false
	}
}

// parseWrappers reads every *_list_wrapper.json schema in dir and resolves it
// down to a Wrapper describing the {messages: [ItemGoType]} envelope it
// represents. The generator emits one Go struct per Wrapper.
func parseWrappers(dir string) ([]Wrapper, error) {
	matches, err := filepath.Glob(filepath.Join(dir, "*_list_wrapper.json"))
	if err != nil {
		return nil, err
	}
	sort.Strings(matches)
	var out []Wrapper
	for _, path := range matches {
		w, err := parseWrapper(dir, path)
		if err != nil {
			return nil, fmt.Errorf("wrapper %s: %w", filepath.Base(path), err)
		}
		out = append(out, w)
	}
	return out, nil
}

type wrapperSchema struct {
	Title      string                    `json:"title"`
	Properties map[string]propertySchema `json:"properties"`
	Required   []string                  `json:"required"`
}

func parseWrapper(dir, path string) (Wrapper, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Wrapper{}, err
	}
	var ws wrapperSchema
	if err := json.Unmarshal(raw, &ws); err != nil {
		return Wrapper{}, err
	}
	if len(ws.Properties) != 1 {
		return Wrapper{}, fmt.Errorf("expected one property, got %d", len(ws.Properties))
	}
	var jsonField string
	var prop propertySchema
	for k, v := range ws.Properties {
		jsonField = k
		prop = v
	}
	if prop.Ref == "" {
		return Wrapper{}, fmt.Errorf("property %q has no $ref", jsonField)
	}

	// Resolve the list schema: list refs have "items.$ref" pointing to the
	// element schema. The element schema's file name encodes the Go type name.
	listPath := filepath.Join(dir, prop.Ref)
	listRaw, err := os.ReadFile(listPath)
	if err != nil {
		return Wrapper{}, fmt.Errorf("reading list schema: %w", err)
	}
	var list propertySchema
	if err := json.Unmarshal(listRaw, &list); err != nil {
		return Wrapper{}, err
	}
	if list.Items == nil || list.Items.Ref == "" {
		return Wrapper{}, fmt.Errorf("list schema %s has no items.$ref", prop.Ref)
	}
	itemGoType := messageGoTypeFromRef(list.Items.Ref)
	if itemGoType == "" {
		return Wrapper{}, fmt.Errorf("cannot map %q to a Go type", list.Items.Ref)
	}

	base := strings.TrimSuffix(filepath.Base(path), ".json")
	return Wrapper{
		GoName:     wrapperGoName(base, itemGoType),
		ItemGoType: itemGoType,
		Field:      pascalCase(jsonField),
		JSONField:  jsonField,
	}, nil
}

// messageGoTypeFromRef maps a ref like "server_to_client.json" to the
// hand-written Go message type "ServerMessage" that represents it.
func messageGoTypeFromRef(ref string) string {
	switch filepath.Base(ref) {
	case "server_to_client.json":
		return "ServerMessage"
	case "client_to_server.json":
		return "ClientMessage"
	}
	return ""
}

// wrapperGoName derives the Go type name for a wrapper schema. For the
// message list wrappers the name is "{Item}ListWrapper".
func wrapperGoName(base, itemGoType string) string {
	switch base {
	case "server_to_client_list_wrapper", "client_to_server_list_wrapper":
		return itemGoType + "ListWrapper"
	}
	return pascalCase(base)
}

func qualifyBuilderType(goType string) string {
	if strings.HasPrefix(goType, "[]") {
		return "[]" + qualifyBuilderType(strings.TrimPrefix(goType, "[]"))
	}
	switch goType {
	case "string", "bool", "int", "float64", "any":
		return goType
	default:
		return "a2ui." + goType
	}
}

func parseIcons(raw json.RawMessage) ([]EnumValue, error) {
	var cs componentSchema
	if err := json.Unmarshal(raw, &cs); err != nil {
		return nil, fmt.Errorf("parse icons: %w", err)
	}

	for _, itemRaw := range cs.AllOf {
		var item allOfItem
		if err := json.Unmarshal(itemRaw, &item); err != nil {
			return nil, fmt.Errorf("parse icons allOf item: %w", err)
		}
		if item.Properties == nil {
			continue
		}
		nameProp, ok := item.Properties["name"]
		if !ok {
			continue
		}
		if len(nameProp.OneOf) > 0 {
			for _, opt := range nameProp.OneOf {
				if len(opt.Enum) > 0 {
					var icons []EnumValue
					for _, v := range opt.Enum {
						icons = append(icons, EnumValue{
							Name:  "Icon" + pascalCase(v),
							Value: v,
						})
					}
					return icons, nil
				}
			}
		}
	}
	return nil, nil
}

func parseFunction(name string, raw json.RawMessage) (FuncDef, error) {
	var fs functionSchema
	if err := json.Unmarshal(raw, &fs); err != nil {
		return FuncDef{}, fmt.Errorf("parse function %s: %w", name, err)
	}

	fd := FuncDef{
		Name:             name,
		GoName:           pascalCase(name),
		ReturnEnum:       fs.Properties.ReturnType.Const,
		ReturnEnumPascal: pascalCase(fs.Properties.ReturnType.Const),
		Desc:             fs.Description,
	}

	switch fs.Properties.ReturnType.Const {
	case "boolean":
		fd.ReturnType = "DynamicBoolean"
	case "string":
		fd.ReturnType = "DynamicString"
	case "number":
		fd.ReturnType = "DynamicNumber"
	case "void":
		fd.ReturnType = "Action"
	default:
		fd.ReturnType = "DynamicValue"
	}

	argNames := sortedKeys(fs.Properties.Args.Properties)
	reqArgs := map[string]bool{}
	for _, r := range fs.Properties.Args.Required {
		reqArgs[r] = true
	}

	for _, aname := range argNames {
		aprop := fs.Properties.Args.Properties[aname]
		arg := FuncArg{
			Name:     aname,
			GoName:   pascalCase(aname),
			GoType:   resolveGoType(aprop, "", aname),
			Required: reqArgs[aname],
		}
		// For the "required" function, the "value" arg has no type/ref, use DynamicValue.
		if arg.GoType == "any" {
			arg.GoType = "DynamicValue"
		}
		// And/Or values are []DynamicBoolean
		if aprop.Type == "array" && aprop.Items != nil && aprop.Items.Ref != "" {
			arg.GoType = "[]" + refToGoType(aprop.Items.Ref)
		}
		fd.Args = append(fd.Args, arg)
	}

	return fd, nil
}

func parseReturnTypes(ct *commonTypesFile) ([]EnumValue, error) {
	var fc struct {
		Properties struct {
			ReturnType struct {
				Enum []string `json:"enum"`
			} `json:"returnType"`
		} `json:"properties"`
	}
	if raw, ok := ct.Defs["FunctionCall"]; ok {
		if err := json.Unmarshal(raw, &fc); err != nil {
			return nil, fmt.Errorf("parse FunctionCall returnType: %w", err)
		}
	}
	var vals []EnumValue
	for _, v := range fc.Properties.ReturnType.Enum {
		vals = append(vals, EnumValue{
			Name:  "ReturnType" + pascalCase(v),
			Value: v,
		})
	}
	return vals, nil
}

// Template helper functions.

func pascalCase(s string) string {
	if s == "" {
		return ""
	}
	acronyms := map[string]string{
		"url": "URL", "id": "ID", "html": "HTML", "css": "CSS",
		"http": "HTTP", "https": "HTTPS", "api": "API", "uri": "URI",
	}
	var out strings.Builder
	for _, word := range identifierWords(s) {
		if upper, ok := acronyms[strings.ToLower(word)]; ok {
			out.WriteString(upper)
			continue
		}
		runes := []rune(word)
		runes[0] = unicode.ToUpper(runes[0])
		out.WriteString(string(runes))
	}
	return out.String()
}

func identifierWords(s string) []string {
	runes := []rune(s)
	var words []string
	start := 0
	for i := 0; i < len(runes); i++ {
		if !unicode.IsLetter(runes[i]) && !unicode.IsDigit(runes[i]) {
			if start < i {
				words = append(words, string(runes[start:i]))
			}
			start = i + 1
			continue
		}
		if i > start && unicode.IsUpper(runes[i]) && (unicode.IsLower(runes[i-1]) || unicode.IsDigit(runes[i-1])) {
			words = append(words, string(runes[start:i]))
			start = i
		}
	}
	if start < len(runes) {
		words = append(words, string(runes[start:]))
	}
	return words
}

func goFieldName(s string) string {
	return pascalCase(s)
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}
