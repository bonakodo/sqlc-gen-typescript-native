;; WASI provides argv as bytes. These imports must precede core.wat because
;; WebAssembly requires all imports before the first memory/data definition.
(import "wasi_snapshot_preview1" "args_sizes_get"
  (func $wasi_args_sizes_get (param i32 i32) (result i32)))
(import "wasi_snapshot_preview1" "args_get"
  (func $wasi_args_get (param i32 i32) (result i32)))
