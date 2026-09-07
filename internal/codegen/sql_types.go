package typescript

import (
	"strings"

	"github.com/bonakodo/sqlc-gen-typescript-native/protocol"
)

// sqlType selects the values returned by the chosen driver's default parsers.
// PostgreSQL scalar int8 and numeric stay strings: converting either to a
// JavaScript number would discard precision. SQLite uses the older plugin's
// driver-specific types unless native conversion mode is explicitly selected.
func (m *module) sqlType(column *protocol.Column) (string, string) {
	if enum := m.gen.enumForColumn(column); enum != nil {
		return "string", enum.name
	}
	switch m.gen.request.Settings.Engine {
	case "postgresql":
		return m.postgresType(column)
	case "mysql":
		return m.mysqlType(column)
	default:
		if m.gen.options.SQLiteTypeMode == "native" {
			return sqliteKind(column)
		}
		return m.sqliteDriverType(column)
	}
}

// databaseTypeName accepts both sqlc's separate schema field and older requests
// with a pg_catalog. prefix in the name. Size annotations do not change a type's
// representation; remove them without dropping words such as "unsigned".
func databaseTypeName(column *protocol.Column) string {
	name := strings.ToLower(column.GetType().GetName())
	name = strings.TrimPrefix(name, "pg_catalog.")
	if index := strings.IndexByte(name, '('); index >= 0 {
		name = name[:index]
	}
	return strings.Join(strings.Fields(name), " ")
}

// postgresType reflects pg and postgres.js without installing custom parsers.
// Both expose large scalar integers and decimals as text. Their geometry and interval parsers differ, so those branches
// must follow the driver instead of the SQL dialect alone.
func (m *module) postgresType(column *protocol.Column) (string, string) {
	pg := m.gen.options.DriverName() == "pg"
	switch databaseTypeName(column) {
	case "smallint", "integer", "int", "int2", "int4", "smallserial", "serial", "serial2", "serial4", "float4", "float8", "real", "double precision", "oid":
		return "number", "number"
	case "numeric", "decimal":
		if pg && (column.IsArray || column.ArrayDims > 0 || column.IsSqlcSlice) {
			// pg-types registers parseFloat for numeric[] but leaves scalar
			// numeric as text. Preserve the real array result contract; the
			// connection needs a custom parser and codec for exact decimals.
			return "number", "number"
		}
		return "string", "string"
	case "bool", "boolean":
		return "boolean", "boolean"
	case "bytea":
		return "buffer", "Buffer"
	case "date", "timestamp", "timestamp without time zone", "timestamptz", "timestamp with time zone":
		return "date", "Date"
	case "json", "jsonb":
		return "json", "JsonValue"
	case "box":
		return "box", "string"
	case "point":
		if pg {
			return "point", "{ x: number; y: number }"
		}
	case "circle":
		if pg {
			return "circle", "{ x: number; y: number; radius: number }"
		}
	case "interval":
		if pg {
			return "interval", "IPostgresInterval"
		}
	case "any", "unknown":
		return "unknown", "unknown"
	}
	// PostgreSQL's fallback text parser also covers enums, composites, network
	// addresses, time/timetz, numeric, money, int8, ranges, and extension types.
	return "string", "string"
}

// mysqlType follows mysql2/promise's default parsers. The two BIGINT options
// apply to each generated query and determine its result contract.
// In particular, DECIMAL stays text regardless of support_big_numbers.
func (m *module) mysqlType(column *protocol.Column) (string, string) {
	switch databaseTypeName(column) {
	case "bigint", "bigint unsigned", "bigint signed":
		if m.gen.options.MySQL2.SupportBigNumbers {
			if m.gen.options.MySQL2.BigNumberStrings {
				return "string", "string"
			}
			return "number-or-string", "number | string"
		}
		return "number", "number"
	case "tinyint", "smallint", "mediumint", "int", "integer", "year", "float", "double", "double precision", "real", "bool", "boolean":
		return "number", "number"
	case "binary", "varbinary", "bit", "blob", "tinyblob", "mediumblob", "longblob":
		return "buffer", "Buffer"
	case "date", "datetime", "timestamp":
		return "date", "Date"
	case "json":
		return "json", "JsonValue"
	case "decimal", "dec", "fixed", "numeric", "time", "char", "varchar", "text", "tinytext", "mediumtext", "longtext", "enum", "set":
		return "string", "string"
	default:
		return "unknown", "unknown"
	}
}

// importSQLType adds driver-specific type imports only when the final type uses
// them. A codec override can replace Buffer with an unrelated application type;
// eager imports would leave invalid noUnusedLocals output in that case.
func (m *module) importSQLType(value *valueType, column *protocol.Column) {
	var path, name string
	if enum := m.gen.enumForColumn(column); enum != nil {
		path, name = "./enums.ts", enum.name
	} else {
		switch value.kind {
		case "buffer", "bytes":
			path, name = "node:buffer", "Buffer"
		case "interval":
			path, name = "postgres-interval", "IPostgresInterval"
		case "json":
			if m.gen.request.Settings.Engine == "sqlite" {
				return
			}
			path, name = "./json.ts", "JsonValue"
		default:
			return
		}
	}
	probe, err := parseType(value.typeName, map[string]string{name: name + "$sqlcReference"})
	if err != nil || probe == value.typeName {
		return
	}
	alias := m.useImport(path, name, true)
	value.typeName, _ = parseType(value.typeName, map[string]string{name: alias})
}

// sqliteDriverType follows the older plugin's value rules with corrected text
// fields. Text declarations use string instead of the older untyped fallback.
// @bonakodo/sqlite exposes SQLite storage values directly; numeric affinity can yield
// a floating-point number or a bigint with safeIntegers enabled. Driver mode
// converts safe bigints to numbers to retain the existing value contract. better-sqlite3
// retains its advertised boolean/Date types using checked native conversions,
// fixing the old wrappers' unchecked casts without changing their declarations.
func (m *module) sqliteDriverType(column *protocol.Column) (string, string) {
	name := strings.ReplaceAll(databaseTypeName(column), " ", "")
	deno := m.gen.options.DriverName() == "@bonakodo/sqlite"
	switch name {
	case "int", "integer", "tinyint", "smallint", "mediumint", "bigint", "unsignedbigint", "int2", "int8":
		if deno {
			return "sqlite-integer", "number | bigint"
		}
		return "number", "number"
	case "numeric", "decimal":
		if deno {
			return "sqlite-integer", "number | bigint"
		}
	case "real", "double", "doubleprecision", "float":
		return "number", "number"
	case "bool", "boolean":
		if deno {
			return "number", "number"
		}
		return "boolean", "boolean"
	case "date", "datetime", "timestamp":
		if deno {
			return "string", "string"
		}
		return "date", "Date"
	case "blob":
		if deno {
			return "bytes", "Uint8Array"
		}
		return "bytes", "Buffer"
	case "text", "char", "character", "clob", "varchar", "varyingcharacter", "nchar", "nativecharacter", "nvarchar":
		return "string", "string"
	}
	return "unknown", "any"
}
