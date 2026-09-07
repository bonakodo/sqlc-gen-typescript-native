package opts

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

// TestParseDefaults preserves the older plugin's Node default and required driver.
func TestParseDefaults(t *testing.T) {
	for _, data := range []string{`{"driver":"pg"}`, `{"runtime":"","driver":"pg"}`} {
		options, err := Parse([]byte(data))
		if err != nil {
			t.Fatal(err)
		}
		if options.Runtime != "node" || options.Driver != "pg" || options.SQLiteTypeMode != "driver" || options.EmitSQLAsConst == nil || !*options.EmitSQLAsConst {
			t.Fatalf("unexpected defaults: %#v", options)
		}
	}
	for _, data := range []string{"", `{}`, `{"driver":""}`} {
		if _, err := Parse([]byte(data)); err == nil || !strings.Contains(err.Error(), "driver is required") {
			t.Fatalf("missing driver error = %v", err)
		}
	}
	options, err := Parse([]byte(`{"driver":"pg","emit_sql_as_const":false,"types_only":true}`))
	if err != nil || *options.EmitSQLAsConst || !options.TypesOnly {
		t.Fatalf("explicit settings lost: %#v, %v", options, err)
	}
}

// TestParseInvalidOptions checks that misspelled settings and incomplete
// overrides fail before the generator writes any modules.
func TestParseInvalidOptions(t *testing.T) {
	for _, test := range []struct {
		name string
		data string
		want string
	}{
		{"runtime", `{"driver":"pg","runtime":"browser"}`, "unsupported runtime"},
		{"driver", `{"driver":"sqlite3"}`, "unsupported driver"},
		{"unknown", `{"typesOnly":true}`, "unknown field"},
		{"trailing", `{} {}`, "one JSON object"},
		{"missing matcher", `{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"ts_type":"string"}]}`, "exactly one"},
		{"two matchers", `{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"column":"a.id","db_type":"integer","ts_type":"string"}]}`, "exactly one"},
		{"missing type", `{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"db_type":"integer"}]}`, "requires ts_type"},
		{"short column", `{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"column":"id","ts_type":"ID"}]}`, "two to four"},
		{"long column", `{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"column":"a.b.c.d.e","ts_type":"ID"}]}`, "two to four"},
		{"empty column part", `{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"column":"users..id","ts_type":"ID"}]}`, "empty name"},
		{"invalid pattern escape", `{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"column":"users.i\\d","ts_type":"ID"}]}`, "column pattern"},
		{"incomplete pattern escape", `{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"column":"users.id\\","ts_type":"ID"}]}`, "column pattern"},
		{"missing import name", `{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"column":"a.id","ts_type":"ID","import":{"path":"./id.ts"}}]}`, "requires path and name"},
		{"missing codec path", `{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"column":"a.id","ts_type":"ID","codec":{"name":"idCodec"}}]}`, "requires path and name"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := Parse([]byte(test.data))
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("Parse() error = %v, want %q", err, test.want)
			}
		})
	}
}

// TestParseOverrides preserves type and codec imports as separate named exports.
func TestParseOverrides(t *testing.T) {
	options, err := Parse([]byte(`{"runtime":"deno","driver":"jsr:@bonakodo/sqlite@0.1.0","overrides":[{"column":"users.id","ts_type":"UserID","import":{"path":"./types.ts","name":"UserID"},"codec":{"path":"./codecs.ts","name":"userID"}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(options.Overrides) != 1 || options.Overrides[0].Import.Name != "UserID" || options.Overrides[0].Codec.Name != "userID" {
		t.Fatalf("unexpected overrides: %#v", options.Overrides)
	}
}

// FuzzParse checks that arbitrary JSON cannot panic during option validation.
// Accepted options must keep their defaults and canonical JSON after a second
// parse, including overrides whose wildcard syntax previously reached a panic.
func FuzzParse(f *testing.F) {
	for _, seed := range []string{
		"", "null", "{}", "[]", "{",
		`{"runtime":"deno","driver":"@bonakodo/sqlite","types_only":true,"emit_sql_as_const":false}`,
		`{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[]}`,
		`{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"column":"users.*","ts_type":"UserID","import":{"path":"../types.ts","name":"UserID"}}]}`,
		`{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"db_type":"json","nullable":true,"ts_type":"Payload","codec":{"path":"./codec.ts","name":"payloadCodec"}}]}`,
		`{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"column":"users.id\\","ts_type":"ID"}]}`,
		`{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"column":"users.i\\d","ts_type":"ID"}]}`,
		`{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"column":"users..id","ts_type":"ID"}]}`,
		`{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"column":"users.id","db_type":"integer","ts_type":"ID"}]}`,
		`{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"column":"users.id","ts_type":"ID","import":{"path":"./types.ts"}}]}`,
		`{"driver":"@bonakodo/sqlite","runtime":"deno","overrides":[{"column":"users.id","ts_type":"ID","codec":{"name":"idCodec"}}]}`,
	} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, input []byte) {
		options, err := Parse(input)
		if err != nil {
			return
		}
		if err := options.Validate(); err != nil {
			t.Fatalf("accepted options failed validation: %v", err)
		}
		encoded, err := json.Marshal(options)
		if err != nil {
			t.Fatal(err)
		}
		again, err := Parse(encoded)
		if err != nil {
			t.Fatalf("accepted options failed their JSON round trip: %v", err)
		}
		if options.Runtime != again.Runtime || options.Driver != again.Driver || options.EmitSQLAsConst == nil || again.EmitSQLAsConst == nil || *options.EmitSQLAsConst != *again.EmitSQLAsConst {
			t.Fatal("option defaults changed during their JSON round trip")
		}
		reencoded, err := json.Marshal(again)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(encoded, reencoded) {
			t.Fatalf("option JSON changed during its round trip: %s -> %s", encoded, reencoded)
		}
	})
}
