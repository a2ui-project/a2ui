package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveOutputConfigDefaultLayout(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module example.com/a2ui\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg, err := resolveOutputConfig(dir, "", "a2ui", "a2uibuild", "", "v09")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.A2UIDir != "a2ui" {
		t.Fatalf("A2UIDir = %q, want a2ui", cfg.A2UIDir)
	}
	if cfg.A2UIBuildDir != "a2uibuild" {
		t.Fatalf("A2UIBuildDir = %q, want a2uibuild", cfg.A2UIBuildDir)
	}
	if cfg.A2UIImport != "example.com/a2ui/a2ui" {
		t.Fatalf("A2UIImport = %q, want example.com/a2ui/a2ui", cfg.A2UIImport)
	}
	if cfg.VersionImport != "example.com/a2ui/a2ui/v09" {
		t.Fatalf("VersionImport = %q, want example.com/a2ui/a2ui/v09", cfg.VersionImport)
	}
}

func TestResolveOutputConfigRootLayout(t *testing.T) {
	dir := t.TempDir()

	cfg, err := resolveOutputConfig(dir, "example.com/root", ".", "a2uibuild", "", "v09")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.A2UIDir != "." {
		t.Fatalf("A2UIDir = %q, want .", cfg.A2UIDir)
	}
	if cfg.A2UIImport != "example.com/root" {
		t.Fatalf("A2UIImport = %q, want example.com/root", cfg.A2UIImport)
	}
	if cfg.VersionImport != "example.com/root/v09" {
		t.Fatalf("VersionImport = %q, want example.com/root/v09", cfg.VersionImport)
	}
}

func TestResolveOutputConfigExplicitA2UIImport(t *testing.T) {
	dir := t.TempDir()

	cfg, err := resolveOutputConfig(dir, "", "generated/a2ui", "generated/a2uibuild", "example.com/custom/a2ui", "v010")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.A2UIImport != "example.com/custom/a2ui" {
		t.Fatalf("A2UIImport = %q, want example.com/custom/a2ui", cfg.A2UIImport)
	}
	if cfg.VersionImport != "example.com/custom/a2ui/v010" {
		t.Fatalf("VersionImport = %q, want example.com/custom/a2ui/v010", cfg.VersionImport)
	}
}
