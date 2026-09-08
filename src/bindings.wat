;; Hand-written SQL binding planner. It reads compiler SQL as byte views and
;; creates fixed-size binding records in the discarded input tail. Quoted SQL,
;; comments and identifiers remain unchanged; only real parameter occurrences
;; become binding records. The generator later uses their original identities.
;;
;; Binding record107: next@4, text pointer/length@8, parameter number@16.
;; Private planner fields: original named-token pointer/length@20, PG ordinal@28.
;; No SQL lexer token array, map, allocator, or memory.grow is needed. Named and
;; PostgreSQL identities use earlier binding records; metadata uses field links.
(data (i32.const 2965632) "unsupported SQL engine \00")
(data (i32.const 2965760) "invalid metadata for \00")
(data (i32.const 2965888) "slice name \00")
(data (i32.const 2966016) "slice marker \00")
(data (i32.const 2966144) "invalid \00")
(data (i32.const 2966272) "\00")
(data (i32.const 2966400) "slice marker \00")
(data (i32.const 2966528) "slice parameter \00")
(data (i32.const 2966656) "unterminated SQL comment\00")
(data (i32.const 2966784) "unterminated PostgreSQL dollar quote\00")
(data (i32.const 2966912) "unterminated SQL quote\00")
(data (i32.const 2968064) " parameter \00")
(data (i32.const 2968192) " identifies multiple parameters\00")
(data (i32.const 2968320) " has no argument metadata\00")
(data (i32.const 2968448) " does not match parameter \00")
(data (i32.const 2968576) " is missing its compiler marker\00")
(data (i32.const 2970000) "sqlite\00postgresql\00mysql\00")
(data (i32.const 2970100) "/*SLICE:")
(data (i32.const 2970120) "CAST(? AS REAL)")

(func $bind_zlen (param $p i32) (result i32) (local $n i32)
  (block $done (loop $loop
    (br_if $done (i32.eqz (i32.load8_u (i32.add (local.get $p) (local.get $n)))))
    (local.set $n (i32.add (local.get $n) (i32.const 1))) (br $loop))) (local.get $n))
(func $bind_literal (param $code i32) (local $p i32)
  (local.set $p (i32.add (i32.const 2965504) (i32.shl (local.get $code) (i32.const 7))))
  (call $text_append (local.get $p) (call $bind_zlen (local.get $p))))
(func $bind_engine (result i32 i32)
  (if (i32.eq (global.get $gen_engine) (i32.const 1)) (then (return (i32.const 2970000) (i32.const 6))))
  (if (i32.eq (global.get $gen_engine) (i32.const 2)) (then (return (i32.const 2970007) (i32.const 10))))
  (if (i32.eq (global.get $gen_engine) (i32.const 3)) (then (return (i32.const 2970018) (i32.const 5))))
  (call $text_ptr (global.get $gen_settings) (i32.const 2)) (call $text_len (global.get $gen_settings) (i32.const 2)))
(func $bind_error (param $code i32) (param $p i32) (param $n i32) (param $number i32)
  (local $quote i32) (local $qn i32) (local $num i32) (local $nn i32) (local $start i32)
  ;; Quote/decimal helpers write to the text pool. Prepare them BEFORE marking
  ;; the diagnostic start, then append their views in the required order.
  (call $go_quote (local.get $p) (local.get $n)) (local.set $qn) (local.set $quote)
  (call $decimal_i32 (local.get $number)) (local.set $nn) (local.set $num)
  (local.set $start (global.get $txt_cursor)) (call $bind_literal (local.get $code))
  (if (i32.eq (local.get $code) (i32.const 1)) (then (call $text_append (local.get $quote) (local.get $qn))))
  (if (i32.eq (local.get $code) (i32.const 2)) (then
    (call $text_append (call $bind_engine)) (call $bind_literal (i32.const 20)) (call $text_append (local.get $num) (local.get $nn))))
  (if (i32.eq (local.get $code) (i32.const 3)) (then
    (call $text_append (local.get $quote) (local.get $qn)) (call $bind_literal (i32.const 21))))
  (if (i32.eq (local.get $code) (i32.const 4)) (then
    (call $text_append (local.get $quote) (local.get $qn)) (call $bind_literal (i32.const 22))))
  (if (i32.eq (local.get $code) (i32.const 5)) (then
    (call $text_append (call $bind_engine)) (call $bind_literal (i32.const 20)) (call $text_append (local.get $quote) (local.get $qn))))
  (if (i32.eq (local.get $code) (i32.const 6)) (then
    (call $text_append (call $bind_engine)) (call $bind_literal (i32.const 20))
    (call $text_append (local.get $p) (local.get $n)) (call $bind_literal (i32.const 22))))
  (if (i32.eq (local.get $code) (i32.const 7)) (then
    (call $text_append (local.get $quote) (local.get $qn)) (call $bind_literal (i32.const 23)) (call $text_append (local.get $num) (local.get $nn))))
  (if (i32.eq (local.get $code) (i32.const 8)) (then
    (call $text_append (local.get $num) (local.get $nn)) (call $bind_literal (i32.const 24))))
  (call $error (local.get $start) (i32.sub (global.get $txt_cursor) (local.get $start))) unreachable)
