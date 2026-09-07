// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See LICENSE.
// Modified for sqlc: restricted to UTF-8 string and template literals, with no
// compiler AST, JSX, source maps, or JavaScript surrogate-sentinel dependencies.

package tsast

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

// escapedChars maps characters with short JavaScript escapes to their source text.
var escapedChars = map[rune]string{
	'\t': `\t`, '\v': `\v`, '\f': `\f`, '\b': `\b`, '\r': `\r`, '\n': `\n`,
	'\\': `\\`, '"': `\"`, '`': "\\`", '$': `\$`,
	'\u2028': `\u2028`, '\u2029': `\u2029`, '\u0085': `\u0085`,
}

// Quote returns a double-quoted TypeScript string literal. It preserves valid
// UTF-8 and replaces each invalid input byte with the Unicode replacement rune.
func Quote(value string) string {
	return literal(value, '"')
}

// Template returns a backtick literal with no substitutions. It preserves SQL
// text, including CRLF, backslashes, backticks, and literal ${ sequences.
func Template(value string) string {
	return literal(value, '`')
}

// literal adapts TypeScript's escapeStringWorker to the two emitted quote forms.
func literal(value string, quote rune) string {
	var out strings.Builder
	out.Grow(len(value) + 2)
	out.WriteRune(quote)
	start := 0
	for i := 0; i < len(value); {
		ch, size := utf8.DecodeRuneInString(value[i:])
		escape := ch == utf8.RuneError && size == 1
		switch ch {
		case '\\', quote, '\u2028', '\u2029', '\u0085', '\r':
			escape = true
		case '$':
			escape = quote == '`' && i+1 < len(value) && value[i+1] == '{'
		case '\n':
			escape = quote != '`'
		default:
			escape = escape || ch <= '\u001f'
		}
		if escape {
			out.WriteString(value[start:i])
			switch {
			case ch == '\r' && quote == '`' && i+1 < len(value) && value[i+1] == '\n':
				// Raw CRLF in a template cooks to LF, so both bytes need escapes.
				size++
				out.WriteString(`\r\n`)
			case ch == 0:
				if i+1 < len(value) && value[i+1] >= '0' && value[i+1] <= '9' {
					// A decimal digit after \0 could create a forbidden octal escape.
					out.WriteString(`\x00`)
				} else {
					out.WriteString(`\0`)
				}
			default:
				if escaped, ok := escapedChars[ch]; ok {
					out.WriteString(escaped)
				} else {
					fmt.Fprintf(&out, `\u%04X`, ch)
				}
			}
			start = i + size
		}
		i += size
	}
	out.WriteString(value[start:])
	out.WriteRune(quote)
	return out.String()
}

// Identifier reports whether value is a safe identifier in a strict TypeScript
// module. Property and Access also accept names that cannot be bare identifiers.
func Identifier(value string) bool {
	if value == "" || !utf8.ValidString(value) {
		return false
	}
	for i, ch := range value {
		if ch == '$' || ch == '_' || unicode.IsLetter(ch) || unicode.Is(unicode.Nl, ch) || unicode.Is(unicode.Other_ID_Start, ch) {
			continue
		}
		if i > 0 && (unicode.IsDigit(ch) || unicode.Is(unicode.Mn, ch) || unicode.Is(unicode.Mc, ch) || unicode.Is(unicode.Pc, ch) || unicode.Is(unicode.Other_ID_Continue, ch) || ch == '\u200c' || ch == '\u200d') {
			continue
		}
		return false
	}
	switch value {
	case "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "implements", "import", "in", "instanceof", "interface", "let", "new", "null", "package", "private", "protected", "public", "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield", "eval", "arguments":
		return false
	}
	return true
}

// Property returns a safe declaration or object-literal key. The computed form
// for __proto__ creates a data property rather than setting an object's prototype.
func Property(value string) string {
	if value == "__proto__" {
		return "[" + Quote(value) + "]"
	}
	if Identifier(value) {
		return value
	}
	return Quote(value)
}

// Access returns property access on an already-printed object expression. The
// caller must parenthesize expressions that cannot precede a dot or bracket.
func Access(object, key string) string {
	if Identifier(key) {
		return object + "." + key
	}
	return object + "[" + Quote(key) + "]"
}

// Comment returns a JSDoc block without a trailing newline. It neutralizes block
// terminators and line separators so SQL comments cannot escape into source code.
func Comment(lines []string) string {
	if len(lines) == 0 {
		return ""
	}
	var out strings.Builder
	out.WriteString("/**\n")
	for _, line := range lines {
		line = strings.ToValidUTF8(line, "\uFFFD")
		line = strings.ReplaceAll(line, "*/", "*\\/")
		line = strings.NewReplacer("\r\n", "\n", "\r", "\n", "\u2028", "\n", "\u2029", "\n").Replace(line)
		for _, part := range strings.Split(line, "\n") {
			out.WriteString(" *")
			if part != "" {
				out.WriteByte(' ')
				out.WriteString(part)
			}
			out.WriteByte('\n')
		}
	}
	out.WriteString(" */")
	return out.String()
}
