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

package main

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/a2aproject/a2a-go/a2a"
	"github.com/a2aproject/a2a-go/a2asrv"

	"github.com/a2ui-project/a2ui/go/a2aext"
)

var localhostOriginRe = regexp.MustCompile(`^http://localhost:\d+$`)

// serverApp bundles the configured HTTP handler, AgentCard, and resolved SampleConfig.
type serverApp struct {
	Handler   http.Handler
	AgentCard *a2a.AgentCard
	Config    sampleConfig
}

// createServerOptions configures CreateServerApp for production or test servers.
type createServerOptions struct {
	Env      map[string]string
	Port     int
	BaseURL  string
	Backend  modelBackend
	RepoRoot string
}

// buildAgentCard constructs the A2A AgentCard advertised at /.well-known/agent-card.json.
func buildAgentCard(port int, baseURL string, stub bool) *a2a.AgentCard {
	name := "Restaurant Agent"
	if stub {
		name = "Restaurant Agent (stub)"
	}
	endpointURL := fmt.Sprintf("http://localhost:%d/a2a/json-rpc", port)
	if trimmed := strings.TrimRight(baseURL, "/"); trimmed != "" {
		endpointURL = trimmed + "/a2a/json-rpc"
	}

	extensions := make([]a2a.AgentExtension, 0, len(servedVersions))
	for _, profile := range servedVersions {
		extensions = append(extensions, a2aext.AgentExtension(profile.ProtocolVersion, &a2aext.AgentExtensionOptions{
			SupportedCatalogIDs: []string{profile.BasicCatalogID},
		}))
	}

	return &a2a.AgentCard{
		Name:               name,
		Description:        "This agent helps find restaurants based on user criteria.",
		ProtocolVersion:    string(a2a.Version),
		Version:            "1.0.0",
		URL:                endpointURL,
		DefaultInputModes:  []string{"text/plain"},
		DefaultOutputModes: []string{"text/plain"},
		Capabilities: a2a.AgentCapabilities{
			Streaming:  true,
			Extensions: extensions,
		},
		Skills: []a2a.AgentSkill{
			{
				ID:          "find_restaurants",
				Name:        "Find Restaurants Tool",
				Description: "Helps find restaurants based on user criteria (e.g., cuisine, location).",
				Tags:        []string{"restaurant", "finder"},
				Examples:    []string{"Find me the top 10 chinese restaurants in the US"},
			},
		},
	}
}

// createServerApp initializes catalogs, backend, A2A request handler, static routes, and localhost CORS without binding a socket.
func createServerApp(ctx context.Context, opts createServerOptions) (*serverApp, error) {
	cfg, err := resolveSampleConfig(opts.Env, opts.Port)
	if err != nil {
		return nil, err
	}

	repoRoot := opts.RepoRoot
	if repoRoot == "" {
		repoRoot, err = resolveRepoRoot()
		if err != nil {
			return nil, err
		}
	}
	if err := verifySampleAssets(repoRoot); err != nil {
		return nil, err
	}

	catalogs, err := loadBasicCatalogs(repoRoot)
	if err != nil {
		return nil, err
	}

	baseURL := opts.BaseURL
	if baseURL == "" {
		baseURL = fmt.Sprintf("http://localhost:%d", cfg.Port)
	}

	backend := opts.Backend
	if backend == nil {
		if cfg.Mode == modeStub {
			backend, err = newStubBackend(repoRoot, cfg.Format, catalogs)
			if err != nil {
				return nil, err
			}
		} else {
			backend, err = newADKBackend(ctx, adkBackendOptions{
				Config:          cfg,
				BaseURL:         baseURL,
				PythonSampleDir: resolvePythonSampleDir(repoRoot),
			})
			if err != nil {
				return nil, err
			}
		}
	}

	card := buildAgentCard(cfg.Port, opts.BaseURL, cfg.Mode == modeStub)
	executor, err := newRestaurantExecutor(repoRoot, cfg.Format, backend, catalogs, card)
	if err != nil {
		return nil, err
	}

	reqHandler := a2asrv.NewHandler(executor, a2asrv.WithCallInterceptor(extensionCallInterceptor{}))
	jsonrpcHandler := withActivatedExtensionsHeader(a2asrv.NewJSONRPCHandler(reqHandler))
	cardHandler := a2asrv.NewStaticAgentCardHandler(card)

	imagesDir := filepath.Join(resolvePythonSampleDir(repoRoot), "images")
	staticHandler := http.StripPrefix("/static/", http.FileServer(http.Dir(imagesDir)))

	mux := http.NewServeMux()
	mux.Handle(a2asrv.WellKnownAgentCardPath, cardHandler)
	mux.Handle("/static/", staticHandler)
	mux.Handle("/a2a/json-rpc", jsonrpcHandler)
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" && r.Method == http.MethodPost {
			jsonrpcHandler.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	}))

	return &serverApp{
		Handler:   localhostCORSMiddleware(mux),
		AgentCard: card,
		Config:    cfg,
	}, nil
}

func localhostCORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Origin")
		if r.Method == http.MethodOptions {
			w.Header().Add("Vary", "Access-Control-Request-Headers")
		}
		origin := r.Header.Get("Origin")
		if origin != "" && localhostOriginRe.MatchString(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE, PATCH")
			reqHeaders := r.Header.Get("Access-Control-Request-Headers")
			if reqHeaders == "" {
				reqHeaders = "*"
			}
			w.Header().Set("Access-Control-Allow-Headers", reqHeaders)
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type callContextHolderKey struct{}

type callContextHolder struct {
	mu      sync.Mutex
	callCtx *a2asrv.CallContext
}

func (h *callContextHolder) set(callCtx *a2asrv.CallContext) {
	h.mu.Lock()
	h.callCtx = callCtx
	h.mu.Unlock()
}

func (h *callContextHolder) activatedURIs() []string {
	h.mu.Lock()
	cc := h.callCtx
	h.mu.Unlock()
	if cc == nil {
		return nil
	}
	return cc.Extensions().ActivatedURIs()
}

type extensionCallInterceptor struct {
	a2asrv.PassthroughCallInterceptor
}

func (extensionCallInterceptor) Before(ctx context.Context, callCtx *a2asrv.CallContext, _ *a2asrv.Request) (context.Context, error) {
	if h, ok := ctx.Value(callContextHolderKey{}).(*callContextHolder); ok {
		h.set(callCtx)
	}
	return ctx, nil
}

type extensionResponseWriter struct {
	http.ResponseWriter
	holder      *callContextHolder
	wroteHeader bool
}

func (w *extensionResponseWriter) applyExtensionHeader() {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	if uris := w.holder.activatedURIs(); len(uris) > 0 {
		w.Header().Set(a2asrv.ExtensionsMetaKey, strings.Join(uris, ", "))
	}
}

func (w *extensionResponseWriter) WriteHeader(statusCode int) {
	w.applyExtensionHeader()
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *extensionResponseWriter) Write(p []byte) (int, error) {
	w.applyExtensionHeader()
	return w.ResponseWriter.Write(p)
}

func (w *extensionResponseWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *extensionResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func withActivatedExtensionsHeader(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		holder := &callContextHolder{}
		ctx := context.WithValue(r.Context(), callContextHolderKey{}, holder)
		next.ServeHTTP(&extensionResponseWriter{ResponseWriter: w, holder: holder}, r.WithContext(ctx))
	})
}
