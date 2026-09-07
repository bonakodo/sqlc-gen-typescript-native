package typescript

import (
	"strings"

	"github.com/sqlc-dev/plugin-sdk-go/plugin"
	"google.golang.org/protobuf/proto"
)

// embedColumns fills the nullability omitted from embedded columns by stock
// sqlc. Its older request format identifies the catalog table but does not say
// which side of a join supplies it. We recover that fact only for SELECTs whose
// table/join structure this file fully understands. Other queries retain the
// safe nullable type. Newer hosts that supply Table or TableAlias keep complete
// control over their metadata, including an explicitly nullable embedded row.
//
// This is deliberately not a second SQL analyzer. It only recognizes base-table
// references, aliases, and ordinary join trees; sqlc still resolves all types.
func (m *module) embedColumns(query *plugin.Query) []*plugin.Column {
	needed := false
	for _, col := range query.Columns {
		if legacyEmbed(col) {
			needed = true
			break
		}
	}
	if !needed {
		return query.Columns
	}
	tokens, ok := embedTokens(query.Text, m.gen.request.Settings.Engine)
	if !ok {
		return query.Columns
	}
	relations, targets, ok := selectEmbedRelations(tokens, m.gen.request.Settings.Engine)
	if !ok {
		return query.Columns
	}
	columns := append([]*plugin.Column(nil), query.Columns...)
	position := 0
	for i, col := range columns {
		width := 1
		if col.GetEmbedTable() != nil {
			model := m.gen.byTable[m.gen.tableKey(col.EmbedTable)]
			if model == nil {
				return query.Columns // makeFields reports the missing catalog table.
			}
			width = len(model.columns)
		}
		if legacyEmbed(col) {
			// Expanded SELECT targets disambiguate a self join's two aliases.
			// If a host leaves stars unexpanded, catalog identity alone still
			// suffices when every matching relation is required.
			qualifier := ""
			if position+width <= len(targets) {
				qualifier = embedTargetQualifier(targets[position : position+width])
			}
			found, required := false, true
			for _, relation := range relations {
				if !m.embedTableMatches(relation.table, col.EmbedTable) || qualifier != "" && qualifier != relation.alias {
					continue
				}
				found = true
				required = required && relation.required
			}
			if found && required {
				columns[i] = proto.Clone(col).(*plugin.Column)
				columns[i].NotNull = true
			}
		}
		position += width
	}
	return columns
}

func legacyEmbed(col *plugin.Column) bool {
	return col != nil && col.EmbedTable != nil && !col.NotNull && col.Table == nil && col.TableAlias == ""
}

func (m *module) embedTableMatches(parts []string, table *plugin.Identifier) bool {
	actual := []string{table.Catalog, table.Schema, table.Name}
	if actual[1] == "" {
		actual[1] = m.gen.request.Catalog.DefaultSchema
	}
	for i, name := range parts {
		want := actual[len(actual)-len(parts)+i]
		if name != want && !(m.gen.request.Settings.Engine == "sqlite" && strings.EqualFold(name, want)) {
			return false
		}
	}
	return true
}

// embedToken separates identifiers from punctuation, strings, and keywords.
// Quoted identifiers never act as grammar keywords, even when named "left".
// Strings and comments use the same dialect-aware scanner as bind rewriting.
type embedToken struct {
	text       string
	identifier bool
	quoted     bool
}

func (t embedToken) is(word string) bool { return !t.quoted && t.text == word }

