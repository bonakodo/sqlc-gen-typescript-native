package tsast

import "strings"

// TypeExpr is a TypeScript type expression with correct parenthesis handling.
type TypeExpr interface {
	// TypeScript returns valid source for the type expression.
	TypeScript() string
	// precedence orders supported type expressions from loose to tight binding.
	precedence() int
}

// NameType names a built-in or imported type, or contains a validated custom type.
// Callers must validate user-supplied type text before constructing a NameType.
type NameType string

// TypeScript returns the type name without changing its spelling.
func (n NameType) TypeScript() string { return string(n) }

// precedence treats a simple name as an atom. Custom text with operators or
// spaces gets conservative parentheses when nested; redundant parentheses are
// harmless and avoid changing unions, functions, or keyof types into new types.
func (n NameType) precedence() int {
	if strings.Contains(string(n), "=>") || strings.Contains(string(n), " extends ") {
		return 0
	}
	if strings.ContainsAny(string(n), " \t\r\n|&") {
		return 1
	}
	return 3
}

// ArrayType is an array whose element may itself be a union or array.
type ArrayType struct {
	// Element is the type of each array element.
	Element TypeExpr
}

// TypeScript prints the element with parentheses when needed before [].
func (a ArrayType) TypeScript() string { return parenthesize(a.Element, a.precedence()) + "[]" }

// precedence binds an array suffix more tightly than a union.
func (ArrayType) precedence() int { return 2 }

// UnionType permits any of its ordered member types. An empty union prints never.
type UnionType []TypeExpr

// TypeScript prints the union in input order, preserving stable generated output.
func (u UnionType) TypeScript() string {
	if len(u) == 0 {
		return "never"
	}
	parts := make([]string, len(u))
	for i, item := range u {
		parts[i] = parenthesize(item, u.precedence())
	}
	return strings.Join(parts, " | ")
}

// precedence gives union expressions the lowest supported binding strength.
func (UnionType) precedence() int { return 1 }

// parenthesize follows the printer's type precedence rule: a weaker child must
// be enclosed before it can appear as an operand of a stronger parent expression.
func parenthesize(child TypeExpr, parentPrecedence int) string {
	if child.precedence() < parentPrecedence {
		return "(" + child.TypeScript() + ")"
	}
	return child.TypeScript()
}

// PropertyDecl describes a documented interface property.
type PropertyDecl struct {
	// Name is the unescaped property name.
	Name string
	// Type is the property's value type.
	Type TypeExpr
	// Optional permits omission independently of the value type.
	Optional bool
	// Readonly prevents assignments through the generated interface.
	Readonly bool
	// Doc holds JSDoc lines; an empty slice emits no comment.
	Doc []string
}

// Emit writes a property declaration and its documentation at the current indent.
func (p PropertyDecl) Emit(w *Writer) {
	emitComment(w, p.Doc)
	prefix, suffix := "", ""
	if p.Readonly {
		prefix = "readonly "
	}
	if p.Optional {
		suffix = "?"
	}
	w.Line("%s%s%s: %s;", prefix, Property(p.Name), suffix, p.Type.TypeScript())
}

// InterfaceDecl describes a named interface and its ordered properties.
type InterfaceDecl struct {
	// Name is a validated TypeScript declaration identifier.
	Name string
	// Export makes the declaration available to importing modules.
	Export bool
	// Doc holds JSDoc lines; an empty slice emits no comment.
	Doc []string
	// Properties are printed in the supplied order.
	Properties []PropertyDecl
}

// Emit writes the interface and its documented fields.
func (d InterfaceDecl) Emit(w *Writer) {
	emitComment(w, d.Doc)
	prefix := ""
	if d.Export {
		prefix = "export "
	}
	w.Line("%sinterface %s {", prefix, d.Name)
	w.Indent()
	for _, property := range d.Properties {
		property.Emit(w)
	}
	w.Dedent()
	w.Line("}")
}

// emitComment indents each line of a JSDoc block without altering literal text.
func emitComment(w *Writer, lines []string) {
	if block := Comment(lines); block != "" {
		for _, line := range strings.Split(block, "\n") {
			w.Line(line)
		}
	}
}
