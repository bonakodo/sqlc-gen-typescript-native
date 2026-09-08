# sqlc-gen-typescript-native

A TypeScript generator for [sqlc](https://sqlc.dev), written directly in
WebAssembly text (WAT). The WASI plugin turns sqlc's analyzed schema, queries,
and options into TypeScript for Node, Bun, and Deno.

WABT assembles the source and Binaryen optimizes it. Deno tools pack constant
strings and TypeScript support templates into the module. Those
[templates](src/templates/README.md) become generated files; the plugin runs WAT
code. The module uses fixed 64 MiB memory, explicit bounds checks, and no
allocator or garbage collector.

The plugin replaces this repository's Go implementation. The release filename
and sqlc options stay the same; the Go library and process plugin have been
removed. See [migration](#migration).

## Use a release

Each pushed `v*` tag publishes a WASI plugin and its SHA-256 checksum to
[GitHub Releases](https://github.com/bonakodo/sqlc-gen-typescript-native/releases).
Copy the sqlc configuration from the release notes: it includes the exact
download URL and checksum. No local plugin build is needed.

For an existing config, replace its `wasm` section with:

```yaml
wasm:
  url: https://github.com/bonakodo/sqlc-gen-typescript-native/releases/download/vX.Y.Z/sqlc-gen-typescript-native.wasm
  sha256: REPLACE_WITH_THE_RELEASE_SHA256
```

Replace `vX.Y.Z` with the release tag and copy the checksum from its notes or
the first field in `sqlc-gen-typescript-native.wasm.sha256`. Run
`sqlc generate`. Keep the version URL and matching checksum pinned in your
config.

## Build locally

Install [Deno](https://deno.com/) 2.9 or later, then run:

```sh
deno task tools
deno task build
```

`deno task tools` downloads WABT 1.0.41 and Binaryen 132, verifies their SHA-256
hashes, and extracts them into the ignored `bin/.tools` directory. It supports
Linux on arm64 and amd64 and macOS on arm64. On macOS amd64, supply your own
WABT 1.0.41 executables. It changes no system settings. Ordinary builds do not
install native tools. Deno may fetch standard-library packages on first use;
`deno.lock` pins those dependencies. Set `WAT2WASM`, `WASM2WAT`, `WASMOPT`, or
`DENO` to select explicit executable paths.

The build writes these files under `bin/`:

- `sqlc-gen-typescript-native.wasm`: optimized WASI plugin.
- `sqlc-gen-typescript-native.wasm.sha256`: release checksum.
- `sqlc-gen-typescript-native.raw.wasm`: direct WABT assembly used by tests.
- `sqlc-gen-typescript-native.wat`: combined source with unpacked static data.
- `sqlc-gen-typescript-native.packed.wat`: combined source with packed data.

The default packs static data losslessly and restores it at startup.
`PACK_DATA=0 deno task build` leaves it unpacked for inspection and comparison.

The build needs no Go, TinyGo, protoc, Node, Bun, database, or TypeScript
compiler.

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

The plugin reads one protobuf request from stdin and writes one response to
stdout, then exits. Diagnostics go to stderr. Validation and capacity errors
produce a diagnostic and no partial response; a host I/O error can interrupt
transmission. The [protocol schema](https://github.com/sqlc-dev/sqlc/blob/a95e91d70ad9e1181253c333a1cfdd75ae4b95a5/protos/plugin/codegen.proto) tracks sqlc
v1.31.1.

## Drivers and runtimes

| Engine     | Driver             | Node | Bun | Deno |
| ---------- | ------------------ | ---- | --- | ---- |
| PostgreSQL | `pg`               | yes  | yes | yes  |
| PostgreSQL | `postgres`         | yes  | yes | yes  |
| MySQL      | `mysql2`           | yes  | yes | yes  |
| SQLite     | `better-sqlite3`   | yes  | yes | yes  |
| SQLite     | `@bonakodo/sqlite` | —    | —   | yes  |

`runtime` defaults to `node`; `driver` is required. Engine/driver mismatches
fail before sqlc receives output files. Generated imports use bare package
names, including `@bonakodo/sqlite` and `mysql2/promise`. Put full Deno
specifiers and version pins in your application's `deno.json` `imports`, for
example:

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
drivers. Map `postgres-interval` there when using PostgreSQL intervals with
`pg`. Generated Node and Bun modules use `.ts` relative imports; use a runtime
that supports them, or TypeScript's `rewriteRelativeImportExtensions` when
emitting JavaScript. See the checked configuration in
`tests/integration/tsconfig.json`. The test and example import maps resolve
`@bonakodo/sqlite` to the published `jsr:@bonakodo/sqlite@0.1.0` package.
Generated code uses the bare package name so applications can supply their own
import map. Queries use `safeIntegers()`, `raw().get()`/`all()`, `run()` result
fields, and `Symbol.dispose` to release statements on success or failure. They
leave connection settings unchanged; JSON stays text or bytes without driver
parsing.

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
`GetAuthorArgs`, `GetAuthorRow`, and `getAuthor(database, args)`. Queries
without arguments omit `args`. Pass a driver connection, pool, or transaction
handle; the generated code does not open or close connections.

- Each SQL source produces a matching `*_sql.ts` module, retaining
  subdirectories.
- `models.ts` contains table interfaces.
- Catalog enums produce `enums.ts` with value arrays and their derived types.
- `index.ts` exports models, enums, and query namespaces.
- `query_helpers.ts` shares argument and row types, parameter encoders, row
  decoders, and field metadata across SQL modules. Query modules keep their
  public names and interfaces.
- `runtime_common.ts` contains helpers used across engines. A second file,
  `runtime_sqlite.ts`, `runtime_postgresql.ts`, or `runtime_mysql.ts`, contains
  the selected engine's conversions and driver connection types. Generation
  includes only the helpers and value kinds the queries need.
- `codec_error.ts` contains structured conversion errors without bound or stored
  values.
- Server-driver output includes `json.ts` with reusable JSON value types.
- Snake_case field names become camelCase; existing camelCase names retain their
  spelling in every driver. Unsafe names use quoted properties.
- Output order and names are stable. Generation does not change the request.

| Command       | Result                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:one`        | Row or `null`; server drivers require exactly one row, SQLite returns the first                                                                                           |
| `:many`       | Row array; no matches returns `[]`                                                                                                                                        |
| `:exec`       | `void`                                                                                                                                                                    |
| `:execlastid` | MySQL: `number`, `number \| string`, or `string` according to big-number options; Deno SQLite: `number` in driver mode, `bigint` in native mode; better-sqlite3: `bigint` |
| `:execrows`   | `bigint` count                                                                                                                                                            |
| `:execresult` | `{ rowsAffected: bigint; lastInsertId: bigint \| null }`; PostgreSQL insert ID is `null`                                                                                  |

Functions return promises except `@bonakodo/sqlite` functions, which run
synchronously. Native SQLite mode also makes better-sqlite3 functions
synchronous, so both can run inside synchronous transaction callbacks.
PostgreSQL rejects `:execlastid`; use `INSERT ... RETURNING` with `:one`. The
older better-sqlite3 generator rejected `:execlastid`; this plugin adds it with
a `bigint` result. Unsupported annotations produce errors.

The SQLite drivers use positional rows and checked conversions. Deno statements
are finalized in `finally`; better-sqlite3 owns statement disposal. Integer
reads use per-statement settings without changing the connection. MySQL uses its
promise `execute()` API to bind values safely, including SQL text containing
`?`. PostgreSQL keeps repeated parameters in one bind slot so server type
inference stays consistent. Compiler-marked SQLite/MySQL slices expand at
runtime; empty slices emit `NULL`. PostgreSQL arrays bind as one parameter; use
`ANY($1)` for array membership. PostgreSQL `sqlc.slice` produces a generation
error with this guidance instead of emitting a query that fails at runtime.

Set `emit_query_factory: true` to also bind queries to a connection once:

```ts
import { createQueries } from "./db/index.ts";

const queries = createQueries(database);
const author = queries.query.getAuthor({ id: 1n });

database.transaction(() => {
  const transactionQueries = createQueries(database);
  transactionQueries.query.renameAuthor({ id: 1n, name: "Ada" });
})();
```

Each root factory key comes from a SQL source path: `query.sql` becomes `query`,
and `billing/payments.sql` becomes `billingPayments`. A query module also
exports its own `createQueries(database)` factory, with a suffix if a query
already owns that name. Standalone functions keep their names and signatures.
Factories keep synchronous SQLite calls and asynchronous server calls unchanged;
they do not open, close, cache, or start transactions. Bind the transaction
handle supplied by your driver when it differs from the main connection.
`types_only` omits factories.

## Options and types

| Option                       | Default  | Effect                                                                                                      |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `runtime`                    | `node`   | `node`, `bun`, or `deno`                                                                                    |
| `driver`                     | required | Driver from the table above                                                                                 |
| `sqlite_type_mode`           | `driver` | Older plugin types, or `native` value conversions                                                           |
| `types_only`                 | `false`  | Models, query types, and enum value arrays; no SQL, functions, codecs, or runtime module                    |
| `emit_null_as_undefined`     | `false`  | Absent rows and nullable results use `undefined`; nullable args may be omitted                              |
| `optional_nullable_args`     | unset    | Controls nullable argument optionality independently; unset preserves `emit_null_as_undefined` behavior     |
| `emit_query_factory`         | `false`  | Add connection-bound factories to query modules and the index                                               |
| `emit_sql_as_const`          | `true`   | Export SQL constants; `false` keeps SQL private                                                             |
| `mysql2.support_big_numbers` | `false`  | BIGINT values can be `number \| string`                                                                     |
| `mysql2.big_number_strings`  | `false`  | With `support_big_numbers`, BIGINT values are always `string`                                               |
| `mysql2.insert_id_unsigned`  | unset    | `true` interprets insert IDs as unsigned; `false` as signed; unset rejects ambiguous negative packet values |
| `overrides`                  | `[]`     | Column/database type overrides with optional imports and codecs                                             |
| `type_mappings`              | `{}`     | Reusable named types/codecs or SQLite codec presets                                                         |
| `query_overrides`            | `[]`     | Types, codecs, and nullability for a named query's argument or result alias                                 |

Generated output omits boilerplate documentation and retains SQL, user comments,
types, and runtime checks.

MySQL big-number flags are set on each generated query. Its DECIMAL values
remain strings. PostgreSQL uses default driver parsers: int8/numeric are
strings, small integers and floats are numbers, timestamps are `Date`, binary
values are `Buffer`, and parsed JSON values use `JsonValue`. PostgreSQL array
element types follow the selected driver; pg's numeric array parser returns
numbers and can lose decimal precision. Enum labels become named string unions.
Raw enum/circle array text from pg is decoded when it has no registered array
parser. Box arrays retain their semicolon delimiter. For postgres.js queries
with array results, the generator reads raw cells so SQL NULL stays distinct
from the text "NULL"; scalar columns still use the driver's own parsers. Custom
driver parsers may need matching overrides and codecs.

MySQL insert IDs follow the same big-number type policy as BIGINT row fields.
With support enabled, large IDs remain exact strings. With support disabled, an
unsafe insert ID throws instead of returning a rounded number. This error occurs
**after the INSERT executes**; do not retry the insert just because the ID
conversion failed. Enable `support_big_numbers` before inserting large IDs.
mysql2 reports negative signed keys and unsigned insert IDs above `2^63 - 1`
using the same packet value. The wrappers reject that ambiguous value unless the
caller specifies `mysql2.insert_id_unsigned: true` for unsigned IDs or `false`
for signed IDs. This applies to `:execlastid` and `:execresult`; it does not
change database column types or driver connection settings. Use separate codegen
blocks when tables need different insert-ID policies.

`sqlite_type_mode: driver` keeps the older SQLite value rules with corrected
text types:

| Declared SQLite type | @bonakodo/sqlite   | better-sqlite3 |
| -------------------- | ------------------ | -------------- |
| Integer              | `number \| bigint` | `number`       |
| NUMERIC/DECIMAL      | `number \| bigint` | `any`          |
| REAL/float           | `number`           | `number`       |
| Boolean              | `number`           | `boolean`      |
| Date/time            | `string`           | `Date`         |
| BLOB                 | `Uint8Array`       | `Buffer`       |
| Text                 | `string`           | `string`       |

For the Deno driver, generated statements read integers as `bigint`, then driver
mode returns safe integers as `number` and larger integers as `bigint`. Native
mode keeps every integer as `bigint`.

The better-sqlite3 wrappers now actually convert booleans/dates and map
snake_case columns to the emitted camelCase properties. Other unknown SQLite
types remain `any` in driver mode. Missing rows and nullable values keep their
configured null policy. `number` integer and insert-ID APIs retain their usual
JavaScript precision limits; use native SQLite mode for exact signed 64-bit
data.

`sqlite_type_mode: native` uses the migrated native value contract for either
SQLite driver: integers are `bigint`, booleans are `boolean`, dates are `Date`,
REAL/NUMERIC values are finite `number`, blobs are `Uint8Array`, and JSON
remains raw UTF-8/SQLite bytes. Dates use UTC when stored text has no zone and
keep millisecond precision. Numeric timestamps need a codec. Codecs control
their own storage representation. Unknown SQLite types use `unknown` in native
mode.

### Enums

Catalog enums produce a readonly value array and a type derived from that array
in `enums.ts`:

```ts
export const StatusValues = ["active", "inactive"] as const;
export type Status = (typeof StatusValues)[number];
```

Import either export from `enums.ts` or `index.ts`. Models, query arguments, and
rows use the shared type; plain strings such as `"active"` remain valid.
Nullable fields and PostgreSQL arrays keep their existing null and array rules.
The array retains the database's label order. `as const` makes it readonly to
TypeScript; it does not freeze the array at runtime.

Enums outside the default schema include the schema in their names, such as
`ArchiveStatus`. Name clashes with models, helper types, or other enum exports
receive stable numeric suffixes. Existing model names stay unchanged.

All catalog enums appear, including enums unused by queries. `types_only` keeps
these static value arrays and derived types without database dependencies. Types
without catalog enum labels retain the driver's fallback type; this does not
infer enum labels from strings, CHECK constraints, or bare MySQL `enum`
metadata. Overrides still control field types and optional value conversions.

### JSON fields

The pg, postgres.js, and mysql2 drivers parse JSON into JavaScript values. Their
JSON/JSONB fields use exported recursive `JsonValue`, `JsonObject`, and
`JsonArray` types. `JsonValue` covers strings, numbers, booleans, objects,
arrays, and JSON null. It excludes functions, bigint, and other non-JSON values.
These types remain available in `types_only` output.

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

Built-in JSON bindings reject values that JSON cannot represent, including
nested undefined, bigint, functions, non-finite numbers, class instances, and
cycles. Built-in PostgreSQL JSON array bindings preserve the distinction between
an SQL array dimension and an array inside a JSON document. Custom codecs
instead return driver-ready values and remain responsible for their driver's
JSON binding rules; the runtime does not serialize their output a second time.

JSON null remains a valid value even in a `NOT NULL` JSON column. On nullable
columns, the server drivers return JavaScript `null` for both JSON null and SQL
NULL. With `emit_null_as_undefined`, the existing null policy maps that
ambiguous top-level value to `undefined`; nulls inside JSON arrays and objects
remain null.

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

Column selectors accept two to four parts and `*` wildcards. They take
precedence over database type selectors, which also match declared nullability.
An imported branded type can refine a default type. Changes of value
representation require a codec with `encode` and `decode` methods; parsed server
JSON also permits domain type overrides without a codec. The runtime handles
nullable values outside the codec; PostgreSQL array codecs apply to each
non-null element. Relative import paths resolve from the output directory and
rebase for nested query modules. The emitter validates type expressions and
escapes SQL, comments, property names, and module specifiers.

Use named mappings and `columns` to share conversions. Built-in presets require
SQLite native mode and do not infer storage formats from column names:

```yaml
options:
  runtime: deno
  driver: "@bonakodo/sqlite"
  sqlite_type_mode: native
  optional_nullable_args: true
  emit_query_factory: true
  type_mappings:
    timestamp: { preset: epoch_milliseconds }
    settings: { preset: json_text }
  overrides:
    - db_type: integer
      nullable_all: true
      preset: safe_integer
    - columns: ["authors.created_at", "records.expires_at"]
      mapping: timestamp
    - column: authors.active
      preset: sqlite_boolean
    - column: authors.settings
      mapping: settings
```

`safe_integer` maps SQLite integers to JavaScript numbers and rejects unsafe
values. `epoch_milliseconds` maps integer milliseconds to `Date`.
`sqlite_boolean` binds booleans and reads integer 0/1. `json_text` stores JSON
as text and returns parsed values. Its default static type is `unknown`; an
explicit `ts_type` describes an application contract, not runtime validation.
For validation, import `createJsonTextCodec` from the generated
`runtime_sqlite.ts`, export a codec made with `createJsonTextCodec(parse)` from
your own module, and reference that codec in your mapping. Its parser runs
on reads and writes and determines its TypeScript result. The runtime also
includes the preset codecs used by your mappings as `safeInteger`,
`epochMilliseconds`, `sqliteBoolean`, and `jsonText`. A `json_text` mapping also
retains `createJsonTextCodec`. External SQLite codec modules retain the public
preset helpers and factory, since the generator cannot inspect their imports.
Direct codec mappings to `./runtime_sqlite.ts` select the named helper.
The old `./runtime.ts` mapping path still resolves to the selected runtime.

Column overrides retain first-match precedence over database-type overrides.
`nullable_all: true` applies a database-type rule to both required and nullable
columns. It avoids duplicating an otherwise identical override. With
`optional_nullable_args: true`, omitted or `undefined` nullable inputs bind SQL
NULL while results still use `null` unless `emit_null_as_undefined` is enabled.
Omission binds NULL; it does not omit an INSERT column or invoke its SQL
default. Required JSON-text codecs encode JavaScript `null` as JSON text
`"null"`; nullable JSON-text arguments use `null` for SQL NULL.

### Query-specific types and nullability

sqlc analyzes SQL before the plugin runs. For a scalar subquery or aggregate
whose metadata needs correction, target the exact SQL query name and result
alias or parameter name:

```yaml
query_overrides:
  - query: GetLatestExpiry
    column: latestExpiry
    mapping: timestamp
    nullable: true
  - query: HasStarted
    parameter: nowMillis
    mapping: timestamp
    nullable: false
  - query: GetDisplayName
    column: displayName
    ts_type: string
    nullable: false
```

These settings override the query boundary without changing table model types or
mutating sqlc's request. An explicit primitive override for an unknown
expression selects its checked runtime conversion. Setting `nullable: false`
still rejects an actual SQL NULL for non-JSON values; it does not supply a
default. Server drivers cannot distinguish SQL NULL from JSON null in parsed
JSON results. A runtime type change otherwise needs a codec, as with schema
overrides. SQL parsing, missing table functions, and query analysis errors still
require support in sqlc itself.

### Conversion errors

Generated conversions throw `QueryCodecError`, a `TypeError` with `query`,
`file`, `field`, `expectedType`, and `phase` (`encode` or `decode`). Import it
from the generated index or `codec_error.ts`. Its message and public cause use
only static metadata. They exclude input and result values, including values
inside an error thrown by an application codec. `originalCause()` provides the
original exception for explicit local debugging; it may contain application
data. SQL constraint and driver errors propagate unchanged.

`expectedType` describes the generated type. Imported type aliases in that
string can change after regeneration; use the other fields to identify a
specific query or field.

## Migration

After regenerating, handle conversion failures through `QueryCodecError` fields
instead of matching old error messages or checking for `RangeError`. Direct
runtime calls without query context throw the underlying error types. Generated
bindings now reject missing required inputs; use `sqlc.narg` or a query override
when an argument should accept SQL NULL. The new factory, mapping, and
input-null options are opt-in. Output always omits boilerplate documentation.
Remove the `compact` key from existing configurations; the parser rejects it.

Generated runtime imports now use `runtime_common.ts` and the selected engine's
file. Update any application imports from `runtime.ts`, then remove that stale
file after regeneration. Query modules share private types and converters in
`query_helpers.ts`; keep that file with the rest of the generated output.

From the older TypeScript plugin, change the plugin WASM URL and keep your
runtime, driver, and mysql2 options. The default API follows that plugin. Output
text is not byte-compatible: this plugin adds shared models/runtime/index files,
corrects collisions and escaping, and rejects unsupported inputs instead of
silently omitting wrappers. Pg `time`/`timetz` use the strings its parser
returns; nullable PostgreSQL array elements are reflected in their types.
Existing camelCase properties now retain their spelling, better-sqlite3 text
fields use `string`, and parsed server JSON uses `JsonValue` in place of `any`.
MySQL callers that enable big-number support must handle string insert IDs.

From the native sqlc branch, move `gen.typescript.out` to `codegen.out` and the
remaining settings to `codegen.options`. Set `runtime: deno`,
`driver: @bonakodo/sqlite`, and `sqlite_type_mode: native` explicitly. Configure
the output path in `codegen.out`. No modified sqlc binary is needed.

The plugin consumes the analysis sqlc sends. It cannot add compiler features
that run before plugin dispatch. With stock sqlc, schema-only configuration,
sparse SQLite `?NNN` parameters, untyped parameters, and JSON table-function
analysis depend on the host's support. Stock sqlc may rewrite SQLite JSONB
projections to JSON text; the plugin cannot recover the original stored bytes
after that rewrite. A host that supplies richer protobuf metadata can include
table identities and correct nullability for embeds. For stock-sqlc embeds, the
plugin recovers nullability from ordinary base-table SELECT/join trees,
including aliases and outer joins. CTEs, derived tables, set operations, table
functions, and other complex forms retain conservative nullable fields when the
supplied metadata cannot prove a relation required.

From this project's earlier Go releases, keep the WASM URL shape and generator
options. Replace any `process` configuration with `wasm`. Applications that
called the Go library must invoke the WASI plugin through sqlc or a WASI host.
The fixed-memory plugin accepts requests up to 16 MiB, 65,536 protobuf records,
16,384 JSON tokens, 1,024 output files, and 16 MiB of combined file contents.
Work records must also fit the unused input region.

## Development

```sh
deno task tools        # install pinned assembler and optimizer
deno task build        # assemble and optimize the plugin
deno task check        # formatting, lint, types, build, and tests
deno task test         # Deno.test component, full-plugin, and adversarial suites
deno task integration # stock sqlc plus generated-code checks and runtime tests
deno task runtime      # build and test WASM-generated TypeScript support
deno task live         # PostgreSQL/MySQL tests after integration
```

Tests use `Deno.test` and checked-in reference fixtures. The WASM suites check
both direct assembly and optimized modules, parser boundaries, naming, types,
SQL bindings, driver output, and exact protobuf responses. The
[adversarial suite](tests/wasm/adversarial_test.ts) covers NUL bytes, malformed
Unicode, oversized requests, mutation cases, and WASI I/O faults. Workers let
the runner stop a module that loops forever.

The integration suite needs stock sqlc, Node, npm, Deno, and the WASM build
tools. Install the pinned sqlc binary without a compiler:

```sh
tools/setup-sqlc.sh
export PATH="$PWD/bin/.tools/sqlc-1.31.1:$PATH"
deno task integration
```

The installer supports macOS and Linux on arm64 and amd64, verifies the official
release archive checksum, and writes only to `bin/.tools`. The scripts also
accept `SQLC=/absolute/path/to/sqlc`.

Integration checks real sqlc output for supported drivers and options, checks
generated TypeScript against pinned package declarations, and runs queries under
Deno, Node, and Bun. Test dependencies, including Bun and TypeScript, live in
`tests/integration/package.json` and its lockfile. They take no part in the
plugin build. See [integration tests](tests/integration/README.md).

`deno task live` uses dedicated PostgreSQL and MySQL test databases and creates
and drops fixture tables. Set `SQLC_LIVE_PG_URL` and `SQLC_LIVE_MYSQL_URL`, or
use the local `sqlc_test` defaults in `tests/integration/server_live_test.ts`.
The script starts no database services. CI supplies PostgreSQL 17 and MySQL 8.4
and checks JSON, arrays, geometry, binding, CRUD, transactions, and BIGINT. The
[Deno SQLite example](examples/deno-sqlite/README.md) also regenerates and runs
in CI.

| Directory            | Contents                                                            |
| -------------------- | ------------------------------------------------------------------- |
| `src/`               | WAT modules, constant strings, Unicode and inflection tables        |
| `src/templates/`     | Common and engine runtimes, JSON types, and codec errors            |
| `tools/`             | Pinned tool setup, assembly, data packing, and test commands        |
| `tests/wasm/`        | Deno component and full-plugin tests, fixtures, and WASI host       |
| `tests/tools/`       | Tests for Deno data encoders and packers                            |
| `tests/runtime/`     | Tests for generated TypeScript support code                         |
| `tests/integration/` | Stock-sqlc and Node/Bun/Deno checks, test dependencies              |
| `tests/fixtures/`    | SQL fixtures and stock-sqlc metadata                                |
| `examples/`          | Applications using the released or locally built WASI plugin        |
| `bin/`               | Ignored build output and local tools                                |

To publish a release, push a new `v*` tag, such as `v1.2.3`. The workflow
checks, builds, and tests the WASM, then checks generated example files with
stock sqlc. It publishes `sqlc-gen-typescript-native.wasm`, its `.wasm.sha256`
file, and release notes with a pinned config. Tags containing a hyphen, such as
`v1.2.3-rc.1`, produce prereleases. Use a new tag for each release so published
URLs and checksums stay valid.

The generator uses the MIT license. Adapted emitter logic and third-party data
retain their original notices and license texts in [NOTICE](NOTICE).
