package tsast

import "testing"

// TestTypePrecedence ensures array suffixes cannot change a union's meaning.
func TestTypePrecedence(t *testing.T) {
	typ := ArrayType{Element: UnionType{NameType("string"), NameType("null")}}
	if got := typ.TypeScript(); got != "(string | null)[]" {
		t.Fatalf("type = %s", got)
	}
	if got := (UnionType{ArrayType{Element: NameType("bigint")}, NameType("null")}).TypeScript(); got != "bigint[] | null" {
		t.Fatalf("type = %s", got)
	}
	if got := (UnionType{}).TypeScript(); got != "never" {
		t.Fatalf("empty union = %s", got)
	}
	for _, custom := range []string{"'a'|'b'", "keyof Model", "() => string"} {
		if got := (ArrayType{Element: NameType(custom)}).TypeScript(); got != "("+custom+")[]" {
			t.Fatalf("custom array type = %s", got)
		}
	}
	if got := (UnionType{NameType("() => string"), NameType("null")}).TypeScript(); got != "(() => string) | null" {
		t.Fatalf("function union type = %s", got)
	}
}

// TestInterfaceEmission covers documentation, unusual keys, and optional fields.
func TestInterfaceEmission(t *testing.T) {
	var w Writer
	InterfaceDecl{
		Name: "Record", Export: true, Doc: []string{"Record describes a SQL result."},
		Properties: []PropertyDecl{
			{Name: "display-name", Type: NameType("string"), Optional: true, Readonly: true, Doc: []string{"display-name retains the database field."}},
		},
	}.Emit(&w)
	want := "/**\n * Record describes a SQL result.\n */\nexport interface Record {\n  /**\n   * display-name retains the database field.\n   */\n  readonly \"display-name\"?: string;\n}\n"
	if got := w.String(); got != want {
		t.Fatalf("source = %q, want %q", got, want)
	}
}

// TestWriterPreservesLiteralLines checks that indentation cannot modify SQL text.
func TestWriterPreservesLiteralLines(t *testing.T) {
	var w Writer
	w.Indent()
	w.Line("const sql = %s;", Template("SELECT 1\n-- 20% complete"))
	w.Dedent()
	w.Line("// 100% complete")
	want := "  const sql = `SELECT 1\n-- 20% complete`;\n// 100% complete\n"
	if got := w.String(); got != want {
		t.Fatalf("source = %q, want %q", got, want)
	}
}

// TestWriterIndentUnderflow makes an unbalanced generator block fail immediately.
func TestWriterIndentUnderflow(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("Dedent did not reject an unbalanced block")
		}
	}()
	var w Writer
	w.Dedent()
}
