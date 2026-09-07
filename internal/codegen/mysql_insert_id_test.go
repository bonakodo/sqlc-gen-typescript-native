package typescript

import (
	"fmt"
	"strings"
	"testing"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/opts"
)

// TestMySQLInsertIDOptions keeps the function type and the OK-packet conversion
// in agreement. mysql2 uses connection options for insertId, so the statement's
// big-number flags alone cannot establish either its type or its precision.
func TestMySQLInsertIDOptions(t *testing.T) {
	for _, test := range []struct {
		name    string
		options opts.MySQL2Options
		result  string
	}{
		{"default", opts.MySQL2Options{}, "number"},
		{"stringsWithoutSupport", opts.MySQL2Options{BigNumberStrings: true}, "number"},
		{"mixed", opts.MySQL2Options{SupportBigNumbers: true}, "number | string"},
		{"strings", opts.MySQL2Options{SupportBigNumbers: true, BigNumberStrings: true}, "string"},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := compatibilityRequest(opts.Options{Driver: "mysql2", MySQL2: test.options})
			query := req.Queries[0]
			query.Name, query.Cmd, query.Columns = "InsertAuthor", ":execlastid", nil
			query.Text = "INSERT INTO authors (id) VALUES (?)"
			source := compatibilitySource(t, req)
			for _, want := range []string{
				"): Promise<" + test.result + "> {",
				fmt.Sprintf("return _sqlcImportMysqlInsertId(result.insertId, %t, %t, undefined);", test.options.SupportBigNumbers, test.options.BigNumberStrings),
			} {
				if !strings.Contains(source, want) {
					t.Errorf("missing %q:\n%s", want, source)
				}
			}
			if strings.Contains(source, "Number(result.insertId)") {
				t.Fatal("unchecked insert-ID conversion can lose integer precision")
			}
		})
	}
}

// TestMySQLInsertIDSignedness applies the caller's ID type to both inserted-ID
// annotations. It must never affect affected-row counts or connection settings.
func TestMySQLInsertIDSignedness(t *testing.T) {
	for _, unsigned := range []bool{false, true} {
		for _, command := range []string{":execlastid", ":execresult"} {
			t.Run(fmt.Sprintf("unsigned=%t/%s", unsigned, command), func(t *testing.T) {
				req := compatibilityRequest(opts.Options{Driver: "mysql2", MySQL2: opts.MySQL2Options{
					InsertIDUnsigned: &unsigned, SupportBigNumbers: true, BigNumberStrings: true,
				}})
				query := req.Queries[0]
				query.Cmd, query.Columns = command, nil
				query.Text = "INSERT INTO authors (id) VALUES (?)"
				source := compatibilitySource(t, req)
				want := fmt.Sprintf("_sqlcImportMysqlInsertId(result.insertId, true, true, %t)", unsigned)
				if command == ":execresult" {
					want = fmt.Sprintf("lastInsertId: _sqlcImportMysqlInsertIdBigInt(result.insertId, %t)", unsigned)
				}
				if !strings.Contains(source, want) {
					t.Errorf("missing %q:\n%s", want, source)
				}
			})
		}
	}
}
