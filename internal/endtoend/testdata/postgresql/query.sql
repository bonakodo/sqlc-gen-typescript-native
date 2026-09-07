-- name: CreateAuthor :one
INSERT INTO authors (id, name, bio, score)
VALUES (sqlc.arg(id), sqlc.arg(name), sqlc.narg(bio), sqlc.arg(score)) RETURNING *;
-- name: GetAuthor :one
SELECT * FROM authors WHERE id = sqlc.arg(id);
-- name: ListAuthors :many
SELECT * FROM authors ORDER BY id;
-- name: RenameAuthor :exec
UPDATE authors SET name = sqlc.arg(name) WHERE id = sqlc.arg(id);
-- name: DeleteAuthor :execrows
DELETE FROM authors WHERE id = sqlc.arg(id);
-- name: InsertAuthorResult :execresult
INSERT INTO authors (id, name) VALUES (sqlc.arg(id), sqlc.arg(name));
-- name: FindAuthors :many
SELECT * FROM authors WHERE id = ANY(sqlc.arg(ids)::int[]) ORDER BY id;
-- name: GetRecord :one
SELECT * FROM records WHERE id = sqlc.arg(id);
