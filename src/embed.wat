;; Recover legacy sqlc embed nullability from the same narrow SELECT grammar as
;; the previous generator. This is not a SQL type checker: CTEs, subqueries as
;; relations, set operations, table functions, and unrecognized syntax leave the
;; original compiler nullability unchanged.
;;
;; Fixed scratch [31719424,32768000) contains 65536 tokens of 16 bytes:
;; pointer, byte length, flags (1 identifier / 2 quoted), target-end token index.
;; Only target-start tokens use the final word. Following end+1 walks the SELECT
;; targets, so no separate target array exists. Relation records use kind 111:
;; next@4, partCount@8, required@12, three table pointer/length pairs@16..39,
;; alias pointer/length@40. Text and relation scratch are reset on every return;
;; the only lasting change is setting proven legacy embeds' NotNull to true.
;; SQL source bytes remain intact for emission and bind rewriting.
(global $em_count (mut i32) (i32.const 0))
(global $em_pos (mut i32) (i32.const 0))
(global $em_ok (mut i32) (i32.const 1))
(global $em_from (mut i32) (i32.const 0))
(global $em_targets (mut i32) (i32.const 0))

(func $em_token (param $index i32) (result i32)
  (i32.add (i32.const 31719424) (i32.mul (local.get $index) (i32.const 16))))
(func $em_text (param $index i32) (result i32 i32)
  (if (result i32 i32) (i32.lt_u (local.get $index) (global.get $em_count))
    (then (call $get_text (call $em_token (local.get $index)) (i32.const 0)))
    (else (i32.const 0) (i32.const 0))))
(func $em_is (param $index i32) (param $p i32) (param $n i32) (result i32)
  (if (i32.ge_u (local.get $index) (global.get $em_count)) (then (return (i32.const 0))))
  (if (i32.and (i32.load offset=8 (call $em_token (local.get $index))) (i32.const 2))
    (then (return (i32.const 0))))
  (call $eq (call $em_text (local.get $index)) (local.get $p) (local.get $n)))
(func $em_ident (param $index i32) (result i32)
  (if (result i32) (i32.lt_u (local.get $index) (global.get $em_count))
    (then (i32.and (i32.load offset=8 (call $em_token (local.get $index))) (i32.const 1)))
    (else (i32.const 0))))
(func $em_take (param $p i32) (param $n i32) (result i32)
  (if (call $em_is (global.get $em_pos) (local.get $p) (local.get $n))
    (then
      (global.set $em_pos (i32.add (global.get $em_pos) (i32.const 1)))
      (return (i32.const 1))))
  (i32.const 0))
(func $em_add (param $p i32) (param $n i32) (param $flags i32)
  (local $t i32)
  (if (i32.ge_u (global.get $em_count) (i32.const 65536))
    (then (call $fail (i32.const 19)) unreachable))
  (local.set $t (call $em_token (global.get $em_count)))
  (call $set_text (local.get $t) (i32.const 0) (local.get $p) (local.get $n))
  (i32.store offset=8 (local.get $t) (local.get $flags))
  (i32.store offset=12 (local.get $t) (i32.const 0))
  (global.set $em_count (i32.add (global.get $em_count) (i32.const 1))))

