# Overlay / concat 확장 검증과 구현 계약

2026-10-24. 사용자가 승인한 `createLayerPlot` / `getPlotComposition` API를 구현하고 Add overlay에 연결했다. 아래의 조사 시점 결과와 구현 후 검증 결과를 구분한다.

## 재현

```sh
node scripts/audit-composition-space.js
node --test vendor/ggaction/test/charts/linked-composition/variants/independent-layers/*.js
node --test test/layer-picker.test.js
npm run build:workers
npm run test:layers
```

상세 결과는 gitignored `output/layer-composition-audit/inventory.json`. 입력은 Iris, Barley, Stocks, Tips, Weather, Gapminder, Cars, Electricity의 앞쪽 최대 150 complete rows 및 Radar/Horizon의 작은 결정적 fixture다. 코퍼스 전체나 모든 파라미터를 검증했다고 주장하지 않는다.

## 구현 전 확인한 근본 원인

1. Add overlay는 `createOverlay`의 **visibleItems → line/point**만 제공한다. `point/bar/line/area`라는 저수준 mark type이 후보 자격을 결정한다. Box/Violin 같은 composite owner가 저수준 bar/area라는 이유로 잘못 follow 대상으로 취급될 수 있고, Heatmap/Polar는 진입 자체가 없다.
2. `adjacentContext`가 화면 layer의 `encoding.x.field/y.field`를 원본 컬럼 이름으로 가정한다. Box quartile, Histogram count, Density/ECDF 생성 필드, Dot/Lollipop endpoint, Horizon folded coordinates는 이 가정을 만족하지 않는다.
3. Polar/Radar/Parallel은 x/y 자체가 없다. 다른 좌표계와의 **독립 concat은 이미 가능**하지만 앱이 `Select an X variable`에서 중단한다.
4. 같은 scale ID뿐 아니라 원본 field, 통계/단위, temporal/bin 단위, 방향, 차원 순서, shared color grain을 확인해야 한다. 생성이 성공해도 의미가 맞지 않는 그림은 성공으로 세면 안 된다.
5. 독립 새 layer와 source 결과를 따르는 overlay는 편집·필터·집계·통계 population의 소유권이 다르다. 한 가지 follow 상태에 억지로 묶으면 source 변경 때 사용자 설정이 사라지거나 표본이 중복된다.

## 구현 전 실행 결과

- 29개 공개 plot constructor의 대표 chart를 생성했다.
- 순서 있는 29 × 29 쌍 각각 hconcat/vconcat, **1,682개 독립 병치** 모두 native Canvas scene 생성 성공. SVG만 성공한 상태가 아니다.
- 같은 29개 source에 앱의 `adjacentContext → adjacentSpecs`를 실행하면 **15종에서 오류**가 발생한다. Histogram은 X/Y가 같은 원본 필드로 오인되고, 나머지 다수는 생성 열이나 비직교 좌표 때문에 X를 찾지 못한다.
- 나머지 성공 후보에도 원본 역할을 하나만 복구해 빈 Y로 진행하는 경우가 있어, 오류가 없다는 것만으로 충분하지 않다.
- 기존 API를 명시 연결한 Beeswarm+Box, Violin+Box+Beeswarm은 공통 x/y scale·단일 좌표에서 그려진다. 4개 검증에서 관측 개수, composite owner, 개별 opacity 편집, resize, 이전 상태 불변, 저장 복원 Canvas scene/PNG 동일성을 확인했다.

### 앱 진입에서 오류가 난 source

Histogram, Heatmap, Density, Dot, Lollipop, Dumbbell, ECDF, Pie, Rose, RadialBar, PolarScatter, PolarLine, ParallelCoordinates, Radar, Horizon.

### 해결할 조합 공간

| 공간 | 겹치기 | 병치 |
|---|---|---|
| 범주 × 측정 | Box/Violin/Beeswarm/Strip/Gradient/Interval/Dot 등 역할·단위 호환 조합. 가로/세로 모두 | 같은 원본측정, 같은 집계일 때 공유. 원본 vs 집계는 독립 |
| 연속 × 연속 | Scatter + Regression/Line/Area/Text/Heatmap/Rug 등 지원된 기하와 같은 좌표 | 다른 데이터 의미도 독립 축으로 가능 |
| 집계/시계열 | Bar 끝점 Line/Point follow와 독립 plot layer를 구분 | bin·temporal unit·group·aggregate까지 비교 |
| 단변량 | Histogram/Density/ECDF/Rug: count, density, mass, cumulative 단위 구분 | 공유 가능한 측정 축만 공유, 다른 수치 축 독립 |
| Polar/Radar/Parallel | 같은 coordinate 의미·차원·scale일 때만 | Cartesian과 섞어도 독립 concat은 허용 |
| Facet + overlay + concat | facet의 원본 owner에 추가, 셀별 재계산 | panel/group 어디에든 배치, 기존 sharing과 alignment 유지 |

각 계열의 자세한 포함·제외 기준, 신규 함수와 inspection 계약, 편집 소유권, 테스트 체크리스트는 [라이브러리 검토안](../vendor/ggaction/agent_docs/impl/layer-composition/PROPOSAL.md)에 있다. 차트 쌍별 예외를 앱에 누적하는 대신 한 role/capability resolver를 native layer 생성·병치·inspection·앱이 공유한다.

