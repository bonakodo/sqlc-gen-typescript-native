package typescript

import (
	"strings"
	"testing"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/tsast"
)

// TestTypeExpressions checks the supported override grammar and ensures that
// imported type aliases do not rename object property names or string literals.
func TestTypeExpressions(t *testing.T) {
	for _, test := range []struct {
		source string
		want   string
	}{
		{"string | null", "string | null"},
		{"Date[]", "Date[]"},
		{"(ID | null)[]", "(ID_2 | null)[]"},
		{"Record<string, ID>", "Record<string, ID_2>"},
		{"ID.Nested", "ID_2.Nested"},
		{`ID & { readonly id?: ID; ID: "ID" }`, `ID_2 & { readonly id?: ID_2; ID: "ID"; }`},
		{`{ readonly: boolean; readonly?: boolean }`, `{ readonly: boolean; readonly?: boolean; }`},
		{"[string, ID?]", "[string, ID_2?]"},
		{"[]", "[]"},
		{"readonly ID[]", "readonly ID_2[]"},
		{"readonly [string, ID]", "readonly [string, ID_2]"},
		{"keyof ID", "keyof ID_2"},
		{"typeof ID.value", "typeof ID_2.value"},
		{"typeof ID[]", "typeof ID_2[]"},
		{`ID["id"]`, `ID_2["id"]`},
		{"true | false | 0 | -1 | 2n | -3n | 1.5 | 1e3", "true | false | 0 | -1 | 2n | -3n | 1.5 | 1e3"},
		{`"a\u0041" | 'b\x42'`, `"a\u0041" | 'b\x42'`},
		{"利用者 | ID", "利用者 | ID_2"},
	} {
		t.Run(test.source, func(t *testing.T) {
			got, err := parseType(test.source, map[string]string{"ID": "ID_2"})
			if err != nil || got != test.want {
				t.Fatalf("parseType(%q) = %q, %v; want %q", test.source, got, err, test.want)
			}
		})
	}
}

// TestInvalidTypeExpressions rejects malformed syntax and executable fragments
// at generation time, rather than leaving deno check to discover them later.
func TestInvalidTypeExpressions(t *testing.T) {
	for _, source := range []string{
		"", "class", "function", "return", "this", "import", "infer", "unique", "string<T>", "true.member",
		"Foo |", "Foo &", "Foo<>", "Foo<T", "(Foo", "Foo[", "{ id string }", "{id: }", "[string?, number]",
		"1.2n", "01", "00n", "1e", "1e+n", "readonly string", `typeof "string"`, "typeof string", "typeof ID.",
		`"unterminated`, `"bad\uXX00"`, `"bad\xGG"`, `"bad\07"`, "\"line\nbreak\"", "\"nul\x00byte\"",
		"Foo; globalThis.pwned = true", "Foo /* comment */", "() => void", "Foo extends Bar ? X : Y", "`template`", string([]byte{0xff}),
	} {
		t.Run(source, func(t *testing.T) {
			if got, err := parseType(source, nil); err == nil || !strings.Contains(err.Error(), "ts_type") {
				t.Fatalf("parseType(%q) = %q, %v; want a ts_type error", source, got, err)
			}
		})
	}
	if _, err := parseType("ID", map[string]string{"ID": "Bad;Code"}); err == nil {
		t.Fatal("invalid imported alias was emitted as source")
	}
}

// TestTypeExpressionLimits bounds recursion and work for user-controlled types.
func TestTypeExpressionLimits(t *testing.T) {
	for _, test := range []struct {
		source string
		want   string
	}{
		{strings.Repeat("(", maxTypeDepth+1) + "string" + strings.Repeat(")", maxTypeDepth+1), "nesting"},
		{strings.Repeat("A | ", maxTypeTokens) + "A", "tokens"},
		{strings.Repeat("A", maxTypeSourceBytes+1), "bytes"},
	} {
		if _, err := parseType(test.source, nil); err == nil || !strings.Contains(err.Error(), test.want) {
			t.Fatalf("limit %s: got %v", test.want, err)
		}
	}
}

// TestGeneratedNames checks stable collision suffixes, reserved names, and the
// distinction between declaration identifiers and quoted result properties.
func TestGeneratedNames(t *testing.T) {
	names := newNameSet()
	for _, test := range []struct{ base, want string }{
		{"class", "class_2"}, {"class", "class_3"}, {"Class", "Class"},
		{"Database", "Database_2"}, {"GetUser", "GetUser"}, {"GetUser", "GetUser_2"},
	} {
		if got := names.take(test.base); got != test.want {
			t.Fatalf("take(%q) = %q, want %q", test.base, got, test.want)
		}
	}
	for _, test := range []struct{ source, want string }{
		{"userName", "userName"}, {"user_name", "userName"}, {"userAccount_id", "userAccountId"},
		{"HTTP_status", "httpStatus"}, {"USER_ID", "userId"}, {"利用者_名前", "利用者名前"},
		{"full name", "full name"}, {"__proto__", "__proto__"}, {"", "col1"}, {"_", "col1"},
	} {
		if got := fieldName(test.source, "col1"); got != test.want {
			t.Fatalf("fieldName(%q) = %q, want %q", test.source, got, test.want)
		}
	}
	for _, source := range []string{"", "123 users", "user_name", "e\u0301tat", "利用者", "quote\"field", "___", "💾"} {
		name := declarationName(source)
		if !tsast.Identifier(name) {
			t.Fatalf("declarationName(%q) produced invalid identifier %q", source, name)
		}
	}
	if got := declarationName("e\u0301tat"); got != "E\u0301tat" {
		t.Fatalf("declarationName discarded a combining mark: %q", got)
	}
	if got := tsast.Property("__proto__"); got != `["__proto__"]` {
		t.Fatalf("object key changes the prototype: %s", got)
	}
}

// FuzzTypeExpressions checks that bounded arbitrary type input never panics and
// that a successfully formatted type can be parsed again without changes.
func FuzzTypeExpressions(f *testing.F) {
	for _, seed := range []string{"string", "Record<string, ID>", "[ID?, ID]", "Foo & { readonly id: 1n }", "class", "1.2n"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, source string) {
		output, err := parseType(source, nil)
		if err != nil {
			return
		}
		again, err := parseType(output, nil)
		if err != nil || output != again {
			t.Fatalf("formatted type was unstable: %q -> %q -> %q, %v", source, output, again, err)
		}
	})
}
