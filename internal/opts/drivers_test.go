package opts

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestDriverMatrix validates every supported runtime against each SQL dialect.
func TestDriverMatrix(t *testing.T) {
	for _, runtime := range []string{"node", "bun", "deno"} {
		for _, driver := range []struct{ name, engine string }{
			{"pg", "postgresql"}, {"postgres", "postgresql"},
			{"mysql2", "mysql"}, {"better-sqlite3", "sqlite"}, {"@bonakodo/sqlite", "sqlite"},
		} {
			t.Run(runtime+"/"+driver.name, func(t *testing.T) {
				input, _ := json.Marshal(Options{Runtime: runtime, Driver: driver.name})
				options, err := Parse(input)
				if driver.name == "@bonakodo/sqlite" && runtime != "deno" {
					if err == nil || !strings.Contains(err.Error(), "requires runtime: deno") {
						t.Fatalf("expected Deno-only error, got %v", err)
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				for _, engine := range []string{"sqlite", "postgresql", "mysql", "invalid"} {
					err := options.ValidateEngine(engine)
					if (err == nil) != (engine == driver.engine) {
						t.Fatalf("ValidateEngine(%q) = %v", engine, err)
					}
				}
			})
		}
	}
}

// TestDriverSpecifiers keeps registry prefixes and pins out of source imports.
func TestDriverSpecifiers(t *testing.T) {
	for _, test := range []struct{ runtime, input, name, specifier string }{
		{"deno", "@bonakodo/sqlite", "@bonakodo/sqlite", "@bonakodo/sqlite"},
		{"deno", "jsr:@bonakodo/sqlite", "@bonakodo/sqlite", "@bonakodo/sqlite"},
		{"deno", "jsr:@bonakodo/sqlite@0.1.0", "@bonakodo/sqlite", "@bonakodo/sqlite"},
		{"deno", "@bonakodo/sqlite@0.1.1", "@bonakodo/sqlite", "@bonakodo/sqlite"},
		{"deno", "pg", "pg", "pg"},
		{"node", "pg", "pg", "pg"},
		{"bun", "postgres", "postgres", "postgres"},
		{"deno", "npm:pg@8.16.3", "pg", "pg"},
		{"deno", "mysql2", "mysql2", "mysql2/promise"},
		{"node", "mysql2/promise", "mysql2", "mysql2/promise"},
		{"deno", "npm:mysql2@3.24.3/promise", "mysql2", "mysql2/promise"},
		{"node", "npm:better-sqlite3", "better-sqlite3", "better-sqlite3"},
	} {
		t.Run(test.runtime+"/"+test.input, func(t *testing.T) {
			o := Options{Runtime: test.runtime, Driver: test.input}
			if err := o.Validate(); err != nil {
				t.Fatal(err)
			}
			if got := o.DriverName(); got != test.name {
				t.Errorf("DriverName() = %q, want %q", got, test.name)
			}
			if got := o.DriverSpecifier(); got != test.specifier {
				t.Errorf("DriverSpecifier() = %q, want %q", got, test.specifier)
			}
		})
	}
}

// TestInvalidDriverSpecifiers rejects imports outside the supported packages.
func TestInvalidDriverSpecifiers(t *testing.T) {
	for _, runtime := range []string{"node", "bun"} {
		for _, driver := range []string{"pg@8.16.3", "npm:mysql2@3/promise", "postgres@3"} {
			if err := (Options{Runtime: runtime, Driver: driver}).Validate(); err == nil || !strings.Contains(err.Error(), "package.json") {
				t.Errorf("%s accepted a versioned package specifier %q: %v", runtime, driver, err)
			}
		}
	}
	for _, driver := range []string{"pg@", "pg@8/evil", "jsr:pg", "npm:@bonakodo/sqlite", "pg\n", "mysql2/other", "jsr:@bonakodo/sqlite@0.1.0/other"} {
		if err := (Options{Runtime: "deno", Driver: driver}).Validate(); err == nil {
			t.Errorf("accepted unsupported driver %q", driver)
		}
	}
	for _, data := range []string{"null", "[]", "false", `"pg"`} {
		if _, err := Parse([]byte(data)); err == nil {
			t.Errorf("accepted non-object configuration %s", data)
		}
	}
}

// TestMySQL2Options keeps the legacy snake_case option names and strict types.
func TestMySQL2Options(t *testing.T) {
	o, err := Parse([]byte(`{"driver":"mysql2","mysql2":{"support_big_numbers":true,"big_number_strings":true}}`))
	if err != nil || !o.MySQL2.SupportBigNumbers || !o.MySQL2.BigNumberStrings {
		t.Fatalf("unexpected MySQL2 settings: %#v, %v", o, err)
	}
	for _, data := range []string{
		`{"driver":"mysql2","mysql2":{"supportBigNumbers":true}}`,
		`{"driver":"mysql2","mysql2":{"support_big_numbers":"true"}}`,
	} {
		if _, err := Parse([]byte(data)); err == nil {
			t.Errorf("accepted invalid mysql2 options %s", data)
		}
	}
}

// TestMySQLInsertIDUnsigned keeps omission distinct from an explicit signed ID
// type; those modes differ when mysql2 reports a negative OK-packet value.
func TestMySQLInsertIDUnsigned(t *testing.T) {
	for _, value := range []string{"null", "false", "true"} {
		o, err := Parse([]byte(`{"driver":"mysql2","mysql2":{"insert_id_unsigned":` + value + `}}`))
		if err != nil {
			t.Fatal(err)
		}
		if value == "null" {
			if o.MySQL2.InsertIDUnsigned != nil {
				t.Fatal("null must leave ID signedness unknown")
			}
		} else if o.MySQL2.InsertIDUnsigned == nil || *o.MySQL2.InsertIDUnsigned != (value == "true") {
			t.Fatalf("lost explicit ID signedness %s", value)
		}
	}
	if _, err := Parse([]byte(`{"driver":"mysql2","mysql2":{"insert_id_unsigned":"true"}}`)); err == nil {
		t.Fatal("accepted a string as inserted-ID signedness")
	}
}

// TestSQLiteTypeModes makes native value conversion an explicit migration choice.
func TestSQLiteTypeModes(t *testing.T) {
	for _, mode := range []string{"", "driver", "native"} {
		input, _ := json.Marshal(Options{Runtime: "deno", Driver: "@bonakodo/sqlite", SQLiteTypeMode: mode})
		o, err := Parse(input)
		if err != nil {
			t.Fatal(err)
		}
		if mode == "" {
			mode = "driver"
		}
		if o.SQLiteTypeMode != mode {
			t.Fatalf("mode = %q, want %q", o.SQLiteTypeMode, mode)
		}
	}
	if _, err := Parse([]byte(`{"driver":"better-sqlite3","sqlite_type_mode":"auto"}`)); err == nil {
		t.Fatal("accepted an unknown SQLite type mode")
	}
}