(func $em_lower (param $p i32) (param $end i32) (result i32 i32)
  (local $mark i32) (local $r i32)
  (local.set $mark (call $text_mark))
  (block $done
    (loop $rune
      (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
      (call $rune (local.get $p) (local.get $end)) (local.set $r) (local.set $p)
      (call $put_rune (call $unicode_case (local.get $r) (i32.const 1)))
      (br $rune)))
  (local.get $mark) (i32.sub (global.get $txt_cursor) (local.get $mark)))

(func $em_tokens (param $p i32) (param $n i32) (result i32)
  (local $end i32) (local $after i32) (local $c i32) (local $quoted i32)
  (local $mark i32) (local $i i32) (local $close i32) (local $b i32)
  (global.set $em_count (i32.const 0))
  (local.set $end (i32.add (local.get $p) (local.get $n)))
  (block $done
    (loop $token
      (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
      (local.set $c (i32.load8_u (local.get $p)))
      (if (i32.le_u (local.get $c) (i32.const 32))
        (then (local.set $p (i32.add (local.get $p) (i32.const 1))) (br $token)))
      (local.set $after (call $scan_dialect_sql (local.get $p) (local.get $end)))
      (if (i32.eq (local.get $after) (i32.const -1)) (then (return (i32.const 0))))
      (if (i32.gt_u (local.get $after) (local.get $p))
        (then
          (local.set $quoted (i32.or
            (i32.and (i32.eq (local.get $c) (i32.const 34)) (i32.ne (global.get $gen_engine) (i32.const 3)))
            (i32.or
              (i32.and (i32.eq (local.get $c) (i32.const 96)) (i32.ne (global.get $gen_engine) (i32.const 2)))
              (i32.and (i32.eq (local.get $c) (i32.const 91)) (i32.eq (global.get $gen_engine) (i32.const 1))))))
          (if (local.get $quoted)
            (then
              (local.set $mark (call $text_mark))
              (local.set $close (i32.load8_u (i32.sub (local.get $after) (i32.const 1))))
              (local.set $i (i32.add (local.get $p) (i32.const 1)))
              (block $quoted_done
                (loop $name
                  (br_if $quoted_done (i32.ge_u (local.get $i) (i32.sub (local.get $after) (i32.const 1))))
                  (local.set $b (i32.load8_u (local.get $i)))
                  (call $text_byte (local.get $b))
                  (local.set $i (i32.add (local.get $i) (i32.const 1)))
                  (if (i32.and (i32.eq (local.get $b) (local.get $close))
                        (i32.lt_u (local.get $i) (i32.sub (local.get $after) (i32.const 1))))
                    (then
                      (if (i32.eq (i32.load8_u (local.get $i)) (local.get $close))
                        (then (local.set $i (i32.add (local.get $i) (i32.const 1)))))))
                  (br $name)))
              (call $em_add (local.get $mark) (i32.sub (global.get $txt_cursor) (local.get $mark)) (i32.const 3)))
            (else
              (if (i32.eqz (i32.or
                    (i32.or (call $bind_pair (local.get $p) (local.get $end) (i32.const 11565))
                            (call $bind_pair (local.get $p) (local.get $end) (i32.const 10799)))
                    (i32.and (i32.eq (global.get $gen_engine) (i32.const 3)) (i32.eq (local.get $c) (i32.const 35)))))
                (then (call $em_add (i32.const 2654208) (i32.const 9) (i32.const 2))))))
          (local.set $p (local.get $after)) (br $token)))
      (if (call $bind_identifier_start (local.get $c))
        (then
          (local.set $after (i32.add (local.get $p) (i32.const 1)))
          (block $name_done
            (loop $identifier
              (br_if $name_done (i32.ge_u (local.get $after) (local.get $end)))
              (br_if $name_done (i32.eqz (call $bind_name_byte (i32.load8_u (local.get $after)))))
              (local.set $after (i32.add (local.get $after) (i32.const 1))) (br $identifier)))
          (call $em_add (call $em_lower (local.get $p) (local.get $after)) (i32.const 1))
          (local.set $p (local.get $after)) (br $token)))
      (call $em_add (local.get $p) (i32.const 1) (i32.const 0))
      (local.set $p (i32.add (local.get $p) (i32.const 1))) (br $token)))
  (i32.const 1))

(func $em_clause_end (param $i i32) (result i32)
  (if (call $em_is (local.get $i) (i32.const 2654217) (i32.const 5)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654222) (i32.const 5)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654227) (i32.const 6)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654233) (i32.const 6)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654239) (i32.const 5)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654244) (i32.const 5)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654249) (i32.const 6)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654255) (i32.const 5)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654260) (i32.const 3)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654263) (i32.const 7)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654270) (i32.const 5)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654275) (i32.const 9)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654284) (i32.const 6)) (then (return (i32.const 1))))
  (call $em_is (local.get $i) (i32.const 2654290) (i32.const 1)))
