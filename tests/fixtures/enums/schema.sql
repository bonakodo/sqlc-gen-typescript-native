CREATE TYPE status AS ENUM ('active', 'inactive');
CREATE TYPE unused_label AS ENUM ('needs review', 'can''t', '');
CREATE SCHEMA archive;
CREATE TYPE archive.status AS ENUM ('archived', 'deleted');

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  status status NOT NULL,
  previous_status status,
  status_history status[] NOT NULL,
  archived_status archive.status NOT NULL
);
