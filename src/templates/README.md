# Generated TypeScript support

These files supply the generated runtime, JSON types, and codec errors. The
build stores them as UTF-8 data in the WASM plugin. The plugin copies the
needed declarations into its response; it does not execute TypeScript.

Each project gets `runtime_common.ts` and one engine runtime:

| Template | Contents |
| --- | --- |
| [runtime_common.ts](runtime_common.ts) | Shared context and JSON checks; conversions and types shared by PostgreSQL and MySQL |
| [runtime_sqlite.ts](runtime_sqlite.ts) | SQLite values, dates, codecs, presets, and insert-ID lookup |
| [runtime_postgresql.ts](runtime_postgresql.ts) | Driver connection types, arrays, and shared helper exports |
| [runtime_mysql.ts](runtime_mysql.ts) | Driver connection types, insert IDs, and shared helper exports |

[assets.ts](../../tools/assets.ts) builds a dependency table from the templates.
[runtime.wat](../runtime.wat) records imports and conversion kinds as it plans
queries, follows the table, and emits each needed declaration once in source
order. Unused helpers and conversion branches stay out of generated files.
The selected runtime supports the conversion kinds used by that project's
queries; a removed scalar branch throws if code calls it with another kind.

Template markers describe declarations and optional branches:

- `// @part name` starts a declaration. The build finds its references to other
  declarations, including types. Add names after the declaration name for
  dependencies the source does not show, such as `common.checkedJson` for an
  import from the common file. The build ignores identifiers in comments and
  quoted text; list any dependency used inside a template-string expression.
- Add `@pg`, `@postgres`, `@mysql2`, `@bonakodo`, or `@better-sqlite3` to a part
  to select a driver within the file's engine. Driver alternatives can share
  a declaration name when their driver sets do not overlap. Shared server
  implementations use all three server driver names. Their dependencies on
  engine reexports apply only to that engine's drivers; these build-time edges
  preserve direct helper imports without a TypeScript module import cycle.
- `// @when kind ...` starts a branch needed by any listed conversion kind;
  `// @endwhen` closes it. Branches cannot nest. Dependencies inside a branch
  only apply when the generator selects that branch.
- `// @kind kind ...` records kinds a declaration needs itself. For example,
  custom SQLite encoding checks a codec's result with the `unknown` kind.

Markers do not appear in generated files. The build rejects unknown markers,
kinds, driver names, missing dependencies, and overlapping declarations. The
WASM selection table holds at most 256 declarations; the build checks that
bound too. Adding a helper needs no generated WAT code or TypeScript parser.

[json.ts](json.ts) and [codec_error.ts](codec_error.ts) remain separate support
files. SQLite's `json_text` preset includes `createJsonTextCodec` so application
code can add shape checks; other presets remain separate and appear when a
query mapping selects them. An explicit codec mapping can name a generated
preset through `./runtime_sqlite.ts`; the old `./runtime.ts` mapping path also
works and routes to the helper's file. Common helper mappings can use
`./runtime_common.ts`.

An external SQLite codec module can import the generated presets or JSON codec
factory. The generator cannot inspect that module, so it retains this public
codec family when a query uses an external SQLite codec. Built-in presets and
explicit generated-runtime mappings retain only the selected preset.

The templates contain marked alternatives, so tests use files from the actual
WASM generator. `deno task runtime` builds the plugin, generates SQLite, pg,
postgres.js, and MySQL support under the ignored `tests/runtime/.generated/`
directory, and tests those files with Deno. Its fixtures request every tested
conversion and codec, so the tests also check dependency pruning. This suite
needs no sqlc executable. Integration tests generate complete projects with
stock sqlc and check their types and driver behavior.
