package typescript

import (
	"reflect"
	"strings"
	"testing"
)

// bindingNumbers exposes source-order identities without including SQL text.
func bindingNumbers(plan bindingPlan) []int {
	var numbers []int
	for _, part := range plan.parts {
		if part.number != 0 {
			numbers = append(numbers, part.number)
		}
	}
	return numbers
}

func TestPlanPostgreSQLBindings(t *testing.T) {
	params := map[int]*queryParameter{
		1: testParameter(1, "first", false),
		3: testParameter(3, "third", false),
	}
	// Deliberately mix bind order, repeats, JSON operators, casts, string
	// escapes, dollar quotes, names containing dollars, and nested comments.
	sql := `SELECT $3::numeric, $1, $3, body ? 'key', body ?| ARRAY['a'], body ?& ARRAY['b'], amount$usd, amount$1,
E'escaped\' $99', e'escaped\\ $98', '$97', "$96", $$ $95 $$, $body$ $94 $body$,
/* outer $93 /* inner $92 */ still outer $91 */ $1 -- $90
FROM things`
	want := strings.Replace(sql, "SELECT $3::numeric, $1, $3", "SELECT $1::numeric, $2, $1", 1)
	want = strings.Replace(want, "*/ $1 --", "*/ $2 --", 1)
	plan, err := planDialectBindings(sql, params, "postgresql")
	if err != nil {
		t.Fatal(err)
	}
	if plan.text != want {
		t.Fatalf("PostgreSQL syntax changed:\ngot:  %s\nwant: %s", plan.text, want)
	}
	if got, want := bindingNumbers(plan), []int{3, 1, 3, 1}; !reflect.DeepEqual(got, want) {
		t.Fatalf("binding order = %v, want %v", got, want)
	}
}

func TestPostgreSQLSlicesUseOneArrayBind(t *testing.T) {
	parameter := testParameter(1, "ids", true)
	plan, err := planDialectBindings("SELECT id FROM authors WHERE id = ANY($1) OR parent_id = ANY($1)", map[int]*queryParameter{1: parameter}, "postgresql")
	if err != nil {
		t.Fatal(err)
	}
	if plan.dynamic || plan.text != "SELECT id FROM authors WHERE id = ANY($1) OR parent_id = ANY($1)" {
		t.Fatalf("PostgreSQL array was expanded as SQL: %#v", plan)
	}
	if got, want := bindingNumbers(plan), []int{1, 1}; !reflect.DeepEqual(got, want) {
		t.Fatalf("binding order = %v, want %v", got, want)
	}
}

func TestPostgreSQLArraySubscriptsKeepBindings(t *testing.T) {
	params := map[int]*queryParameter{1: testParameter(1, "index", false)}
	plan, err := planDialectBindings("SELECT items[$1], '$tag$ no quote' FROM arrays WHERE items[$1] IS NOT NULL", params, "postgresql")
	if err != nil {
		t.Fatal(err)
	}
	if plan.text != "SELECT items[$1], '$tag$ no quote' FROM arrays WHERE items[$1] IS NOT NULL" {
		t.Fatalf("PostgreSQL array index lost its bind: %s", plan.text)
	}
}

// PostgreSQL infers the type of every use of one parameter together. Assigning
// a new bind number to the IS NULL occurrence would leave its type unknown.
func TestPostgreSQLRepeatedParameterKeepsTypeInference(t *testing.T) {
	sql := "SELECT id FROM authors WHERE id = $1 OR $1 IS NULL"
	plan, err := planDialectBindings(sql, map[int]*queryParameter{1: testParameter(1, "id", false)}, "postgresql")
	if err != nil {
		t.Fatal(err)
	}
	if plan.text != sql {
		t.Fatalf("repeated PostgreSQL parameter lost its type identity: %s", plan.text)
	}
}

func TestPlanMySQLBindings(t *testing.T) {
	params := map[int]*queryParameter{
		1: testParameter(1, "first", false),
		2: testParameter(2, "second", false),
		3: testParameter(3, "third", false),
		4: testParameter(4, "fourth", false),
	}
	sql := "SELECT ?, '?', 'escaped\\' ?', \"escaped\\\" ?\", `?`, `back``tick?`, @variable, @@mode, $name, :literal,\n" +
		"1--? + 2, ? -- ? is a comment\n" +
		"# another ? comment\r" +
		"/* ? block */ ?"
	plan, err := planDialectBindings(sql, params, "mysql")
	if err != nil {
		t.Fatal(err)
	}
	if plan.text != sql {
		t.Fatalf("MySQL SQL text changed: %s", plan.text)
	}
	if got, want := bindingNumbers(plan), []int{1, 2, 3, 4}; !reflect.DeepEqual(got, want) {
		t.Fatalf("binding order = %v, want %v", got, want)
	}
}

