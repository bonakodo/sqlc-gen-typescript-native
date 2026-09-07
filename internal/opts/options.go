// Package opts defines the native TypeScript generator's configuration contract.
// It is separate from code generation so the configuration parser can validate
// options without importing the generator or creating an import cycle.
package opts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/bonakodo/sqlc-gen-typescript-native/internal/pattern"
)

// Options configures TypeScript generation for a runtime and database driver.
// An empty Runtime selects node; Driver is required. Out is checked
// by sqlc's configuration parser, rather than by the in-memory generator.
type Options struct {
	// Out is the directory in which sqlc writes generated modules.
	Out string `json:"out,omitempty" yaml:"out"`
	// Runtime selects node, bun, or deno. The default is node.
	Runtime string `json:"runtime,omitempty" yaml:"runtime"`
	// Driver is required and selects pg, postgres, mysql2, better-sqlite3, or @bonakodo/sqlite.
	// Package version pins are preserved in generated import specifiers.
	Driver string `json:"driver,omitempty" yaml:"driver"`
	// SQLiteTypeMode selects driver (default) for the older plugin's value rules or
	// native for checked bigint, boolean, Date, and Uint8Array conversions.
	SQLiteTypeMode string `json:"sqlite_type_mode,omitempty" yaml:"sqlite_type_mode"`
	// MySQL2 describes the mysql2 connection settings that affect result types.
	// Generated queries apply these settings to each mysql2 query.
	MySQL2 MySQL2Options `json:"mysql2,omitempty" yaml:"mysql2"`
	// TypesOnly emits models and query types without runtime dependencies.
	TypesOnly bool `json:"types_only,omitempty" yaml:"types_only"`
	// EmitNullAsUndefined uses undefined for absent rows and nullable values.
	EmitNullAsUndefined bool `json:"emit_null_as_undefined,omitempty" yaml:"emit_null_as_undefined"`
	// EmitSQLAsConst controls SQL constant exports; nil means true.
	EmitSQLAsConst *bool `json:"emit_sql_as_const,omitempty" yaml:"emit_sql_as_const"`
	// Overrides replaces selected column or database types and their codecs.
	Overrides []Override `json:"overrides,omitempty" yaml:"overrides"`
}

// MySQL2Options controls BIGINT row values and inserted-ID decoding. Generated
// queries pass row settings to mysql2 without changing the caller's connection.
type MySQL2Options struct {
	// SupportBigNumbers enables mysql2's lossless BIGINT parsing mode.
	SupportBigNumbers bool `json:"support_big_numbers,omitempty" yaml:"support_big_numbers"`
	// BigNumberStrings returns all BIGINT values as strings when
	// SupportBigNumbers is true. Otherwise values can be numbers or strings.
	BigNumberStrings bool `json:"big_number_strings,omitempty" yaml:"big_number_strings"`
	// InsertIDUnsigned specifies the SQL type of inserted IDs: true for
	// unsigned, false for signed. A nil value rejects negative OK-packet IDs
	// because mysql2 uses the same representation for signed negative IDs
	// and unsigned IDs above 2^63 - 1. This option affects inserted IDs only.
	InsertIDUnsigned *bool `json:"insert_id_unsigned,omitempty" yaml:"insert_id_unsigned"`
}

// Override replaces a column's TypeScript type. Exactly one of Column and DBType
// must be set. Column matches take precedence over database-type matches.
type Override struct {
	// Column matches table.column, schema.table.column, or their wildcard forms.
	Column string `json:"column,omitempty" yaml:"column"`
	// DBType selects a declared database type when Column is absent.
	DBType string `json:"db_type,omitempty" yaml:"db_type"`
	// Nullable restricts database-type matches to nullable or non-null values.
	Nullable bool `json:"nullable,omitempty" yaml:"nullable"`
	// TSType is the replacement TypeScript type, before array and null wrapping.
	TSType string `json:"ts_type" yaml:"ts_type"`
	// Import supplies a named type-only import used by TSType.
	Import *Import `json:"import,omitempty" yaml:"import"`
	// Codec supplies a named value import with encode and decode methods.
	Codec *Import `json:"codec,omitempty" yaml:"codec"`
}

// Import identifies a named export from a TypeScript module. Type imports are
// erased at runtime; codec imports are omitted when TypesOnly is enabled.
type Import struct {
	// Path is the module specifier, resolved relative to the configured output
	// directory. The generator rebases relative paths for nested query modules.
	Path string `json:"path" yaml:"path"`
	// Name is the named export used by the generated type or conversion code.
	Name string `json:"name" yaml:"name"`
}

// Parse decodes JSON options, applies defaults, and rejects unknown fields or
// invalid runtime, driver, and override settings. Driver must be supplied.
func Parse(data []byte) (Options, error) {
	options := Options{Runtime: "node", SQLiteTypeMode: "driver"}
	if len(bytes.TrimSpace(data)) != 0 {
		if bytes.TrimSpace(data)[0] != '{' {
			return Options{}, fmt.Errorf("typescript options: expected one JSON object")
		}
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&options); err != nil {
			return Options{}, fmt.Errorf("typescript options: %w", err)
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			return Options{}, fmt.Errorf("typescript options: expected one JSON object")
		}
	}
	if options.Runtime == "" {
		options.Runtime = "node"
	}
	if options.SQLiteTypeMode == "" {
		options.SQLiteTypeMode = "driver"
	}
	if options.EmitSQLAsConst == nil {
		emit := true
		options.EmitSQLAsConst = &emit
	}
	if err := options.Validate(); err != nil {
		return Options{}, err
	}
	return options, nil
}

