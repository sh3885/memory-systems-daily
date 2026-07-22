import { assertTransition, canonicalizeContent, createId, sha256Hex } from "../domain/lesson-state.mjs";
import { claimsHash, normalizeClaims } from "../research/claim-ledger.mjs";

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

function mapClaimLedger(row, claims = []) {
  if (!row) return null;
  return {
    id: row.id,
    revisionId: row.revision_id,
    operationKey: row.operation_key,
    claimsHash: row.claims_hash,
    createdBy: row.created_by,
    createdAt: row.created_at,
    claims,
  };
}

function mapClaim(row) {
  if (!row) return null;
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    revisionId: row.revision_id,
    claimKey: row.claim_key,
    statement: row.statement,
    sourceUrl: row.source_url,
    sourceTitle: row.source_title,
    sourceType: row.source_type,
    evidenceLocator: row.evidence_locator,
    confidence: row.confidence,
    verificationStatus: row.verification_status,
    checkedAt: row.checked_at,
    createdAt: row.created_at,
  };
}

function mapConversationTurn(row) {
  if (!row) return null;
  const providerAttemptsJson = row.provider_attempts_json ?? "[]";
  return {
    id: row.id,
    lessonId: row.lesson_id,
    revisionId: row.revision_id,
    appliedRevisionId: row.applied_revision_id,
    telegramUpdateId: row.telegram_update_id,
    telegramUserId: row.telegram_user_id,
    telegramChatId: row.telegram_chat_id,
    question: row.question,
    answer: row.answer,
    status: row.status,
    providerId: row.provider_id ?? null,
    providerModel: row.provider_model ?? null,
    providerAttempts: JSON.parse(providerAttemptsJson),
    operationKey: row.operation_key,
    createdAt: row.created_at,
  };
}