(func $em_reserved (param $i i32) (result i32)
  (if (call $em_is (local.get $i) (i32.const 2654291) (i32.const 6)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654297) (i32.const 4)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654301) (i32.const 4)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654305) (i32.const 7)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654312) (i32.const 11)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654323) (i32.const 7)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654330) (i32.const 4)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654334) (i32.const 5)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654339) (i32.const 5)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654344) (i32.const 4)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654348) (i32.const 5)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654353) (i32.const 4)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654357) (i32.const 5)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654362) (i32.const 2)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654364) (i32.const 5)) (then (return (i32.const 1))))
  (if (call $em_is (local.get $i) (i32.const 2654369) (i32.const 2)) (then (return (i32.const 1))))
  (call $em_clause_end (local.get $i)))

(func $em_join_at (param $pos i32) (result i32 i32)
  (local $q i32) (local $kind i32)
  (local.set $q (local.get $pos)) (local.set $kind (i32.const 1))
  (if (call $em_is (local.get $q) (i32.const 2654323) (i32.const 7)) (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))
  (block $kind_done
    (if (call $em_is (local.get $q) (i32.const 2654344) (i32.const 4)) (then (local.set $kind (i32.const 2)) (br $kind_done)))
    (if (call $em_is (local.get $q) (i32.const 2654348) (i32.const 5)) (then (local.set $kind (i32.const 3)) (br $kind_done)))
    (if (call $em_is (local.get $q) (i32.const 2654353) (i32.const 4)) (then (local.set $kind (i32.const 4)) (br $kind_done)))
    (if (call $em_is (local.get $q) (i32.const 2654339) (i32.const 5)) (then (local.set $kind (i32.const 5)) (br $kind_done)))
    (if (call $em_is (local.get $q) (i32.const 2654334) (i32.const 5)) (then (br $kind_done)))
    (local.set $q (i32.sub (local.get $q) (i32.const 1))))
  (local.set $q (i32.add (local.get $q) (i32.const 1)))
  (if (call $em_is (local.get $q) (i32.const 2654357) (i32.const 5)) (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))
  (if (call $em_is (local.get $q) (i32.const 2654330) (i32.const 4))
    (then (return (local.get $kind) (i32.add (local.get $q) (i32.const 1)))))
  (i32.const 0) (local.get $pos))

(func $em_bad (result i32 i32)
  (global.set $em_ok (i32.const 0)) (i32.const 0) (i32.const 0))
(func $em_nullable (param $head i32)
  (block $done
    (loop $relation
      (br_if $done (i32.eqz (local.get $head)))
      (i32.store offset=12 (local.get $head) (i32.const 0))
      (local.set $head (call $next (local.get $head))) (br $relation))))

(func $em_relation (param $depth i32) (result i32 i32)
  (local $row i32) (local $count i32) (local $alias i32) (local $head i32) (local $tail i32)
  (if (i32.ge_u (local.get $depth) (i32.const 128)) (then (return (call $em_bad))))
  (if (call $em_take (i32.const 2654371) (i32.const 1))
    (then
      (call $em_list (i32.add (local.get $depth) (i32.const 1))) (local.set $tail) (local.set $head)
      (if (i32.eqz (global.get $em_ok)) (then (return (call $em_bad))))
      (if (i32.eqz (call $em_take (i32.const 2654372) (i32.const 1))) (then (return (call $em_bad))))
      (return (local.get $head) (local.get $tail))))
  (local.set $row (call $work_record (i32.const 111)))
  (i32.store offset=12 (local.get $row) (i32.const 1))
  (block $name_done
    (loop $part
      (if (i32.or (i32.eqz (call $em_ident (global.get $em_pos))) (call $em_reserved (global.get $em_pos)))
        (then (return (call $em_bad))))
      (local.set $alias (global.get $em_pos))
      (call $set_text (local.get $row) (i32.add (i32.const 16) (i32.mul (local.get $count) (i32.const 8)))
        (call $em_text (global.get $em_pos)))
      (global.set $em_pos (i32.add (global.get $em_pos) (i32.const 1)))
      (local.set $count (i32.add (local.get $count) (i32.const 1)))
      (br_if $name_done (i32.eqz (call $em_take (i32.const 2654373) (i32.const 1))))
      (if (i32.eq (local.get $count) (i32.const 3)) (then (return (call $em_bad))))
      (br $part)))
  (i32.store offset=8 (local.get $row) (local.get $count))
  (if (call $em_take (i32.const 2654369) (i32.const 2))
    (then
      (if (i32.or (i32.eqz (call $em_ident (global.get $em_pos))) (call $em_reserved (global.get $em_pos)))
        (then (return (call $em_bad))))
      (local.set $alias (global.get $em_pos))
      (global.set $em_pos (i32.add (global.get $em_pos) (i32.const 1))))
    (else
      (if (i32.and (call $em_ident (global.get $em_pos)) (i32.eqz (call $em_reserved (global.get $em_pos))))
        (then (local.set $alias (global.get $em_pos))
          (global.set $em_pos (i32.add (global.get $em_pos) (i32.const 1)))))))
  (call $set_text (local.get $row) (i32.const 40) (call $em_text (local.get $alias)))
  (local.get $row) (local.get $row))

