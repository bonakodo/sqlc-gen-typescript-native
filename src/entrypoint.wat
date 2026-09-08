;; One WASI invocation handles one request and returns one GenerateResponse.
;; Startup first checks the optional RPC method, exactly as the native plugin
;; checks os.Args[1]. Further arguments are ignored. Only one leading slash is
;; removed, so //plugin.CodegenService/Generate remains an unknown method.
;;
;; Arg count/size use 16384..16392. The argv pointer table and NUL-terminated
;; strings temporarily occupy the request region at32MiB. Once the method has
;; been checked, no argument pointer remains live. read_input overwrites those
;; bytes with protobuf input. This avoids a separate argument allocation or a
;; small argument-only buffer cap. Both phases use the same16MiB fixed capacity.
(data (i32.const 16400) "plugin.CodegenService/Generate")
(data (i32.const 16440) "unknown method %s")
(data (i32.const 16480) "arguments read failed")

(func $check_method
  (local $argc i32) (local $size i32) (local $strings i32) (local $end i32)
  (local $original i32) (local $p i32) (local $n i32) (local $method i32) (local $method_n i32)
  (if (call $wasi_args_sizes_get (i32.const 16384) (i32.const 16388))
    (then (call $error (i32.const 16480) (i32.const 21))))
  (local.set $argc (i32.load (i32.const 16384)))
  ;; argc includes the executable name; zero or one means no method argument.
  (if (i32.le_u (local.get $argc) (i32.const 1)) (then (return)))
  (local.set $size (i32.load (i32.const 16388)))
  (if (i32.gt_u (local.get $argc) (i32.const 4194304)) (then (call $fail (i32.const 2))))
  (local.set $strings (i32.shl (local.get $argc) (i32.const 2)))
  (if (i32.gt_u (local.get $size) (i32.sub (i32.const 16777216) (local.get $strings))) (then (call $fail (i32.const 2))))
  (local.set $strings (i32.add (i32.const 33554432) (local.get $strings)))
  (local.set $end (i32.add (local.get $strings) (local.get $size)))
  (if (call $wasi_args_get (i32.const 33554432) (local.get $strings))
    (then (call $error (i32.const 16480) (i32.const 21))))
  (local.set $original (i32.load (i32.const 33554436)))
  (if (i32.or (i32.lt_u (local.get $original) (local.get $strings)) (i32.ge_u (local.get $original) (local.get $end)))
    (then (call $error (i32.const 16480) (i32.const 21))))
  (local.set $p (local.get $original))
  (block $terminated (loop $bytes
    (if (i32.ge_u (local.get $p) (local.get $end))
      (then (call $error (i32.const 16480) (i32.const 21))))
    (br_if $terminated (i32.eqz (i32.load8_u (local.get $p))))
    (local.set $p (i32.add (local.get $p) (i32.const 1))) (br $bytes)))
  (local.set $n (i32.sub (local.get $p) (local.get $original)))
  (local.set $method (local.get $original)) (local.set $method_n (local.get $n))
  (if (i32.and (i32.ne (local.get $n) (i32.const 0)) (i32.eq (i32.load8_u (local.get $method)) (i32.const 47)))
    (then (local.set $method (i32.add (local.get $method) (i32.const 1))) (local.set $method_n (i32.sub (local.get $method_n) (i32.const 1)))))
  (if (i32.eqz (call $eq (local.get $method) (local.get $method_n) (i32.const 16400) (i32.const 30)))
    (then (call $error (call $fmt1 (i32.const 16440) (i32.const 17) (call $go_quote (local.get $original) (local.get $n)))))))

(func (export "_start") (local $request i32)
  (call $init_data)
  (call $check_method)
  (local.set $request (call $pb_parse (i32.const 33554432) (call $read_input)))
  (call $work_init)
  (call $generate (local.get $request))
  (call $response_write))
