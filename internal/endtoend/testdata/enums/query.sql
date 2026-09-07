-- name: CreateAccount :one
INSERT INTO accounts (id, status, previous_status, status_history, archived_status)
VALUES (
  sqlc.arg(id),
  sqlc.arg(status)::status,
  sqlc.narg(previous_status)::status,
  sqlc.arg(status_history)::status[],
  sqlc.arg(archived_status)::archive.status
)
RETURNING *;

-- name: GetAccount :one
SELECT * FROM accounts WHERE id = sqlc.arg(id);
