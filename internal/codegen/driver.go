package typescript

import (
	"fmt"
	"strings"
)

// emitDriverQuery keeps connection calls separate from type and binding plans.
// Every driver reads rows by position: column aliases, duplicate names, and
// sqlc.embed must not rely on the driver's object-key rewriting behavior.
func (m *module) emitDriverQuery(plan *queryPlan, bindings, sql string) {
	if bindings == "" {
		bindings = "[]"
	}
	switch m.gen.options.DriverName() {
	case "@bonakodo/sqlite":
		m.emitDenoSQLite(plan, bindings, sql)
	case "better-sqlite3":
		m.emitBetterSQLite(plan, bindings, sql)
	case "pg":
		if plan.query.Cmd == ":exec" {
			m.body.Line("await database.query({ text: %s, values: %s, rowMode: \"array\" });", sql, bindings)
			return
		}
		m.body.Line("const result = await database.query({ text: %s, values: %s, rowMode: \"array\" });", sql, bindings)
		switch plan.query.Cmd {
		case ":one", ":many":
			m.body.Line("const rows: unknown[][] = result.rows;")
			m.emitRows(plan)
		case ":execrows":
			m.body.Line("return %s(result.rowCount ?? 0);", m.runtimeImport("integerResult", false))
		case ":execresult":
			m.body.Line("return { rowsAffected: %s(result.rowCount ?? 0), lastInsertId: null };", m.runtimeImport("integerResult", false))
		}
	case "postgres":
		parameters := m.runtimeImport("DriverParameters", true)
		if plan.query.Cmd == ":exec" {
			m.body.Line("await database.unsafe(%s, %s as %s);", sql, bindings, parameters)
		} else if indices := rawArrayColumnIndices(plan.fields); len(indices) > 0 && (plan.query.Cmd == ":one" || plan.query.Cmd == ":many") {
			m.emitPostgresRawRows(plan, bindings, sql, parameters, indices)
			m.emitRows(plan)
		} else {
			m.body.Line("const rows = await database.unsafe(%s, %s as %s).values();", sql, bindings, parameters)
			switch plan.query.Cmd {
			case ":one", ":many":
				m.emitRows(plan)
			case ":execrows":
				m.body.Line("return %s(rows.count);", m.runtimeImport("integerResult", false))
			case ":execresult":
				m.body.Line("return { rowsAffected: %s(rows.count), lastInsertId: null };", m.runtimeImport("integerResult", false))
			}
		}
	case "mysql2":
		m.emitMySQL(plan, bindings, sql)
	}
}

// rawArrayColumnIndices records the physical row slots that need PostgreSQL
// array text. Embedded tables expand in the same depth-first order used by
// emitRowFields, so their arrays must not be mistaken for adjacent scalar cells.
func rawArrayColumnIndices(fields []field) []int {
	var indices []int
	index := 0
	var visit func([]field)
	visit = func(fields []field) {
		for _, field := range fields {
			if len(field.children) > 0 {
				visit(field.children)
				continue
			}
			if field.value.arrayDims > 0 {
				indices = append(indices, index)
			}
			index++
		}
	}
	visit(fields)
	return indices
}

