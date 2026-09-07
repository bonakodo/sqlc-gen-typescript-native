package typescript

import "github.com/bonakodo/sqlc-gen-typescript-native/internal/opts"

// Options configures the generated runtime, driver, public types, and codecs.
// Marshal Options as JSON into plugin.GenerateRequest.PluginOptions. Driver is
// required; Runtime defaults to node. SQLc owns the output directory, configured
// in codegen.out rather than plugin options.
type Options = opts.Options

// Override replaces a column or database type, with an optional value codec.
// Column selectors take precedence over DBType selectors. A type-only override
// must refine the default type; a change of value representation needs a codec.
type Override = opts.Override

// Import identifies a named type or codec export from a TypeScript module.
// Relative paths resolve from the generated output directory.
type Import = opts.Import

// MySQL2Options selects mysql2 BIGINT parsing for each generated query.
type MySQL2Options = opts.MySQL2Options
