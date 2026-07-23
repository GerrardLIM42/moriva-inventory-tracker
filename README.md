# MORIVA 재고 트래커 (독립 저장소)

기존 moriva-coupang-studio(Vercel/Next.js) 프로젝트와 완전히 분리된,
GitHub Pages로만 돌아가는 가벼운 재고 자동 수집 + 대시보드입니다.

## 파일 구성
```
moriva-inventory-tracker/
├── index.html                          ← 대시보드 (바로 열면 표로 보임)
├── .github/workflows/coupang-inventory.yml   ← 매일 자동 실행 설정
├── scripts/collect-inventory.mjs             ← 쿠팡 API 호출 스크립트
└── data/report-latest.json                   ← 수집 결과 (자동 갱신됨)
```

## 설정 순서

### 1. GitHub에 새 저장소 생성
- 이름: `moriva-inventory-tracker` (자유롭게 변경 가능)
- Public으로 생성

### 2. 이 4개 파일/폴더를 저장소에 업로드
Code 탭 → **Add file → Upload files**로 폴더 구조 그대로 올리세요.
(드래그 앤 드롭 시 폴더 구조가 깨지지 않는지 업로드 후 꼭 확인)

### 3. GitHub Pages 켜기
**Settings → Pages → Build and deployment → Source: Deploy from a branch**
→ Branch: `main`, 폴더: `/ (root)` → Save

몇 분 후 사이트 주소:
```
https://gerrardlim42.github.io/moriva-inventory-tracker/
```

### 4. Secrets 등록
**Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|---|---|
| `COUPANG_ACCESS_KEY` | Wing에서 재발급받은 Access Key |
| `COUPANG_SECRET_KEY` | Wing에서 재발급받은 Secret Key |
| `COUPANG_VENDOR_ID` | `A01031555` |

### 5. 첫 실행 테스트
**Actions 탭 → "MORIVA 쿠팡 재고 자동 수집" → Run workflow** 버튼으로 즉시 실행.

성공하면 `data/report-latest.json`이 자동 커밋되고,
`https://gerrardlim42.github.io/moriva-inventory-tracker/` 새로고침하면 표에 데이터가 뜹니다.

403 (Not allowed IP) 에러가 나면 Actions 로그 캡처해서 보여주세요 —
그때는 고정 IP 서버로 옮기는 다음 단계로 안내해드릴게요.

## 참고
- 대시보드(index.html)는 완전히 정적 파일이라 별도 서버/빌드 과정이 필요 없습니다.
- 데이터가 하루 1번만 갱신되므로, 실시간성이 필요해지면 그때 구조를 바꾸면 됩니다.