func TestMySQLSliceOccurrencesHaveDistinctOrdinals(t *testing.T) {
	params := map[int]*queryParameter{
		1: testParameter(1, "ids", true),
		2: testParameter(2, "ids", true),
		3: testParameter(3, "active", false),
		4: testParameter(4, "names", true),
	}
	sql := "SELECT id FROM authors WHERE id IN (/*SLICE:ids*/?) OR parent_id IN (/*SLICE:ids*/?) AND active = ? AND name IN (/*SLICE:names*/?)"
	plan, err := planDialectBindings(sql, params, "mysql")
	if err != nil {
		t.Fatal(err)
	}
	if !plan.dynamic || plan.text != sql {
		t.Fatalf("MySQL slice markers changed: %#v", plan)
	}
	if got, want := bindingNumbers(plan), []int{1, 2, 3, 4}; !reflect.DeepEqual(got, want) {
		t.Fatalf("binding order = %v, want %v", got, want)
	}
}

func TestDialectRealBindings(t *testing.T) {
	parameter := testParameter(1, "amount", false)
	parameter.field.value.kind = "number"
	for _, tt := range []struct{ engine, sql, want string }{
		{"sqlite", "SELECT ?1", "SELECT CAST(? AS REAL)"},
		{"mysql", "SELECT ?", "SELECT ?"},
		{"postgresql", "SELECT $1", "SELECT $1"},
	} {
		t.Run(tt.engine, func(t *testing.T) {
			plan, err := planDialectBindings(tt.sql, map[int]*queryParameter{1: parameter}, tt.engine)
			if err != nil {
				t.Fatal(err)
			}
			if plan.text != tt.want {
				t.Fatalf("SQL = %q, want %q", plan.text, tt.want)
			}
		})
	}
}

func TestDialectBindingErrors(t *testing.T) {
	for _, tt := range []struct{ engine, sql string }{
		{"postgresql", "SELECT $0"},
		{"postgresql", "SELECT $99999999999999999999999999"},
		{"postgresql", "SELECT $2"},
		{"postgresql", "SELECT $tag$ unterminated"},
		{"postgresql", "SELECT $$ unterminated"},
		{"postgresql", "SELECT E'escaped\\'"},
		{"postgresql", "SELECT /* outer /* nested */"},
		{"mysql", "SELECT 'escaped\\'"},
		{"mysql", "SELECT /* unfinished"},
		{"mysql", "SELECT /*SLICE:wrong*/?"},
		{"mysql", "SELECT ?, ?"},
		{"unknown", "SELECT 1"},
	} {
		t.Run(tt.engine+"/"+tt.sql, func(t *testing.T) {
			if _, err := planDialectBindings(tt.sql, map[int]*queryParameter{1: testParameter(1, "value", false)}, tt.engine); err == nil {
				t.Fatal("accepted invalid binding SQL")
			}
		})
	}
}

// FuzzPlanDialectBindings checks both panic safety and the scanner's lossless
// contract: every output part is either untouched source or one known binding.
func FuzzPlanDialectBindings(f *testing.F) {
	for _, sql := range []string{
		"SELECT $1::numeric, $1", "SELECT body ? 'key'", "SELECT $$ $1 $$, $1",
		"SELECT E'escaped\\' $2', $1", "/* outer /* inner */ $2 */ $1",
		"SELECT ?, 'escaped\\' ?', `?` # ?\n", "/*SLICE:x*/?", "--?\r?",
	} {
		f.Add(sql)
	}
	f.Fuzz(func(t *testing.T, sql string) {
		params := map[int]*queryParameter{1: testParameter(1, "x", false), 2: testParameter(2, "y", true)}
		for _, engine := range []string{"postgresql", "mysql", "sqlite"} {
			plan, err := planDialectBindings(sql, params, engine)
			if err != nil {
				continue
			}
			var rebuilt strings.Builder
			ordinal := 0
			pgNumbers := map[int]int{}
			for _, part := range plan.parts {
				if part.number == 0 {
					rebuilt.WriteString(part.text)
					continue
				}
				parameter := params[part.number]
				if parameter == nil {
					t.Fatalf("unknown parameter %d", part.number)
				}
				if engine != "postgresql" && parameter.field.value.slice {
					rebuilt.WriteString("/*SLICE:" + parameter.field.column.Name + "*/")
				}
				ordinal++
				placeholderNumber := ordinal
				if engine == "postgresql" {
					placeholderNumber = pgNumbers[part.number]
					if placeholderNumber == 0 {
						placeholderNumber = len(pgNumbers) + 1
						pgNumbers[part.number] = placeholderNumber
					}
				}
				rebuilt.WriteString(dialectBindPlaceholder(parameter.field.value, engine, placeholderNumber))
			}
			if rebuilt.String() != plan.text {
				t.Fatalf("binding parts and SQL disagree for %s", engine)
			}
		}
	})
}