func embedTokens(sql, engine string) ([]embedToken, bool) {
	var tokens []embedToken
	for i := 0; i < len(sql); {
		if sql[i] <= ' ' {
			i++
			continue
		}
		end, err := skipDialectSQL(sql, i, engine)
		if err != nil {
			return nil, false
		}
		if end > i {
			piece := sql[i:end]
			quotedIdentifier := sql[i] == '"' && engine != "mysql" || sql[i] == '`' && engine != "postgresql" || sql[i] == '[' && engine == "sqlite"
			if quotedIdentifier {
				quote := piece[len(piece)-1:]
				name := strings.ReplaceAll(piece[1:len(piece)-1], quote+quote, quote)
				tokens = append(tokens, embedToken{text: name, identifier: true, quoted: true})
			} else if !strings.HasPrefix(piece, "--") && !strings.HasPrefix(piece, "/*") && !(engine == "mysql" && sql[i] == '#') {
				tokens = append(tokens, embedToken{text: "<literal>", quoted: true})
			}
			i = end
			continue
		}
		if sqlIdentifierStart(sql[i]) {
			end = i + 1
			for end < len(sql) && sqlNameByte(sql[end]) {
				end++
			}
			tokens = append(tokens, embedToken{text: strings.ToLower(sql[i:end]), identifier: true})
			i = end
			continue
		}
		tokens = append(tokens, embedToken{text: sql[i : i+1]})
		i++
	}
	return tokens, true
}

type embedRelation struct {
	table    []string
	alias    string
	required bool
}

// selectEmbedRelations requires one plain SELECT. CTEs, derived tables, table
// functions, and set operations may change row provenance in ways this narrow
// parser cannot prove. They return false instead of making fields non-null.
func selectEmbedRelations(tokens []embedToken, engine string) ([]embedRelation, [][]embedToken, bool) {
	if len(tokens) == 0 || !tokens[0].is("select") {
		return nil, nil, false
	}
	depth, from := 0, -1
	for i, token := range tokens {
		switch {
		case token.is("("):
			depth++
		case token.is(")"):
			depth--
			if depth < 0 {
				return nil, nil, false
			}
		case depth == 0 && (token.is("union") || token.is("intersect") || token.is("except")):
			return nil, nil, false
		case depth == 0 && token.is(";") && i != len(tokens)-1:
			return nil, nil, false
		case depth == 0 && token.is("from") && from < 0:
			from = i
		}
	}
	if depth != 0 || from < 0 {
		return nil, nil, false
	}
	p := embedParser{tokens: tokens[from+1:], sqlite: engine == "sqlite"}
	relations, ok := p.list()
	if !ok || p.pos < len(p.tokens) && !embedClauseEnd(p.tokens[p.pos]) {
		return nil, nil, false
	}
	var targets [][]embedToken
	start := 1
	depth = 0
	for i := 1; i < from; i++ {
		switch {
		case tokens[i].is("("):
			depth++
		case tokens[i].is(")"):
			depth--
		case depth == 0 && tokens[i].is(","):
			targets = append(targets, tokens[start:i])
			start = i + 1
		}
	}
	targets = append(targets, tokens[start:from])
	return relations, targets, true
}

// embedTargetQualifier accepts only expanded, qualified column references with
// one shared relation name. Expressions, stars, and aliases stay ambiguous.
func embedTargetQualifier(targets [][]embedToken) string {
	qualifier := ""
	for _, target := range targets {
		if len(target) < 3 || len(target)%2 != 1 {
			return ""
		}
		for i, token := range target {
			if i%2 == 0 && !token.identifier || i%2 == 1 && !token.is(".") {
				return ""
			}
		}
		name := target[len(target)-3].text
		if qualifier != "" && qualifier != name {
			return ""
		}
		qualifier = name
	}
	return qualifier
}

type embedParser struct {
	tokens []embedToken
	pos    int
	// SQLite gives comma the same precedence as JOIN. PostgreSQL and MySQL
	// group explicit joins first, so their commas remain in list instead.
	sqlite bool
}

func (p *embedParser) take(word string) bool {
	if p.pos >= len(p.tokens) || !p.tokens[p.pos].is(word) {
		return false
	}
	p.pos++
	return true
}

