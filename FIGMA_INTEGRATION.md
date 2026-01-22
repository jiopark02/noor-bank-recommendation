# Figma Integration Guide

이 프로젝트를 Figma와 연동하는 방법입니다.

## 방법 1: Figma Code Connect (추천)

Figma Dev Mode에서 실제 React 코드를 볼 수 있게 해줍니다.

### Setup

1. Figma Personal Access Token 생성:
   - Figma > Settings > Personal Access Tokens
   - Scopes: Code Connect (Write), File content (Read)

2. 환경변수 설정:
```bash
export FIGMA_ACCESS_TOKEN=your_token_here
```

3. Code Connect 파일 업데이트:
   - `src/components/**/*.figma.tsx` 파일들의 Figma URL을 실제 URL로 교체
   - Figma에서 컴포넌트 선택 > Copy link

4. Publish:
```bash
npx figma connect publish
```

### 연결된 컴포넌트

| Component | File |
|-----------|------|
| BankCard | `src/components/bank/BankCard.figma.tsx` |
| FilterChips | `src/components/layout/FilterChips.figma.tsx` |

## 방법 2: Design Tokens

`design-tokens.json` 파일을 Figma Tokens 플러그인과 함께 사용할 수 있습니다.

### Setup

1. Figma에서 [Tokens Studio](https://tokens.studio/) 플러그인 설치
2. 플러그인 실행 > Import > JSON
3. `design-tokens.json` 파일 업로드
4. 토큰이 Figma에 동기화됨

### 포함된 토큰

- **Colors**: 기본 색상, 카테고리 색상, 상태 색상
- **Typography**: 폰트 패밀리, 사이즈, 웨이트
- **Spacing**: 0-8 스케일
- **Border Radius**: none ~ full
- **Shadows**: 카드, 배지용

## 방법 3: Storybook (옵션)

컴포넌트 문서화 및 시각적 테스트용

```bash
# Storybook 설치 (아직 설정 안 됨)
npx storybook@latest init
```

## 컴포넌트 구조

```
src/components/
├── bank/
│   ├── BankCard.tsx           # 은행 카드
│   ├── BankCard.figma.tsx     # Figma 연결
│   ├── BankDetailModal.tsx    # 상세 모달
│   ├── BankComparisonTable.tsx # 비교표
│   └── BankRecommendationList.tsx
└── layout/
    ├── FilterChips.tsx
    ├── FilterChips.figma.tsx
    ├── Tabs.tsx
    ├── PageLayout.tsx
    └── ...
```

## 디자인 시스템 요약

### Colors
- Primary: Black (#000000)
- Background: White (#FFFFFF)
- Gray scale: 50-900

### Category Colors
| Category | Color | Hex |
|----------|-------|-----|
| Best Overall | Black | #000000 |
| Low Fees | Green | #16A34A |
| International | Blue | #2563EB |
| Branches | Purple | #9333EA |
| Online | Indigo | #4F46E5 |
| Students | Orange | #F97316 |
| No SSN | Teal | #0D9488 |

### Components
- **Card**: 12px border-radius, 1px gray-200 border
- **Fit Badge**: Pill shape, black bg, white text
- **Filter Chip**: Pill shape, toggle active/inactive
- **Top Pick Card**: Ring highlight for best overall

## Figma 파일 생성 팁

1. Auto Layout 사용
2. 컴포넌트화 (/, e.g. Bank/Card, Bank/Modal)
3. Variants 활용 (state=default/hover/active)
4. Design tokens 연결

## 질문?

Figma Code Connect 문서: https://developers.figma.com/docs/code-connect/
