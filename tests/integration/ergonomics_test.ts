import assert from "node:assert/strict";
import { Database } from "@bonakodo/sqlite";
import { createQueries } from "./.generated/ergonomics-db-sqlite/wasm/index.ts";
import { QueryCodecError } from "./.generated/ergonomics-db-sqlite/wasm/codec_error.ts";

const schema = await Deno.readTextFile(
  new URL(
    "../fixtures/ergonomics/schema.sql",
    import.meta.url,
  ),
);

Deno.test("bound queries preserve codecs, optional inputs, SQL null, and transaction scope", () => {
  using database = new Database(":memory:");
  database.exec(schema);
  const queries = createQueries(database).query;
  assert.equal(queries.getAuthor({ id: 1 }), null);
  const createdAt = new Date("2026-09-08T01:02:03.456Z");
  const settings = { enabled: true, names: ["Ada", "Grace"], optional: null };
  const author = queries.createAuthor({
    id: 1,
    name: "Ada",
    createdAt,
    active: true,
    settings,
  });
  assert.deepEqual(author, {
    id: 1,
    name: "Ada",
    createdAt,
    active: true,
    notes: null,
    settings,
  });
  assert.equal(author?.createdAt.getTime(), createdAt.getTime());
  assert.deepEqual(queries.getLatestExpiry({ authorId: 1 }), {
    latestExpiry: null,
  });
  assert.deepEqual(queries.getDisplayName({ id: 999 }), { displayName: "" });
  assert.deepEqual(queries.hasStarted({ id: 1, nowMillis: createdAt }), {
    started: true,
  });
  assert.deepEqual(
    queries.hasStarted({ id: 1, nowMillis: new Date(createdAt.getTime() - 1) }),
    { started: false },
  );
  assert.deepEqual(queries.findAuthors({ ids: [] }), []);
  assert.deepEqual(queries.findAuthors({ ids: [1] }), [author]);

  const expiresAt = new Date(createdAt.getTime() + 1_000);
  using insertRecord = database.prepare("INSERT INTO records VALUES (?, ?, ?)");
  insertRecord.run(1, 1, expiresAt.getTime());
  assert.deepEqual(queries.getLatestExpiry({ authorId: 1 }), {
    latestExpiry: expiresAt,
  });
  assert.throws(
    database.transaction(() => {
      const transactionQueries = createQueries(database).query;
      transactionQueries.createAuthor({
        id: 2,
        name: "rollback",
        createdAt,
        active: false,
        settings: null,
        notes: undefined,
      });
      throw new Error("rollback");
    }),
    /rollback/,
  );
  assert.equal(queries.getAuthor({ id: 2 }), null);
  assert.equal(queries.listAuthors().length, 1);

  // Numeric storage stays numeric even though the application receives Date/boolean.
  using stored = database.prepare(
    "SELECT typeof(created_at) AS timestamp_type, active, typeof(settings) AS json_type FROM authors WHERE id = 1",
  );
  assert.deepEqual(stored.get(), {
    timestamp_type: "integer",
    active: 1,
    json_type: "text",
  });
});

Deno.test("query errors identify fields without exposing values and preserve driver errors", () => {
  using database = new Database(":memory:");
  database.exec(schema);
  const queries = createQueries(database).query;
  const input = {
    id: 1,
    name: "private-name",
    createdAt: new Date(0),
    active: true,
    settings: { private: "private-value" },
  };
  queries.createAuthor(input);
  assert.throws(() => queries.createAuthor(input), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!(error instanceof QueryCodecError));
    return /UNIQUE/.test(error.message);
  });
  using corrupt = database.prepare(
    "UPDATE authors SET created_at = ? WHERE id = 1",
  );
  corrupt.run("private-invalid-timestamp");
  assert.throws(() => queries.getAuthor({ id: 1 }), (error: unknown) => {
    assert.ok(error instanceof QueryCodecError);
    const printable = `${String(error)} ${Deno.inspect(error)} ${
      JSON.stringify(error)
    }`;
    assert.match(printable, /GetAuthor/);
    assert.match(printable, /createdAt/);
    assert.ok(!printable.includes("private-invalid-timestamp"));
    return true;
  });
  assert.throws(
    () => queries.getAuthor({ id: Number.MAX_SAFE_INTEGER + 1 }),
    QueryCodecError,
  );
});
