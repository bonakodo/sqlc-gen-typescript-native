CREATE TYPE live_mood AS ENUM ('quiet', 'comma,value', 'NULL');
CREATE TABLE live_probes (
  id INTEGER PRIMARY KEY,
  document JSONB NOT NULL,
  states live_mood[] NOT NULL,
  numbers NUMERIC[] NOT NULL,
  boxes BOX[] NOT NULL,
  pt POINT NOT NULL,
  disk CIRCLE NOT NULL,
  json_documents JSON[] NOT NULL DEFAULT '{}',
  documents JSONB[] NOT NULL DEFAULT '{}',
  optional_document JSONB,
  optional_documents JSONB[]
);
