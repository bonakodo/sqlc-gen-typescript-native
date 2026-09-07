-- name: CreateAuthor :one
INSERT INTO authors (id, name, bio)
VALUES (sqlc.arg(id), sqlc.arg(name), sqlc.narg(bio)) RETURNING *;

-- name: ListAuthors :many
SELECT * FROM authors ORDER BY id;

-- name: DeleteAuthor :execrows
DELETE FROM authors WHERE id = sqlc.arg(id);
