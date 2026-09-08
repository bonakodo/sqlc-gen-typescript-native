;; This file is a module-body fragment. It is hand-written WAT, not the output
;; of a Go, C, Rust, or other language compiler.
;;
;; A fixed table replaces the usual tree of separately allocated messages.
;; Records hold indexes/addresses into the one linear memory. No record owns a
;; heap allocation, and there is no free list. One invocation fills the table
;; once; the host discards the complete instance after it exits.
(global $pb_count (mut i32) (i32.const 0))
(global $pb_text (mut i32) (i32.const 33554432))

(func $slot (param $r i32) (param $f i32) (result i32)
  (i32.add (local.get $r) (i32.add (i32.const 32) (i32.mul (local.get $f) (i32.const 12)))))
(func $child (param $r i32) (param $f i32) (result i32)
  (if (result i32) (local.get $r)
    (then (i32.load (call $slot (local.get $r) (local.get $f)))) (else (i32.const 0))))
(func $text_ptr (param $r i32) (param $f i32) (result i32)
  (call $child (local.get $r) (local.get $f)))
(func $text_len (param $r i32) (param $f i32) (result i32)
  (if (result i32) (local.get $r)
    (then (i32.load offset=4 (call $slot (local.get $r) (local.get $f)))) (else (i32.const 0))))
(func $text (param $r i32) (param $f i32) (result i32 i32)
  (call $text_ptr (local.get $r) (local.get $f)) (call $text_len (local.get $r) (local.get $f)))
(func $number (param $r i32) (param $f i32) (result i32)
  (call $child (local.get $r) (local.get $f)))
(func $present (param $r i32) (param $f i32) (result i32)
  (if (result i32) (local.get $r)
    (then (i32.load offset=8 (call $slot (local.get $r) (local.get $f)))) (else (i32.const 0))))
(func $next (param $r i32) (result i32)
  (if (result i32) (local.get $r)
    (then (i32.load offset=4 (local.get $r))) (else (i32.const 0))))

(func $pb_record (param $type i32) (result i32) (local $r i32)
  ;; Check BEFORE multiplying or writing. 65,536 * 256 exactly fills the table.
  (if (i32.ge_u (global.get $pb_count) (i32.const 65536)) (then (call $fail (i32.const 13))))
  (local.set $r (i32.add (i32.const 4194304) (i32.shl (global.get $pb_count) (i32.const 8))))
  (global.set $pb_count (i32.add (global.get $pb_count) (i32.const 1)))
  (memory.fill (local.get $r) (i32.const 0) (i32.const 256))
  (i32.store (local.get $r) (local.get $type))
  (local.get $r))

(func $pb_link (param $s i32) (param $r i32) (local $last i32)
  (local.set $last (i32.load offset=4 (local.get $s)))
  (if (local.get $last)
    (then (i32.store offset=4 (local.get $last) (local.get $r)))
    (else (i32.store (local.get $s) (local.get $r))))
  (i32.store offset=4 (local.get $s) (local.get $r))
  (i32.store offset=8 (local.get $s) (i32.add (i32.load offset=8 (local.get $s)) (i32.const 1))))

