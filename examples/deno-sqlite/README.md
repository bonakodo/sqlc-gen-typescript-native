# Deno and SQLite

This example uses the WASI plugin with stock sqlc. It opts into native SQLite
conversions, including exact `bigint` keys. The default `driver` type mode follows
the older plugin's types instead.

From the repository root:

```sh
export DENO_SQLITE_PATH="$(brew --prefix sqlite)/lib/libsqlite3.dylib"
make wasm
cd examples/deno-sqlite
deno task generate
deno task check
deno task start
```

The local development config omits a checksum so each build can run. For a
released plugin, set both its download URL and published SHA-256 in `sqlc.yaml`.
Only generation needs sqlc and the Go-built WASM file. Running the generated
TypeScript needs Deno and `@bonakodo/sqlite`. `deno.json` maps that import to the
published `jsr:@bonakodo/sqlite@0.1.0` package. Set `DENO_SQLITE_PATH` to the
absolute path of an installed SQLite shared library. The path above uses
Homebrew SQLite on macOS; Linux and Windows need their `.so` or `.dll` path.
