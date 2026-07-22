# Git 복구 안내

## 현재 운영 결정

활성 프로젝트는 다음 로컬 경로로 마이그레이션한다.

```text
C:\Users\xa425\Projects\memory-systems-daily
```

기존 OneDrive 폴더는 소스 백업으로 보존하고 새 작업과 commit은 활성 프로젝트에서만 수행한다.

## 현재 증상

```text
fatal: not a git repository
Get-Content .git\HEAD: The cloud file provider is not running
```

소스 코드가 사라진 것은 아니다. `.git` 메타데이터가 OneDrive에서 내려받아지지 않은 상태다.

## 안전한 복구 순서

1. Windows에서 OneDrive가 로그인되어 있고 동기화가 실행 중인지 확인한다.
2. 파일 탐색기에서 프로젝트의 `.git` 폴더에 대해 **이 장치에 항상 유지**를 선택한다.
3. `.git/HEAD`와 `.git/config`가 열리는지 확인한다.
4. 프로젝트 루트에서 다음을 실행한다.

```powershell
git rev-parse --show-toplevel
git status
git fsck --no-reflogs
```

5. 정상 인식된 뒤에만 branch, commit, worktree를 사용한다.

## 금지

- `.git` 폴더 삭제
- 기존 원격 주소를 확인하지 않은 `git init`
- `git reset --hard`
- 소스 백업 없이 저장소 재복제

위 복구로도 실패하면 `.git`을 보존한 상태에서 새 폴더에 원격 저장소를 clone하고, 현재 소스 파일만 비교 복사하는 방식을 사용한다.