(func $bind_identifier_start (param $b i32) (result i32)
  (i32.or (i32.le_u (i32.sub (i32.or (local.get $b) (i32.const 32)) (i32.const 97)) (i32.const 25))
    (i32.or (i32.eq (local.get $b) (i32.const 95)) (i32.ge_u (local.get $b) (i32.const 128)))))
(func $bind_digit (param $b i32) (result i32)
  (i32.le_u (i32.sub (local.get $b) (i32.const 48)) (i32.const 9)))
(func $bind_name_byte (param $b i32) (result i32)
  (i32.or (call $bind_identifier_start (local.get $b))
    (i32.or (call $bind_digit (local.get $b)) (i32.eq (local.get $b) (i32.const 36)))))
(func $bind_pair (param $p i32) (param $end i32) (param $value i32) (result i32)
  (if (result i32) (i32.ge_u (i32.sub (local.get $end) (local.get $p)) (i32.const 2))
    (then (i32.eq (i32.load16_u (local.get $p)) (local.get $value))) (else (i32.const 0))))

;; Return the first byte AFTER a quoted construct; return p when it is not a
;; quoted construct. PostgreSQL's block comments nest and dollar tags exclude
;; dollar signs from the tag body. MySQL's -- requires following whitespace.
(global $sql_scan_error (mut i32) (i32.const 0))
(func $scan_dialect_sql (param $p i32) (param $end i32) (result i32)
  (local $i i32) (local $depth i32) (local $tagend i32) (local $tagn i32)
  (local $quote i32) (local $close i32) (local $backslash i32) (local $line i32)
  (global.set $sql_scan_error (i32.const 0))
  (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (local.get $p))))
  (local.set $line (call $bind_pair (local.get $p) (local.get $end) (i32.const 11565)))
  (if (i32.and (local.get $line) (i32.eq (global.get $gen_engine) (i32.const 3))) (then
    (local.set $line (i32.or (i32.eq (i32.add (local.get $p) (i32.const 2)) (local.get $end))
      (i32.le_u (i32.load8_u (i32.add (local.get $p) (i32.const 2))) (i32.const 32))))))
  (if (i32.or (local.get $line) (i32.and (i32.eq (global.get $gen_engine) (i32.const 3))
    (i32.eq (i32.load8_u (local.get $p)) (i32.const 35)))) (then
    (local.set $i (local.get $p))
    (block $line_done (loop $line_loop
      (br_if $line_done (i32.ge_u (local.get $i) (local.get $end)))
      (if (i32.or (i32.eq (i32.load8_u (local.get $i)) (i32.const 10)) (i32.eq (i32.load8_u (local.get $i)) (i32.const 13)))
        (then (return (i32.add (local.get $i) (i32.const 1)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $line_loop))) (return (local.get $end))))
  (if (call $bind_pair (local.get $p) (local.get $end) (i32.const 10799)) (then
    (local.set $depth (i32.const 1)) (local.set $i (i32.add (local.get $p) (i32.const 2)))
    (block $comment_done (loop $comment
      (br_if $comment_done (i32.ge_u (i32.add (local.get $i) (i32.const 1)) (local.get $end)))
      (if (i32.and (i32.eq (global.get $gen_engine) (i32.const 2))
        (call $bind_pair (local.get $i) (local.get $end) (i32.const 10799)))
        (then (local.set $depth (i32.add (local.get $depth) (i32.const 1))) (local.set $i (i32.add (local.get $i) (i32.const 2))) (br $comment)))
      (if (call $bind_pair (local.get $i) (local.get $end) (i32.const 12074)) (then
        (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
        (if (i32.eqz (local.get $depth)) (then (return (i32.add (local.get $i) (i32.const 2)))))
        (local.set $i (i32.add (local.get $i) (i32.const 2))) (br $comment)))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $comment)))
    (global.set $sql_scan_error (i32.const 9)) (return (i32.const -1))))
  (if (i32.and (i32.eq (global.get $gen_engine) (i32.const 2)) (i32.eq (i32.load8_u (local.get $p)) (i32.const 36))) (then
    (local.set $tagend (i32.add (local.get $p) (i32.const 1)))
    (if (i32.and (i32.lt_u (local.get $tagend) (local.get $end)) (call $bind_identifier_start (i32.load8_u (local.get $tagend)))) (then
      (local.set $tagend (i32.add (local.get $tagend) (i32.const 1)))
      (block $tag_done (loop $tag
        (br_if $tag_done (i32.ge_u (local.get $tagend) (local.get $end)))
        (br_if $tag_done (i32.eq (i32.load8_u (local.get $tagend)) (i32.const 36)))
        (br_if $tag_done (i32.eqz (call $bind_name_byte (i32.load8_u (local.get $tagend)))))
        (local.set $tagend (i32.add (local.get $tagend) (i32.const 1))) (br $tag)))))
    (if (i32.and (i32.lt_u (local.get $tagend) (local.get $end)) (i32.eq (i32.load8_u (local.get $tagend)) (i32.const 36))) (then
      (local.set $tagn (i32.add (i32.sub (local.get $tagend) (local.get $p)) (i32.const 1)))
      (local.set $i (i32.add (local.get $tagend) (i32.const 1)))
      (block $dollar_done (loop $dollar
        (br_if $dollar_done (i32.gt_u (local.get $tagn) (i32.sub (local.get $end) (local.get $i))))
        (if (call $eq (local.get $i) (local.get $tagn) (local.get $p) (local.get $tagn))
          (then (return (i32.add (local.get $i) (local.get $tagn)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $dollar)))
      (global.set $sql_scan_error (i32.const 10)) (return (i32.const -1))))))
  (local.set $quote (i32.load8_u (local.get $p)))
  (local.set $backslash (i32.and (i32.eq (global.get $gen_engine) (i32.const 3))
    (i32.or (i32.eq (local.get $quote) (i32.const 39)) (i32.eq (local.get $quote) (i32.const 34)))))
  (if (i32.and (i32.eq (global.get $gen_engine) (i32.const 2))
    (i32.and (i32.eq (i32.or (local.get $quote) (i32.const 32)) (i32.const 101))
      (i32.and (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
        (i32.eq (i32.load8_u (i32.add (local.get $p) (i32.const 1))) (i32.const 39))))) (then
    (local.set $p (i32.add (local.get $p) (i32.const 1))) (local.set $quote (i32.const 39)) (local.set $backslash (i32.const 1))))
  (if (i32.eqz (i32.or (i32.or (i32.eq (local.get $quote) (i32.const 39)) (i32.eq (local.get $quote) (i32.const 34)))
    (i32.or (i32.and (i32.eq (local.get $quote) (i32.const 96)) (i32.ne (global.get $gen_engine) (i32.const 2)))
      (i32.and (i32.eq (local.get $quote) (i32.const 91)) (i32.eq (global.get $gen_engine) (i32.const 1))))))
    (then (return (local.get $p))))
  (local.set $close (local.get $quote))
  (if (i32.eq (local.get $quote) (i32.const 91)) (then (local.set $close (i32.const 93))))
  (local.set $i (i32.add (local.get $p) (i32.const 1)))
  (block $quote_done (loop $quoted
    (br_if $quote_done (i32.ge_u (local.get $i) (local.get $end)))
    (if (i32.and (local.get $backslash) (i32.eq (i32.load8_u (local.get $i)) (i32.const 92)))
      (then (local.set $i (i32.add (local.get $i) (i32.const 2))) (br $quoted)))
    (if (i32.eq (i32.load8_u (local.get $i)) (local.get $close)) (then
      (if (i32.and (i32.ne (local.get $quote) (i32.const 91))
        (i32.and (i32.lt_u (i32.add (local.get $i) (i32.const 1)) (local.get $end))
          (i32.eq (i32.load8_u (i32.add (local.get $i) (i32.const 1))) (local.get $close))))
        (then (local.set $i (i32.add (local.get $i) (i32.const 2))) (br $quoted)))
      (return (i32.add (local.get $i) (i32.const 1)))))
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $quoted)))
  (global.set $sql_scan_error (i32.const 11)) (return (i32.const -1)) unreachable)

;; Binding plans reject malformed SQL; embed discovery instead calls the same
;; scanner's non-throwing entry and uses its documented fallback on -1.
(func $skip_dialect_sql (param $p i32) (param $end i32) (result i32) (local $after i32)
  (local.set $after (call $scan_dialect_sql (local.get $p) (local.get $end)))
  (if (i32.lt_s (local.get $after) (i32.const 0))
    (then (call $bind_error (global.get $sql_scan_error) (i32.const 0) (i32.const 0) (i32.const 0))))
  (local.get $after))

(func $bind_find_parameter (param $head i32) (param $number i32) (result i32)
  (block $done (loop $loop
    (br_if $done (i32.eqz (local.get $head)))
    (if (i32.eq (i32.load offset=64 (local.get $head)) (local.get $number)) (then (return (local.get $head))))
    (local.set $head (call $next (local.get $head))) (br $loop))) (i32.const 0))
(func $bind_column_name (param $field i32) (result i32 i32)
  (call $text_ptr (i32.load offset=8 (local.get $field)) (i32.const 1))
  (call $text_len (i32.load offset=8 (local.get $field)) (i32.const 1)))
(func $bind_slice (param $head i32) (param $p i32) (param $n i32) (result i32)
  (block $done (loop $loop
    (br_if $done (i32.eqz (local.get $head)))
    (if (i32.load offset=44 (local.get $head)) (then
      (if (call $eq (call $bind_column_name (local.get $head)) (local.get $p) (local.get $n))
        (then (return (i32.load offset=64 (local.get $head)))))))
    (local.set $head (call $next (local.get $head))) (br $loop))) (i32.const 0))
(func $bind_add_part (param $plan i32) (param $last i32) (param $p i32) (param $n i32) (param $number i32) (result i32)
  (local $record i32)
  (local.set $record (call $work_record (i32.const 107)))
  (i32.store offset=8 (local.get $record) (local.get $p)) (i32.store offset=12 (local.get $record) (local.get $n))
  (i32.store offset=16 (local.get $record) (local.get $number))
  (if (local.get $last) (then (i32.store offset=4 (local.get $last) (local.get $record)))
    (else (i32.store offset=56 (local.get $plan) (local.get $record))))
  (local.get $record))
(func $bind_named_number (param $head i32) (param $p i32) (param $n i32) (result i32)
  (block $done (loop $loop
    (br_if $done (i32.eqz (local.get $head)))
    (if (i32.load offset=24 (local.get $head)) (then
      (if (call $eq (i32.load offset=20 (local.get $head)) (i32.load offset=24 (local.get $head)) (local.get $p) (local.get $n))
        (then (return (i32.load offset=16 (local.get $head)))))))
    (local.set $head (call $next (local.get $head))) (br $loop))) (i32.const 0))
(func $bind_pg_number (param $head i32) (param $number i32) (result i32)
  (block $done (loop $loop
    (br_if $done (i32.eqz (local.get $head)))
    (if (i32.eq (i32.load offset=16 (local.get $head)) (local.get $number))
      (then (return (i32.load offset=28 (local.get $head)))))
    (local.set $head (call $next (local.get $head))) (br $loop))) (i32.const 0))

(func $plan_bindings (param $plan i32)
  (local $sql i32) (local $end i32) (local $params i32) (local $field i32) (local $previous i32)
  (local $i i32) (local $start i32) (local $position i32) (local $after i32)
  (local $marker i32) (local $mn i32) (local $probe i32) (local $c i32)
  (local $number i32) (local $highest i32) (local $pgcount i32) (local $ordinal i32)
  (local $parsed i64) (local $digit i64) (local $bad i32)
  (local $named i32) (local $namedn i32) (local $part i32) (local $last i32)
  (local $output i32)
  (if (i32.gt_u (i32.sub (global.get $gen_engine) (i32.const 1)) (i32.const 2))
    (then (call $bind_error (i32.const 1) (call $bind_engine) (i32.const 0))))
  (local.set $sql (call $text_ptr (i32.load offset=8 (local.get $plan)) (i32.const 1)))
  (local.set $end (i32.add (local.get $sql) (call $text_len (i32.load offset=8 (local.get $plan)) (i32.const 1))))
  (local.set $params (i32.load offset=48 (local.get $plan))) (local.set $field (local.get $params))
  (block $checked (loop $check
    (br_if $checked (i32.eqz (local.get $field)))
    (local.set $number (i32.load offset=64 (local.get $field)))
    (if (i32.or (i32.lt_s (local.get $number) (i32.const 1)) (i32.eqz (i32.load offset=8 (local.get $field))))
      (then (call $bind_error (i32.const 2) (i32.const 0) (i32.const 0) (local.get $number))))
    (if (i32.and (i32.eq (global.get $gen_engine) (i32.const 1)) (i32.ne (i32.load offset=44 (local.get $field)) (i32.const 0))) (then
      (local.set $previous (local.get $params))
      (block $earlier_done (loop $earlier
        (br_if $earlier_done (i32.eq (local.get $previous) (local.get $field)))
        (if (i32.and (i32.ne (i32.load offset=44 (local.get $previous)) (i32.const 0))
          (i32.ne (i32.load offset=64 (local.get $previous)) (local.get $number))) (then
          (if (call $eq (call $bind_column_name (local.get $previous)) (call $bind_column_name (local.get $field)))
            (then (call $bind_error (i32.const 3) (call $bind_column_name (local.get $field)) (i32.const 0))))))
        (local.set $previous (call $next (local.get $previous))) (br $earlier)))))
    (local.set $field (call $next (local.get $field))) (br $check)))
  (local.set $i (local.get $sql)) (local.set $start (local.get $sql)) (local.set $output (global.get $txt_cursor))
  (i32.store offset=56 (local.get $plan) (i32.const 0)) (i32.store offset=60 (local.get $plan) (i32.const 0))
  (block $done (loop $scan
    (br_if $done (i32.ge_u (local.get $i) (local.get $end)))
    (local.set $marker (i32.const 0)) (local.set $mn (i32.const 0))
    (local.set $named (i32.const 0)) (local.set $namedn (i32.const 0))
    (local.set $position (local.get $i))
    ;; Compiler slice markers are recognized only if a nonempty marker ends
    ;; immediately before ?. A malformed marker remains an ordinary comment.
    (if (i32.and (i32.ne (global.get $gen_engine) (i32.const 2))
      (i32.ge_u (i32.sub (local.get $end) (local.get $i)) (i32.const 8))) (then
      (if (call $eq (local.get $i) (i32.const 8) (i32.const 2970100) (i32.const 8)) (then
        (local.set $probe (i32.add (local.get $i) (i32.const 8)))
        (block $marker_done (loop $marker_scan
          (br_if $marker_done (i32.ge_u (i32.add (local.get $probe) (i32.const 1)) (local.get $end)))
          (if (call $bind_pair (local.get $probe) (local.get $end) (i32.const 12074)) (then
            (local.set $after (i32.add (local.get $probe) (i32.const 2)))
            (if (i32.and (i32.gt_u (local.get $probe) (i32.add (local.get $i) (i32.const 8)))
              (i32.and (i32.lt_u (local.get $after) (local.get $end)) (i32.eq (i32.load8_u (local.get $after)) (i32.const 63))))
              (then (local.set $marker (i32.add (local.get $i) (i32.const 8)))
                (local.set $mn (i32.sub (local.get $probe) (local.get $marker))) (local.set $i (local.get $after))))
            (br $marker_done)))
          (local.set $probe (i32.add (local.get $probe) (i32.const 1))) (br $marker_scan)))))))
    (if (i32.eqz (local.get $marker)) (then
      (local.set $after (call $skip_dialect_sql (local.get $i) (local.get $end)))
      (if (i32.gt_u (local.get $after) (local.get $i)) (then (local.set $i (local.get $after)) (br $scan)))
      (if (call $bind_identifier_start (i32.load8_u (local.get $i))) (then
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (block $identifier_done (loop $identifier
          (br_if $identifier_done (i32.ge_u (local.get $i) (local.get $end)))
          (br_if $identifier_done (i32.eqz (call $bind_name_byte (i32.load8_u (local.get $i)))))
          (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $identifier))) (br $scan)))))
    (local.set $c (i32.load8_u (local.get $i)))
    (if (i32.eq (global.get $gen_engine) (i32.const 2)) (then
      (if (i32.or (i32.ne (local.get $c) (i32.const 36))
        (i32.or (i32.ge_u (i32.add (local.get $i) (i32.const 1)) (local.get $end))
          (i32.eqz (call $bind_digit (i32.load8_u (i32.add (local.get $i) (i32.const 1)))))))
        (then (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $scan)))))
    (if (i32.and (i32.eq (global.get $gen_engine) (i32.const 3)) (i32.ne (local.get $c) (i32.const 63)))
      (then (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $scan)))
    (if (i32.eq (global.get $gen_engine) (i32.const 1)) (then
      (if (i32.and (i32.and (i32.ne (local.get $c) (i32.const 63)) (i32.ne (local.get $c) (i32.const 58)))
        (i32.and (i32.ne (local.get $c) (i32.const 64)) (i32.ne (local.get $c) (i32.const 36))))
        (then (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $scan)))))
    (local.set $after (i32.add (local.get $i) (i32.const 1))) (local.set $number (i32.const 0))
    (block $number_done
      (if (i32.eq (global.get $gen_engine) (i32.const 3))
        (then (local.set $number (i32.add (local.get $highest) (i32.const 1))) (br $number_done)))
      (if (local.get $marker) (then
        (local.set $number (call $bind_slice (local.get $params) (local.get $marker) (local.get $mn)))
        (if (i32.eqz (local.get $number)) (then (call $bind_error (i32.const 4) (local.get $marker) (local.get $mn) (i32.const 0))))
        (block $digits_done (loop $digits
          (br_if $digits_done (i32.ge_u (local.get $after) (local.get $end)))
          (br_if $digits_done (i32.eqz (call $bind_digit (i32.load8_u (local.get $after)))))
          (local.set $after (i32.add (local.get $after) (i32.const 1))) (br $digits))) (br $number_done)))
      (if (i32.or (i32.eq (local.get $c) (i32.const 63)) (i32.eq (global.get $gen_engine) (i32.const 2))) (then
        (local.set $parsed (i64.const 0)) (local.set $bad (i32.const 0))
        (block $number_digits_done (loop $number_digits
          (br_if $number_digits_done (i32.ge_u (local.get $after) (local.get $end)))
          (br_if $number_digits_done (i32.eqz (call $bind_digit (i32.load8_u (local.get $after)))))
          (local.set $digit (i64.extend_i32_u (i32.sub (i32.load8_u (local.get $after)) (i32.const 48))))
          (if (i32.or (i64.gt_u (local.get $parsed) (i64.const 922337203685477580))
            (i32.and (i64.eq (local.get $parsed) (i64.const 922337203685477580)) (i64.gt_u (local.get $digit) (i64.const 7))))
            (then (local.set $bad (i32.const 1))))
          (local.set $parsed (i64.add (i64.mul (local.get $parsed) (i64.const 10)) (local.get $digit)))
          (local.set $after (i32.add (local.get $after) (i32.const 1))) (br $number_digits)))
        (if (i32.gt_u (local.get $after) (i32.add (local.get $i) (i32.const 1)))
          (then
            (if (i32.or (local.get $bad) (i64.eqz (local.get $parsed)))
              (then (call $bind_error (i32.const 5) (local.get $i) (i32.sub (local.get $after) (local.get $i)) (i32.const 0))))
            (if (i64.gt_u (local.get $parsed) (i64.const 2147483647))
              (then (call $bind_error (i32.const 6) (local.get $i) (i32.sub (local.get $after) (local.get $i)) (i32.const 0))))
            (local.set $number (i32.wrap_i64 (local.get $parsed))))
          (else (local.set $number (i32.add (local.get $highest) (i32.const 1))))) (br $number_done)))
      (block $name_done (loop $name
        (br_if $name_done (i32.ge_u (local.get $after) (local.get $end)))
        (br_if $name_done (i32.eqz (call $bind_name_byte (i32.load8_u (local.get $after)))))
        (local.set $after (i32.add (local.get $after) (i32.const 1))) (br $name)))
      (if (i32.eq (local.get $after) (i32.add (local.get $i) (i32.const 1)))
        (then (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $scan)))
      (local.set $named (local.get $i)) (local.set $namedn (i32.sub (local.get $after) (local.get $i)))
      (local.set $number (call $bind_named_number (i32.load offset=56 (local.get $plan)) (local.get $named) (local.get $namedn)))
      (if (i32.eqz (local.get $number)) (then (local.set $number (i32.add (local.get $highest) (i32.const 1))))))
    (if (i32.gt_s (local.get $number) (local.get $highest)) (then (local.set $highest (local.get $number))))
    (local.set $field (call $bind_find_parameter (local.get $params) (local.get $number)))
    (if (i32.eqz (local.get $field))
      (then (call $bind_error (i32.const 6) (local.get $i) (i32.sub (local.get $after) (local.get $i)) (i32.const 0))))
    (if (local.get $marker) (then
      (if (i32.or (i32.eqz (i32.load offset=44 (local.get $field)))
        (i32.eqz (call $eq (call $bind_column_name (local.get $field)) (local.get $marker) (local.get $mn))))
        (then (call $bind_error (i32.const 7) (local.get $marker) (local.get $mn) (local.get $number))))))
    (if (i32.and (i32.ne (global.get $gen_engine) (i32.const 2))
      (i32.and (i32.eqz (local.get $marker)) (i32.ne (i32.load offset=44 (local.get $field)) (i32.const 0))))
      (then (call $bind_error (i32.const 8) (i32.const 0) (i32.const 0) (local.get $number))))
    (local.set $last (call $bind_add_part (local.get $plan) (local.get $last) (local.get $start) (i32.sub (local.get $position) (local.get $start)) (i32.const 0)))
    (call $text_append (local.get $start) (i32.sub (local.get $position) (local.get $start)))
    (local.set $ordinal (i32.const 0))
    (if (i32.eq (global.get $gen_engine) (i32.const 2)) (then
      (local.set $ordinal (call $bind_pg_number (i32.load offset=56 (local.get $plan)) (local.get $number)))
      (if (i32.eqz (local.get $ordinal)) (then
        (local.set $pgcount (i32.add (local.get $pgcount) (i32.const 1))) (local.set $ordinal (local.get $pgcount))))))
    (local.set $last (call $bind_add_part (local.get $plan) (local.get $last) (i32.const 0) (i32.const 0) (local.get $number)))
    (i32.store offset=20 (local.get $last) (local.get $named)) (i32.store offset=24 (local.get $last) (local.get $namedn))
    (i32.store offset=28 (local.get $last) (local.get $ordinal))
    (if (local.get $marker) (then
      (call $text_append (local.get $position) (i32.sub (local.get $i) (local.get $position)))
      (i32.store offset=60 (local.get $plan) (i32.const 1))))
    (if (i32.eq (global.get $gen_engine) (i32.const 2))
      (then (call $text_byte (i32.const 36)) (call $decimal_i32 (local.get $ordinal)) drop drop)
      (else (if (i32.and (i32.eq (global.get $gen_engine) (i32.const 1))
        (i32.and (i32.eq (i32.load offset=32 (local.get $field)) (i32.const 2)) (i32.eqz (i32.load offset=60 (local.get $field)))))
        (then (call $text_append (i32.const 2970120) (i32.const 15)))
        (else (call $text_byte (i32.const 63))))))
    (local.set $start (local.get $after)) (local.set $i (local.get $after)) (br $scan)))
  (drop (call $bind_add_part (local.get $plan) (local.get $last) (local.get $start) (i32.sub (local.get $end) (local.get $start)) (i32.const 0)))
  (call $text_append (local.get $start) (i32.sub (local.get $end) (local.get $start)))
  (i32.store offset=64 (local.get $plan) (local.get $output))
  (i32.store offset=68 (local.get $plan) (i32.sub (global.get $txt_cursor) (local.get $output))))
