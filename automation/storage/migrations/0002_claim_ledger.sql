PRAGMA foreign_keys = ON;

CREATE TABLE claim_ledgers (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL UNIQUE,
  operation_key TEXT NOT NULL UNIQUE,
  claims_hash TEXT NOT NULL CHECK (length(claims_hash) = 64),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (revision_id) REFERENCES revisions(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  claim_key TEXT NOT NULL,
  statement TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_title TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'standard', 'vendor_documentation', 'official_documentation',
    'official_repository', 'paper', 'dataset'
  )),
  evidence_locator TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified', 'needs_review', 'conflicting')),
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (ledger_id) REFERENCES claim_ledgers(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (revision_id) REFERENCES revisions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  UNIQUE (revision_id, claim_key),
  CHECK (length(trim(statement)) > 0),
  CHECK (length(trim(source_url)) > 0),
  CHECK (length(trim(evidence_locator)) > 0)
);

CREATE INDEX claims_revision_key
  ON claims(revision_id, claim_key);

CREATE INDEX claims_source_type
  ON claims(source_type, verification_status);

CREATE TRIGGER claim_ledgers_are_immutable
BEFORE UPDATE ON claim_ledgers
BEGIN
  SELECT RAISE(ABORT, 'claim ledgers are immutable');
END;

CREATE TRIGGER claim_ledgers_cannot_be_deleted
BEFORE DELETE ON claim_ledgers
BEGIN
  SELECT RAISE(ABORT, 'claim ledgers are immutable');
END;

CREATE TRIGGER claims_are_immutable
BEFORE UPDATE ON claims
BEGIN
  SELECT RAISE(ABORT, 'claims are immutable');
END;

CREATE TRIGGER claims_cannot_be_deleted
BEFORE DELETE ON claims
BEGIN
  SELECT RAISE(ABORT, 'claims are immutable');
END;

CREATE TRIGGER claim_ledgers_record_creation
AFTER INSERT ON claim_ledgers
BEGIN
  INSERT INTO lesson_events (
    event_key, lesson_id, event_type, revision_id, payload_json, created_at
  )
  SELECT
    'claim_ledger:' || NEW.id,
    revision.lesson_id,
    'claim_ledger_created',
    NEW.revision_id,
    json_object('claims_hash', NEW.claims_hash, 'operation_key', NEW.operation_key),
    NEW.created_at
  FROM revisions AS revision
  WHERE revision.id = NEW.revision_id;
END;