// emitPostgresRawRows bypasses postgres.js's array parser for this query alone.
// Its automatic array parser loses the distinction between SQL NULL and the
// enum/string label "NULL". Raw array text lets our decoder retain that detail;
// scalar cells still use the exact parsers attached to the result columns,
// including caller-supplied parsers, without changing the connection registry.
func (m *module) emitPostgresRawRows(plan *queryPlan, bindings, sql, parameters string, indices []int) {
	m.body.Line("const result = await database.unsafe(%s, %s as %s).raw();", sql, bindings, parameters)
	m.body.Line("if (result.columns.length !== %d) throw new TypeError(\"SQL result column count does not match generated query\");", fieldCount(plan.fields))
	m.body.Line("const rows: unknown[][] = result.map((rawRow) => rawRow.map((value, index): unknown => {")
	m.body.Indent()
	m.body.Line("const column = result.columns[index];")
	m.body.Line("if (column === undefined) throw new TypeError(\"SQL driver omitted result column metadata\");")
	m.body.Line("if (value === null) return null;")
	m.body.Line("const text = value.toString(\"utf8\");")
	conditions := make([]string, len(indices))
	for i, index := range indices {
		conditions[i] = fmt.Sprintf("index === %d", index)
	}
	m.body.Line("if (%s) return text;", strings.Join(conditions, " || "))
	// Do not use a nullish fallback here: a JSON or custom parser may return
	// null for a present text value, and that null is the parsed result.
	m.body.Line("return column.parser ? column.parser(text) : text;")
	m.body.Dedent()
	m.body.Line("}));")
}

// emitRows reconstructs all result objects from the selected driver's row array.
func (m *module) emitRows(plan *queryPlan) {
	if plan.query.Cmd == ":one" {
		if m.gen.request.Settings.Engine != "sqlite" {
			m.body.Line("if (rows.length !== 1) return %s;", m.nullText())
		}
		m.body.Line("const row = rows[0];")
		m.body.Line("if (row === undefined) return %s;", m.nullText())
		m.emitRow(plan.fields, "return", fieldCount(plan.fields))
		return
	}
	m.body.Line("return rows.map((row): %s => {", plan.rowName)
	m.body.Indent()
	m.emitRow(plan.fields, "return", fieldCount(plan.fields))
	m.body.Dedent()
	m.body.Line("});")
}

// emitDenoSQLite owns its statement and releases it even if a codec throws.
func (m *module) emitDenoSQLite(plan *queryPlan, bindings, sql string) {
	m.body.Line("const stmt = database.prepare(%s);", sql)
	m.body.Line("try {")
	m.body.Indent()
	m.body.Line("stmt.safeIntegers();")
	switch plan.query.Cmd {
	case ":one", ":many":
		// A fixed tuple lets strict indexed access keep each selected value
		// present without unchecked assertions on SQLite result columns.
		valueType := m.runtimeImport("SqliteValue", true)
		tuple := "["
		for i := 0; i < fieldCount(plan.fields); i++ {
			if i > 0 {
				tuple += ", "
			}
			tuple += valueType
		}
		tuple += "]"
		if plan.query.Cmd == ":one" {
			m.body.Line("const row = stmt.raw().get(%s) as %s | undefined;", bindings, tuple)
			m.body.Line("if (row === undefined) return %s;", m.nullText())
			m.emitRow(plan.fields, "return", fieldCount(plan.fields))
		} else {
			m.body.Line("const rows = stmt.raw().all(%s) as %s[];", bindings, tuple)
			m.emitRows(plan)
		}
	case ":exec":
		m.body.Line("stmt.run(%s);", bindings)
	case ":execrows":
		m.body.Line("return BigInt(stmt.run(%s).changes);", bindings)
	case ":execlastid":
		if m.gen.options.SQLiteTypeMode == "native" {
			m.body.Line("return BigInt(stmt.run(%s).lastInsertRowid);", bindings)
		} else {
			m.body.Line("return Number(stmt.run(%s).lastInsertRowid);", bindings)
		}
	case ":execresult":
		m.body.Line("const result = stmt.run(%s);", bindings)
		m.body.Line("return { rowsAffected: BigInt(result.changes), lastInsertId: BigInt(result.lastInsertRowid) };")
	}
	m.body.Dedent()
	m.body.Line("} finally {")
	m.body.Indent()
	m.body.Line("stmt[Symbol.dispose]();")
	m.body.Dedent()
	m.body.Line("}")
}