(func $em_joined (param $depth i32) (result i32 i32)
  (local $left i32) (local $ltail i32) (local $right i32) (local $rtail i32)
  (local $kind i32) (local $end i32) (local $nest i32) (local $next_join i32)
  (call $em_relation (local.get $depth)) (local.set $ltail) (local.set $left)
  (if (i32.eqz (global.get $em_ok)) (then (return (call $em_bad))))
  (loop $join
    (call $em_join_at (global.get $em_pos)) (local.set $end) (local.set $kind)
    (if (i32.and (i32.eq (global.get $gen_engine) (i32.const 1)) (call $em_is (global.get $em_pos) (i32.const 2654374) (i32.const 1)))
      (then (local.set $kind (i32.const 5)) (local.set $end (i32.add (global.get $em_pos) (i32.const 1)))))
    (if (i32.eq (local.get $end) (global.get $em_pos)) (then (return (local.get $left) (local.get $ltail))))
    (global.set $em_pos (local.get $end))
    (call $em_relation (local.get $depth)) (local.set $rtail) (local.set $right)
    (if (i32.eqz (global.get $em_ok)) (then (return (call $em_bad))))
    (if (i32.or (i32.eq (local.get $kind) (i32.const 3)) (i32.eq (local.get $kind) (i32.const 4)))
      (then (call $em_nullable (local.get $left))))
    (if (i32.or (i32.eq (local.get $kind) (i32.const 2)) (i32.eq (local.get $kind) (i32.const 4)))
      (then (call $em_nullable (local.get $right))))
    (i32.store offset=4 (local.get $ltail) (local.get $right)) (local.set $ltail (local.get $rtail))
    ;; take(on) || take(using) short-circuits; do not consume both words.
    (local.set $kind (call $em_take (i32.const 2654362) (i32.const 2)))
    (if (i32.eqz (local.get $kind)) (then (local.set $kind (call $em_take (i32.const 2654364) (i32.const 5)))))
    (if (local.get $kind)
      (then
        (local.set $nest (i32.const 0))
        (block $condition_done
          (loop $condition
            (br_if $condition_done (i32.ge_u (global.get $em_pos) (global.get $em_count)))
            (call $em_join_at (global.get $em_pos)) (local.set $next_join) (drop)
            (if (i32.eqz (local.get $nest))
              (then
                (br_if $condition_done (i32.or
                  (i32.or (call $em_is (global.get $em_pos) (i32.const 2654372) (i32.const 1)) (call $em_is (global.get $em_pos) (i32.const 2654374) (i32.const 1)))
                  (i32.or (call $em_clause_end (global.get $em_pos)) (i32.ne (local.get $next_join) (global.get $em_pos)))))))
            (if (call $em_is (global.get $em_pos) (i32.const 2654371) (i32.const 1)) (then (local.set $nest (i32.add (local.get $nest) (i32.const 1)))))
            (if (call $em_is (global.get $em_pos) (i32.const 2654372) (i32.const 1)) (then (local.set $nest (i32.sub (local.get $nest) (i32.const 1)))))
            (global.set $em_pos (i32.add (global.get $em_pos) (i32.const 1))) (br $condition)))
        (if (local.get $nest) (then (return (call $em_bad))))))
    (br $join))
  (i32.const 0) (i32.const 0))

