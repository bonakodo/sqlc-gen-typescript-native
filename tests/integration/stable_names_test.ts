import assert from "node:assert/strict";
import { join } from "node:path";
import { compareBuilds, generate, output } from "./generation_helpers.ts";

function declarations(source: string): Map<string, string> {
  return new Map(
    Array.from(
      source.matchAll(
        /^export (?:interface|function|const) ([\p{ID_Continue}$]+)[\s\S]*?(?=^export |$(?![\s\S]))/gmu,
      ),
      (match) => [match[1]!, match[0].trim()],
    ),
  );
}

Deno.test("shared helper names survive new and reordered queries", async () => {
  const directory = join(output, "stable-helper-names");
  await Deno.remove(directory, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  await Deno.mkdir(join(directory, "queries"), { recursive: true });
  await Deno.writeTextFile(
    join(directory, "schema.sql"),
    'CREATE TABLE entries (id INTEGER NOT NULL, "a.b" TEXT, a_b TEXT, notes TEXT);',
  );
  const read = (name: string) =>
    `-- name: ${name} :one\nSELECT id, "a.b", a_b FROM entries WHERE id = sqlc.arg('id');\n`;
  await Deno.writeTextFile(
    join(directory, "queries/middle.sql"),
    read("ReadEntry") + read("ReadAgain"),
  );
  await Deno.writeTextFile(
    join(directory, "queries/collision.sql"),
    // These field names have equal 32-bit metadata hashes. A hash must never
    // substitute for full field/shape equality.
    '-- name: ReadHashCollision :one\nSELECT id AS "collisionFieldAA366f8713", id AS "collisionFieldAA7556c58a" FROM entries;\n',
  );
  await Deno.writeTextFile(
    join(directory, "queries/last.sql"),
    "-- name: ReadNotes :many\nSELECT notes FROM entries WHERE notes = sqlc.narg('notes');\n",
  );
  const regenerate = async () => {
    await generate(directory, [{
      engine: "sqlite",
      schema: "schema.sql",
      queries: "queries",
      codegen: ["wasm", "raw"].map((plugin) => ({
        plugin,
        out: plugin,
        options: {
          runtime: "deno",
          driver: "@bonakodo/sqlite",
          sqlite_type_mode: "native",
          optional_nullable_args: true,
        },
      })),
    }]);
    return await compareBuilds(directory);
  };
  const before = await regenerate();
  const helpers = declarations(before["query_helpers.ts"]!);
  assert(helpers.size > 0);
  await Deno.writeTextFile(
    join(directory, "queries/first.sql"),
    // Both a new shape and an earlier occurrence of an existing shape must
    // leave existing callers, field metadata, and shared declarations intact.
    "-- name: AnUnrelatedQuery :one\nSELECT notes, id FROM entries WHERE notes = sqlc.arg('notes');\n" +
      read("AnEarlierMatchingQuery"),
  );
  const after = await regenerate();
  for (const filename of ["middle_sql.ts", "last_sql.ts"]) {
    assert.equal(after[filename], before[filename], `${filename} changed`);
  }
  const laterHelpers = declarations(after["query_helpers.ts"]!);
  for (const [name, declaration] of helpers) {
    assert.equal(laterHelpers.get(name), declaration, `${name} changed`);
  }
  // Reorder the source without changing query names or shapes.
  await Deno.writeTextFile(
    join(directory, "queries/middle.sql"),
    read("ReadAgain") + read("ReadEntry"),
  );
  assert.deepEqual(await regenerate(), after);
  assert.match(before["middle_sql.ts"]!, /export function readEntry\(/);
  assert.match(before["middle_sql.ts"]!, /export function readAgain\(/);
  const names = [...helpers.keys()];
  assert(names.some((name) => /^bind[\w$]{1,6}$/.test(name)));
  assert(names.some((name) => /^read[\w$]{1,6}$/.test(name)));
  assert(
    names.every((name) =>
      /^(?:Args|Row|bind|read|f)[\w$]{1,6}(?:_2)?$/.test(name)
    ),
  );
  // The complete 32-bit hash fits into six valid identifier characters.
  const collision = "f1uKjGq";
  assert.equal(
    helpers.get(collision),
    `export const ${collision} = ["collisionFieldAA366f8713", "bigint"] as const;`,
  );
  assert.equal(
    helpers.get(`${collision}_2`),
    `export const ${collision}_2 = ["collisionFieldAA7556c58a", "bigint"] as const;`,
  );
});
