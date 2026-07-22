# Memory Systems Daily

DRAM 시스템 엔지니어 관점에서 LLM, 컴퓨터 아키텍처, 메모리 시스템, 차세대 인터페이스를 매일 학습하고 공개 블로그 글로 축적하는 프로젝트입니다.

## 현재 위치

```text
C:\Users\xa425\Projects\memory-systems-daily
```

## 현재 구현

- Astro 기반 정적 블로그 예시
- 36주 전체 학습 로드맵
- LLM next-token prediction 예시 글
- Telegram 승인 자동화 UI 예시
- 데스크톱/모바일 시각 검증 스크립트
- 여러 Codex 에이전트가 공유하는 역할, 작업 보드, 문서 템플릿

## 로컬 실행

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev.ps1
```

브라우저에서 `http://127.0.0.1:4321`을 엽니다.

전체 검사와 빌드는 다음 명령으로 실행합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check.ps1
```

## 작업 시작 순서

1. [AGENTS.md](AGENTS.md)를 읽습니다.
2. [프로젝트 상태](docs/PROJECT_STATUS.md)를 확인합니다.
3. [작업 보드](tasks/BOARD.md)에서 하나의 작업을 선택하고 소유자를 기록합니다.
4. 작업 종류에 맞는 `.codex/agents/` 역할을 사용합니다.
5. 검사 결과와 다음 행동을 작업 보드에 남깁니다.

## 중요

활성 프로젝트는 OneDrive 밖의 로컬 Git 저장소를 사용합니다. 이전 OneDrive 폴더는 마이그레이션 백업으로 남겨두며, 그 안의 손상된 `.git`은 삭제하거나 재초기화하지 않습니다. 배경과 복구 원칙은 [Git 복구 안내](docs/GIT_RECOVERY.md)에 정리했습니다.
