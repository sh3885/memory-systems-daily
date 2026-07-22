import { assertTransition, canonicalizeContent, createId, sha256Hex } from "../domain/lesson-state.mjs";

const LESSON_SELECT = `
  SELECT
    lesson.*,
    head.revision_id AS current_revision_id,
    COALESCE(head.revision_number, 0) AS current_revision_number,
    head.content_hash AS current_content_hash
  FROM lessons AS lesson
  LEFT JOIN lesson_heads AS head ON head.lesson_id = lesson.id
`;

export class StoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.details = details;
  }
}

function requireText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new StoreError("INVALID_INPUT", `${field} is required`, { field });
  return normalized;
}

function requireContent(value) {
  const canonical = canonicalizeContent(value);
  if (!canonical.trim()) throw new StoreError("INVALID_INPUT", "content is required", { field: "content" });
  return canonical;
}

function normalizeFutureTimestamp(value, now, field = "expiresAt") {
  const normalized = normalizeTimestamp(value, field);
  if (normalized <= now) {
    throw new StoreError("INVALID_EXPIRY", `${field} must be after the current time`, { now, [field]: normalized });
  }
  return normalized;
}

function normalizeTimestamp(value, field = "timestamp") {
  const raw = requireText(value, field);
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) {
    throw new StoreError("INVALID_EXPIRY", `${field} must be a valid timestamp`, { [field]: raw });
  }
  return new Date(milliseconds).toISOString();
}

