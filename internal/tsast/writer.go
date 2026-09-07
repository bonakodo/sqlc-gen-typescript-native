// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE.
// Modified for sqlc: line-oriented API, fixed formatting, and no source maps.

package tsast

import (
	"fmt"
	"strings"
)

// Writer accumulates TypeScript source with two-space indentation. Its zero value
// is ready for use. A Writer must not be copied after its first write.
type Writer struct {
	// builder owns the emitted source text.
	builder strings.Builder
	// indent counts active indentation levels.
	indent int
}

// Line writes one formatted source fragment followed by LF. Only the first line
// receives indentation, so embedded newlines in string literals keep their value.
// With no arguments, format is written verbatim, including percent signs.
func (w *Writer) Line(format string, args ...any) {
	if len(args) > 0 {
		format = fmt.Sprintf(format, args...)
	}
	if format != "" {
		w.builder.WriteString(strings.Repeat("  ", w.indent))
		w.builder.WriteString(format)
	}
	w.builder.WriteByte('\n')
}

// Indent adds one indentation level for subsequent lines.
func (w *Writer) Indent() { w.indent++ }

// Dedent removes one indentation level. It panics for unbalanced generator code.
func (w *Writer) Dedent() {
	if w.indent == 0 {
		panic("tsast: indentation underflow")
	}
	w.indent--
}

// String returns the emitted source without clearing the writer.
func (w *Writer) String() string { return w.builder.String() }
