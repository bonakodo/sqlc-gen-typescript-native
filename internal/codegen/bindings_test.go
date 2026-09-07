package typescript

import (
	"context"
	"strings"
	"testing"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/opts"
	"github.com/sqlc-dev/plugin-sdk-go/plugin"
	"google.golang.org/protobuf/proto"
)

// testParameter builds immutable argument metadata for binding-plan tests.
func testParameter(number int, name string, slice bool) *queryParameter {
	return &queryParameter{number: number, field: field{column: &plugin.Column{Name: name}, value: valueType{slice: slice}}}
}

// TestPlanBindings checks SQLite numbering independently of property spelling.
func TestPlanBindings(t *testing.T) {
	params := map[int]*queryParameter{1: testParameter(1, "first", false), 3: testParameter(3, "third", false)}
	plan, err := planBindings("SELECT ?3, ?1, ?3, '?99', \"@field\", `?x`, [@y] -- ?2\n/* ?4 */", params)
	if err != nil {
		t.Fatal(err)
	}
	want := "SELECT ?, ?, ?, '?99', \"@field\", `?x`, [@y] -- ?2\n/* ?4 */"
	if plan.text != want {
		t.Fatalf("rewrote SQL text incorrectly:\n%s", plan.text)
	}
	var numbers []int
	for _, part := range plan.parts {
		if part.number != 0 {
			numbers = append(numbers, part.number)
		}
	}
	if len(numbers) != 3 || numbers[0] != 3 || numbers[1] != 1 || numbers[2] != 3 {
		t.Fatalf("lost parameter identity: %v", numbers)
	}
}

// TestPlanBindingsNamed checks repeated names and anonymous parameters together.
func TestPlanBindingsNamed(t *testing.T) {
	params := map[int]*queryParameter{1: testParameter(1, "name", false), 2: testParameter(2, "extra", false)}
	plan, err := planBindings("SELECT @name, ?, @name", params)
	if err != nil || plan.text != "SELECT ?, ?, ?" {
		t.Fatalf("named bindings: %#v, %v", plan, err)
	}
}

// TestPlanBindingsRealCast checks the driver overflow workaround without
// changing custom codec bindings, quoted SQL, or placeholder identity.
func TestPlanBindingsRealCast(t *testing.T) {
	real := testParameter(1, "amount", false)
	real.field.value.kind = "number"
	custom := testParameter(2, "custom", false)
	custom.field.value.kind = "number"
	custom.field.value.codec = &opts.Import{Path: "./codec.ts", Name: "codec"}
	plan, err := planBindings("SELECT ?1, '?1', ?2, ?1", map[int]*queryParameter{1: real, 2: custom})
	if err != nil {
		t.Fatal(err)
	}
	if want := "SELECT CAST(? AS REAL), '?1', ?, CAST(? AS REAL)"; plan.text != want {
		t.Fatalf("REAL bindings = %q, want %q", plan.text, want)
	}
}

// TestPlanBindingsRepeatedSlice matches the compiler's actual repeated-slice SQL.
// The compiler numbers unique named arguments, so two ids markers share param 1.
func TestPlanBindingsRepeatedSlice(t *testing.T) {
	params := map[int]*queryParameter{
		1: testParameter(1, "ids", true),
		2: testParameter(2, "excluded", false),
		3: testParameter(3, "names", true),
		4: testParameter(4, "extra", false),
	}
	sql := "SELECT id FROM authors WHERE (id IN (/*SLICE:ids*/?) OR parent_id IN (/*SLICE:ids*/?)) AND display_name <> ?2 AND display_name IN (/*SLICE:names*/?) AND id <> ?4"
	plan, err := planBindings(sql, params)
	if err != nil {
		t.Fatal(err)
	}
	var got []int
	for _, part := range plan.parts {
		if part.number != 0 {
			got = append(got, part.number)
		}
	}
	want := []int{1, 1, 2, 3, 4}
	if len(got) != len(want) {
		t.Fatalf("bind order = %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("bind order = %v, want %v", got, want)
		}
	}
	if !plan.dynamic {
		t.Fatal("repeated slices lost dynamic SQL assembly")
	}
}

