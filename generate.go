// Package typescript generates TypeScript source files from sqlc's plugin
// protocol. It can run as a Go library, a native sqlc plugin, or a WASI plugin.
// Generation uses only Go code and does not invoke a TypeScript compiler.
package typescript

import (
	"context"

	"github.com/bonakodo/sqlc-gen-typescript-native/protocol"

	codegen "github.com/bonakodo/sqlc-gen-typescript-native/internal/codegen"
)

// Generate translates a sqlc request into TypeScript files. The request's
// PluginOptions field contains the JSON generator options, and file names in
// the response are relative to the output directory selected in sqlc's config.
// Generate does not read or write files and does not change req.
func Generate(ctx context.Context, req *protocol.GenerateRequest) (*protocol.GenerateResponse, error) {
	return codegen.Generate(ctx, req)
}
