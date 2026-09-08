import { join } from "node:path";
import { generate, type Options, output } from "./generation_helpers.ts";

Deno.test("stock sqlc generates live PostgreSQL and MySQL fixtures", async () => {
  const variants: [string, string, Options?][] = [
    ["pg", "pg"],
    ["postgres", "postgres"],
    ["mysql2", "mysql2"],
    ["mysql2-mixed", "mysql2", {
      support_big_numbers: true,
      big_number_strings: false,
    }],
    ["mysql2-strings", "mysql2", {
      support_big_numbers: true,
      big_number_strings: true,
    }],
    ["mysql2-signed", "mysql2", {
      support_big_numbers: true,
      big_number_strings: true,
      insert_id_unsigned: false,
    }],
    ["mysql2-unsigned", "mysql2", {
      support_big_numbers: true,
      big_number_strings: true,
      insert_id_unsigned: true,
    }],
  ];
  await generate(
    join(output, "live"),
    variants.map(([name, driver, mysql2]) => {
      const engine = driver === "mysql2" ? "mysql" : "postgresql";
      const options: Options = { driver, runtime: "node" };
      if (mysql2) options.mysql2 = mysql2;
      return {
        engine,
        schema: join("../../live", engine, "schema.sql"),
        queries: join("../../live", engine, "query.sql"),
        codegen: [{ plugin: "wasm", out: name, options }],
      };
    }),
  );
});