// emitBetterSQLite applies the same value rules as Deno SQLite. Per-statement
// safeIntegers prevents rounded reads without changing connection-wide options.
// The driver does not expose finalization; statement disposal belongs to it.
func (m *module) emitBetterSQLite(plan *queryPlan, bindings, sql string) {
	m.body.Line("const stmt = database.prepare(%s).safeIntegers();", sql)
	switch plan.query.Cmd {
	case ":one", ":many":
		valueType := m.runtimeImport("SqliteValue", true)
		tuple := "["
		for i := 0; i < fieldCount(plan.fields); i++ {
			if i > 0 {
				tuple += ", "
			}
			tuple += valueType
		}
		tuple += "]"
		if plan.query.Cmd == ":one" {
			m.body.Line("const row = stmt.raw().get(%s) as %s | undefined;", bindings, tuple)
			m.body.Line("if (row === undefined) return %s;", m.nullText())
			m.emitRow(plan.fields, "return", fieldCount(plan.fields))
		} else {
			m.body.Line("const rows = stmt.raw().all(%s) as %s[];", bindings, tuple)
			m.emitRows(plan)
		}
	case ":exec":
		m.body.Line("stmt.run(%s);", bindings)
	case ":execrows":
		m.body.Line("return BigInt(stmt.run(%s).changes);", bindings)
	case ":execlastid":
		m.body.Line("return BigInt(stmt.run(%s).lastInsertRowid);", bindings)
	case ":execresult":
		m.body.Line("const result = stmt.run(%s);", bindings)
		m.body.Line("return { rowsAffected: BigInt(result.changes), lastInsertId: BigInt(result.lastInsertRowid) };")
	}
}

// emitMySQL uses the promise API and per-query big-number settings. SQLc's
// slice expansion has already flattened bound values. execute() binds real SQL
// placeholders; query() would also substitute question marks inside literals
// and comments. The driver owns its prepared statement cache.
func (m *module) emitMySQL(plan *queryPlan, bindings, sql string) {
	insertIDUnsigned := "undefined"
	if unsigned := m.gen.options.MySQL2.InsertIDUnsigned; unsigned != nil {
		insertIDUnsigned = fmt.Sprintf("%t", *unsigned)
	}
	rowQuery := plan.query.Cmd == ":one" || plan.query.Cmd == ":many"
	typ := "ResultSetHeader"
	if rowQuery {
		typ = "RowDataPacket"
	}
	resultType := m.useImport(m.gen.driverSpecifier(), typ, true)
	if rowQuery {
		resultType += "[]"
	}
	name := "result"
	if rowQuery {
		name = "rows"
	}
	prefix := "const [" + name + "] = "
	if plan.query.Cmd == ":exec" {
		prefix = ""
	}
	m.body.Line("%sawait database.execute<%s>({", prefix, resultType)
	m.body.Indent()
	m.body.Line("sql: %s,", sql)
	m.body.Line("values: %s,", bindings)
	m.body.Line("rowsAsArray: %t,", rowQuery)
	m.body.Line("supportBigNumbers: %t,", m.gen.options.MySQL2.SupportBigNumbers)
	m.body.Line("bigNumberStrings: %t,", m.gen.options.MySQL2.BigNumberStrings)
	m.body.Dedent()
	m.body.Line("});")
	switch plan.query.Cmd {
	case ":one", ":many":
		m.emitRows(plan)
	case ":execrows":
		m.body.Line("return %s(result.affectedRows);", m.runtimeImport("integerResult", false))
	case ":execlastid":
		m.body.Line("return %s(result.insertId, %t, %t, %s);", m.runtimeImport("mysqlInsertId", false), m.gen.options.MySQL2.SupportBigNumbers, m.gen.options.MySQL2.BigNumberStrings, insertIDUnsigned)
	case ":execresult":
		convert := m.runtimeImport("integerResult", false)
		m.body.Line("return { rowsAffected: %s(result.affectedRows), lastInsertId: %s(result.insertId, %s) };", convert, m.runtimeImport("mysqlInsertIdBigInt", false), insertIDUnsigned)
	}
}
