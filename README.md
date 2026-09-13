<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# 파일 다이어트

HWPX, PPTX, SHOW, PDF 문서의 이미지와 패키지 구조를 브라우저 안에서 최적화하는 React/Vite 앱입니다. 파일 데이터는 별도 서버로 업로드하지 않습니다.

PDF 모드의 슬라이더는 JPEG 품질값이 아니라 **원본 대비 목표 용량 비율**입니다. 예를 들어 70%를 선택하면 실제 결과 크기를 측정하면서 최대 3회 보정합니다. PDF에서 안전하게 바꿀 수 있는 이미지보다 글꼴, 텍스트, 벡터 데이터의 비중이 큰 경우에는 목표에 도달할 수 없으며, 이때 앱이 달성 가능한 결과와 이유를 표시합니다.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

## 검증

- 타입 검사: `npx tsc --noEmit`
- 프로덕션 빌드: `npm run build`