// TestPlanBindingsDollarIdentifiers keeps dollars inside SQL names intact.
func TestPlanBindingsDollarIdentifiers(t *testing.T) {
	params := map[int]*queryParameter{1: testParameter(1, "a$b", false)}
	sql := "SELECT amount$usd, cash.\"$balance\" FROM cash WHERE amount$usd = $a$b OR amount$usd = $a$b"
	plan, err := planBindings(sql, params)
	if err != nil {
		t.Fatal(err)
	}
	want := "SELECT amount$usd, cash.\"$balance\" FROM cash WHERE amount$usd = ? OR amount$usd = ?"
	if plan.text != want {
		t.Fatalf("dollar names changed meaning: %s", plan.text)
	}
	if _, err := planBindings("SELECT amount$usd FROM cash", nil); err != nil {
		t.Fatalf("unquoted dollar identifier became a parameter: %v", err)
	}
}

// TestPlanBindingsSlices distinguishes compiler markers from text in literals.
func TestPlanBindingsSlices(t *testing.T) {
	params := map[int]*queryParameter{1: testParameter(1, "ids", true), 2: testParameter(2, "active", false)}
	plan, err := planBindings("SELECT '/*SLICE:ids*/?' WHERE id IN (/*SLICE:ids*/?) AND active = ?", params)
	if err != nil || !plan.dynamic {
		t.Fatalf("slice bindings: %#v, %v", plan, err)
	}
	if !strings.Contains(plan.text, "'/*SLICE:ids*/?'") {
		t.Fatal("slice-looking SQL literal was changed")
	}
	for _, sql := range []string{"SELECT ?0", "SELECT ?99999999999999999999999999", "SELECT ?3", "SELECT 'unterminated", "SELECT /* unfinished", "SELECT /*SLICE:wrong*/?"} {
		if _, err := planBindings(sql, params); err == nil {
			t.Errorf("accepted invalid binding SQL %q", sql)
		}
	}
}

// TestGeneratePreservesInput verifies shared compiler metadata is never renamed.
func TestGeneratePreservesInput(t *testing.T) {
	req := &plugin.GenerateRequest{
		PluginOptions: []byte(`{"runtime":"deno","driver":"@bonakodo/sqlite","sqlite_type_mode":"native"}`),
		Settings:      &plugin.Settings{Engine: "sqlite"}, Catalog: &plugin.Catalog{},
		Queries: []*plugin.Query{{Name: "GetName", Filename: "query.sql", Cmd: ":one", Text: "SELECT 1, 2, 3", Columns: []*plugin.Column{
			{Name: "name", Type: &plugin.Identifier{Name: "integer"}, NotNull: true},
			{Name: "name", Type: &plugin.Identifier{Name: "integer"}, NotNull: true},
			{Name: "name", Type: &plugin.Identifier{Name: "integer"}, NotNull: true},
		}}},
	}
	before := proto.Clone(req)
	first, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(req, before) || !proto.Equal(first, second) {
		t.Fatal("generation mutated its input or changed between calls")
	}
	for _, file := range first.Files {
		if file.Name == "query_sql.ts" && !strings.Contains(string(file.Contents), "name_3:") {
			t.Fatal("three duplicate columns did not receive distinct stable names")
		}
	}
}

// FuzzPlanBindings ensures malformed SQL input cannot panic the binding scanner.
func FuzzPlanBindings(f *testing.F) {
	for _, seed := range []string{"SELECT ?1", "'/*SLICE:x*/?'", "/*SLICE:x*/?", "SELECT [x]]", "-- comment\n?"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, sql string) {
		params := map[int]*queryParameter{1: testParameter(1, "x", true)}
		_, _ = planBindings(sql, params)
	})
}
