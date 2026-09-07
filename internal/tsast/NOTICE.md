# TypeScript printer source

This package includes code adapted from Microsoft's TypeScript 7 Go compiler:

- Repository: <https://github.com/microsoft/typescript-go>
- Revision: `89d5d5b2849a0db0957065889ca58536fa6d2e4a`
- `internal/printer/utilities.go`: `escapeStringWorker`, character escapes, and
  quoted/template literal handling, adapted in `literal.go`.
- `internal/printer/textwriter.go`: indentation and literal-preserving writes,
  adapted in `writer.go`.
- `internal/printer/printer.go`: type-parenthesis emission informed the small
  type AST in `types.go`; this AST is sqlc-specific code.

Copyright (c) Microsoft Corporation. All rights reserved.
The upstream code uses the Apache License, Version 2.0, reproduced in `LICENSE`.

The port supports only syntax that sqlc emits. It omits compiler internals, JSX,
source maps, source-file trivia, ASCII-only output, and JavaScript surrogate
sentinels. Public inputs are UTF-8. Invalid bytes become replacement characters.
It uses fixed LF line endings and two-space indentation. No private Microsoft Go
package is imported and no TypeScript compiler process runs during generation.
