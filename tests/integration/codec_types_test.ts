import { command } from "../wasm/test_helpers.ts";
import { tsc, typecheckArgs } from "./generation_helpers.ts";
import { test } from "node:test";
import { writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { join } from "node:path";
import { generate, type Options, output, root } from "./generation_helpers.ts";

// Write-only queries have no result decoder to expose a codec/type mismatch.
test("generated write-only queries reject mismatched codec types", async (t) => {
  for (const preset of [false, true]) {
    await t.test(preset ? "preset alias" : "custom codec", async () => {
      const directory = join(
        output,
        "negative-codecs",
        preset ? "preset-alias" : "custom",
      );
      await mkdir(directory, { recursive: true });
      for (const [name, source] of Object.entries({
        "schema.sql": "CREATE TABLE entries (value INTEGER NOT NULL);",
        "query.sql":
          "-- name: StoreValue :exec\nINSERT INTO entries (value) VALUES (sqlc.arg('value'));",
        "codecs.ts":
          "export type WrongType = string;\nexport const integerCodec = { encode(value: number): bigint { return BigInt(value); }, decode(value: unknown): number { return Number(value); } };",
      }))
        await writeFile(join(directory, name), source);
      const override: Options = preset
        ? {
            column: "entries.value",
            preset: "safe_integer",
            ts_type: "WrongType",
            import: { path: "../codecs.ts", name: "WrongType" },
          }
        : {
            column: "entries.value",
            ts_type: "string",
            codec: { path: "../codecs.ts", name: "integerCodec" },
          };
      await generate(directory, [
        {
          engine: "sqlite",
          schema: "schema.sql",
          queries: "query.sql",
          codegen: [
            {
              plugin: "wasm",
              out: "db",
              options: {
                runtime: "node",
                driver: "node:sqlite",
                overrides: [override],
              },
            },
          ],
        },
      ]);
      const result = await command(
        process.execPath,
        [tsc, ...typecheckArgs, join(directory, "db/query_sql.ts")],
        { cwd: root },
      );
      assert.notEqual(
        result.status,
        0,
        "accepted contradictory codec and argument types",
      );
      const diagnostic = result.stdout + result.stderr;
      assert.match(
        diagnostic,
        /not assignable|does not satisfy the constraint/,
        diagnostic,
      );
    });
  }
});