function mapLesson(row) {
  if (!row) return null;
  return {
    id: row.id,
    lessonDate: row.lesson_date,
    curriculumRef: row.curriculum_ref,
    state: row.state,
    stateVersion: row.state_version,
    currentRevisionId: row.current_revision_id,
    currentRevisionNumber: row.current_revision_number,
    currentContentHash: row.current_content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRevision(row) {
  if (!row) return null;
  return {
    id: row.id,
    lessonId: row.lesson_id,
    revisionNumber: row.revision_number,
    content: row.content,
    contentHash: row.content_hash,
    createdBy: row.created_by,
    changeSummary: row.change_summary,
    operationKey: row.operation_key,
    createdAt: row.created_at,
  };
}

function mapChallenge(row) {
  if (!row) return null;
  return {
    id: row.id,
    lessonId: row.lesson_id,
    revisionId: row.revision_id,
    revisionNumber: row.revision_number,
    contentHash: row.content_hash,
    telegramUserId: row.telegram_user_id,
    telegramChatId: row.telegram_chat_id,
    nonceHash: row.nonce_hash,
    operationKey: row.operation_key,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    invalidatedAt: row.invalidated_at,
    invalidationReason: row.invalidation_reason,
  };
}

function mapApproval(row) {
  if (!row) return null;
  return {
    id: row.id,
    challengeId: row.challenge_id,
    lessonId: row.lesson_id,
    revisionId: row.revision_id,
    revisionNumber: row.revision_number,
    contentHash: row.content_hash,
    telegramUserId: row.telegram_user_id,
    telegramChatId: row.telegram_chat_id,
    operationKey: row.operation_key,
    status: row.status,
    approvedAt: row.approved_at,
    expiresAt: row.expires_at,
    invalidatedAt: row.invalidated_at,
    invalidationReason: row.invalidation_reason,
    consumedAt: row.consumed_at,
  };
}

function revisionOperationMatches(revision, expected) {
  return Boolean(
    revision &&
    revision.lessonId === expected.lessonId &&
    revision.contentHash === expected.contentHash &&
    revision.createdBy === expected.createdBy &&
    revision.changeSummary === expected.changeSummary
  );
}

function challengeOperationMatches(challenge, expected) {
  return Boolean(
    challenge &&
    challenge.lessonId === expected.lessonId &&
    challenge.telegramUserId === expected.telegramUserId &&
    challenge.telegramChatId === expected.telegramChatId &&
    challenge.nonceHash === expected.nonceHash &&
    challenge.expiresAt === expected.expiresAt
  );
}

export class D1LessonStore {
  constructor(db, options = {}) {
    if (!db?.prepare || !db?.batch) {
      throw new StoreError("INVALID_DATABASE", "A D1-compatible database binding is required");
    }
    this.db = db;
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? createId;
  }

  async createLesson({ lessonDate, curriculumRef }) {
    const date = requireText(lessonDate, "lessonDate");
    const curriculum = requireText(curriculumRef, "curriculumRef");
    const timestamp = this.now();
    const id = this.id("lesson");
    await this.db.prepare(`
      INSERT OR IGNORE INTO lessons (
        id, lesson_date, curriculum_ref, state, state_version, created_at, updated_at
      ) VALUES (?1, ?2, ?3, 'scheduled', 0, ?4, ?4)
    `).bind(id, date, curriculum, timestamp).run();

    const lesson = await this.getLessonByDate(date);
    if (lesson.curriculumRef !== curriculum) {
      throw new StoreError("SCHEDULE_CONFLICT", "The lesson date is already assigned to another curriculum item", {
        lessonDate: date,
        existingCurriculumRef: lesson.curriculumRef,
        requestedCurriculumRef: curriculum,
      });
    }
    return lesson;
  }

  async getLesson(id) {
    const row = await this.db.prepare(`${LESSON_SELECT} WHERE lesson.id = ?1`).bind(id).first();
    if (!row) throw new StoreError("LESSON_NOT_FOUND", `Lesson not found: ${id}`, { id });
    return mapLesson(row);
  }

  async getLessonByDate(lessonDate) {
    const row = await this.db.prepare(`${LESSON_SELECT} WHERE lesson.lesson_date = ?1`).bind(lessonDate).first();
    if (!row) throw new StoreError("LESSON_NOT_FOUND", `Lesson not found for date: ${lessonDate}`, { lessonDate });
    return mapLesson(row);
  }

  async transitionLesson(id, toState, expectedVersion) {
    if (toState === "approved" || toState === "publishing") {
      throw new StoreError("SENSITIVE_TRANSITION", `${toState} requires a dedicated approval method`, { id, toState });
    }
    const before = await this.getLesson(id);
    if (before.stateVersion !== expectedVersion) {
      throw new StoreError("VERSION_CONFLICT", "Lesson state version is stale", {
        expectedVersion,
        actualVersion: before.stateVersion,
      });
    }
    assertTransition(before.state, toState);
    const result = await this.db.prepare(`
      UPDATE lessons
      SET state = ?1, state_version = state_version + 1, updated_at = ?2
      WHERE id = ?3 AND state = ?4 AND state_version = ?5
    `).bind(toState, this.now(), id, before.state, expectedVersion).run();

    if ((result?.meta?.changes ?? 0) !== 1) {
      throw new StoreError("VERSION_CONFLICT", "Lesson changed while applying transition", { id, expectedVersion });
    }
    return this.getLesson(id);
  }

  async appendRevision({ lessonId, content, createdBy, changeSummary, operationKey }) {
    const key = requireText(operationKey, "operationKey");
    const body = requireContent(content);
    const author = requireText(createdBy, "createdBy");
    const summary = requireText(changeSummary, "changeSummary");
    const contentHash = await sha256Hex(body);
    const expectedOperation = { lessonId, contentHash, createdBy: author, changeSummary: summary };
    const existing = await this.findRevisionByOperationKey(key);
    if (existing) {
      if (!revisionOperationMatches(existing, expectedOperation)) {
        throw new StoreError("OPERATION_KEY_CONFLICT", "Operation key was reused with a different revision payload", {
          operationKey: key,
        });
      }
      return existing;
    }

    const lesson = await this.getLesson(lessonId);
    const revision = {
      id: this.id("revision"),
      number: lesson.currentRevisionNumber + 1,
      hash: contentHash,
      createdAt: this.now(),
    };

    try {
      await this.db.prepare(`
        INSERT INTO revisions (
          id, lesson_id, revision_number, content, content_hash,
          created_by, change_summary, operation_key, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      `).bind(
        revision.id,
        lessonId,
        revision.number,
        body,
        revision.hash,
        author,
        summary,
        key,
        revision.createdAt,
      ).run();
    } catch (error) {
      const committed = await this.findRevisionByOperationKey(key);
      if (revisionOperationMatches(committed, expectedOperation)) return committed;
      if (committed) {
        throw new StoreError("OPERATION_KEY_CONFLICT", "Operation key was committed with a different revision payload", {
          operationKey: key,
        });
      }
      throw new StoreError("REVISION_CONFLICT", "Could not append the next immutable revision", {
        lessonId,
        attemptedRevisionNumber: revision.number,
        cause: error.message,
      });
    }
    return this.getRevision(revision.id);
  }

  async getRevision(id) {
    const row = await this.db.prepare("SELECT * FROM revisions WHERE id = ?1").bind(id).first();
    if (!row) throw new StoreError("REVISION_NOT_FOUND", `Revision not found: ${id}`, { id });
    return mapRevision(row);
  }

  async findRevisionByOperationKey(operationKey) {
    const row = await this.db.prepare("SELECT * FROM revisions WHERE operation_key = ?1").bind(operationKey).first();
    return mapRevision(row);
  }

  async issueApprovalChallenge({ lessonId, telegramUserId, telegramChatId, nonce, expiresAt, operationKey }) {
    const key = requireText(operationKey, "operationKey");
    const userId = requireText(telegramUserId, "telegramUserId");
    const chatId = requireText(telegramChatId, "telegramChatId");
    const nonceHash = await sha256Hex(requireText(nonce, "nonce"));
    const normalizedExpiry = normalizeTimestamp(expiresAt, "expiresAt");
    const expectedOperation = {
      lessonId,
      telegramUserId: userId,
      telegramChatId: chatId,
      nonceHash,
      expiresAt: normalizedExpiry,
    };
    const existing = await this.findChallengeByOperationKey(key);
    if (existing) {
      if (!challengeOperationMatches(existing, expectedOperation)) {
        throw new StoreError("OPERATION_KEY_CONFLICT", "Operation key was reused with a different challenge payload", {
          operationKey: key,
        });
      }
      return existing;
    }

    const lesson = await this.getLesson(lessonId);
    if (lesson.state !== "review_ready" || !lesson.currentRevisionId) {
      throw new StoreError("NOT_REVIEW_READY", "Lesson must have a current review-ready revision", { lessonId });
    }
    const createdAt = this.now();
    const challenge = {
      id: this.id("challenge"),
      nonceHash,
      expiresAt: normalizeFutureTimestamp(normalizedExpiry, createdAt),
    };

    try {
      await this.db.prepare(`
        INSERT INTO approval_challenges (
          id, lesson_id, revision_id, revision_number, content_hash,
          telegram_user_id, telegram_chat_id, nonce_hash, operation_key,
          status, created_at, expires_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', ?10, ?11)
      `).bind(
        challenge.id,
        lessonId,
        lesson.currentRevisionId,
        lesson.currentRevisionNumber,
        lesson.currentContentHash,
        userId,
        chatId,
        challenge.nonceHash,
        key,
        createdAt,
        challenge.expiresAt,
      ).run();
    } catch (error) {
      const committed = await this.findChallengeByOperationKey(key);
      if (challengeOperationMatches(committed, expectedOperation)) return committed;
      if (committed) {
        throw new StoreError("OPERATION_KEY_CONFLICT", "Operation key was committed with a different challenge payload", {
          operationKey: key,
        });
      }
      throw new StoreError("CHALLENGE_CONFLICT", "Approval challenge could not be issued", {
        lessonId,
        cause: error.message,
      });
    }
    return this.getChallenge(challenge.id);
  }

  async getChallenge(id) {
    const row = await this.db.prepare("SELECT * FROM approval_challenges WHERE id = ?1").bind(id).first();
    if (!row) throw new StoreError("CHALLENGE_NOT_FOUND", `Approval challenge not found: ${id}`, { id });
    return mapChallenge(row);
  }

  async findChallengeByOperationKey(operationKey) {
    const row = await this.db.prepare("SELECT * FROM approval_challenges WHERE operation_key = ?1").bind(operationKey).first();
    return mapChallenge(row);
  }

  async consumeApprovalChallenge({ challengeId, telegramUserId, telegramChatId, nonce, operationKey }) {
    const userId = requireText(telegramUserId, "telegramUserId");
    const chatId = requireText(telegramChatId, "telegramChatId");
    const nonceHash = await sha256Hex(requireText(nonce, "nonce"));
    const key = requireText(operationKey, "operationKey");
    const challenge = await this.getChallenge(challengeId);

    if (challenge.telegramUserId !== userId || challenge.telegramChatId !== chatId || challenge.nonceHash !== nonceHash) {
      throw new StoreError("APPROVAL_IDENTITY_MISMATCH", "Approval callback does not match its issued binding", {
        challengeId,
      });
    }
    if (challenge.status === "consumed") {
      const existing = await this.findApprovalByChallenge(challengeId);
      if (existing) return existing;
    }
    if (challenge.status !== "pending") {
      throw new StoreError("STALE_APPROVAL", "Approval challenge is no longer pending", {
        challengeId,
        status: challenge.status,
      });
    }

    const approvedAt = this.now();
    if (challenge.expiresAt <= approvedAt) {
      await this.db.prepare(`
        UPDATE approval_challenges
        SET status = 'expired', invalidated_at = ?1, invalidation_reason = 'expired'
        WHERE id = ?2 AND status = 'pending'
      `).bind(approvedAt, challengeId).run();
      throw new StoreError("APPROVAL_EXPIRED", "Approval challenge has expired", { challengeId });
    }

    const approvalId = this.id("approval");
    try {
      await this.db.batch([
        this.db.prepare(`
          UPDATE approval_challenges
          SET status = 'consumed', consumed_at = ?1
          WHERE id = ?2 AND status = 'pending' AND expires_at > ?1
            AND telegram_user_id = ?3 AND telegram_chat_id = ?4 AND nonce_hash = ?5
        `).bind(approvedAt, challengeId, userId, chatId, nonceHash),
        this.db.prepare(`
          INSERT INTO approvals (
            id, challenge_id, lesson_id, revision_id, revision_number, content_hash,
            telegram_user_id, telegram_chat_id, operation_key, status, approved_at, expires_at
          )
          SELECT ?1, id, lesson_id, revision_id, revision_number, content_hash,
                 telegram_user_id, telegram_chat_id, ?2, 'active', ?3, expires_at
          FROM approval_challenges
          WHERE id = ?4 AND status = 'consumed'
        `).bind(approvalId, key, approvedAt, challengeId),
        this.db.prepare(`
          UPDATE lessons
          SET state = 'approved', state_version = state_version + 1, updated_at = ?1
          WHERE id = ?2 AND state = 'review_ready'
        `).bind(approvedAt, challenge.lessonId),
      ]);
    } catch (error) {
      const committed = await this.findApprovalByChallenge(challengeId);
      if (committed && committed.telegramUserId === userId && committed.telegramChatId === chatId) return committed;
      throw new StoreError("APPROVAL_CONFLICT", "Approval could not be recorded atomically", {
        challengeId,
        cause: error.message,
      });
    }
    return this.getApproval(approvalId);
  }

  async getApproval(id) {
    const row = await this.db.prepare("SELECT * FROM approvals WHERE id = ?1").bind(id).first();
    if (!row) throw new StoreError("APPROVAL_NOT_FOUND", `Approval not found: ${id}`, { id });
    return mapApproval(row);
  }

  async findApprovalByChallenge(challengeId) {
    const row = await this.db.prepare("SELECT * FROM approvals WHERE challenge_id = ?1").bind(challengeId).first();
    return mapApproval(row);
  }

  async startPublishing({ lessonId, approvalId }) {
    const lesson = await this.getLesson(lessonId);
    const approval = await this.getApproval(approvalId);
    const timestamp = this.now();
    if (
      !["approved", "publish_failed"].includes(lesson.state) ||
      approval.lessonId !== lessonId ||
      approval.status !== "active" ||
      approval.revisionId !== lesson.currentRevisionId ||
      approval.revisionNumber !== lesson.currentRevisionNumber ||
      approval.contentHash !== lesson.currentContentHash
    ) {
      throw new StoreError("STALE_APPROVAL", "Approval does not match the current approved lesson revision", {
        lessonId,
        approvalId,
      });
    }
    if (approval.expiresAt <= timestamp) {
      await this.db.prepare(`
        UPDATE approvals
        SET status = 'expired', invalidated_at = ?1, invalidation_reason = 'expired'
        WHERE id = ?2 AND status = 'active'
      `).bind(timestamp, approvalId).run();
      throw new StoreError("APPROVAL_EXPIRED", "Approval expired before publishing started", { approvalId });
    }

    const result = await this.db.prepare(`
      UPDATE lessons
      SET state = 'publishing', state_version = state_version + 1, updated_at = ?1
      WHERE id = ?2 AND state = ?3 AND state_version = ?4
    `).bind(timestamp, lessonId, lesson.state, lesson.stateVersion).run();
    if ((result?.meta?.changes ?? 0) !== 1) {
      throw new StoreError("VERSION_CONFLICT", "Lesson changed before publishing started", { lessonId });
    }
    return this.getLesson(lessonId);
  }
}
