PRAGMA foreign_keys = ON;

CREATE TABLE conversation_turns (
  id TEXT PRIMARY KEY,
  lesson_id TEXT,
  revision_id TEXT,
  applied_revision_id TEXT,
  telegram_update_id INTEGER NOT NULL,
  telegram_user_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('answered', 'revised', 'failed')),
  operation_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (revision_id) REFERENCES revisions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (applied_revision_id) REFERENCES revisions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(question)) > 0),
  CHECK (length(trim(answer)) > 0)
);

CREATE INDEX conversation_turns_lesson_created
  ON conversation_turns(lesson_id, created_at);

CREATE INDEX conversation_turns_telegram_update
  ON conversation_turns(telegram_chat_id, telegram_update_id);

CREATE TRIGGER conversation_turns_are_immutable
BEFORE UPDATE ON conversation_turns
BEGIN
  SELECT RAISE(ABORT, 'conversation turns are immutable');
END;

CREATE TRIGGER conversation_turns_cannot_be_deleted
BEFORE DELETE ON conversation_turns
BEGIN
  SELECT RAISE(ABORT, 'conversation turns are immutable');
END;

CREATE TRIGGER conversation_turns_record_creation
AFTER INSERT ON conversation_turns
WHEN NEW.lesson_id IS NOT NULL
BEGIN
  INSERT INTO lesson_events (
    event_key, lesson_id, event_type, revision_id, payload_json, created_at
  ) VALUES (
    'conversation:' || NEW.id,
    NEW.lesson_id,
    'conversation_turn_created',
    NEW.applied_revision_id,
    json_object(
      'telegram_update_id', NEW.telegram_update_id,
      'status', NEW.status,
      'operation_key', NEW.operation_key
    ),
    NEW.created_at
  );
END;
