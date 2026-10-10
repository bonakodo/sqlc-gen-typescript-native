import assert from "node:assert/strict";
import { test } from "node:test";
import { command } from "../wasm/test_helpers.ts";

test("subprocess helper preserves output, exit status, and environment", async () => {
  const result = await command(
    process.execPath,
    [
      "-e",
      `
    process.stdout.write(process.env.SQLC_COMMAND_TEST);
    process.stderr.write("rejected");
    process.exitCode = 2;
  `,
    ],
    { env: { SQLC_COMMAND_TEST: "猫" }, encoding: null },
  );
  assert.equal(result.status, 2);
  assert.deepEqual(result.stdout, Buffer.from("猫"));
  assert.deepEqual(result.stderr, Buffer.from("rejected"));
});

test("subprocess helper retains diagnostics when the child closes stdin early", async () => {
  const result = await command(
    process.execPath,
    [
      "-e",
      `
    process.stderr.write("unsupported method");
    process.exit(2);
  `,
    ],
    { input: Buffer.alloc(16 * 1024 * 1024) },
  );
  assert.equal(result.status, 2);
  assert.equal(result.stderr, "unsupported method");
});

test("subprocess helper kills stalled children and reports spawn failures", async () => {
  await assert.rejects(
    command(process.execPath, ["-e", "while (true) {}"], { timeout: 100 }),
    /terminated by SIGKILL/,
  );
  await assert.rejects(command("sqlc-test-command-that-does-not-exist", []), {
    code: "ENOENT",
  });
});
