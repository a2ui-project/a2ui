package a2uischema

import (
	"fmt"
	"os"
)

// CatalogProvider loads a catalog schema.
type CatalogProvider interface {
	Load() ([]byte, error)
}

// StaticCatalogProvider returns a fixed schema payload.
type StaticCatalogProvider struct {
	Data []byte
}

// Load implements [CatalogProvider].
func (p StaticCatalogProvider) Load() ([]byte, error) {
	if len(p.Data) == 0 {
		return nil, fmt.Errorf("schema: static catalog provider has no data")
	}
	data := make([]byte, len(p.Data))
	copy(data, p.Data)
	return data, nil
}

// FileSystemCatalogProvider loads a catalog schema from disk.
type FileSystemCatalogProvider string

// Load implements [CatalogProvider].
func (p FileSystemCatalogProvider) Load() ([]byte, error) {
	return os.ReadFile(string(p))
}

// BasicCatalogProvider returns the embedded basic catalog provider for a version.
func BasicCatalogProvider(version Version) (CatalogProvider, error) {
	switch version {
	case Version09:
		return StaticCatalogProvider{Data: basicCatalogV09}, nil
	case Version091:
		return StaticCatalogProvider{Data: basicCatalogV091}, nil
	case Version010:
		return StaticCatalogProvider{Data: basicCatalogV010}, nil
	default:
		return nil, fmt.Errorf("schema: unsupported version %q", version)
	}
}
