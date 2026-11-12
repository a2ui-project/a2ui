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

// Command restaurant_finder runs the A2UI Go Restaurant Finder sample agent server over A2A HTTP JSON-RPC + SSE.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// shutdownTimeout bounds how long in-flight requests, including open SSE streams,
// get to finish after an interrupt.
const shutdownTimeout = 10 * time.Second

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	app, err := createServerApp(ctx, createServerOptions{})
	if err != nil {
		return fmt.Errorf("configuration error: %w", err)
	}

	fmt.Printf("Restaurant Agent Go Sample running on port %d\n", app.Config.Port)
	fmt.Printf("Format: %s\n", app.Config.Format)
	switch {
	case app.Config.Mode == modeStub:
		fmt.Println("Model: none. STUB_LLM=true, so every turn serves the canned response.")
	case app.Config.UseVertexAI:
		fmt.Printf("Model: %s via Vertex AI (project=%s, location=%s)\n", app.Config.ModelName, app.Config.VertexProject, app.Config.VertexLoc)
	default:
		fmt.Printf("Model: %s via GEMINI_API_KEY\n", app.Config.ModelName)
	}
	fmt.Printf("JSON-RPC endpoint: http://localhost:%d/a2a/json-rpc\n", app.Config.Port)

	srv := &http.Server{
		Addr:              fmt.Sprintf("0.0.0.0:%d", app.Config.Port),
		Handler:           app.Handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		// No WriteTimeout: SSE responses stay open for the whole model turn.
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.ListenAndServe() }()

	select {
	case err := <-serveErr:
		return fmt.Errorf("server error: %w", err)
	case <-ctx.Done():
	}
	stop()
	fmt.Println("Shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("shutdown: %w", err)
	}
	return nil
}