(func $em_list (param $depth i32) (result i32 i32)
  (local $head i32) (local $tail i32) (local $right i32) (local $rtail i32)
  (call $em_joined (local.get $depth)) (local.set $tail) (local.set $head)
  (if (i32.eqz (global.get $em_ok)) (then (return (call $em_bad))))
  (block $done
    (loop $comma
      (br_if $done (i32.eqz (call $em_take (i32.const 2654374) (i32.const 1))))
      (call $em_joined (local.get $depth)) (local.set $rtail) (local.set $right)
      (if (i32.eqz (global.get $em_ok)) (then (return (call $em_bad))))
      (i32.store offset=4 (local.get $tail) (local.get $right)) (local.set $tail (local.get $rtail))
      (br $comma)))
  (local.get $head) (local.get $tail))

(func $em_select (result i32)
  (local $i i32) (local $depth i32) (local $from i32) (local $head i32) (local $start i32)
  (global.set $em_ok (i32.const 1)) (global.set $em_targets (i32.const 0))
  (if (i32.eqz (call $em_is (i32.const 0) (i32.const 2654291) (i32.const 6))) (then (return (i32.const 0))))
  (local.set $from (i32.const -1))
  (block $scan_done
    (loop $scan
      (br_if $scan_done (i32.ge_u (local.get $i) (global.get $em_count)))
      (if (call $em_is (local.get $i) (i32.const 2654371) (i32.const 1))
        (then (local.set $depth (i32.add (local.get $depth) (i32.const 1))))
        (else
          (if (call $em_is (local.get $i) (i32.const 2654372) (i32.const 1))
            (then
              (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
              (if (i32.lt_s (local.get $depth) (i32.const 0)) (then (return (i32.const 0)))))
            (else
              (if (i32.eqz (local.get $depth))
                (then
                  (if (i32.or (call $em_is (local.get $i) (i32.const 2654270) (i32.const 5))
                        (i32.or (call $em_is (local.get $i) (i32.const 2654275) (i32.const 9)) (call $em_is (local.get $i) (i32.const 2654284) (i32.const 6))))
                    (then (return (i32.const 0))))
                  (if (i32.and (call $em_is (local.get $i) (i32.const 2654290) (i32.const 1))
                        (i32.ne (local.get $i) (i32.sub (global.get $em_count) (i32.const 1))))
                    (then (return (i32.const 0))))
                  (if (i32.and (call $em_is (local.get $i) (i32.const 2654375) (i32.const 4)) (i32.lt_s (local.get $from) (i32.const 0)))
                    (then (local.set $from (local.get $i))))))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $scan)))
  (if (i32.or (i32.ne (local.get $depth) (i32.const 0)) (i32.lt_s (local.get $from) (i32.const 0)))
    (then (return (i32.const 0))))
  (global.set $em_from (local.get $from))
  (global.set $em_pos (i32.add (local.get $from) (i32.const 1)))
  (call $em_list (i32.const 0)) (drop) (local.set $head)
  (if (i32.eqz (global.get $em_ok)) (then (return (i32.const 0))))
  (if (i32.and (i32.lt_u (global.get $em_pos) (global.get $em_count))
        (i32.eqz (call $em_clause_end (global.get $em_pos))))
    (then (return (i32.const 0))))
  (local.set $i (i32.const 1)) (local.set $start (i32.const 1))
  (local.set $depth (i32.const 0))
  (block $targets_done
    (loop $target
      (br_if $targets_done (i32.ge_u (local.get $i) (local.get $from)))
      (if (call $em_is (local.get $i) (i32.const 2654371) (i32.const 1)) (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
      (if (call $em_is (local.get $i) (i32.const 2654372) (i32.const 1)) (then (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
      (if (i32.and (i32.eqz (local.get $depth)) (call $em_is (local.get $i) (i32.const 2654374) (i32.const 1)))
        (then
          (i32.store offset=12 (call $em_token (local.get $start)) (local.get $i))
          (global.set $em_targets (i32.add (global.get $em_targets) (i32.const 1)))
          (local.set $start (i32.add (local.get $i) (i32.const 1)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $target)))
  (i32.store offset=12 (call $em_token (local.get $start)) (local.get $from))
  (global.set $em_targets (i32.add (global.get $em_targets) (i32.const 1)))
  (local.get $head))

(func $em_qualifier (param $target i32) (param $width i32) (result i32 i32)
  (local $q i32) (local $qn i32) (local $end i32) (local $i i32) (local $offset i32)
  (local $p i32) (local $n i32)
  (block $done
    (loop $target
      (br_if $done (i32.eqz (local.get $width)))
      (local.set $end (i32.load offset=12 (call $em_token (local.get $target))))
      (local.set $n (i32.sub (local.get $end) (local.get $target)))
      (if (i32.or (i32.lt_u (local.get $n) (i32.const 3)) (i32.eqz (i32.and (local.get $n) (i32.const 1))))
        (then (return (i32.const 0) (i32.const 0))))
      (local.set $i (local.get $target)) (local.set $offset (i32.const 0))
      (block $tokens_done
        (loop $token
          (br_if $tokens_done (i32.ge_u (local.get $i) (local.get $end)))
          (if (i32.and (local.get $offset) (i32.const 1))
            (then (if (i32.eqz (call $em_is (local.get $i) (i32.const 2654373) (i32.const 1))) (then (return (i32.const 0) (i32.const 0)))))
            (else (if (i32.eqz (call $em_ident (local.get $i))) (then (return (i32.const 0) (i32.const 0))))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (local.set $offset (i32.add (local.get $offset) (i32.const 1))) (br $token)))
      (call $em_text (i32.sub (local.get $end) (i32.const 3))) (local.set $n) (local.set $p)
      (if (i32.and (i32.ne (local.get $qn) (i32.const 0))
            (i32.eqz (call $eq (local.get $p) (local.get $n) (local.get $q) (local.get $qn))))
        (then (return (i32.const 0) (i32.const 0))))
      (local.set $q (local.get $p)) (local.set $qn (local.get $n))
      (local.set $target (i32.add (local.get $end) (i32.const 1)))
      (local.set $width (i32.sub (local.get $width) (i32.const 1))) (br $target)))
  (local.get $q) (local.get $qn))

(func $em_legacy (param $column i32) (result i32)
  (if (i32.eqz (local.get $column)) (then (return (i32.const 0))))
  (i32.and
    (i32.and (i32.ne (call $child (local.get $column) (i32.const 14)) (i32.const 0))
             (i32.eqz (call $number (local.get $column) (i32.const 3))))
    (i32.and (i32.eqz (call $child (local.get $column) (i32.const 10)))
             (i32.eqz (call $text_len (local.get $column) (i32.const 11))))))

(func $em_table_matches (param $row i32) (param $table i32) (result i32)
  (local $count i32) (local $i i32) (local $field i32)
  (local $p i32) (local $n i32) (local $q i32) (local $m i32)
  (local.set $count (i32.load offset=8 (local.get $row)))
  (block $done
    (loop $part
      (br_if $done (i32.ge_u (local.get $i) (local.get $count)))
      (local.set $field (i32.add (i32.sub (i32.const 4) (local.get $count)) (local.get $i)))
      (call $text (local.get $table) (local.get $field)) (local.set $n) (local.set $p)
      (if (i32.and (i32.eq (local.get $field) (i32.const 2)) (i32.eqz (local.get $n)))
        (then (call $text (global.get $gen_catalog) (i32.const 2)) (local.set $n) (local.set $p)))
      (call $get_text (local.get $row) (i32.add (i32.const 16) (i32.mul (local.get $i) (i32.const 8)))) (local.set $m) (local.set $q)
      (if (i32.eqz (call $eq (local.get $p) (local.get $n) (local.get $q) (local.get $m)))
        (then
          (if (i32.ne (global.get $gen_engine) (i32.const 1)) (then (return (i32.const 0))))
          (if (i32.eqz (call $equal_fold (local.get $p) (local.get $n) (local.get $q) (local.get $m)))
            (then (return (i32.const 0))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $part)))
  (i32.const 1))

(func $em_model_width (param $column i32) (result i32)
  (local $model i32) (local $field i32) (local $width i32)
  (if (i32.eqz (call $child (local.get $column) (i32.const 14))) (then (return (i32.const 1))))
  (local.set $model (call $find_model (call $child (local.get $column) (i32.const 14))))
  (if (i32.eqz (local.get $model)) (then (return (i32.const -1))))
  (local.set $field (i32.load offset=12 (local.get $model)))
  (block $done
    (loop $field
      (br_if $done (i32.eqz (local.get $field)))
      (local.set $width (i32.add (local.get $width) (i32.const 1)))
      (local.set $field (call $next (local.get $field))) (br $field)))
  (local.get $width))

(func $embed_columns (param $query i32) (result i32)
  (local $head i32) (local $column i32) (local $needed i32) (local $relations i32)
  (local $text_mark i32) (local $work_mark i32) (local $width i32)
  (local $position i32) (local $target i32) (local $qp i32) (local $qn i32)
  (local $row i32) (local $found i32) (local $required i32) (local $skip i32)
  (local.set $head (call $child (local.get $query) (i32.const 4)))
  (local.set $column (local.get $head))
  (block $scan_done
    (loop $scan
      (br_if $scan_done (i32.eqz (local.get $column)))
      (if (call $em_legacy (local.get $column)) (then (local.set $needed (i32.const 1)) (br $scan_done)))
      (local.set $column (call $next (local.get $column))) (br $scan)))
  (if (i32.eqz (local.get $needed)) (then (return (local.get $head))))
  (local.set $text_mark (call $text_mark)) (local.set $work_mark (global.get $work_cursor))
  (block $finish
    (br_if $finish (i32.eqz (call $em_tokens (call $text (local.get $query) (i32.const 1)))))
    (local.set $relations (call $em_select))
    (br_if $finish (i32.eqz (local.get $relations)))
    ;; The Go version abandons all cloned changes if any later embed has no
    ;; model. Check that condition before making the first lasting mutation.
    (local.set $column (local.get $head))
    (block $models_done
      (loop $model
        (br_if $models_done (i32.eqz (local.get $column)))
        (br_if $finish (i32.lt_s (call $em_model_width (local.get $column)) (i32.const 0)))
        (local.set $column (call $next (local.get $column))) (br $model)))
    (local.set $column (local.get $head)) (local.set $target (i32.const 1))
    (block $columns_done
      (loop $column
        (br_if $columns_done (i32.eqz (local.get $column)))
        (local.set $width (call $em_model_width (local.get $column)))
        (if (call $em_legacy (local.get $column))
          (then
            (local.set $qp (i32.const 0)) (local.set $qn (i32.const 0))
            (if (i32.le_u (i32.add (local.get $position) (local.get $width)) (global.get $em_targets))
              (then (call $em_qualifier (local.get $target) (local.get $width)) (local.set $qn) (local.set $qp)))
            (local.set $found (i32.const 0)) (local.set $required (i32.const 1))
            (local.set $row (local.get $relations))
            (block $relations_done
              (loop $relation
                (br_if $relations_done (i32.eqz (local.get $row)))
                (block $next
                  (br_if $next (i32.eqz (call $em_table_matches (local.get $row) (call $child (local.get $column) (i32.const 14)))))
                  (br_if $next (i32.and (i32.ne (local.get $qn) (i32.const 0))
                    (i32.eqz (call $eq (local.get $qp) (local.get $qn) (call $get_text (local.get $row) (i32.const 40))))))
                  (local.set $found (i32.const 1))
                  (local.set $required (i32.and (local.get $required) (i32.load offset=12 (local.get $row)))))
                (local.set $row (call $next (local.get $row))) (br $relation)))
            (if (i32.and (local.get $found) (local.get $required))
              (then (i32.store (call $slot (local.get $column) (i32.const 3)) (i32.const 1))))))
        (local.set $skip (local.get $width))
        (block $skip_done
          (loop $skip
            (br_if $skip_done (i32.eqz (local.get $skip)))
            (br_if $skip_done (i32.ge_u (local.get $position) (global.get $em_targets)))
            (local.set $target (i32.add (i32.load offset=12 (call $em_token (local.get $target))) (i32.const 1)))
            (local.set $skip (i32.sub (local.get $skip) (i32.const 1)))
            (local.set $position (i32.add (local.get $position) (i32.const 1))) (br $skip)))
        (local.set $position (i32.add (local.get $position) (local.get $skip)))
        (local.set $column (call $next (local.get $column))) (br $column))))
  (global.set $work_cursor (local.get $work_mark))
  (call $text_reset (local.get $text_mark))
  (local.get $head))

;; Read-only SQL grammar words.
(data (i32.const 2654208) "\3c\6c\69\74\65\72\61\6c\3e") ;; '<literal>'
(data (i32.const 2654217) "\77\68\65\72\65") ;; 'where'
(data (i32.const 2654222) "\67\72\6f\75\70") ;; 'group'
(data (i32.const 2654227) "\68\61\76\69\6e\67") ;; 'having'
(data (i32.const 2654233) "\77\69\6e\64\6f\77") ;; 'window'
(data (i32.const 2654239) "\6f\72\64\65\72") ;; 'order'
(data (i32.const 2654244) "\6c\69\6d\69\74") ;; 'limit'
(data (i32.const 2654249) "\6f\66\66\73\65\74") ;; 'offset'
(data (i32.const 2654255) "\66\65\74\63\68") ;; 'fetch'
(data (i32.const 2654260) "\66\6f\72") ;; 'for'
(data (i32.const 2654263) "\71\75\61\6c\69\66\79") ;; 'qualify'
(data (i32.const 2654270) "\75\6e\69\6f\6e") ;; 'union'
(data (i32.const 2654275) "\69\6e\74\65\72\73\65\63\74") ;; 'intersect'
(data (i32.const 2654284) "\65\78\63\65\70\74") ;; 'except'
(data (i32.const 2654290) "\3b") ;; ';'
(data (i32.const 2654291) "\73\65\6c\65\63\74") ;; 'select'
(data (i32.const 2654297) "\77\69\74\68") ;; 'with'
(data (i32.const 2654301) "\6f\6e\6c\79") ;; 'only'
(data (i32.const 2654305) "\6c\61\74\65\72\61\6c") ;; 'lateral'
(data (i32.const 2654312) "\74\61\62\6c\65\73\61\6d\70\6c\65") ;; 'tablesample'
(data (i32.const 2654323) "\6e\61\74\75\72\61\6c") ;; 'natural'
(data (i32.const 2654330) "\6a\6f\69\6e") ;; 'join'
(data (i32.const 2654334) "\69\6e\6e\65\72") ;; 'inner'
(data (i32.const 2654339) "\63\72\6f\73\73") ;; 'cross'
(data (i32.const 2654344) "\6c\65\66\74") ;; 'left'
(data (i32.const 2654348) "\72\69\67\68\74") ;; 'right'
(data (i32.const 2654353) "\66\75\6c\6c") ;; 'full'
(data (i32.const 2654357) "\6f\75\74\65\72") ;; 'outer'
(data (i32.const 2654362) "\6f\6e") ;; 'on'
(data (i32.const 2654364) "\75\73\69\6e\67") ;; 'using'
(data (i32.const 2654369) "\61\73") ;; 'as'
(data (i32.const 2654371) "\28") ;; '('
(data (i32.const 2654372) "\29") ;; ')'
(data (i32.const 2654373) "\2e") ;; '.'
(data (i32.const 2654374) "\2c") ;; ','
(data (i32.const 2654375) "\66\72\6f\6d") ;; 'from'
