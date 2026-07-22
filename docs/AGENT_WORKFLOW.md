# 에이전트 협업 방식

## 역할

| 역할 | 정의 파일 | 책임 | 기본 쓰기 범위 |
| --- | --- | --- | --- |
| Orchestrator | 메인 세션 | 계획, 위임, 의사결정, 통합 | 전체, 단 동시 소유 금지 |
| Curriculum Planner | `.codex/agents/curriculum-planner.toml` | 학습 순서와 선수 지식 점검 | 읽기 전용 |
| Researcher | `.codex/agents/researcher.toml` | 1차 자료 조사와 claim ledger | 읽기 전용 |
| Content Writer | `.codex/agents/content-writer.toml` | 한국어 초안과 revision 작성 | `content/drafts/` 또는 지정 글 1개 |
| Technical Reviewer | `.codex/agents/technical-reviewer.toml` | 정확성, 반례, 과장 검토 | 읽기 전용 |
| Automation Engineer | `.codex/agents/automation-engineer.toml` | Telegram, 상태 저장, 승인, 배포 | 명시적으로 배정된 코드 경로 |
| QA Reviewer | `.codex/agents/qa-reviewer.toml` | 테스트, 모바일 UI, 보안 gate 검증 | 읽기 전용 |

## 작업 수명주기

1. 메인 에이전트가 `tasks/BOARD.md`에서 task ID와 완료 조건을 확정한다.
2. 작업 에이전트는 Owner와 Owned paths를 기록한다.
3. 조사/검토처럼 독립적인 읽기 작업은 병렬 실행한다.
4. 쓰기 작업은 파일 경로가 겹치지 않을 때만 병렬 실행한다.
5. 담당 에이전트가 검사 결과와 handoff를 남긴다.
6. 메인 에이전트가 결과를 통합하고 작업 상태를 변경한다.

## Handoff 형식

```markdown
Task: T-000
Status: ready_for_review | blocked | done
Files changed:
- path/to/file
Decisions:
- decision and reason
Validation:
- command: result
Risks:
- remaining risk or none
Next action:
- one concrete action
```

## 병렬 작업 규칙

- 동일한 파일을 두 에이전트에게 배정하지 않는다.
- 조사 결과는 raw dump가 아니라 claim, 근거, 불확실성으로 요약한다.
- reviewer는 writer의 문장을 직접 수정하지 않고 finding을 반환한다.
- 메인 에이전트만 여러 결과를 하나의 최종 변경으로 합친다.
- Git 복구 후에는 장기 쓰기 작업을 별도 worktree/branch에서 수행한다.