// Validate checks the supported runtime and the structure of each override.
// A blank runtime means node. Driver is required. Type syntax and codec
// compatibility depend on resolved columns and are checked during generation.
func (o Options) Validate() error {
	if o.Driver == "" {
		return fmt.Errorf("typescript: driver is required; use pg, postgres, mysql2, better-sqlite3, or @bonakodo/sqlite")
	}
	if o.SQLiteTypeMode != "" && o.SQLiteTypeMode != "driver" && o.SQLiteTypeMode != "native" {
		return fmt.Errorf("typescript: unsupported sqlite_type_mode %q; use driver or native", o.SQLiteTypeMode)
	}
	if o.Runtime != "" && o.Runtime != "node" && o.Runtime != "bun" && o.Runtime != "deno" {
		return fmt.Errorf("typescript: unsupported runtime %q; use node, bun, or deno", o.Runtime)
	}
	if !driverPattern.MatchString(o.Driver) && o.Driver != "" {
		return fmt.Errorf("typescript: unsupported driver %q", o.Driver)
	}
	if (o.Runtime == "" || o.Runtime == "node" || o.Runtime == "bun") && strings.Contains(strings.TrimPrefix(o.Driver, "npm:"), "@") && o.DriverName() != "@bonakodo/sqlite" {
		return fmt.Errorf("typescript: driver version selectors require runtime: deno; pin the package in package.json for %s", o.Runtime)
	}
	if o.DriverName() == "@bonakodo/sqlite" && o.Runtime != "deno" {
		return fmt.Errorf("typescript: @bonakodo/sqlite requires runtime: deno")
	}
	if strings.HasPrefix(o.Driver, "jsr:") && o.DriverName() != "@bonakodo/sqlite" || strings.HasPrefix(o.Driver, "npm:") && o.DriverName() == "@bonakodo/sqlite" {
		return fmt.Errorf("typescript: unsupported driver module specifier %q", o.Driver)
	}
	for i, override := range o.Overrides {
		if (override.Column == "") == (override.DBType == "") {
			return fmt.Errorf("typescript: override %d must specify exactly one of column or db_type", i+1)
		}
		if strings.TrimSpace(override.TSType) == "" {
			return fmt.Errorf("typescript: override %d requires ts_type", i+1)
		}
		if override.Column != "" {
			parts := strings.Split(override.Column, ".")
			if len(parts) < 2 || len(parts) > 4 {
				return fmt.Errorf("typescript: override %d column must have two to four dot-separated parts", i+1)
			}
			for _, part := range parts {
				if part == "" {
					return fmt.Errorf("typescript: override %d column contains an empty name", i+1)
				}
				if _, err := pattern.MatchCompile(part); err != nil {
					return fmt.Errorf("typescript: override %d column pattern: %w", i+1, err)
				}
			}
		}
		for _, entry := range []struct {
			name string
			item *Import
		}{{"import", override.Import}, {"codec", override.Codec}} {
			if entry.item != nil && (strings.TrimSpace(entry.item.Path) == "" || strings.TrimSpace(entry.item.Name) == "") {
				return fmt.Errorf("typescript: override %d %s requires path and name", i+1, entry.name)
			}
		}
	}
	return nil
}

// driverPattern permits package names and version selectors, but not unrelated
// package subpaths or whitespace. Quotes and slashes in version text cannot
// become part of an import declaration.
var driverPattern = regexp.MustCompile(`^(?:(?:npm:)?(?:pg|postgres|better-sqlite3)(?:@[a-zA-Z0-9.*^~+_-]+)?|(?:npm:)?mysql2(?:@[a-zA-Z0-9.*^~+_-]+)?(?:/promise)?|(?:jsr:)?@bonakodo/sqlite(?:@[a-zA-Z0-9.*^~+_-]+)?)$`)

// DriverName returns a stable driver identity without its registry prefix,
// version selector, or mysql2 promise subpath. A missing driver stays empty.
func (o Options) DriverName() string {
	name := strings.TrimPrefix(strings.TrimPrefix(o.Driver, "npm:"), "jsr:")
	name = strings.TrimSuffix(name, "/promise")

	if index := strings.LastIndexByte(name, '@'); index > 0 {
		name = name[:index]
	}
	return name
}

// DriverSpecifier returns a bare package import. Deno import maps own registry
// prefixes and version selectors; mysql2 needs its promise subpath.
func (o Options) DriverSpecifier() string {
	name := o.DriverName()
	if name == "mysql2" {
		name += "/promise"
	}
	return name
}

// ValidateEngine rejects a driver that cannot execute the compiler's SQL dialect.
// It also validates options when called without Parse by library users.
func (o Options) ValidateEngine(engine string) error {
	if err := o.Validate(); err != nil {
		return err
	}
	var expected string
	switch o.DriverName() {
	case "pg", "postgres":
		expected = "postgresql"
	case "mysql2":
		expected = "mysql"
	case "@bonakodo/sqlite", "better-sqlite3":
		expected = "sqlite"
	default:
		return fmt.Errorf("typescript: unsupported driver %q", o.Driver)
	}
	if engine != expected {
		return fmt.Errorf("typescript: %s requires engine: %s (received %q)", o.DriverName(), expected, engine)
	}
	return nil
}