;; Descriptor low byte: 1 string, 2 bytes, 3 bool, 4 int32,
;; 5 singular message, 6 repeated string, 7 repeated message.
;; The upper byte supplies the child schema type for message fields.
;; Unknown field numbers return zero. These cases mirror codegen.proto directly.
(func $pb_descriptor (param $t i32) (param $f i32) (result i32)
  (if (i32.eq (local.get $t) (i32.const 1)) (then
    (if (i32.eq (local.get $f) (i32.const 1)) (then (return (i32.const 1))))
    (if (i32.eq (local.get $f) (i32.const 2)) (then (return (i32.const 2))))))
  (if (i32.eq (local.get $t) (i32.const 2)) (then
    (if (i32.le_u (i32.sub (local.get $f) (i32.const 1)) (i32.const 1)) (then (return (i32.const 1))))
    (if (i32.le_u (i32.sub (local.get $f) (i32.const 3)) (i32.const 1)) (then (return (i32.const 6))))
    (if (i32.eq (local.get $f) (i32.const 12)) (then (return (i32.const 773))))))
  (if (i32.eq (local.get $t) (i32.const 3)) (then
    (if (i32.le_u (i32.sub (local.get $f) (i32.const 1)) (i32.const 1)) (then (return (i32.const 1))))
    (if (i32.eq (local.get $f) (i32.const 3)) (then (return (i32.const 2))))
    (if (i32.eq (local.get $f) (i32.const 4)) (then (return (i32.const 6))))
    (if (i32.eq (local.get $f) (i32.const 5)) (then (return (i32.const 1029))))
    (if (i32.eq (local.get $f) (i32.const 6)) (then (return (i32.const 1285))))))
  (if (i32.eq (local.get $t) (i32.const 4)) (then
    (if (i32.eq (local.get $f) (i32.const 1)) (then (return (i32.const 1))))))
  (if (i32.eq (local.get $t) (i32.const 5)) (then
    (if (i32.le_u (i32.sub (local.get $f) (i32.const 1)) (i32.const 1)) (then (return (i32.const 1))))))
  (if (i32.eq (local.get $t) (i32.const 6)) (then
    (if (i32.le_u (i32.sub (local.get $f) (i32.const 1)) (i32.const 2)) (then (return (i32.const 1))))
    (if (i32.eq (local.get $f) (i32.const 4)) (then (return (i32.const 1799))))))
  (if (i32.eq (local.get $t) (i32.const 7)) (then
    (if (i32.le_u (i32.sub (local.get $f) (i32.const 1)) (i32.const 1)) (then (return (i32.const 1))))
    (if (i32.eq (local.get $f) (i32.const 3)) (then (return (i32.const 2567))))
    (if (i32.eq (local.get $f) (i32.const 4)) (then (return (i32.const 2311))))
    (if (i32.eq (local.get $f) (i32.const 5)) (then (return (i32.const 2055))))))
  (if (i32.eq (local.get $t) (i32.const 8)) (then
    (if (i32.le_u (i32.sub (local.get $f) (i32.const 1)) (i32.const 1)) (then (return (i32.const 1))))))
  (if (i32.eq (local.get $t) (i32.const 9)) (then
    (if (i32.or (i32.eq (local.get $f) (i32.const 1)) (i32.eq (local.get $f) (i32.const 3))) (then (return (i32.const 1))))
    (if (i32.eq (local.get $f) (i32.const 2)) (then (return (i32.const 6))))))
  (if (i32.eq (local.get $t) (i32.const 10)) (then
    (if (i32.eq (local.get $f) (i32.const 1)) (then (return (i32.const 2821))))
    (if (i32.eq (local.get $f) (i32.const 2)) (then (return (i32.const 3079))))
    (if (i32.eq (local.get $f) (i32.const 3)) (then (return (i32.const 1))))))
  (if (i32.eq (local.get $t) (i32.const 11)) (then
    (if (i32.le_u (i32.sub (local.get $f) (i32.const 1)) (i32.const 2)) (then (return (i32.const 1))))))
  (if (i32.eq (local.get $t) (i32.const 12)) (then
    (if (i32.or (i32.or (i32.eq (local.get $f) (i32.const 1)) (i32.eq (local.get $f) (i32.const 5)))
                (i32.or (i32.or (i32.eq (local.get $f) (i32.const 9)) (i32.eq (local.get $f) (i32.const 11)))
                        (i32.eq (local.get $f) (i32.const 15)))) (then (return (i32.const 1))))
    (if (i32.or (i32.or (i32.eq (local.get $f) (i32.const 3)) (i32.eq (local.get $f) (i32.const 4)))
                (i32.or (i32.or (i32.eq (local.get $f) (i32.const 7)) (i32.eq (local.get $f) (i32.const 8)))
                        (i32.or (i32.eq (local.get $f) (i32.const 13)) (i32.eq (local.get $f) (i32.const 16))))) (then (return (i32.const 3))))
    (if (i32.or (i32.eq (local.get $f) (i32.const 6)) (i32.eq (local.get $f) (i32.const 17))) (then (return (i32.const 4))))
    (if (i32.or (i32.or (i32.eq (local.get $f) (i32.const 10)) (i32.eq (local.get $f) (i32.const 12)))
                (i32.eq (local.get $f) (i32.const 14))) (then (return (i32.const 2821))))))
  (if (i32.eq (local.get $t) (i32.const 13)) (then
    (if (i32.or (i32.le_u (i32.sub (local.get $f) (i32.const 1)) (i32.const 2))
                (i32.eq (local.get $f) (i32.const 7))) (then (return (i32.const 1))))
    (if (i32.eq (local.get $f) (i32.const 4)) (then (return (i32.const 3079))))
    (if (i32.eq (local.get $f) (i32.const 5)) (then (return (i32.const 3591))))
    (if (i32.eq (local.get $f) (i32.const 6)) (then (return (i32.const 6))))
    (if (i32.eq (local.get $f) (i32.const 8)) (then (return (i32.const 2821))))))
  (if (i32.eq (local.get $t) (i32.const 14)) (then
    (if (i32.eq (local.get $f) (i32.const 1)) (then (return (i32.const 4))))
    (if (i32.eq (local.get $f) (i32.const 2)) (then (return (i32.const 3077))))))
  (if (i32.eq (local.get $t) (i32.const 15)) (then
    (if (i32.eq (local.get $f) (i32.const 1)) (then (return (i32.const 517))))
    (if (i32.eq (local.get $f) (i32.const 2)) (then (return (i32.const 1541))))
    (if (i32.eq (local.get $f) (i32.const 3)) (then (return (i32.const 3335))))
    (if (i32.eq (local.get $f) (i32.const 4)) (then (return (i32.const 1))))
    (if (i32.le_u (i32.sub (local.get $f) (i32.const 5)) (i32.const 1)) (then (return (i32.const 2))))))
  (if (i32.eq (local.get $t) (i32.const 16)) (then
    (if (i32.eq (local.get $f) (i32.const 1)) (then (return (i32.const 263))))))
  (i32.const 0))

