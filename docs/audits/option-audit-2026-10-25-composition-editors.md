# 후속 composition editor 추가 감사 — 2026-10-25

기존 조합 감사에서 실제 UI로 작성·저장한 Barley, Iris, Fashion-MNIST의 중첩 프로젝트를 다시 사용해, 초기 차트 카드가 아닌 후속 편집 여섯 종류를 검사했다. 제품 코드는 수정하지 않았다.

## 검사 범위

[전용 runner](../../scripts/audit-composition-editors-2026-10-25.mjs)는 앱의 실제 calculation service에 대상·검색어를 전달하고, 반환된 `recommendationParameters`와 `buildRecommendationCall`을 그대로 사용한다. 파라미터를 정규화한 뒤 `prepareGuidedAction`을 거쳐 SVG와 Canvas를 모두 렌더링한다. 브라우저 재현은 격리된 모의 계정으로 기존 프로젝트를 import해 실제 카드 버튼을 클릭했다.

- 기존 프로젝트 3개, All 및 개별 차트/overlay 대상에 대한 함수명 검색 84회.
- 동일 호출을 대상 간 중복 제거한 카드 13개, 파라미터 변형 70개.
- 검사 함수: `editFacetHeaders`, `editFacetGuides`, `editFacetScales`, `editCompositionLayout`, `editCompositionScales`, `editOverlay`.
- 각 카드의 활성 enum 선택지와 수치 min/mid/max를 검사했다. 모든 상호작용 쌍·순열을 검사한 것은 아니다.
- 결과: 성공 58회, 일반 no-change 5회, 이미 같은 facet scale 정책을 요청한 native 거부 2회, 아래 범례 선택 실패 5회. 마지막 5회는 실제 브라우저에서도 같은 오류를 확인했다.

[집계 JSON](../../output/option-audit-2026-10-25/composition-editors/summary.json), [Barley 기록](../../output/option-audit-2026-10-25/composition-editors/barley-horizontal.json), [Iris 기록](../../output/option-audit-2026-10-25/composition-editors/iris-distributions.json), [Fashion 기록](../../output/option-audit-2026-10-25/composition-editors/fashion-point.json).

## E01 · P2 · Edit facet guides의 범례 선택지가 데이터·공간 조건을 반영하지 않음

### 재현 A: 충분한 공간을 확보하지 못하는 top/bottom 선택

1. [Barley 중첩 프로젝트](../../output/option-audit-2026-10-25/compositions/barley-horizontal-nested.visauto.json)를 import한다. Bar + Follow-results Line을 site로 facet하고, 옆과 아래에 차트를 추가한 상태다.
2. Target에서 **Bar 1** 선택 → Style → `editFacetGuides` 검색.
3. 기본 카드는 유효하다. Legend에서 **Shared · bottom** 또는 **Shared · top**을 선택한다.

두 선택 모두 `Horizontal legend block requires more plot width.`로 미리보기가 무효화된다. 기본 Shared · right 및 Per facet은 검사에서 성공했다. 원본 색상은 10개 `variety`이고 수평 범례가 더 넓은 공간을 요구한다.

범례가 실제로 들어갈 수 없는 폭을 native가 거부하는 것은 타당하다. 카드에는 위치만 바꾸는 활성 선택지가 있지만, 그 결과를 지원할 줄바꿈·폭 조정·항목 배치나 구체적 회복 경로가 없다. 자동 배치가 처리하거나, 해당 조건을 반영한 선택지·수정 가능한 파라미터를 제공해야 한다. 이것은 무조건 overflow를 허용하라는 요구가 아니다.

**증거:** [실제 UI 기록](../../output/option-audit-2026-10-25/composition-editors/browser-guides-barley-horizontal.json), [bottom](../../output/option-audit-2026-10-25/composition-editors/barley-horizontal-guides-bottom.png), [top](../../output/option-audit-2026-10-25/composition-editors/barley-horizontal-guides-top.png). 브라우저 page error는 없고 카드 자체에 위 오류가 표시된다.

### 재현 B: 공유할 범례 인코딩이 없는데 shared 선택지를 활성화

1. [Iris 중첩 프로젝트](../../output/option-audit-2026-10-25/compositions/iris-distributions-nested.visauto.json)를 import한다. Species/Sepal.Length의 Beeswarm + Box layer를 Species로 facet한 상태이며, 색상 등 범례를 생성할 인코딩이 없다.
2. Target **Point 1** → Style → `editFacetGuides` 검색.
3. Legend에서 Shared · right / bottom / top을 각각 선택한다.

