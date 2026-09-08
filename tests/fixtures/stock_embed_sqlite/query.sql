-- name: CommaRight :many
SELECT sqlc.embed(a), sqlc.embed(c)
FROM a, b RIGHT JOIN c ON b.id = c.id;

-- name: CommaFull :many
SELECT sqlc.embed(a), sqlc.embed(b), sqlc.embed(c)
FROM a, b FULL JOIN c ON b.id = c.id;
