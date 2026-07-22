PRAGMA foreign_keys = ON;

ALTER TABLE conversation_turns
  ADD COLUMN provider_id TEXT;

ALTER TABLE conversation_turns
  ADD COLUMN provider_model TEXT;

ALTER TABLE conversation_turns
  ADD COLUMN provider_attempts_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(provider_attempts_json));

CREATE INDEX conversation_turns_provider
  ON conversation_turns(provider_id, provider_model);