right는 `Shared facet legend requires one eligible encoded scale.`, bottom/top은 `createLegend requires target when the categorical mark is ambiguous.`가 난다. 기본 Per facet은 성공한다. native가 없는 인코딩의 범례를 만들지 않는 것은 기대되는 제한이다. 문제는 이 상태에서 세 가지 shared 선택을 모두 정상 선택지로 제공한다는 점이다.

**증거:** [실제 UI 기록](../../output/option-audit-2026-10-25/composition-editors/browser-guides-iris-distributions.json), [right](../../output/option-audit-2026-10-25/composition-editors/iris-distributions-guides-right.png), [bottom](../../output/option-audit-2026-10-25/composition-editors/iris-distributions-guides-bottom.png), [top](../../output/option-audit-2026-10-25/composition-editors/iris-distributions-guides-top.png).

**공통 원인 경계:** [facet-candidates.js](../../src/facet-candidates.js)의 기존 facet 분기는 legend에 Per facet/right/bottom/top을 일괄 제공한다. 생성 시의 `hasLegend` 조건과 달리 후속 editor에는 인코딩 유무에 따른 비활성화나 폭 기반 parameter adaptation이 없다. 공간 문제와 인코딩 부재를 같은 원시 오류로 세지 않고, 후속 카드 선택지 계약의 두 재현으로 묶었다.

## 성공한 경계값과 대상 선택

- Barley/Iris의 facet header 크기 8–22, offset 0–24, normal/bold와 제공된 색상 선택은 모두 렌더링됐다.
- 같은 두 fixture의 facet columns 1–6 및 gap 0–40 경계·중간값이 성공했다. 단일 함수 호출과 반환된 SVG/Canvas 해시가 기록돼 있다.
- facet X/Y/Color shared/independent 변경은 실제로 다른 정책을 요청할 때 성공했다. 현재와 완전히 같은 정책은 아래 제외 기준으로 처리했다.
- Barley/Fashion에서 상위 전체 그룹과 내부 그룹의 `editCompositionScales` 카드가 각각 제공됐고, 검사한 shared/independent 선택은 성공했다.
- Barley의 **Line** target을 선택해야 `editOverlay`가 나온다. Missing break/connect 및 Order by x/y 검사가 성공했다. 원본이 grouped bar여서 Total은 비활성화되어 있으며 이를 실패로 세지 않았다.
- Barley **Bar 1**, Iris **Point 1**에서 facet 편집 카드가 제공됐다. All이나 facet이 아닌 형제 차트에서 안 나오는 것을 누락 결함으로 세지 않았다. 혼합 대상에 동일 facet 호출을 일괄 적용할 수 없기 때문이다.

## 제외와 한계

- `editFacetScales requires at least one channel policy change.` 두 건은 기존 정책과 완전히 같은 요청이다. 원시 JSON에는 `error`로 남아 있지만 본 보고서에서는 정상 무변경 요청의 거부로 분류하며 별도 버그로 세지 않는다.
- Iris의 공유 scale 후보가 내부 Box summary와 원본 Point의 의미 비교에서 거부되는 것은 기존 조합 감사 C03과 관련된 진단이지만, 이번 추가 검사에서 새로운 최소 재현을 확정하지 않았으므로 독립 결함으로 추가하지 않았다.
- Fashion fixture에는 유지된 facet·follow-results overlay가 없어 해당 editor가 나오지 않는다. 이 fixture는 중첩 공유 scale 편집에만 기여했다.
- 예외 없이 생성된 SVG/Canvas를 확인한 것이며, 70개 결과 모두에 대한 픽셀 단위 시각적 정답을 판정한 것은 아니다. 실패 다섯 선택은 실제 브라우저 카드 상태로 추가 확인했다.

## 재실행

아래 명령은 기존 조합 감사가 생성한 `*-nested.visauto.json`을 요구한다. 생성된 원시 결과와 이미지는 Git에서 제외된 `output/option-audit-2026-10-25/composition-editors/`에 둔다.

```sh
node --expose-gc scripts/audit-composition-editors-2026-10-25.mjs
node scripts/audit-composition-editors-2026-10-25.mjs --browser --case=barley-horizontal
node scripts/audit-composition-editors-2026-10-25.mjs --browser --case=iris-distributions
```

브라우저 재현은 `http://127.0.0.1:5205/`의 로컬 앱을 사용한다. 실제 계정·프로덕션 데이터에는 쓰지 않는다.
