// Run the release Wasm directly so tests can send malformed protocol bytes.
import { readFile } from 'node:fs/promises';
import { WASI } from 'node:wasi';

const [path, ...args] = process.argv.slice(2);
const wasi = new WASI({ version: 'preview1', args: [path, ...args], returnOnExit: true });
const module = await WebAssembly.compile(await readFile(path));
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
process.exitCode = wasi.start(instance) ?? 0;
