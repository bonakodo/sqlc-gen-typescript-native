// Package tsast prints the TypeScript syntax used by sqlc's native generator.
// It owns no global mutable state and does not invoke a TypeScript compiler.
// Literal escaping and writer behavior derive from Microsoft's TypeScript 7
// printer; see NOTICE.md for source revisions and the scope of the port.
package tsast
