# sqlc-gen-typescript-native

A pure Go TypeScript generator for [sqlc](https://sqlc.dev). Use it as a Go library,
a process plugin, or a WASI WebAssembly plugin.

The generator uses a small Go source emitter adapted from TypeScript 7 through
the local native sqlc implementation. Its build and generation need only Go. Node, Deno, Bun,
TypeScript, Javy, and a database are not build dependencies. Generated programs
use the selected JavaScript runtime and database driver.

## Use a release

Each pushed `v*` tag publishes a WASI plugin and its SHA-256 checksum to
[GitHub Releases](https://github.com/bonakodo/sqlc-gen-typescript-native/releases).
Copy the sqlc configuration from the release notes: it includes the exact download
URL and checksum. No Go installation or local plugin build is needed.

For an existing config, replace its `wasm` section with:

```yaml
    wasm:
      url: https://github.com/bonakodo/sqlc-gen-typescript-native/releases/download/vX.Y.Z/sqlc-gen-typescript-native.wasm
      sha256: REPLACE_WITH_THE_RELEASE_SHA256
```

Replace `vX.Y.Z` with the release tag and copy the checksum from its notes or the
first field in `sqlc-gen-typescript-native.wasm.sha256`. Run `sqlc generate`.
Keep the version URL and matching checksum pinned in your config.

## Build locally

Requires Go 1.26.5, or a Go installation that can download that toolchain.

```sh
make all
```

This builds two independent plugins:

- `bin/sqlc-gen-typescript-native.wasm`: WASI (`GOOS=wasip1 GOARCH=wasm`).
- `bin/sqlc-gen-typescript-native`: native process plugin.

Use the absolute path to the local WASM file:

```yaml
version: "2"
plugins:
  - name: typescript
    wasm:
      url: file:///absolute/path/sqlc-gen-typescript-native/bin/sqlc-gen-typescript-native.wasm
sql:
  - engine: postgresql
    schema: schema.sql
    queries: query.sql
    codegen:
      - plugin: typescript
        out: db
        options:
          runtime: node
          driver: pg
```

Run `sqlc generate`. A local `file://` plugin does not need a checksum on recent
sqlc versions; pin a published artifact with its SHA-256 checksum when sharing a
config.

To use the process plugin, replace `wasm` with:

```yaml
    process:
      cmd: /absolute/path/sqlc-gen-typescript-native/bin/sqlc-gen-typescript-native
```

Both entry points use sqlc's protobuf plugin protocol and the official Go plugin
SDK. The process exits after one request. Diagnostics go to stderr; stdout holds
only the protobuf response.

## Drivers and runtimes

| Engine | Driver | Node | Bun | Deno |
| --- | --- | --- | --- | --- |
| PostgreSQL | `pg` | yes | yes | yes |
| PostgreSQL | `postgres` | yes | yes | yes |
| MySQL | `mysql2` | yes | yes | yes |
| SQLite | `better-sqlite3` | yes | yes | yes |
| SQLite | `@bonakodo/sqlite` | — | — | yes |

`runtime` defaults to `node`; `driver` is required. Engine/driver mismatches fail
before sqlc receives output files. Generated imports use bare package names,
including `@bonakodo/sqlite` and `mysql2/promise`. Put full Deno specifiers and
version pins in your application's `deno.json` `imports`, for example:

```json
{
  "imports": {
    "postgres": "npm:postgres@3.4.9"
  }
}
```

Registry-prefixed and versioned Deno driver options remain accepted, but only
select the driver; the import map controls its version. Pin Node and Bun
dependencies in `package.json`.

For `pg` and `better-sqlite3`, install their `@types` packages. Queries that use
PostgreSQL intervals with `pg` also import the `postgres-interval` type package;
add it as a direct dependency when your package manager restricts transitive
imports. Deno output includes bare `@deno-types` hints; map `@types/pg` and
`@types/better-sqlite3` to their full specifiers in `imports` when using those
drivers. Map `postgres-interval` there when using PostgreSQL intervals with `pg`.
Generated Node and Bun modules use `.ts` relative imports;
use a runtime that supports them, or TypeScript's `rewriteRelativeImportExtensions`
when emitting JavaScript. See the checked configuration in `scripts/tsconfig.json`.
The test and example import maps resolve `@bonakodo/sqlite` to the published
`jsr:@bonakodo/sqlite@0.1.0` package. Generated code uses the bare package name
so applications can supply their own import map.
Queries use `safeIntegers()`, `raw().get()`/`all()`, `run()` result fields, and
`Symbol.dispose` to release statements on success or failure. They leave
connection settings unchanged; JSON stays text or bytes without driver parsing.

Set `DENO_SQLITE_PATH` to an absolute SQLite shared library path before running
the tests or example. On macOS with Homebrew SQLite:

```sh
export DENO_SQLITE_PATH="$(brew --prefix sqlite)/lib/libsqlite3.dylib"
```

On other platforms, use the installed `.so` or `.dll` path. Runtime calls need
`--allow-env=DENO_SQLITE_PATH --allow-ffi`; the example also needs read access
to its schema. The package does not download a native library.

## Generated API

For `-- name: GetAuthor :one`, a query module exports `getAuthorQuery`,
`GetAuthorArgs`, `GetAuthorRow`, and `getAuthor(database, args)`. Queries without
arguments omit `args`. Pass a driver connection, pool, or transaction handle;
the generated code does not open or close connections.

- Each SQL source produces a matching `*_sql.ts` module, retaining subdirectories.
- `models.ts` contains table interfaces.
- Catalog enums produce `enums.ts` with value arrays and their derived types.
- `index.ts` exports models, enums, and query namespaces.
- `runtime.ts` contains shared conversions and driver connection types.
- Server-driver output includes `json.ts` with reusable JSON value types.
- Snake_case field names become camelCase; existing camelCase names retain
  their spelling in every driver. Unsafe names use quoted properties.
- Output order and names are stable. Generation does not change the request.

| Command | Result |
| --- | --- |
| `:one` | Row or `null`; server drivers require exactly one row, SQLite returns the first |
| `:many` | Row array; no matches returns `[]` |
| `:exec` | `void` |
| `:execlastid` | MySQL: `number`, `number \| string`, or `string` according to big-number options; Deno SQLite: `number` in driver mode, `bigint` in native mode; better-sqlite3: `bigint` |
| `:execrows` | `bigint` count |
| `:execresult` | `{ rowsAffected: bigint; lastInsertId: bigint \| null }`; PostgreSQL insert ID is `null` |

Functions return promises except `@bonakodo/sqlite` functions, which run synchronously.
Native SQLite mode also makes better-sqlite3 functions synchronous, so both can
run inside synchronous transaction callbacks. PostgreSQL rejects `:execlastid`;
use `INSERT ... RETURNING` with `:one`. The older better-sqlite3 generator rejected
`:execlastid`; this plugin adds it with a `bigint` result. Unsupported annotations
produce errors.

The SQLite drivers use positional rows and checked conversions. Deno statements
are finalized in `finally`; better-sqlite3 owns statement disposal. Integer reads
use per-statement settings without changing the connection. MySQL uses its
promise `execute()` API to bind values safely, including SQL text containing `?`.
PostgreSQL keeps repeated parameters in one bind slot so server type inference
stays consistent. Compiler-marked SQLite/MySQL slices expand at runtime; empty
slices emit `NULL`. PostgreSQL arrays bind as one parameter; use `ANY($1)` for
array membership. PostgreSQL `sqlc.slice` produces a generation error with this
guidance instead of emitting a query that fails at runtime.

## Options and types

| Option | Default | Effect |
| --- | --- | --- |
| `runtime` | `node` | `node`, `bun`, or `deno` |
| `driver` | required | Driver from the table above |
| `sqlite_type_mode` | `driver` | Older plugin types, or `native` value conversions |
| `types_only` | `false` | Models, query types, and enum value arrays; no SQL, functions, codecs, or runtime module |
| `emit_null_as_undefined` | `false` | Absent rows and nullable results use `undefined`; nullable args may be omitted |
| `emit_sql_as_const` | `true` | Export SQL constants; `false` keeps SQL private |
| `mysql2.support_big_numbers` | `false` | BIGINT values can be `number \| string` |
| `mysql2.big_number_strings` | `false` | With `support_big_numbers`, BIGINT values are always `string` |
| `mysql2.insert_id_unsigned` | unset | `true` interprets insert IDs as unsigned; `false` as signed; unset rejects ambiguous negative packet values |
| `overrides` | `[]` | Column/database type overrides with optional imports and codecs |

MySQL big-number flags are set on each generated query. Its DECIMAL values remain
strings. PostgreSQL uses default driver parsers: int8/numeric are strings, small
integers and floats are numbers, timestamps are `Date`, binary values are
`Buffer`, and parsed JSON values use `JsonValue`. PostgreSQL array element types follow the
selected driver; pg's numeric array parser returns numbers and can lose decimal
precision. Enum labels become named string unions. Raw enum/circle array text from pg
is decoded when it has no registered array parser. Box arrays retain their
semicolon delimiter. For postgres.js queries with array results, the generator
reads raw cells so SQL NULL stays distinct from the text "NULL"; scalar columns
still use the driver's own parsers. Custom driver parsers may need matching
overrides and codecs.

MySQL insert IDs follow the same big-number type policy as BIGINT row fields.
With support enabled, large IDs remain exact strings. With support disabled,
an unsafe insert ID throws instead of returning a rounded number. This error
occurs **after the INSERT executes**; do not retry the insert just because the
ID conversion failed. Enable `support_big_numbers` before inserting large IDs.
mysql2 reports negative signed keys and unsigned insert IDs above `2^63 - 1`
using the same packet value. The wrappers reject that ambiguous value unless
the caller specifies `mysql2.insert_id_unsigned: true` for unsigned IDs or
`false` for signed IDs. This applies to `:execlastid` and `:execresult`; it does
not change database column types or driver connection settings. Use separate
codegen blocks when tables need different insert-ID policies.

`sqlite_type_mode: driver` keeps the older SQLite value rules with corrected
text types:

| Declared SQLite type | @bonakodo/sqlite | better-sqlite3 |
| --- | --- | --- |
| Integer | `number \| bigint` | `number` |
| NUMERIC/DECIMAL | `number \| bigint` | `any` |
| REAL/float | `number` | `number` |
| Boolean | `number` | `boolean` |
| Date/time | `string` | `Date` |
| BLOB | `Uint8Array` | `Buffer` |
| Text | `string` | `string` |

For the Deno driver, generated statements read integers as `bigint`, then driver
mode returns safe integers as `number` and larger integers as `bigint`. Native
mode keeps every integer as `bigint`.

The better-sqlite3 wrappers now actually convert booleans/dates and map snake_case
columns to the emitted camelCase properties. Other unknown SQLite types remain
`any` in driver mode. Missing rows and nullable values keep their
configured null policy. `number` integer and insert-ID APIs retain their usual
JavaScript precision limits; use native SQLite mode for exact signed 64-bit data.

`sqlite_type_mode: native` uses the migrated native value contract for either
SQLite driver: integers are `bigint`, booleans are `boolean`, dates are `Date`,
REAL/NUMERIC values are finite `number`, blobs are `Uint8Array`, and JSON remains
raw UTF-8/SQLite bytes. Dates use UTC when stored text has no zone and keep
millisecond precision. Numeric timestamps need a codec. Codecs control their own
storage representation. Unknown SQLite types use `unknown` in native mode.

### Enums

Catalog enums produce a readonly value array and a type derived from that array
in `enums.ts`:

```ts
export const StatusValues = ["active", "inactive"] as const;
export type Status = (typeof StatusValues)[number];
```

Import either export from `enums.ts` or `index.ts`. Models, query arguments, and
rows use the shared type; plain strings such as `"active"` remain valid. Nullable
fields and PostgreSQL arrays keep their existing null and array rules. The array
retains the database's label order. `as const` makes it readonly to TypeScript;
it does not freeze the array at runtime.

Enums outside the default schema include the schema in their names, such as
`ArchiveStatus`. Name clashes with models, helper types, or other enum exports
receive stable numeric suffixes. Existing model names stay unchanged.

All catalog enums appear, including enums unused by queries. `types_only` keeps
these static value arrays and derived types without database dependencies.
Types without catalog enum labels retain the driver's fallback type; this does
not infer enum labels from strings, CHECK constraints, or bare MySQL `enum`
metadata. Overrides still control field types and optional value conversions.

### JSON fields

The pg, postgres.js, and mysql2 drivers parse JSON into JavaScript values. Their
JSON/JSONB fields use exported recursive `JsonValue`, `JsonObject`, and `JsonArray`
types. `JsonValue` covers strings, numbers, booleans, objects, arrays, and JSON
null. It excludes functions, bigint, and other non-JSON values. These types remain
available in `types_only` output.

Use an override to give a field a domain type without a codec:

```yaml
options:
  driver: pg
  overrides:
    - column: users.preferences
      ts_type: UserPreferences
      import: { path: "../types.ts", name: UserPreferences }
```

The override supplies a static type contract; it does not validate a JSON schema
at runtime. Add a codec when you need validation or a different representation.
JSON serialization still follows the selected driver's binding rules. SQLite
drivers return stored text or bytes, so converting their JSON to an object still
requires a codec.

Built-in JSON bindings reject values that JSON cannot represent, including nested
undefined, bigint, functions, non-finite numbers, class instances, and cycles.
Built-in PostgreSQL JSON array bindings preserve the distinction between an SQL
array dimension and an array inside a JSON document. Custom codecs instead
return driver-ready values and remain responsible for their driver's JSON
binding rules; the runtime does not serialize their output a second time.

JSON null remains a valid value even in a `NOT NULL` JSON column. On nullable
columns, the server drivers return JavaScript `null` for both JSON null and SQL
NULL. With `emit_null_as_undefined`, the existing null policy maps that ambiguous
top-level value to `undefined`; nulls inside JSON arrays and objects remain null.

### Overrides

```yaml
options:
  runtime: deno
  driver: "@bonakodo/sqlite"
  sqlite_type_mode: native
  overrides:
    - column: documents.id
      ts_type: DocumentID
      import: { path: "../types.ts", name: DocumentID }
    - db_type: JSON
      nullable: true
      ts_type: Payload
      import: { path: "../codecs.ts", name: Payload }
      codec: { path: "../codecs.ts", name: payloadCodec }
```

Column selectors accept two to four parts and `*` wildcards. They take precedence
over database type selectors, which also match declared nullability. An imported
branded type can refine a default type. Changes of value representation require
a codec with `encode` and `decode` methods; parsed server JSON also permits domain
type overrides without a codec. The runtime handles nullable values
outside the codec; PostgreSQL array codecs apply to each non-null element.
Relative import paths resolve from the output directory and rebase for nested
query modules. The emitter validates type expressions and escapes SQL, comments,
property names, and module specifiers.

## Migration

From the older TypeScript plugin, change the plugin executable/WASM URL and keep
your runtime, driver, and mysql2 options. The default API follows that plugin.
Output text is not byte-compatible: this plugin adds shared models/runtime/index
files, corrects collisions and escaping, and rejects unsupported inputs instead
of silently omitting wrappers. Pg `time`/`timetz` use the strings its parser
returns; nullable PostgreSQL array elements are reflected in their types.
Existing camelCase properties now retain their spelling, better-sqlite3 text
fields use `string`, and parsed server JSON uses `JsonValue` in place of `any`.
MySQL callers that enable big-number support must handle string insert IDs.

From the native sqlc branch, move `gen.typescript.out` to `codegen.out` and the
remaining settings to `codegen.options`. Set `runtime: deno`, `driver: @bonakodo/sqlite`,
and `sqlite_type_mode: native` explicitly. Configure the output path in
`codegen.out`; the retained `Options.Out` field has no effect on generated files.
No modified sqlc binary is needed.

The plugin consumes the analysis sqlc sends. It cannot add compiler features
that run before plugin dispatch. With stock sqlc, schema-only configuration,
sparse SQLite `?NNN` parameters, untyped parameters, and JSON table-function
analysis depend on the host's support. Stock sqlc may
rewrite SQLite JSONB projections to JSON text; the plugin cannot recover the
original stored bytes after that rewrite. Direct library callers can supply a
richer request, including table identities and correct nullability for embeds.
For stock-sqlc embeds, the plugin recovers nullability from ordinary base-table
SELECT/join trees, including aliases and outer joins. CTEs, derived tables, set
operations, table functions, and other complex forms retain conservative
nullable fields when the supplied metadata cannot prove a relation required.

## Go library

```go
import (
    "context"
    "encoding/json"

    typescript "github.com/bonakodo/sqlc-gen-typescript-native"
    "github.com/sqlc-dev/plugin-sdk-go/plugin"
)

func generate(ctx context.Context, req *plugin.GenerateRequest) (*plugin.GenerateResponse, error) {
    options, err := json.Marshal(typescript.Options{Runtime: "node", Driver: "pg"})
    if err != nil {
        return nil, err
    }
    req.PluginOptions = options
    return typescript.Generate(ctx, req)
}
```

`Generate` returns files in memory. It never writes output, opens a database,
launches a process, or changes the supplied request. The caller provides sqlc's
analyzed settings, catalog, queries, and JSON options. Missing or unsupported
metadata produces an error without a partial response.

## Development

To publish a release, push a new tag such as `v1.2.3` on a commit containing the
release workflow. The workflow runs `make check` and checks WASM generation with
stock sqlc before publishing the raw `.wasm` file, a `.wasm.sha256` checksum file,
and release notes with a ready-to-use config. Tags containing a hyphen, such as
`v1.2.3-rc.1`, produce prereleases. Use a new tag for each release so existing
download URLs and checksums stay valid.

```sh
make check                    # formatting, vet, Go tests, WASM build
make integration              # stock sqlc, TypeScript 7, Deno, Node, and Bun
make live                     # live PostgreSQL/MySQL tests after integration
```

The integration suite needs sqlc, Go, Node, npm, and Deno. Its JavaScript packages,
including the pinned Bun binary, are test-only dependencies with a checked-in
lockfile. It compares process and WASM output through stock sqlc, checks all
runtime/driver combinations against real package declarations, and runs generated
queries under Deno, Node, and Bun.

`make live` uses dedicated PostgreSQL and MySQL test databases. It creates and
drops fixture tables in them. Set `SQLC_LIVE_PG_URL` and `SQLC_LIVE_MYSQL_URL` to
your test databases, or use the local `sqlc_test` defaults in
`scripts/server_live_test.ts`. The script starts no database services. CI supplies
PostgreSQL 17 and MySQL 8.4 services and runs live JSON, arrays, geometry, binding,
CRUD, transaction, and BIGINT tests. See `internal/endtoend` and `scripts` for
fixtures and exact commands.

The layout follows sqlc-dev Go plugins: `plugin` for the executable,
`internal/codegen` for generation, `internal/opts` for configuration, and
`internal/tsast` for source emission. The root package exposes the Go API.

MIT license for the sqlc-derived generator; the adapted Microsoft emitter parts
retain Apache-2.0 notices. See [NOTICE](NOTICE) and
[the TypeScript source notice](internal/tsast/NOTICE.md).