function mapPublication(row) {
  if (!row) return null;
  return {
    id: row.id,
    lessonId: row.lesson_id,
    revisionId: row.revision_id,
    approvalId: row.approval_id,
    operationKey: row.operation_key,
    status: row.status,
    provider: row.provider,
    branch: row.branch,
    filePath: row.file_path,
    commitSha: row.commit_sha,
    pullRequestUrl: row.pull_request_url,
    deploymentUrl: row.deployment_url,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
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

function claimLedgerOperationMatches(ledger, expected) {
  return Boolean(
    ledger &&
    ledger.revisionId === expected.revisionId &&
    ledger.claimsHash === expected.claimsHash &&
    ledger.createdBy === expected.createdBy
  );
}

function conversationOperationMatches(turn, expected) {
  return Boolean(
    turn &&
    turn.lessonId === expected.lessonId &&
    turn.revisionId === expected.revisionId &&
    turn.appliedRevisionId === expected.appliedRevisionId &&
    turn.telegramUpdateId === expected.telegramUpdateId &&
    turn.telegramUserId === expected.telegramUserId &&
    turn.telegramChatId === expected.telegramChatId &&
    turn.question === expected.question &&
    turn.answer === expected.answer &&
    turn.status === expected.status &&
    turn.providerId === expected.providerId &&
    turn.providerModel === expected.providerModel &&
    JSON.stringify(turn.providerAttempts) === expected.providerAttemptsJson
  );
}

function publicationOperationMatches(publication, expected) {
  return Boolean(
    publication &&
    publication.lessonId === expected.lessonId &&
    publication.revisionId === expected.revisionId &&
    publication.approvalId === expected.approvalId &&
    publication.status === expected.status
  );
}

function normalizeProviderMetadata(provider) {
  if (!provider) {
    return { providerId: null, providerModel: null, providerAttemptsJson: "[]" };
  }
  const providerId = String(provider.id ?? "").trim() || null;
  const providerModel = String(provider.model ?? "").trim() || null;
  const attempts = Array.isArray(provider.attempts) ? provider.attempts.map((attempt) => ({
    providerId: String(attempt.providerId ?? "").trim() || null,
    model: String(attempt.model ?? "").trim() || null,
    reason: String(attempt.reason ?? "").trim() || null,
    code: String(attempt.code ?? "").trim() || null,
    status: attempt.status === undefined || attempt.status === null ? null : Number(attempt.status),
  })) : [];
  return {
    providerId,
    providerModel,
    providerAttemptsJson: JSON.stringify(attempts),
  };
}

async function allRows(statement) {
  const response = await statement.all();
  return response?.results ?? [];
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

  async getActiveApprovalForLesson(lessonId) {
    const row = await this.db.prepare(`
      SELECT *
      FROM approvals
      WHERE lesson_id = ?1 AND status = 'active'
      ORDER BY approved_at DESC
      LIMIT 1
    `).bind(lessonId).first();
    return mapApproval(row);
  }

  async recordClaimLedger({ revisionId, claims, createdBy, operationKey }) {
    const key = requireText(operationKey, "operationKey");
    const revision = await this.getRevision(requireText(revisionId, "revisionId"));
    const author = requireText(createdBy, "createdBy");
    const normalizedClaims = normalizeClaims(claims, { checkedAt: this.now() });
    const hash = await claimsHash(normalizedClaims);
    const expectedOperation = { revisionId: revision.id, claimsHash: hash, createdBy: author };
    const existing = await this.findClaimLedgerByOperationKey(key);
    if (existing) {
      if (!claimLedgerOperationMatches(existing, expectedOperation)) {
        throw new StoreError("OPERATION_KEY_CONFLICT", "Operation key was reused with a different claim ledger payload", {
          operationKey: key,
        });
      }
      return existing;
    }

    const committedForRevision = await this.getClaimLedgerByRevision(revision.id);
    if (committedForRevision) {
      throw new StoreError("CLAIM_LEDGER_CONFLICT", "Revision already has a claim ledger", {
        revisionId: revision.id,
        existingLedgerId: committedForRevision.id,
      });
    }

    const ledger = { id: this.id("claim_ledger"), createdAt: this.now(), claimsHash: hash };
    try {
      const statements = [
        this.db.prepare(`
          INSERT INTO claim_ledgers (
            id, revision_id, operation_key, claims_hash, created_by, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        `).bind(ledger.id, revision.id, key, ledger.claimsHash, author, ledger.createdAt),
        ...normalizedClaims.map((claim) => this.db.prepare(`
          INSERT INTO claims (
            id, ledger_id, revision_id, claim_key, statement,
            source_url, source_title, source_type, evidence_locator,
            confidence, verification_status, checked_at, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        `).bind(
          this.id("claim"),
          ledger.id,
          revision.id,
          claim.claimKey,
          claim.statement,
          claim.sourceUrl,
          claim.sourceTitle,
          claim.sourceType,
          claim.evidenceLocator,
          claim.confidence,
          claim.verificationStatus,
          claim.checkedAt,
          ledger.createdAt,
        )),
      ];
      await this.db.batch(statements);
    } catch (error) {
      const committed = await this.findClaimLedgerByOperationKey(key);
      if (claimLedgerOperationMatches(committed, expectedOperation)) return committed;
      if (committed) {
        throw new StoreError("OPERATION_KEY_CONFLICT", "Operation key was committed with a different claim ledger payload", {
          operationKey: key,
        });
      }
      throw new StoreError("CLAIM_LEDGER_CONFLICT", "Claim ledger could not be recorded atomically", {
        revisionId: revision.id,
        cause: error.message,
      });
    }

    return this.getClaimLedger(ledger.id);
  }

  async getClaimLedger(id) {
    const row = await this.db.prepare("SELECT * FROM claim_ledgers WHERE id = ?1").bind(id).first();
    if (!row) throw new StoreError("CLAIM_LEDGER_NOT_FOUND", `Claim ledger not found: ${id}`, { id });
    return mapClaimLedger(row, await this.getClaimsForRevision(row.revision_id));
  }

  async getClaimLedgerByRevision(revisionId) {
    const row = await this.db.prepare("SELECT * FROM claim_ledgers WHERE revision_id = ?1").bind(revisionId).first();
    if (!row) return null;
    return mapClaimLedger(row, await this.getClaimsForRevision(revisionId));
  }

  async findClaimLedgerByOperationKey(operationKey) {
    const row = await this.db.prepare("SELECT * FROM claim_ledgers WHERE operation_key = ?1").bind(operationKey).first();
    if (!row) return null;
    return mapClaimLedger(row, await this.getClaimsForRevision(row.revision_id));
  }

  async getClaimsForRevision(revisionId) {
    const rows = await allRows(this.db.prepare(`
      SELECT *
      FROM claims
      WHERE revision_id = ?1
      ORDER BY claim_key ASC
    `).bind(revisionId));
    return rows.map(mapClaim);
  }

  async recordConversationTurn({
    lessonId = null,
    revisionId = null,
    appliedRevisionId = null,
    telegramUpdateId,
    telegramUserId,
    telegramChatId,
    question,
    answer,
    status = "answered",
    provider = null,
    operationKey,
  }) {
    const key = requireText(operationKey, "operationKey");
    const updateId = Number(telegramUpdateId);
    if (!Number.isSafeInteger(updateId) || updateId < 0) {
      throw new StoreError("INVALID_INPUT", "telegramUpdateId must be a non-negative safe integer", {
        field: "telegramUpdateId",
      });
    }
    const normalizedStatus = requireText(status, "status");
    if (!["answered", "revised", "failed"].includes(normalizedStatus)) {
      throw new StoreError("INVALID_INPUT", "status is not allowed", { field: "status", status: normalizedStatus });
    }
    const providerMetadata = normalizeProviderMetadata(provider);
    const expectedOperation = {
      lessonId,
      revisionId,
      appliedRevisionId,
      telegramUpdateId: updateId,
      telegramUserId: requireText(telegramUserId, "telegramUserId"),
      telegramChatId: requireText(telegramChatId, "telegramChatId"),
      question: requireText(question, "question"),
      answer: requireText(answer, "answer"),
      status: normalizedStatus,
      ...providerMetadata,
    };
    const existing = await this.findConversationTurnByOperationKey(key);
    if (existing) {
      if (!conversationOperationMatches(existing, expectedOperation)) {
        throw new StoreError("OPERATION_KEY_CONFLICT", "Operation key was reused with a different conversation turn", {
          operationKey: key,
        });
      }
      return existing;
    }

    const id = this.id("conversation");
    try {
      await this.db.prepare(`
        INSERT INTO conversation_turns (
          id, lesson_id, revision_id, applied_revision_id,
          telegram_update_id, telegram_user_id, telegram_chat_id,
          question, answer, status, provider_id, provider_model,
          provider_attempts_json, operation_key, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
      `).bind(
        id,
        lessonId,
        revisionId,
        appliedRevisionId,
        updateId,
        expectedOperation.telegramUserId,
        expectedOperation.telegramChatId,
        expectedOperation.question,
        expectedOperation.answer,
        expectedOperation.status,
        expectedOperation.providerId,
        expectedOperation.providerModel,
        expectedOperation.providerAttemptsJson,
        key,
        this.now(),
      ).run();
    } catch (error) {
      const committed = await this.findConversationTurnByOperationKey(key);
      if (conversationOperationMatches(committed, expectedOperation)) return committed;
      if (committed) {
        throw new StoreError("OPERATION_KEY_CONFLICT", "Operation key was committed with a different conversation turn", {
          operationKey: key,
        });
      }
      throw new StoreError("CONVERSATION_CONFLICT", "Conversation turn could not be recorded", {
        operationKey: key,
        cause: error.message,
      });
    }
    return this.getConversationTurn(id);
  }

  async getConversationTurn(id) {
    const row = await this.db.prepare("SELECT * FROM conversation_turns WHERE id = ?1").bind(id).first();
    if (!row) throw new StoreError("CONVERSATION_NOT_FOUND", `Conversation turn not found: ${id}`, { id });
    return mapConversationTurn(row);
  }

  async findConversationTurnByOperationKey(operationKey) {
    const row = await this.db.prepare("SELECT * FROM conversation_turns WHERE operation_key = ?1").bind(operationKey).first();
    return mapConversationTurn(row);
  }

  async getConversationTurnsForLesson(lessonId) {
    const rows = await allRows(this.db.prepare(`
      SELECT *
      FROM conversation_turns
      WHERE lesson_id = ?1
      ORDER BY created_at ASC, telegram_update_id ASC
    `).bind(lessonId));
    return rows.map(mapConversationTurn);
  }

  async claimTelegramUpdate({ botId, updateId, leaseMs = 60_000 }) {
    const bot = requireText(botId, "botId");
    if (!Number.isSafeInteger(updateId) || updateId < 0) {
      throw new StoreError("INVALID_INPUT", "updateId must be a non-negative safe integer", { field: "updateId" });
    }
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
      throw new StoreError("INVALID_INPUT", "leaseMs must be a positive safe integer", { field: "leaseMs" });
    }

    const receivedAt = this.now();
    const claimToken = this.id("telegram");
    const processingResult = `processing:${claimToken}`;
    const inserted = await this.db.prepare(`
      INSERT OR IGNORE INTO processed_telegram_updates (
        bot_id, update_id, received_at, handled_at, result
      ) VALUES (?1, ?2, ?3, NULL, ?4)
    `).bind(bot, updateId, receivedAt, processingResult).run();

    if ((inserted?.meta?.changes ?? 0) === 1) {
      return { status: "claimed", botId: bot, updateId, claimToken };
    }

    const existing = await this.db.prepare(`
      SELECT bot_id, update_id, received_at, handled_at, result
      FROM processed_telegram_updates
      WHERE bot_id = ?1 AND update_id = ?2
    `).bind(bot, updateId).first();
    if (!existing) {
      throw new StoreError("UPDATE_CLAIM_LOST", "Telegram update claim disappeared", { botId: bot, updateId });
    }
    if (existing.handled_at) {
      return { status: "duplicate", botId: bot, updateId, handledAt: existing.handled_at, result: existing.result };
    }

    const receivedMilliseconds = Date.parse(existing.received_at);
    const nowMilliseconds = Date.parse(receivedAt);
    const stale = !Number.isFinite(receivedMilliseconds) ||
      !Number.isFinite(nowMilliseconds) ||
      receivedMilliseconds <= nowMilliseconds - leaseMs;
    if (stale) {
      const reclaimed = await this.db.prepare(`
        UPDATE processed_telegram_updates
        SET received_at = ?1, result = ?2
        WHERE bot_id = ?3 AND update_id = ?4
          AND handled_at IS NULL AND received_at = ?5
      `).bind(receivedAt, processingResult, bot, updateId, existing.received_at).run();
      if ((reclaimed?.meta?.changes ?? 0) === 1) {
        return { status: "claimed", botId: bot, updateId, claimToken, reclaimed: true };
      }
    }

    return { status: "in_progress", botId: bot, updateId };
  }

  async completeTelegramUpdate({ botId, updateId, claimToken, result }) {
    const bot = requireText(botId, "botId");
    const token = requireText(claimToken, "claimToken");
    const outcome = requireText(result, "result");
    const handledAt = this.now();
    const updated = await this.db.prepare(`
      UPDATE processed_telegram_updates
      SET handled_at = ?1, result = ?2
      WHERE bot_id = ?3 AND update_id = ?4 AND result = ?5 AND handled_at IS NULL
    `).bind(handledAt, outcome, bot, updateId, `processing:${token}`).run();
    if ((updated?.meta?.changes ?? 0) !== 1) {
      throw new StoreError("UPDATE_CLAIM_NOT_OWNED", "Telegram update claim is no longer owned", { botId: bot, updateId });
    }
    return { botId: bot, updateId, handledAt, result: outcome };
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

  async getPublication(id) {
    const row = await this.db.prepare("SELECT * FROM publications WHERE id = ?1").bind(id).first();
    if (!row) throw new StoreError("PUBLICATION_NOT_FOUND", `Publication not found: ${id}`, { id });
    return mapPublication(row);
  }

  async findPublicationByOperationKey(operationKey) {
    const row = await this.db.prepare("SELECT * FROM publications WHERE operation_key = ?1").bind(operationKey).first();
    return mapPublication(row);
  }

  async getLatestPublicationForLesson(lessonId) {
    const row = await this.db.prepare(`
      SELECT *
      FROM publications
      WHERE lesson_id = ?1
      ORDER BY completed_at DESC, created_at DESC
      LIMIT 1
    `).bind(lessonId).first();
    return mapPublication(row);
  }

  async recordPublicationSuccess({
    lessonId,
    revisionId,
    approvalId,
    operationKey,
    provider,
    branch,
    filePath,
    commitSha,
    pullRequestUrl = null,
    deploymentUrl = null,
  }) {
    const key = requireText(operationKey, "operationKey");
    const expected = { lessonId, revisionId, approvalId, status: "published" };
    const existing = await this.findPublicationByOperationKey(key);
    if (existing) {
      if (!publicationOperationMatches(existing, expected)) {
        throw new StoreError("OPERATION_KEY_CONFLICT", "Operation key was reused with a different publication payload", {
          operationKey: key,
        });
      }
      return existing;
    }

    const timestamp = this.now();
    const publicationId = this.id("publication");
    try {
      await this.db.batch([
        this.db.prepare(`
          INSERT INTO publications (
            id, lesson_id, revision_id, approval_id, operation_key, status, provider,
            branch, file_path, commit_sha, pull_request_url, deployment_url,
            error_message, created_at, completed_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, 'published', ?6, ?7, ?8, ?9, ?10, ?11, NULL, ?12, ?12)
        `).bind(
          publicationId,
          lessonId,
          revisionId,
          approvalId,
          key,
          requireText(provider, "provider"),
          requireText(branch, "branch"),
          requireText(filePath, "filePath"),
          requireText(commitSha, "commitSha"),
          pullRequestUrl,
          deploymentUrl,
          timestamp,
        ),
        this.db.prepare(`
          UPDATE approvals
          SET status = 'consumed', consumed_at = ?1
          WHERE id = ?2 AND status = 'active'
        `).bind(timestamp, approvalId),
        this.db.prepare(`
          UPDATE lessons
          SET state = 'published', state_version = state_version + 1, updated_at = ?1
          WHERE id = ?2 AND state = 'publishing'
        `).bind(timestamp, lessonId),
      ]);
    } catch (error) {
      const committed = await this.findPublicationByOperationKey(key);
      if (publicationOperationMatches(committed, expected)) return committed;
      if (committed) {
        throw new StoreError("OPERATION_KEY_CONFLICT", "Operation key was committed with a different publication payload", {
          operationKey: key,
        });
      }
      throw new StoreError("PUBLICATION_CONFLICT", "Publication success could not be recorded atomically", {
        lessonId,
        approvalId,
        cause: error.message,
      });
    }

    return this.getPublication(publicationId);
  }

  async recordPublicationFailure({
    lessonId,
    revisionId,
    approvalId,
    operationKey,
    provider,
    errorMessage,
  }) {
    const key = requireText(operationKey, "operationKey");
    const expected = { lessonId, revisionId, approvalId, status: "failed" };
    const existing = await this.findPublicationByOperationKey(key);
    if (existing) {
      if (!publicationOperationMatches(existing, expected)) {
        throw new StoreError("OPERATION_KEY_CONFLICT", "Operation key was reused with a different publication payload", {
          operationKey: key,
        });
      }
      return existing;
    }

    const timestamp = this.now();
    const publicationId = this.id("publication");
    try {
      await this.db.batch([
        this.db.prepare(`
          INSERT INTO publications (
            id, lesson_id, revision_id, approval_id, operation_key, status, provider,
            branch, file_path, commit_sha, pull_request_url, deployment_url,
            error_message, created_at, completed_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, 'failed', ?6, NULL, NULL, NULL, NULL, NULL, ?7, ?8, ?8)
        `).bind(
          publicationId,
          lessonId,
          revisionId,
          approvalId,
          key,
          requireText(provider, "provider"),
          requireText(errorMessage, "errorMessage").slice(0, 2000),
          timestamp,
        ),
        this.db.prepare(`
          UPDATE lessons
          SET state = 'publish_failed', state_version = state_version + 1, updated_at = ?1
          WHERE id = ?2 AND state = 'publishing'
        `).bind(timestamp, lessonId),
      ]);
    } catch (error) {
      const committed = await this.findPublicationByOperationKey(key);
      if (publicationOperationMatches(committed, expected)) return committed;
      if (committed) {
        throw new StoreError("OPERATION_KEY_CONFLICT", "Operation key was committed with a different publication payload", {
          operationKey: key,
        });
      }
      throw new StoreError("PUBLICATION_CONFLICT", "Publication failure could not be recorded atomically", {
        lessonId,
        approvalId,
        cause: error.message,
      });
    }

    return this.getPublication(publicationId);
  }
}
