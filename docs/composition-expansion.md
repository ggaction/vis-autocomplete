# Overlay / concat 확장 검증과 구현 계약

2026-10-24 조사. **아직 기능 구현 완료 보고가 아니다.** 신규 API 승인 전에 실제 native capability와 앱의 제한을 분리해 확인한 기록이다. 이후 사용자가 2026-10-24 “구현하자”로 계약과 그림을 승인했으며 구현을 진행한다.

## 재현

```sh
node scripts/audit-composition-space.js
node --test vendor/ggaction/test/gates/layer-composition/layers.test.js vendor/ggaction/test/gates/layer-composition/png.render.js
```

상세 결과는 gitignored `output/layer-composition-audit/inventory.json`. 입력은 Iris, Barley, Stocks, Tips, Weather, Gapminder, Cars, Electricity의 앞쪽 최대 150 complete rows 및 Radar/Horizon의 작은 결정적 fixture다. 코퍼스 전체나 모든 파라미터를 검증했다고 주장하지 않는다.

## 확인된 근본 원인

1. Add overlay는 `createOverlay`의 **visibleItems → line/point**만 제공한다. `point/bar/line/area`라는 저수준 mark type이 후보 자격을 결정한다. Box/Violin 같은 composite owner가 저수준 bar/area라는 이유로 잘못 follow 대상으로 취급될 수 있고, Heatmap/Polar는 진입 자체가 없다.
2. `adjacentContext`가 화면 layer의 `encoding.x.field/y.field`를 원본 컬럼 이름으로 가정한다. Box quartile, Histogram count, Density/ECDF 생성 필드, Dot/Lollipop endpoint, Horizon folded coordinates는 이 가정을 만족하지 않는다.
3. Polar/Radar/Parallel은 x/y 자체가 없다. 다른 좌표계와의 **독립 concat은 이미 가능**하지만 앱이 `Select an X variable`에서 중단한다.
4. 같은 scale ID뿐 아니라 원본 field, 통계/단위, temporal/bin 단위, 방향, 차원 순서, shared color grain을 확인해야 한다. 생성이 성공해도 의미가 맞지 않는 그림은 성공으로 세면 안 된다.
5. 독립 새 layer와 source 결과를 따르는 overlay는 편집·필터·집계·통계 population의 소유권이 다르다. 한 가지 follow 상태에 억지로 묶으면 source 변경 때 사용자 설정이 사라지거나 표본이 중복된다.

## 실행 결과

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

## 제안된 사용자 흐름

- 기존 **Add overlay** 버튼에서 `Follow results`와 `Layer a chart`를 구분해 보여준다. 후자는 실제 새 차트 카드와 필요한 native parameters를 표시한다.
- 범주형×수치에서 Beeswarm을 선택했다면 Box/Violin/Interval 등을 추가할 수 있다. 선택 카드 하나는 공개 함수 한 번이다.
- Target은 같은 패널 안에 `[Beeswarm | Box]`처럼 표시하고, 복합 Box의 whisker/median은 별도 chart target으로 분해하지 않는다.
- `+`는 source의 내부 generated field가 아니라 실제 데이터 역할을 사용한다. 공유 불가인 새 차트도 독립 축으로 추가할 수 있다.
- 썸네일/preview/transition, code/Apply/history, 독립 Target/All, reset/replay/resize의 기존 의미를 유지한다.
- 원본/집계 구분은 직전 수정 정책을 유지한다. contour, 지도, dual-axis 같은 별도 새 시각화 API를 조용히 추가하지 않는다.

신규 API/목표 그림 Gate는 사용자에게 승인받았다. 새 layer API와 앱 통합은 진행 중이며, 조사 시점의 결과와 구현 완료 검증은 구분한다.