func (p *embedParser) list() ([]embedRelation, bool) {
	relations, ok := p.joined()
	if !ok {
		return nil, false
	}
	for p.take(",") {
		next, ok := p.joined()
		if !ok {
			return nil, false
		}
		relations = append(relations, next...)
	}
	return relations, true
}

// joined applies outer joins to the entire preceding subtree, rather than just
// the nearest table. Thus (a LEFT JOIN b) RIGHT JOIN c can null both a and b.
func (p *embedParser) joined() ([]embedRelation, bool) {
	left, ok := p.relation()
	if !ok {
		return nil, false
	}
	for {
		kind, end := p.joinAt(p.pos)
		if p.sqlite && p.pos < len(p.tokens) && p.tokens[p.pos].is(",") {
			kind, end = "cross", p.pos+1
		}
		if end == p.pos {
			return left, true
		}
		p.pos = end
		right, ok := p.relation()
		if !ok {
			return nil, false
		}
		if kind == "right" || kind == "full" {
			for i := range left {
				left[i].required = false
			}
		}
		if kind == "left" || kind == "full" {
			for i := range right {
				right[i].required = false
			}
		}
		left = append(left, right...)
		if p.take("on") || p.take("using") {
			depth := 0
			for p.pos < len(p.tokens) {
				token := p.tokens[p.pos]
				_, nextJoin := p.joinAt(p.pos)
				if depth == 0 && (token.is(")") || token.is(",") || embedClauseEnd(token) || nextJoin != p.pos) {
					break
				}
				if token.is("(") {
					depth++
				} else if token.is(")") {
					depth--
				}
				p.pos++
			}
			if depth != 0 {
				return nil, false
			}
		}
	}
}

func (p *embedParser) joinAt(pos int) (string, int) {
	q := embedParser{tokens: p.tokens, pos: pos}
	q.take("natural")
	kind := "inner"
	for _, word := range []string{"left", "right", "full", "inner", "cross"} {
		if q.take(word) {
			kind = word
			break
		}
	}
	q.take("outer")
	if !q.take("join") {
		return "", pos
	}
	return kind, q.pos
}

func (p *embedParser) relation() ([]embedRelation, bool) {
	if p.take("(") {
		relations, ok := p.list()
		if !ok || !p.take(")") {
			return nil, false
		}
		// An alias for a whole join hides its children's aliases. Falling
		// back is safer than attributing a selected field to the wrong side.
		return relations, true
	}
	var parts []string
	for {
		if p.pos >= len(p.tokens) || !p.tokens[p.pos].identifier || embedReserved(p.tokens[p.pos]) {
			return nil, false
		}
		parts = append(parts, p.tokens[p.pos].text)
		p.pos++
		if !p.take(".") {
			break
		}
		if len(parts) == 3 {
			return nil, false
		}
	}
	alias := parts[len(parts)-1]
	if p.take("as") {
		if p.pos >= len(p.tokens) || !p.tokens[p.pos].identifier || embedReserved(p.tokens[p.pos]) {
			return nil, false
		}
		alias = p.tokens[p.pos].text
		p.pos++
	} else if p.pos < len(p.tokens) && p.tokens[p.pos].identifier && !embedReserved(p.tokens[p.pos]) {
		alias = p.tokens[p.pos].text
		p.pos++
	}
	return []embedRelation{{table: parts, alias: alias, required: true}}, true
}

func embedReserved(token embedToken) bool {
	if token.quoted {
		return false
	}
	switch token.text {
	case "select", "with", "only", "lateral", "tablesample", "natural", "join", "inner", "cross", "left", "right", "full", "outer", "on", "using", "as":
		return true
	}
	return embedClauseEnd(token)
}

func embedClauseEnd(token embedToken) bool {
	if token.quoted {
		return false
	}
	switch token.text {
	case "where", "group", "having", "window", "order", "limit", "offset", "fetch", "for", "qualify", "union", "intersect", "except", ";":
		return true
	}
	return false
}