## 구현한 사용자 흐름

- 기존 **Add overlay** 버튼에서 `Follow results`와 `Layer chart`를 구분해 보여준다. 후자는 실제 새 차트 카드와 필요한 native parameters를 표시한다.
- 범주형×수치에서 Beeswarm을 선택했다면 Box/Violin/Interval 등을 추가할 수 있다. 선택 카드 하나는 공개 함수 한 번이다.
- Target은 같은 패널 안에 `[Point | Box]`처럼 표시하고, 복합 Box의 whisker/median은 별도 chart target으로 분해하지 않는다.
- `+`는 source의 내부 generated field가 아니라 실제 데이터 역할을 사용한다. 공유 불가인 새 차트도 독립 축으로 추가할 수 있다.
- 썸네일/preview/transition, code/Apply/history, 독립 Target/All, reset/replay/resize의 기존 의미를 유지한다.
- 원본/집계 구분은 직전 수정 정책을 유지한다. contour, 지도, dual-axis 같은 별도 새 시각화 API를 조용히 추가하지 않는다.

## 구현 후 검증

- `createLayerPlot`은 기존 public constructor를 실행해 독립 owner를 만든다. 원본 데이터·측정 단위·좌표·공유 scale을 native planner가 판단하고, compound 내부 marks는 하나의 Target으로 유지한다.
- `getPlotComposition`은 생성된 내부 열 대신 원래 변수와 통계 의미를 반환한다. 앱의 29종 source 모두 `+`를 통한 차트 선택까지 도달하며, 기존 15종의 진입 오류가 없어졌다.
- 독립 병치 1,682개는 Canvas scene 생성에 성공했다. 이것은 각 source의 대표 fixture로 만든 **독립 축 병치**이고 모든 데이터셋·공유 축·파라미터 조합을 증명하는 수치는 아니다.
- 방향을 포함한 148개 native layer 조합, 실제 geometry·저장/복원 PNG, facet·nested concat·데이터 revision·개별 스타일·앞/뒤 배치를 회귀검증한다. Pie partition, Rose 면적 반경과 RadialBar 길이 반경 등 다른 의미를 같은 좌표라고 취급하지 않는다.
- 서로 다른 color 그룹을 요약할 수 없는 분포 constructor는 잘못된 색상 열을 상속하지 않는다. Interval은 지원하는 groupBy를 유지한다. singleton 그룹의 Area처럼 구성할 수 없는 기본 조합은 layer 후보에서 제외한다.
- 옵션 기본값과 활성 enum/slider 경계값을 포함한 21개 테스트를 통과했다. 반복 Raincloud→Box 추가 시 facade ID 충돌, 가로/세로 집계 축, Interval 신뢰수준, Dumbbell Start 변수도 검증했다. 여러 원본 측정이 공유 축에 놓일 때 생성된 통계 열 대신 원본 변수 이름을 표시한다.
- 브라우저: Iris Beeswarm+Box, Tips Violin+Raincloud, Barley Bar+follow Line, Cars Scatter+Heatmap. Preview/Transition, Behind/Apply, 독립 Target, Undo/Redo, 30회 빠른 호버, 새로고침 복원을 확인한다. 결과와 스크린샷은 `output/layer-composition-audit/browser/`에 재생성된다.
- 기존 병치 브라우저 4개 시나리오(Cars 오른쪽 Line, Barley 왼쪽 Line, Iris 아래 Scatter, Stocks 위 Area)도 통과했다. Follow overlay, All 스타일, 프로젝트 내보내기·재생, History, 두 preview 모드를 포함한다.
- ggaction unit **4,357/4,357**, 전체 계약 테스트 **660/660**, 문서 테스트 **156/156**가 통과했다. 이후 파라미터·축 제목 보완에 대해서도 관련 타입·소스 경계·패키지 테스트 18개와 축/레이어 테스트 44개를 통과했다. 승인된 두 목표 PNG는 실제 공개 호출과 기존 native 함수 조합의 decoded pixel이 같은지 검증했다.
- 앱 전체 테스트는 최종 소스에서 **481/481** 통과했다. 새 layer 카드의 21개 테스트와 4개 브라우저 시나리오를 포함해 확인했다. Layer의 공유 guide 제약도 TypeScript 선언과 맞췄으며 nested scale의 모든 타입 경로·리터럴을 포함한 관련 5개 계약 테스트가 통과했다.

## 범위

같은 화면 위치에 그릴 수 있다는 이유만으로 모든 차트 쌍을 추천하지 않는다. count/density/probability, 원본값/sum, Cartesian/Polar, Radar 차원 순서 등 의미가 다른 경우에는 독립 concat을 사용한다. Pie 위에 같은 Pie를 포개는 카드는 앱에서 제공하지 않는다. 지도·dual axis·contour 같은 새로운 시각화 primitive는 이번 범위에 추가하지 않았다.

기존 transition 패키지 API는 변경할 필요가 없었다. 새로운 레이어도 기존 concrete Canvas scene을 사용한다. npm publish와 문서 사이트 배포는 실행하지 않았다.
