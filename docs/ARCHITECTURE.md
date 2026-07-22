# 시스템 아키텍처

## 현재 구조

```text
Astro UI
  -> src/data/curriculum.ts
  -> src/pages/*
  -> static build in dist/

Telegram webhook boundary
  -> secret and allowlist verification
  -> processed update claim
  -> message/callback routing
  -> D1LessonStore approval contract

Research pipeline
  -> curriculum topic input
  -> injected research provider
  -> immutable revision
  -> revision-linked claim ledger
```

현재 `/automation`은 목표 사용자 경험을 향한 백엔드 기반을 단계적으로 구현 중이다. 실제 Telegram 송신, LLM/search provider, GitHub 배포 연결은 아직 구현하지 않았다.

백엔드 기반으로 `automation/domain`의 상태 머신과 `automation/storage`의 D1 호환 저장 계층을 구현했다. 현재 로컬 Node SQLite 통합 테스트까지 완료했으며, Cloudflare Worker와 실제 D1 binding 연결은 다음 단계다.

Research pipeline은 아직 외부 API를 직접 호출하지 않는다. `researchProvider`를 주입받아 초안 본문과 claim 목록을 반환받고, 본문은 immutable revision으로 저장하며 claim은 revision에 연결된 ledger로 기록한다. claim ledger는 primary-source 유형, URL, evidence locator, confidence, verification status를 검증하고 append-only event로 남긴다.

## 목표 구조

```text
08:30 KST Scheduler
  -> Lesson Orchestrator
  -> Research + Claim Ledger
  -> Draft Revision Store
  -> Telegram Bot (lesson, Q&A, edit, approval)
  -> Approval Gate (user + chat + revision verification)
  -> GitHub Commit/PR
  -> Astro Build
  -> Deployment
```

## 학습 세션 상태

```text
scheduled
  -> researching
  -> draft_ready
  -> discussing
  -> review_ready
  -> approved
  -> publishing
  -> published
```

Lesson 실패 상태는 `research_failed`, `publish_failed`로 분리한다. 승인 만료는 lesson 전체 상태가 아니라 개별 `Approval.status = expired`로 기록하여 최신 revision 상태를 덮어쓰지 않는다. `discussing`, `review_ready`, `approved`, `publish_failed`에서 글이 수정되면 revision을 증가시키고 기존 승인을 무효화한 뒤 `discussing`으로 돌아간다.

## 핵심 데이터

- `Lesson`: 날짜, 커리큘럼 위치, 목표, 선행 개념
- `Revision`: 본문, 작성 시각, 작성 주체, 변경 요약, content hash
- `Claim`: 주장, 근거 URL, 출처 유형, 확인 날짜, 신뢰도, 인용 범위
- `Conversation`: Telegram update ID, 질문, 답변, 반영 여부
- `Approval`: 사용자 ID, chat ID, revision ID, content hash, 승인 시각
- `Publication`: commit SHA, 배포 URL, 배포 상태, 실패 원인

## 보안 경계

- Telegram bot token, OpenAI key, GitHub token은 환경변수/CI secret으로만 관리한다.
- 허용된 Telegram user ID와 private chat ID를 모두 확인한다.
- callback query payload는 짧은 opaque ID로 만들고 서버 저장 상태와 대조한다.
- 승인 대상 revision의 hash가 현재 초안 hash와 같을 때만 배포한다.
- content hash는 본문을 Unicode NFC와 LF 줄바꿈으로 정규화한 UTF-8 bytes의 SHA-256으로 계산한다.
- webhook update ID를 저장해 중복 실행을 방지한다.
- 배포 권한은 콘텐츠 경로와 대상 저장소에 필요한 최소 범위로 제한한다.
- 공개 자료가 아닌 회사 정보는 research context와 게시물에 넣지 않는다.

## 스케줄

KST `08:30`은 UTC `23:30`(전날)이다. UTC 기반 cron에서는 `30 23 * * *`를 사용하되, 날짜 계산은 항상 `Asia/Seoul` 기준으로 수행한다.

## 배포 원칙

초기 버전은 승인 후 별도 branch와 pull request를 생성하는 방식을 권장한다. 자동 테스트가 통과하면 merge/deploy하되, 첫 운영 기간에는 최종 merge도 사용자가 확인할 수 있게 유지한다. 안정화 후 승인 버튼이 merge와 배포까지 수행하도록 확장한다.
