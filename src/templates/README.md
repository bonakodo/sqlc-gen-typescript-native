# Generated TypeScript support

These files supply `runtime.ts`, `json.ts`, and `codec_error.ts` in generated
applications. They are static UTF-8 data inside the WASM plugin. The plugin
copies selected bytes into its response; it does not execute TypeScript.

[runtime.ts](runtime.ts) holds the shared imports, codec exports, and JSON
validation once. Its marked sections retain each driver's value contract:

| Section          | Drivers                              | Contents                                                                            |
| ---------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| Unmarked text    | All                                  | Shared codec exports and JSON validation                                            |
| `sqlite`         | `@bonakodo/sqlite`, `better-sqlite3` | SQLite values, dates, JSON text, and custom codecs                                  |
| `bonakodo`       | `@bonakodo/sqlite`                   | Insert-ID lookup with statement disposal                                            |
| `better-sqlite3` | `better-sqlite3`                     | Insert-ID lookup with the driver's statement API                                    |
| `server`         | `pg`, `postgres`, `mysql2`           | Driver values, arrays, geometry, JSON bindings, result counts, and MySQL insert IDs |

Mark a section with `// @if <section>` and close it with `// @endif` on their
own lines. Sections cannot nest. [assets.ts](../../tools/assets.ts) checks
marker names and pairing at build time, then records each text span's driver
mask, byte pointer, and length. Unmarked text applies to every driver. The
markers do not appear in generated files.

[runtime.wat](../runtime.wat) emits the selected driver's imports and JSON
binding setting, then walks those descriptors and copies matching spans. It
performs no text search or replacement. The output remains one `runtime.ts`
file, containing shared helpers and the selected driver's sections.

[json.ts](json.ts) and [codec_error.ts](codec_error.ts) supply shared JSON types
and codec errors. The combined runtime template is not an importable test
module: its alternatives declare different types and functions with the same
names. [Runtime tests](../../tests/runtime) therefore use support modules
created by the actual WASM generator. `deno task runtime` builds the plugin,
generates SQLite, pg, and postgres.js modules into the ignored
`tests/runtime/.generated/` directory, and runs Deno tests against them. It
needs no sqlc executable. Integration tests also generate complete projects with
stock sqlc and run their queries with each driver.
