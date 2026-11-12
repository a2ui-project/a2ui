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

package agent

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/a2ui-project/a2ui/go/core"
)

// Skill represents a compiled SKILL.md artifact with YAML frontmatter and markdown body.
type Skill struct {
	Name        string
	Description string
	Content     string
	Metadata    map[string]any
	Filename    string
}

func wrapValidationError(cause error, format string, args ...any) *core.ValidationError {
	err := core.NewValidationErrorf(format, args...)
	err.Cause = cause
	return err
}

// NewSkill validates and normalizes s, defaulting Filename to "<Name>/SKILL.md" when empty.
func NewSkill(s Skill) (*Skill, error) {
	if s.Filename == "" {
		s.Filename = s.Name + "/SKILL.md"
	}
	if err := s.Validate(); err != nil {
		return nil, err
	}
	return &s, nil
}

// Validate checks that the Skill's Filename is a valid, traversal-free relative path.
func (s *Skill) Validate() error {
	if s == nil {
		return core.NewValidationError("skill must not be nil")
	}
	fn := s.Filename
	if fn == "" {
		fn = s.Name + "/SKILL.md"
	}
	return validateSkillFilename(fn)
}

// ToMarkdown serializes the Skill into a complete SKILL.md string with YAML frontmatter.
//
// The frontmatter is written as PyYAML writes it, so every SDK produces byte-identical
// skills. Metadata keys are written in sorted order.
func (s *Skill) ToMarkdown() string {
	entries := []frontmatterEntry{
		{key: "name", value: s.Name},
		{key: "description", value: s.Description},
	}
	if len(s.Metadata) > 0 {
		entries = append(entries, frontmatterEntry{key: "metadata", value: s.Metadata})
	}
	yamlStr := strings.TrimSpace(marshalFrontmatter(entries))
	body := strings.TrimSpace(s.Content)
	return fmt.Sprintf("---\n%s\n---\n\n%s\n", yamlStr, body)
}

// SkillSet holds a modular collection of Skill artifacts (core syntax + per-catalog skills).
type SkillSet struct {
	Skills []*Skill
}

// Add appends skill to the SkillSet (replacing any earlier skill with the same Filename).
func (s *SkillSet) Add(skill *Skill) {
	if skill == nil {
		return
	}
	if skill.Filename == "" && skill.Name != "" {
		skill.Filename = skill.Name + "/SKILL.md"
	}
	for i, existing := range s.Skills {
		if existing != nil && existing.Filename == skill.Filename {
			s.Skills[i] = skill
			return
		}
	}
	s.Skills = append(s.Skills, skill)
}

// Get looks up a skill by exact filename, exact name, or substring match (length >= 3).
func (s *SkillSet) Get(key string) *Skill {
	for _, sk := range s.Skills {
		if sk != nil && sk.Filename == key {
			return sk
		}
	}
	for _, sk := range s.Skills {
		if sk != nil && sk.Name == key {
			return sk
		}
	}
	if len(key) >= 3 {
		for _, sk := range s.Skills {
			if sk != nil && strings.Contains(sk.Filename, key) {
				return sk
			}
		}
	}
	return nil
}

// ToMap serializes all skills in the SkillSet to a map from relative filename to markdown content.
func (s *SkillSet) ToMap() (map[string]string, error) {
	out := make(map[string]string, len(s.Skills))
	for _, sk := range s.Skills {
		if sk == nil {
			continue
		}
		fn := sk.Filename
		if fn == "" {
			fn = sk.Name + "/SKILL.md"
		}
		if err := validateSkillFilename(fn); err != nil {
			return nil, err
		}
		out[fn] = sk.ToMarkdown()
	}
	return out, nil
}

