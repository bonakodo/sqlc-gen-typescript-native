-- name: InnerScores :many
SELECT sqlc.embed(students), sqlc.embed(test_scores)
FROM students INNER JOIN test_scores ON test_scores.student_id = students.id;

-- name: LeftScores :many
SELECT sqlc.embed(students), sqlc.embed(test_scores)
FROM students LEFT JOIN test_scores ON test_scores.student_id = students.id;

-- name: RightScores :many
SELECT sqlc.embed(students), sqlc.embed(test_scores)
FROM students RIGHT JOIN test_scores ON test_scores.student_id = students.id;

-- name: FullScores :many
SELECT sqlc.embed(students), sqlc.embed(test_scores)
FROM students FULL JOIN test_scores ON test_scores.student_id = students.id;

-- name: AliasScores :many
SELECT sqlc.embed(s), sqlc.embed(ts)
FROM students AS s LEFT JOIN test_scores AS ts ON ts.student_id = s.id;

-- name: SelfJoin :many
SELECT sqlc.embed(s1), sqlc.embed(s2)
FROM students AS s1 LEFT JOIN students AS s2 ON s1.id = s2.id;