(func $pb_message (param $r i32) (param $p i32) (param $n i32) (param $depth i32)
  (local $end i32) (local $after i32) (local $f i32) (local $wire i32)
  (local $v i64) (local $text i32) (local $len i32) (local $d i32)
  (local $kind i32) (local $s i32) (local $c i32)
  (if (i32.ge_u (local.get $depth) (i32.const 100)) (then (call $fail (i32.const 18))))
  (local.set $end (i32.add (local.get $p) (local.get $n)))
  (block $done (loop $fields
    (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
    ;; Multi-value results arrive in declaration order; local.set consumes the
    ;; LAST value first. Save all six before calling a nested parser.
    (call $field_depth (local.get $p) (local.get $end) (i32.add (local.get $depth) (i32.const 1)))
    (local.set $len) (local.set $text) (local.set $v)
    (local.set $wire) (local.set $f) (local.set $after)
    (local.set $d (call $pb_descriptor (i32.load (local.get $r)) (local.get $f)))
    (local.set $kind (i32.and (local.get $d) (i32.const 255)))
    (block $unknown
      (br_if $unknown (i32.eqz (local.get $d)))
      ;; Known numbers with the wrong wire type are unknown protobuf fields.
      (if (i32.or (i32.eq (local.get $kind) (i32.const 3)) (i32.eq (local.get $kind) (i32.const 4)))
        (then (br_if $unknown (i32.ne (local.get $wire) (i32.const 0))))
        (else (br_if $unknown (i32.ne (local.get $wire) (i32.const 2)))))
      (local.set $s (call $slot (local.get $r) (local.get $f)))
      (if (i32.or (i32.eq (local.get $kind) (i32.const 3)) (i32.eq (local.get $kind) (i32.const 4)))
        (then
          (if (i32.eq (local.get $kind) (i32.const 3))
            (then (local.set $v (i64.extend_i32_u (i64.ne (local.get $v) (i64.const 0))))))
          (i64.store (local.get $s) (local.get $v))
          (i32.store offset=8 (local.get $s) (i32.const 1)))
        (else
          (if (i32.or (i32.eq (local.get $kind) (i32.const 5)) (i32.eq (local.get $kind) (i32.const 7)))
            (then
              (local.set $c (i32.load (local.get $s)))
              (if (i32.or (i32.eqz (local.get $c)) (i32.eq (local.get $kind) (i32.const 7)))
                (then
                  (local.set $c (call $pb_record (i32.shr_u (local.get $d) (i32.const 8))))
                  (if (i32.eq (local.get $kind) (i32.const 7))
                    (then (call $pb_link (local.get $s) (local.get $c)))
                    (else (i32.store (local.get $s) (local.get $c))
                          (i32.store offset=8 (local.get $s) (i32.const 1))))))
              (call $pb_message (local.get $c) (local.get $text) (local.get $len)
                (i32.add (local.get $depth) (i32.const 1))))
            (else
              (if (i32.ne (local.get $kind) (i32.const 2))
                (then (call $utf8 (local.get $text) (local.get $len))))
              (if (i32.eq (local.get $kind) (i32.const 6))
                (then
                  (local.set $c (call $pb_record (i32.const 0)))
                  (call $pb_link (local.get $s) (local.get $c))
                  (local.set $s (call $slot (local.get $c) (i32.const 1)))))
              ;; Destination <= source, so memory.copy may overlap safely and
              ;; never overwrites the tag, length, or bytes of the next field.
              (if (i32.gt_u (global.get $pb_text) (local.get $text)) (then (call $fail (i32.const 14))))
              (memory.copy (global.get $pb_text) (local.get $text) (local.get $len))
              (i32.store (local.get $s) (global.get $pb_text))
              (i32.store offset=4 (local.get $s) (local.get $len))
              (i32.store offset=8 (local.get $s) (i32.const 1))
              (global.set $pb_text (i32.add (global.get $pb_text) (local.get $len)))))))
    )
    (local.set $p (local.get $after))
    (br $fields))))

(func $pb_parse (param $p i32) (param $n i32) (result i32) (local $r i32)
  (global.set $pb_count (i32.const 0))
  (global.set $pb_text (local.get $p))
  (local.set $r (call $pb_record (i32.const 15)))
  (call $pb_message (local.get $r) (local.get $p) (local.get $n) (i32.const 0))
  (local.get $r))
