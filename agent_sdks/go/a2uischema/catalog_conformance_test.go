package a2uischema

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCatalogLoadExamplesConformance(t *testing.T) {
	catalog := &Catalog{
		Version:              Version09,
		Name:                 "test",
		ServerToClientSchema: map[string]any{},
		CommonTypesSchema:    map[string]any{},
		CatalogSchema:        map[string]any{CatalogIDKey: "basic"},
	}
	root := makeLoadExamplesFixtures(t)
	tests := []struct {
		name string
		path string
		want string
	}{
		{
			name: "empty",
			path: "",
		},
		{
			name: "missing",
			path: root + "/missing",
		},
		{
			name: "directory",
			path: root + "/basic",
			want: "---BEGIN example1---\n" +
				`[{"beginRendering": {"surfaceId": "id"}}]` + "\n" +
				"---END example1---\n\n" +
				"---BEGIN example2---\n" +
				`[{"beginRendering": {"surfaceId": "id"}}]` + "\n" +
				"---END example2---",
		},
		{
			name: "glob prefix",
			path: root + "/glob_filter/user_*.json",
			want: "---BEGIN user_profile---\n" +
				`[{"beginRendering": {"surfaceId": "user"}}]` + "\n" +
				"---END user_profile---\n\n" +
				"---BEGIN user_settings---\n" +
				`[{"beginRendering": {"surfaceId": "settings"}}]` + "\n" +
				"---END user_settings---",
		},
		{
			name: "glob range",
			path: root + "/glob_range/step[1-2].json",
			want: "---BEGIN step1---\n" +
				`[{"beginRendering": {"surfaceId": "1"}}]` + "\n" +
				"---END step1---\n\n" +
				"---BEGIN step2---\n" +
				`[{"beginRendering": {"surfaceId": "2"}}]` + "\n" +
				"---END step2---",
		},
		{
			name: "glob negation",
			path: root + "/glob_negation/[!i]*.json",
			want: "---BEGIN visible---\n" +
				`[{"beginRendering": {"surfaceId": "visible"}}]` + "\n" +
				"---END visible---",
		},
		{
			name: "recursive glob",
			path: root + "/glob_recursive/**/*.json",
			want: "---BEGIN deep---\n" +
				`[{"beginRendering": {"surfaceId": "deep"}}]` + "\n" +
				"---END deep---\n\n" +
				"---BEGIN top---\n" +
				`[{"beginRendering": {"surfaceId": "top"}}]` + "\n" +
				"---END top---",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := catalog.LoadExamples(tt.path, false)
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Fatalf("LoadExamples() = %q, want %q", got, tt.want)
			}
		})
	}
}

func makeLoadExamplesFixtures(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	files := map[string]string{
		"basic/example1.json":             `[{"beginRendering": {"surfaceId": "id"}}]`,
		"basic/example2.json":             `[{"beginRendering": {"surfaceId": "id"}}]`,
		"basic/ignored.txt":               "ignored",
		"glob_filter/admin_profile.json":  `[{"beginRendering": {"surfaceId": "admin"}}]`,
		"glob_filter/user_profile.json":   `[{"beginRendering": {"surfaceId": "user"}}]`,
		"glob_filter/user_settings.json":  `[{"beginRendering": {"surfaceId": "settings"}}]`,
		"glob_negation/index.json":        `[{"beginRendering": {"surfaceId": "index"}}]`,
		"glob_negation/visible.json":      `[{"beginRendering": {"surfaceId": "visible"}}]`,
		"glob_range/step1.json":           `[{"beginRendering": {"surfaceId": "1"}}]`,
		"glob_range/step2.json":           `[{"beginRendering": {"surfaceId": "2"}}]`,
		"glob_range/step3.json":           `[{"beginRendering": {"surfaceId": "3"}}]`,
		"glob_recursive/ignored.txt":      "ignored",
		"glob_recursive/nested/deep.json": `[{"beginRendering": {"surfaceId": "deep"}}]`,
		"glob_recursive/top.json":         `[{"beginRendering": {"surfaceId": "top"}}]`,
	}
	for name, content := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o666); err != nil {
			t.Fatal(err)
		}
	}
	return root
}
