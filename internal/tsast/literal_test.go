package tsast

import (
	"fmt"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"
)

// TestLiterals verifies exact escaping for SQL-sensitive and Unicode characters.
func TestLiterals(t *testing.T) {
	tests := []struct {
		// name identifies the escape behavior under test.
		name string
		// input is the unescaped source value.
		input string
		// quoted is the expected double-quoted TypeScript literal.
		quoted string
		// template is the expected backtick TypeScript literal.
		template string
	}{
		{"empty", "", `""`, "``"},
		{"SQL text", "SELECT '東京'", `"SELECT '東京'"`, "`SELECT '東京'`"},
		{"quotes", "\"'`\\", `"\"'` + "`" + `\\"`, "`\"'\\`\\\\`"},
		{"substitution", "${globalThis.alert(1)}", `"${globalThis.alert(1)}"`, "`\\${globalThis.alert(1)}`"},
		{"line endings", "a\r\nb\rc\nd", `"a\r\nb\rc\nd"`, "`a\\r\\nb\\rc\nd`"},
		{"null digits", "\x001\x00x", `"\x001\0x"`, "`\\x001\\0x`"},
		{"controls", "\b\f\t\v\x01", `"\b\f\t\v\u0001"`, "`\\b\\f\\t\\v\\u0001`"},
		{"Unicode separators", "\u2028\u2029\u0085", `"\u2028\u2029\u0085"`, "`\\u2028\\u2029\\u0085`"},
		{"invalid UTF8", "\xff", `"\uFFFD"`, "`\\uFFFD`"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := Quote(test.input); got != test.quoted {
				t.Errorf("Quote() = %q, want %q", got, test.quoted)
			}
			if got := Template(test.input); got != test.template {
				t.Errorf("Template() = %q, want %q", got, test.template)
			}
		})
	}
}

// TestIdentifiers checks strict module names and quoted property access.
func TestIdentifiers(t *testing.T) {
	for _, name := range []string{"camelCase", "snake_case", "$value", "日本語", "π2", "a\u0301", "a\u200c"} {
		if !Identifier(name) {
			t.Errorf("Identifier(%q) rejected a valid name", name)
		}
	}
	for _, name := range []string{"", "1name", "name-space", "default", "class", "await", "arguments", "a\xff", "💾", "\u0301a"} {
		if Identifier(name) {
			t.Errorf("Identifier(%q) accepted an unsafe name", name)
		}
	}
	if got := Property("__proto__"); got != `["__proto__"]` {
		t.Errorf("Property(__proto__) = %s", got)
	}
	if got := Access("row", "x-y"); got != `row["x-y"]` {
		t.Errorf("Access() = %s", got)
	}
	if got := Access("row", "name"); got != `row.name` {
		t.Errorf("Access() = %s", got)
	}
}

// TestComment rejects source-code escape routes through SQL documentation.
func TestComment(t *testing.T) {
	got := Comment([]string{"Summary */ export const injected = 1;", "line\r\nnext\u2028last"})
	if strings.Count(got, "*/") != 1 || !strings.HasSuffix(got, " */") {
		t.Fatalf("comment has an early terminator: %q", got)
	}
	if !strings.Contains(got, "*\\/ export") || !strings.Contains(got, " * next\n * last") {
		t.Fatalf("comment was not normalized safely: %q", got)
	}
	if got := Comment(nil); got != "" {
		t.Errorf("Comment(nil) = %q", got)
	}
}

// FuzzLiteralRoundTrip checks cooked string values and syntactic escape safety.
func FuzzLiteralRoundTrip(f *testing.F) {
	for _, seed := range []string{"", "SELECT '${x}'\r\n", "\x001", "東京\u2028", "`\\\"", "\xff\xfe"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, input string) {
		want := string([]rune(input))
		for _, emitted := range []string{Quote(input), Template(input)} {
			got, err := decodeLiteral(emitted)
			if err != nil || got != want {
				t.Fatalf("literal %q decoded as %q, %v; want %q", emitted, got, err, want)
			}
		}
	})
}

// FuzzIdentifier ensures accepted names remain bare, valid UTF-8 property keys.
func FuzzIdentifier(f *testing.F) {
	for _, seed := range []string{"camelCase", "日本語", "default", "a-b", "__proto__"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, name string) {
		if Identifier(name) {
			if !utf8.ValidString(name) || name == "" {
				t.Fatalf("accepted invalid identifier %q", name)
			}
			if name != "__proto__" && Property(name) != name {
				t.Fatalf("accepted identifier changed in property position: %q", name)
			}
		}
	})
}

// decodeLiteral independently reads the JavaScript escape subset emitted here.
// Unlike Go's string reader, it permits \0 and escaped dollars in templates.
func decodeLiteral(source string) (string, error) {
	if len(source) < 2 || source[len(source)-1] != source[0] {
		return "", fmt.Errorf("mismatched delimiters")
	}
	quote := source[0]
	text := source[1 : len(source)-1]
	var out strings.Builder
	for i := 0; i < len(text); i++ {
		ch := text[i]
		if ch == quote || ch == '\r' || ch == '\n' && quote != '`' || quote == '`' && ch == '$' && i+1 < len(text) && text[i+1] == '{' {
			return "", fmt.Errorf("unescaped source character at %d", i)
		}
		if ch != '\\' {
			out.WriteByte(ch)
			continue
		}
		i++
		if i == len(text) {
			return "", fmt.Errorf("truncated escape")
		}
		switch text[i] {
		case '\\', '"', '`', '$':
			out.WriteByte(text[i])
		case '0':
			if i+1 < len(text) && text[i+1] >= '0' && text[i+1] <= '9' {
				return "", fmt.Errorf("octal escape")
			}
			out.WriteByte(0)
		case 'n':
			out.WriteByte('\n')
		case 'r':
			out.WriteByte('\r')
		case 'b':
			out.WriteByte('\b')
		case 'f':
			out.WriteByte('\f')
		case 't':
			out.WriteByte('\t')
		case 'v':
			out.WriteByte('\v')
		case 'x', 'u':
			count := 2
			if text[i] == 'u' {
				count = 4
			}
			if i+count >= len(text) {
				return "", fmt.Errorf("truncated hex escape")
			}
			value, err := strconv.ParseUint(text[i+1:i+count+1], 16, 32)
			if err != nil {
				return "", err
			}
			out.WriteRune(rune(value))
			i += count
		default:
			return "", fmt.Errorf("unknown escape: %c", text[i])
		}
	}
	return out.String(), nil
}
