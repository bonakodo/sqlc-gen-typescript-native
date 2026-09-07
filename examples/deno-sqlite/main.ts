import { Database } from "@bonakodo/sqlite";
import { createAuthor, deleteAuthor, listAuthors } from "./db/query_sql.ts";

const database = new Database(":memory:");
try {
  database.exec(
    await Deno.readTextFile(new URL("./schema.sql", import.meta.url)),
  );
  database.transaction(() => {
    createAuthor(database, { id: 1n, name: "Ada", bio: null });
    createAuthor(database, {
      id: 9_007_199_254_740_993n,
      name: "Grace",
      bio: "Large integer keys stay exact.",
    });
  })();
  console.log(listAuthors(database));
  console.log("Deleted:", deleteAuthor(database, { id: 1n }));
} finally {
  database.close();
}
