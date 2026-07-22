# 프로젝트 상태

마지막 갱신: 2026-07-22

## 목표

매일 오전 8시 30분(KST)에 Telegram으로 학습 주제를 받고, 사용자와 AI가 질의응답하며 내용을 수정한 뒤, 사용자가 승인하면 GitHub 기반 Astro 블로그에 배포하는 시스템을 만든다.

학습 범위는 다음을 모두 포함한다.

- LLM 기본 원리와 최신 추론/학습 트렌드
- 컴퓨터 아키텍처와 성능 분석
- DRAM, HBM, DDR, LPDDR, GDDR
- 메모리 컨트롤러, 캐시, 인터커넥트
- CXL과 메모리 확장/풀링
- PIM, near-memory computing, persistent/emerging memory
- AI 시스템의 bandwidth, capacity, latency, energy 병목

전체 36주 커리큘럼의 소스는 `src/data/curriculum.ts`이다.

## 완료

- Astro 프로젝트와 공통 디자인 시스템
- 홈, 전체 로드맵, 자동화 흐름, 예시 글 페이지
- 반응형 레이아웃 및 브라우저 시각 검사
- 프로젝트 공통 규칙과 역할별 Codex 에이전트 정의
- 공유 작업 보드와 글/근거 템플릿
- D1 호환 학습 세션 상태 머신, immutable revision, 승인 challenge 및 stale approval 차단
- Telegram webhook 경계, secret/allowlist 검증, update deduplication, 승인 callback routing
- UTC cron에서 KST lesson date를 계산하는 idempotent scheduler
- Provider 주입형 research pipeline, revision-linked claim ledger, primary-source claim validation
- Telegram Bot API client, `/today`/`/revise`/`/review`/Q&A command router, scheduled lesson notification wiring
- OpenAI Responses API 기반 Telegram Q&A/revision provider, optional `web_search`, immutable conversation ledger
- OpenAI/search-backed scheduled research draft provider, daily draft revision, primary-source claim ledger, Telegram notification
- Claude Messages API 기반 Q&A/revision provider, Claude rate/quota/context/transient failure 시 OpenAI fallback router

## 다음 구현 단계

- Cloudflare Worker에서 D1 migration과 저장 계층 연결
- 날짜별 curriculum selector와 lesson topic 확장
- 승인 callback과 revision 잠금
- 승인 후 GitHub commit/PR 및 Astro 배포
- scheduler와 research 작업의 실패 재시도/lease 정책
- provider fallback 사용량/실패 사유를 conversation ledger에 더 세밀하게 기록

## 로컬 상태

- 활성 프로젝트: `C:\Users\xa425\Projects\memory-systems-daily`
- 이전 OneDrive 프로젝트: 마이그레이션 백업, 직접 개발하지 않음
- 개발 URL: `http://127.0.0.1:4321`
- 런타임: `.tools/node-v24.18.0-win-x64/node.exe`
- 검사: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check.ps1`
- 시각 검사: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\visual-check.ps1`

## 알려진 문제

이전 OneDrive 프로젝트의 `.git/HEAD`와 `.git/config`은 오프라인 자리표시자라 읽을 수 없다. 활성 프로젝트는 OneDrive 밖에서 새 Git 저장소로 관리한다. 이전 `.git`은 기록 보존을 위해 그대로 두며 자세한 내용은 `docs/GIT_RECOVERY.md`를 따른다.