// ExportToDirectory writes all skills in the SkillSet into dir safely, guarding against path traversal and symlinks.
func (s *SkillSet) ExportToDirectory(dir string) error {
	// Validate all filenames before touching disk so an invalid filename aborts cleanly.
	type plannedSkill struct {
		filename string
		markdown string
	}
	planned := make([]plannedSkill, 0, len(s.Skills))
	for _, sk := range s.Skills {
		if sk == nil {
			continue
		}
		fn := sk.Filename
		if fn == "" {
			fn = sk.Name + "/SKILL.md"
		}
		if err := validateSkillFilename(fn); err != nil {
			return err
		}
		planned = append(planned, plannedSkill{filename: fn, markdown: sk.ToMarkdown()})
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return wrapValidationError(err, "failed to create output directory %q: %v", dir, err)
	}
	outputRoot, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return wrapValidationError(err, "failed to resolve output directory %q: %v", dir, err)
	}
	outputRoot = filepath.Clean(outputRoot)

	var dirsToClean []string
	seenDirs := make(map[string]bool)
	for _, item := range planned {
		relNorm := strings.ReplaceAll(item.filename, `\`, "/")
		dirRel := filepath.FromSlash(posixDir(relNorm))
		if dirRel == "" || dirRel == "." {
			continue
		}
		skillFolder := filepath.Join(dir, dirRel)
		if err := assertResolvesInside(filepath.Dir(skillFolder), outputRoot, item.filename); err != nil {
			return err
		}
		if !seenDirs[skillFolder] {
			seenDirs[skillFolder] = true
			dirsToClean = append(dirsToClean, skillFolder)
		}
	}

	for _, skillFolder := range dirsToClean {
		info, statErr := os.Lstat(skillFolder)
		if statErr != nil {
			continue
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			if err := os.Remove(skillFolder); err != nil {
				return wrapValidationError(err, "failed to remove %q: %v", skillFolder, err)
			}
		} else {
			if err := os.RemoveAll(skillFolder); err != nil {
				return wrapValidationError(err, "failed to clean skill directory %q: %v", skillFolder, err)
			}
		}
	}

	for _, item := range planned {
		relNorm := filepath.FromSlash(strings.ReplaceAll(item.filename, `\`, "/"))
		targetPath := filepath.Join(dir, relNorm)
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return wrapValidationError(err, "failed to create parent directory for %q: %v", item.filename, err)
		}
		if err := assertResolvesInside(filepath.Dir(targetPath), outputRoot, item.filename); err != nil {
			return err
		}
		if info, lerr := os.Lstat(targetPath); lerr == nil && info.Mode()&os.ModeSymlink != 0 {
			if err := os.Remove(targetPath); err != nil {
				return wrapValidationError(err, "failed to remove symlink at %q: %v", targetPath, err)
			}
		}
		if err := os.WriteFile(targetPath, []byte(item.markdown), 0o644); err != nil {
			return wrapValidationError(err, "failed to write skill %q: %v", item.filename, err)
		}
	}
	return nil
}

func posixDir(p string) string {
	idx := strings.LastIndexByte(p, '/')
	if idx < 0 {
		return ""
	}
	return p[:idx]
}

func validateSkillFilename(filename string) error {
	if filename == "" {
		return core.NewValidationError("skill filename must be a non-empty relative path")
	}
	if strings.HasPrefix(filename, "/") || strings.HasPrefix(filename, `\`) {
		return core.NewValidationErrorf("skill filename %q must be a relative path without '.' or '..' segments", filename)
	}
	if len(filename) >= 2 && ((filename[0] >= 'a' && filename[0] <= 'z') || (filename[0] >= 'A' && filename[0] <= 'Z')) && filename[1] == ':' {
		return core.NewValidationErrorf("skill filename %q must be a relative path without '.' or '..' segments", filename)
	}
	segments := strings.FieldsFunc(filename, func(r rune) bool { return r == '/' || r == '\\' })
	// Also reject consecutive slashes or trailing slash which produce empty segments when split directly.
	rawParts := splitPathBothSlashes(filename)
	if len(segments) == 0 || len(rawParts) != len(segments) {
		return core.NewValidationErrorf("skill filename %q must be a relative path without '.' or '..' segments", filename)
	}
	for _, seg := range rawParts {
		if seg == "" || seg == "." || seg == ".." {
			return core.NewValidationErrorf("skill filename %q must be a relative path without '.' or '..' segments", filename)
		}
	}
	return nil
}

func splitPathBothSlashes(s string) []string {
	norm := strings.ReplaceAll(s, `\`, "/")
	return strings.Split(norm, "/")
}

func assertResolvesInside(target, outputRoot, filename string) error {
	existing := target
	for {
		if _, err := os.Lstat(existing); err == nil {
			break
		}
		parent := filepath.Dir(existing)
		if parent == existing {
			break
		}
		existing = parent
	}
	real, err := filepath.EvalSymlinks(existing)
	if err != nil {
		return wrapValidationError(err, "failed to resolve path for skill %q: %v", filename, err)
	}
	real = filepath.Clean(real)
	if real != outputRoot && !strings.HasPrefix(real, outputRoot+string(filepath.Separator)) {
		return core.NewValidationErrorf(
			"skill filename %q resolves through a symlink to %q, outside the output directory",
			filename, real,
		)
	}
	return nil
}

// SkillGeneratorOptions configures GenerateSkill and GenerateCoreSkill.
type SkillGeneratorOptions struct {
	Name        string
	Description string
	Catalogs    []*core.Catalog
}

// CatalogSkillOptions configures GenerateCatalogSkill.
// The zero value includes catalog examples.
type CatalogSkillOptions struct {
	Name            string
	Description     string
	ExcludeExamples bool
}

// SkillGenerator compiles an InferenceFormat and its Catalogs into Skill and SkillSet artifacts.
type SkillGenerator struct {
	Format InferenceFormat
}

// NewSkillGenerator creates a SkillGenerator for fmtInst.
func NewSkillGenerator(fmtInst InferenceFormat) *SkillGenerator {
	return &SkillGenerator{Format: fmtInst}
}

// GenerateSkill compiles a monolithic Skill covering rules, catalog instructions, and examples.
func (g *SkillGenerator) GenerateSkill(opts *SkillGeneratorOptions) (*Skill, error) {
	if g == nil || g.Format == nil {
		return nil, core.NewValidationError("SkillGenerator requires a non-nil InferenceFormat")
	}
	var resolved SkillGeneratorOptions
	if opts != nil {
		resolved = *opts
	}
	name := resolved.Name
	if name == "" {
		name = "a2ui"
	}
	desc := resolved.Description
	if desc == "" {
		desc = "Generates interactive user interface components for user requests."
	}
	body, err := AssembleInstructions(g.Format.PromptGenerator(), resolved.Catalogs)
	if err != nil {
		return nil, err
	}
	return NewSkill(Skill{
		Name:        name,
		Description: desc,
		Content:     body + "\n",
		Filename:    name + "/SKILL.md",
	})
}

// GenerateCoreSkill compiles a base core syntax Skill without catalog schemas.
func (g *SkillGenerator) GenerateCoreSkill(opts *SkillGeneratorOptions) (*Skill, error) {
	if g == nil || g.Format == nil {
		return nil, core.NewValidationError("SkillGenerator requires a non-nil InferenceFormat")
	}
	var resolved SkillGeneratorOptions
	if opts != nil {
		resolved = *opts
	}
	name := resolved.Name
	if name == "" {
		name = "a2ui-core"
	}
	desc := resolved.Description
	if desc == "" {
		desc = "Core A2UI protocol instructions and syntax rules for UI generation."
	}
	baseRules := strings.TrimSpace(g.Format.PromptGenerator().GenerateBaseRules(nil))
	return NewSkill(Skill{
		Name:        name,
		Description: desc,
		Content:     baseRules + "\n",
		Filename:    name + "/SKILL.md",
	})
}

// GenerateCatalogSkill compiles a dedicated Skill for catalog (or the format's first catalog when catalog is nil).
func (g *SkillGenerator) GenerateCatalogSkill(catalog *core.Catalog, opts *CatalogSkillOptions) (*Skill, error) {
	if g == nil || g.Format == nil {
		return nil, core.NewValidationError("SkillGenerator requires a non-nil InferenceFormat")
	}
	var resolved CatalogSkillOptions
	if opts != nil {
		resolved = *opts
	}
	target := catalog
	if target == nil {
		cats := g.Format.Catalogs()
		if len(cats) == 0 {
			return nil, core.NewValidationError("no catalog provided or configured on the inference format to compile catalog skill")
		}
		target = cats[0]
	}
	var examples string
	if !resolved.ExcludeExamples {
		var err error
		examples, err = g.Format.PromptGenerator().GenerateExamples(target, false)
		if err != nil {
			return nil, err
		}
	}
	return g.buildCatalogSkill(target, examples, resolved.Name, resolved.Description)
}

func (g *SkillGenerator) buildCatalogSkill(catalog *core.Catalog, examples, name, description string) (*Skill, error) {
	cleanName := cleanCatalogSkillName(catalog)
	skillName := name
	if skillName == "" {
		skillName = "a2ui-" + cleanName
	}
	catBody := g.Format.PromptGenerator().GenerateCatalogInstructions(true, catalog)
	if examples != "" {
		catBody += "\n\n" + ExamplesHeading + "\n\n" + examples
	}
	desc := description
	if desc == "" {
		desc = fmt.Sprintf("UI component catalog signatures for %s. Use when building %s user interface components.", cleanName, cleanName)
	}
	return NewSkill(Skill{
		Name:        skillName,
		Description: desc,
		Content:     strings.TrimSpace(catBody) + "\n",
		Filename:    skillName + "/SKILL.md",
	})
}

// GenerateSkillSet compiles a modular SkillSet (core skill + one skill per catalog).
func (g *SkillGenerator) GenerateSkillSet(catalogs []*core.Catalog, coreName string) (*SkillSet, error) {
	if g == nil || g.Format == nil {
		return nil, core.NewValidationError("SkillGenerator requires a non-nil InferenceFormat")
	}
	if coreName == "" {
		coreName = "a2ui-core"
	}
	coreSkill, err := g.GenerateCoreSkill(&SkillGeneratorOptions{Name: coreName})
	if err != nil {
		return nil, err
	}
	set := &SkillSet{}
	set.Add(coreSkill)

	targets := catalogs
	if targets == nil {
		targets = g.Format.Catalogs()
	}
	pg := g.Format.PromptGenerator()
	seenExamples := make(map[string]bool)
	for _, cat := range targets {
		ex, exErr := pg.GenerateExamples(cat, false)
		if exErr != nil {
			return nil, exErr
		}
		useEx := ex
		if seenExamples[ex] {
			useEx = ""
		}
		seenExamples[ex] = true
		catSkill, csErr := g.buildCatalogSkill(cat, useEx, "", "")
		if csErr != nil {
			return nil, csErr
		}
		set.Add(catSkill)
	}
	return set, nil
}

func cleanCatalogSkillName(cat *core.Catalog) string {
	if cat == nil || cat.CatalogID() == "" {
		return "basic"
	}
	rawID := cat.CatalogID()
	if strings.ContainsAny(rawID, `/\`) {
		norm := strings.ReplaceAll(rawID, `\`, "/")
		var parts []string
		for _, p := range strings.Split(norm, "/") {
			if p != "" && !strings.HasSuffix(p, ".json") {
				parts = append(parts, p)
			}
		}
		if len(parts) > 0 {
			cand := parts[len(parts)-1]
			if strings.HasPrefix(cand, "v") && len(parts) > 1 {
				cand = parts[len(parts)-2]
			}
			rawID = cand
		}
	}
	return strings.ToLower(rawID)
}
