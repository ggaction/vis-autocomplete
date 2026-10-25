# 옵션 카드·파라미터·차트 조합 감사 — 2026-10-25

후속 수정과 재검증은 [v0.0.2 수정 보고서](option-audit-fixes-2026-10-25.md)에 기록한다. 아래 내용은 수정 전 발견 상태다.

## 결과와 범위

새 예제 데이터셋 10개를 추가했다. 메뉴의 전체 예제는 19개이며, 요청한 **legacy Fashion-MNIST t-SNE CSV 498행은 원본 그대로** 포함했다. 추가 데이터 전체는 4,687행, 537,648바이트다. 선택할 때만 로컬 정적 파일을 읽으며 외부 데이터 서버에 의존하지 않는다. [데이터 설명·출처·라이선스](../../web/data/EXAMPLES.md), [체크섬·변환 기록](../../web/data/sources.json).

이번 제품 변경은 데이터셋 추가와 로딩·스키마 처리에 한정했다. 아래 발견한 동작 오류는 **수정하지 않았다**. 자동 검사 결과를 그대로 버그 개수로 세지 않고, 유효하지 않은 요청·의도된 검증 거부·테스트 드라이버 오류를 제외하고 재현 묶음으로 정리했다.

**문제 재현 묶음 28개와 별도 개선점 6개**를 정리했다. 우선순위가 높은 것은 공유 Color의 범례 소실, 정상 concat·overlay 후보의 잘못된 호출, 후속 필드 변경의 데이터/소유 차트 제약 누락, 그리고 기본 Area의 첫 추천 준비 49초다. 파라미터 감사 27,479건, 실제 UI 값 조작 999건, 조합 값 조작 3,141건, 후속 composition 편집 70건을 기록했다. 서로 중복되는 검사가 있으므로 이 숫자를 합쳐 독립 테스트 개수로 부르지 않는다.

검사 기준은 앱 `8bc727dc30c071d1ca8520c14e0aa189bf60c914`, ggaction `aa8f1e285295b46672408849fc3cbd0929fee178`, transition `1693936a04c67c3272805a24a1fb87491da7c874`다. Chromium의 실제 UI, 앱과 동일한 파라미터 빌더·준비 경로, SVG와 Canvas 렌더러를 사용했다. 로그인·저장은 격리된 모의 계정으로 처리했다. 실제 계정이나 배포 서버에는 쓰지 않았다.

정확한 검사 분모와 실행 결과는 [범위 집계](option-audit-2026-10-25-coverage.md)에 별도로 기록한다. 수치형 슬라이더의 모든 실수 값이나 무한한 액션 순열을 전수 검사했다는 뜻은 아니다. **새 데이터셋 10개, 차트 계열 29종, 조건부 파라미터, 경계값, 일부 상호작용 쌍, 연속 편집과 중첩 조합**을 검사했고, 미검사 범위도 함께 남겼다.

## 추가한 데이터와 검증 목적

| 데이터 | 행 × 열 | 중점 검사 |
| --- | --- | --- |
| Fashion-MNIST t-SNE | 498 × 4 | 음수 좌표, 10개 색상, 점·극좌표·facet·밀도 |
| Palmer penguins | 344 × 7 | 결측값, 성별·종 그룹, Violin·Raincloud·Box·Beeswarm |
| Wine chemistry | 178 × 14 | 서로 다른 단위·범위, PCP·회귀·ECDF·극좌표 |
| Glass identification | 214 × 11 | 0값, 불균형 클래스, 고유 ID, Radar·밀도 |
| Daily bike sharing | 731 × 16 | 날짜, 정수 범주 코드, 이진 변수, 집계·공유 축 |
| US employment | 120 × 24 | 넓은 테이블, 다변량 선택, 월별 시계열·음수 변화량 |
| Unemployment by industry | 1,708 × 6 | 14개 시계열, 다중 범례·facet·concat |
| US budget forecasts | 230 × 3 | 음수·양수, 예측 연도, 길이가 다른 시계열 |
| US household income | 520 × 6 | 순서형 소득 구간, 지역·주 계층, 비율 집계 |
| Global temperature | 144 × 2 | 음수 anomaly, 연도 bin, Horizon·Area·극좌표 |

## 먼저 고쳐야 할 구조

개별 카드 이름을 숨기는 것으로 해결할 문제가 아니다. 다음 다섯 계약이 서로 어긋난다.

1. **필드의 의미와 소유 차트의 제약:** 원본 타입 힌트, 집계, 결측 정책, packing·jitter, series grain을 후속 편집에서도 함께 유지해야 한다.
2. **일반 채널과 차트 생성자의 인자:** Area·ECDF·Rug 등은 같은 X/Y/Color 객체를 그대로 받을 수 없다. `None`도 생략과 구분해야 한다.
3. **표시되는 결과와 공유 축의 의미:** Violin의 내부 파생 필드와 원본 측정값을 같은 의미 계층에서 비교해야 한다. Follow results 가능 여부도 마크 종류만으로 판단하면 안 된다.
4. **자동 공간과 사용자 지정 공간:** 범례를 추가하거나 줄일 때 자동 예약 공간을 재계산해야 한다. 사용자가 지정한 위치·크기를 잃지 않으면서 자동 범례끼리 충돌하지 않아야 한다.
5. **동적 파라미터의 표시와 실제 값:** Radar 차원 순서, 통계 population/groupBy, 선택 가능한 타입이 실제 호출과 일치해야 한다.
6. **추천 준비 비용:** 기본 Area에서도 첫 페이지가 약 49초 걸린다. 구체적 병목 함수는 아직 미확정이며, 후보 준비·guide 계산·재사용 범위의 계측이 필요하다.

## 재현된 문제

우선순위는 P1=정상적인 생성·편집·조합을 막거나 결과를 사실상 못 쓰게 함, P2=특정 조합·후속 편집·의미 전달의 결함이다. 원시 실패 횟수와 아래 재현 묶음 개수는 다르다.

### A01 · P1 · 결측값이 있는 새 필드를 선택하면 여러 카드가 실패

**재현:** Palmer penguins에서 Species와 Body Mass (g)를 선택 → Raincloud → Edit raincloud → Group=Sex. `Field "Sex" must contain a nominal value at row 7.` 오류가 난다. Beeswarm의 Color/Stroke/Shape를 Sex로 바꾸거나 Dot/Lollipop 범주를 Sex로 바꿔도 같은 계열의 실패가 나온다.

초기 변수의 complete-case 필터만 있고 나중에 선택한 필드의 결측 정책은 함께 갱신되지 않는다. 필드 매핑 변경 시 소유 차트와 데이터 준비를 일관되게 갱신해야 한다. 결측값을 임의의 범주로 바꾸는 수정은 적절하지 않다. [상세 P1](option-audit-2026-10-25-parameters.md), [실제 UI 증거](../../output/option-audit-2026-10-25/reproductions/missing-raincloud-group.png).

### A02 · P1 · Parallel coordinates의 Color=None이 잘못된 호출을 생성

**재현:** Wine에서 Alcohol, Malicacid, Ash, Alcalinity_of_ash, Magnesium, class → Parallel coordinates → Color=None. `encodeColor requires exactly one of value or field.` 오류가 난다.

필드를 지워도 `color: { scale: { palette: 'tableau10' } }`가 남는다. Optional encoding을 끄면 scale payload도 함께 없어져야 한다. [실제 UI 증거](../../output/option-audit-2026-10-25/reproductions/parallel-color-none.png).

### A03 · P1 · 범례를 편집한 뒤 변수 기반 Stroke를 추가하면 범례가 충돌

**재현:** Income의 Bar, X=group, Y=pct(sum), Color=region → Edit legend(right, label size 10, item gap 18, show all) → Encode stroke=Variable(region). 색상 범례와 stroke 범례가 겹친다는 오류가 난다. **같은 encodeStroke 호출이 범례 편집 전에는 성공한다.** Wine Radial bar에서도 확인했다.

사용자 편집 범례와 새 자동 범례를 따로 배치하는 것이 원인 경계다. 위치·스타일을 보존하면서 모든 범례를 함께 배치하고 여백을 예약해야 한다. [독립 호출 재현](../../output/option-audit-2026-10-25/parameters/confirmed-legend.json), [Wine Radial bar 기록](../../output/option-audit-2026-10-25/live/23-createRadialBarPlot-wine.json).

### A04 · P2 · 통계 Group by에 현재 population에 없는 내부 필드가 노출

**재현:** Penguins의 Species / Body Mass (g) → Violin → Add statistic, Y, Original observations → Group by=Body Mass (g)_value 또는 Body Mass (g)_density. `groupBy field ... is missing at item 0.` 오류가 난다. Species는 성공한다. Raincloud와 Glass Density도 영향받는다.

여러 population의 필드 목록을 합친 뒤 population과 groupBy의 유효성을 함께 맞추지 않는다. 선택지와 정규화를 동일한 데이터 population 계약에 묶어야 한다. [실제 UI 증거](../../output/option-audit-2026-10-25/reproductions/statistics-internal-field.png).

### A05 · P2 · Beeswarm·Strip의 위치 편집이 범주형 슬롯 제약을 무시

**재현:** Penguins Species / Beak Depth (mm) → Beeswarm → Encode X=Beak Length (mm). `Point packing requires a categorical position scale with a positive slot.` 오류. Strip은 band jitter 슬롯 오류다.

일반적인 숫자 축 매핑 가능 여부만으로는 부족하다. 소유 차트의 packing/jitter 역할을 확인하고, 지원하는 역할 교환을 수행하거나 불가능한 선택에 이유를 제공해야 한다. [실제 UI 증거](../../output/option-audit-2026-10-25/reproductions/beeswarm-position-type.png).

### A06 · P2 · 필터의 극단값이 밀도·구간 추정의 성립 조건을 깨뜨림

**재현:** Penguins Violin/Raincloud에서 Body Mass (g) ≥ 6300 또는 ≤ 2700. Gradient에서 Flipper Length (mm) ≥ 231 또는 ≤ 172. 서로 다른 관측값이 부족해 `Density observed extent requires varying finite values.`가 난다. Interval에서도 극단 필터가 빈 scale domain 오류를 만든다.

추정기가 거부하는 것은 타당하다. 문제는 카드가 이 값을 정상적인 끝점처럼 제시하면서 남는 데이터의 제약을 설명하지 않는다는 것이다. 지원 범위·빈 결과·퇴화 분포의 표시 정책이 필요하다. [세부 기록](option-audit-2026-10-25-parameters.md).

### A07 · P2 · 유효한 scale·normalization 쌍에서 축 자동 맞춤 실패

**재현:** Glass RI → Density → Normalization=count + Y scale=symlog. Y tick label overlap 오류. unit/linear, unit/symlog, count/linear은 모두 성공한다. Bike Bar의 가로 sum(cnt) + symlog에서도 별도 실패를 확인했다.

`prepareFittedPlot`은 일반 x/y 인자를 중심으로 fallback을 시도하지만 Density는 field/valueScale/densityScale 역할을 사용한다. 현재 [축 보정 코드](../../src/prepare.js)는 Density의 측정값·밀도 역할을 축 binding으로 변환하지 않아 해당 재시도에 tick 조정이 들어가지 않는다. 생성자별 의미 역할을 통한 축 fitting이 필요하다. [독립 2×2 비교](../../output/option-audit-2026-10-25/parameters/confirmed-density.json).

### A08 · P2 · 위치·그룹 변경이 기존 집계·series 제약을 고려하지 않음

**재현:** Bike dteday / cnt / season → Line. Encode Y에서 instant, mnth, dteday를 선택하면 mean 집계가 남아 새 타입과 충돌한다. Encode group=yr는 한 series 안에 여러 색상이 들어가서 실패하고, instant는 series당 한 점이라 실패한다. weekday × holiday facet grid의 희소 패널도 영향을 받는다.

필드 타입뿐 아니라 집계, 색상 일관성, series별 최소 관측수와 희소 패널 정책을 함께 계산해야 한다. 이것들을 별개 카드 예외로 처리하면 반복된다. [세부 재현](option-audit-2026-10-25-parameters.md).

드문 차트에서도 같은 범주의 문제가 확인됐다. Bike Pie의 Encode theta=cnt는 quantitative theta에 허용되지 않는 aggregate=sum을 남긴다. Rose의 theta=yr는 기존 polar guide 값과 충돌한다. Temperature Horizon의 Encode group은 내부 plotHorizonSign/Color를 제안하지만 소유 차트가 요구하는 그룹 역할과 맞지 않는다. [독립 재현 결과](../../output/option-audit-2026-10-25/parameters/confirmed-specialized.json).

통계 선 target에서도 공유 관계가 고려되지 않는다. Cars Scatter → Add statistics → 통계 선 target → Encode X의 Linear/Log/Sqrt/Symlog는 새 scale ID를 만들며 다른 소비자가 있는 기존 X guide를 재바인딩하려다 실패한다. Auto는 성공한다. 현재 linear인 차트에서 Linear를 고르는 것만으로 실패할 수 있다.

### A09 · P2 · Area의 원본에 없던 정렬용 null 행을 후속 매핑이 잘못 검증

**재현:** Budgets Area에서 Encode X=value, 또는 Bike Area에서 Encode X=casual. 소스 값은 완전하지만 정렬된 series 데이터의 측정값에는 missing:break를 위해 삽입한 null이 있다. 이를 새 X 원본 값처럼 검증하면서 오류가 난다.

실제 결측값이 있는 A01과 구분되는 문제다. 후속 매핑은 렌더링용 파생 행을 무작정 재사용하지 말고 소유 차트의 원본·측정 역할에서 변환을 다시 구성해야 한다. [합성된 null 행과 호출 증거](../../output/option-audit-2026-10-25/parameters/confirmed-specialized.json).

### A10 · P1 · 범주형 범례의 overflow 설정을 연속형 범례에 전달

**재현:** Glass Id_number, RI, Na, Mg → Radar → Encode opacity → Variable=Al. `Unknown createLegend option "overflow".` 오류가 난다. 같은 차트의 수치 변수 Stroke에서도 발생한다.

자동 guide 생성기가 기존 color domain의 214개 범주를 보고 overflow를 켠 뒤, 새 opacity/stroke 범례에도 그 옵션을 복사한다. 연속형 범례는 overflow 인자를 받지 않는다. 같은 encodeOpacity(Al) 뒤 overflow 없는 createGuides는 성공하는 대조군을 확인했다. 현재 필요한 채널의 scale/legend 종류별로 옵션을 생성해야 한다. [독립 대조 결과](../../output/option-audit-2026-10-25/parameters/confirmed-radar-overflow.json).

### A11 · P2 · Polar·PCP의 개별 축 편집은 native에서 되지만 검색에도 없음

**재현:** Wine Polar Scatter에서 editThetaAxis·editRadialAxis를 정확한 이름으로 검색해도 후보가 없다. Wine PCP의 editParallelAxis도 같다. 동일한 상태에서 native editThetaAxis(labels.fontSize=16), editRadialAxis(angle=45), editParallelAxis(field=Alcohol, labels.fontSize=16)는 실제로 렌더링된다.

전체 축을 함께 바꾸는 editAxes 카드만으로는 특정 각도·반지름·차원의 축 설정을 표현할 수 없다. `extended-catalog.js`의 세부 축 후보 생성이 x/y 채널에 한정되어 있고 corpus 후보 보완도 이 역할을 보충하지 않는다. 좌표계의 공개 축 역할을 열거해 개별 편집을 연결해야 한다. [native 성공과 앱 검색 대조](../../output/option-audit-2026-10-25/parameters/confirmed-axis-coverage.json).

### A12 · P2 · Shape scale 카드는 있지만 조절 가능한 파라미터가 없음

**재현:** Cars Scatter → Encode shape=Origin → Edit shape scale. 카드가 나타나지만 control은 0개이고 한 개의 고정 shape range만 적용한다. 사용자가 다른 shape 배치를 비교하거나 선택할 수 없다.

같이 검사한 variable Size/Opacity/Stroke/StrokeWidth의 scale 카드는 실제 파라미터가 있고 검사한 값들이 성공했다. Shape도 공개 scale 계약의 선택 가능한 range를 비교할 수 있게 노출해야 한다. [대조 검사 기록](../../output/option-audit-2026-10-25/parameters/cars-scatter-seeded-editSizeScale,editOpacityScale,editShapeScale,editStrokeScale,editColorScale.json).

### A13 · P2 · 잘못된 기본 인자 때문에 Stroke dash scale 카드가 사라짐

**재현:** Cars Scatter → Origin별 Add statistics → 통계 선 target → 변수 Stroke width·Stroke dash(group) → Edit stroke dash scale 검색. native scale은 있지만 후보의 `editStrokeDashScale({ target, reverse: true })`가 preflight에서 거부된다. reverse는 공개 API에 없는 옵션이다.

지원되는 `range: [[1, 3], [5, 2], []]`로 호출하면 렌더링된다. 공출현이 부족하거나 차트가 미지원인 것이 아니라 후보 recipe가 API 계약과 어긋나 기능을 숨긴다. [native 성공·실패 대조](../../output/option-audit-2026-10-25/parameters/confirmed-stroke-dash-scale.json).

### A14 · P1 · 기본 Area를 적용한 뒤 첫 추천 페이지에 약 49초

**재현:** Unemployment by industry → date, rate, series → 기본 Area → Apply. 별도 새 세션에서 초기 차트와 History는 만들어지지만 첫 추천 5개가 준비되기까지 **49.193초** 걸렸다. 1.6초에는 Encode stroke, 26.7초에는 Facet까지 보였고 49.2초에 나머지 3개와 busy=false가 확인됐다.

이 구간 renderer process CPU는 약 49.607초, main-thread TaskDuration은 약 0.432초 증가했다. 전체 파라미터 sweep이 끝난 뒤에도 재현되므로 단순 드라이버 timeout으로 제외할 문제가 아니다. 백그라운드 worker 계산이 주도한 것으로 추정되지만 **특정 함수·후보별 비용·알고리즘 원인은 프로파일로 확정하지 않았다**. 추천 계산의 세부 비용을 계측하고 비싼 조합 준비의 스케줄링·재사용을 검토해야 한다. [독립 측정 보고서](option-audit-2026-10-25-area-readiness.md).

### C01 · P1 · 정상 Bar의 Layer chart 기본 후보가 모두 실패

**재현:** Barley variety, yield, year → Bar → Add overlay → Layer chart. 기본은 X=sum(yield), Y=year, Color=variety이다. Bar/Dot/Lollipop은 series layout policy 충돌, Line은 X aggregate 미지원으로 실패한다. 앞/뒤 배치를 바꿔도 동일하다. Follow results는 이 원본에서 성공한다.

앱은 이미 공개 `describeAction`으로 검사하고 있는데 후보가 통과한다. 따라서 descriptor와 실제 materialization의 공유 layout 계약을 함께 고쳐야 한다. [조합 보고서 C01](option-audit-2026-10-25-compositions.md).

### C02 · P2 · Violin에 성립하지 않는 Follow results를 정상 후보로 제공

**재현:** Penguins Species / Body Mass (g) / Sex → Violin → Add overlay → Follow results → Line 또는 Point. 기본값과 개별적으로 검사한 Missing·Order by 선택값 모두 단일 endpoint가 없다는 오류를 낸다. 모든 파라미터의 교차 조합을 전수 검사한 것은 아니다.

Violin은 범주당 여러 밀도 좌표가 있다. 원시 데이터 Layer는 가능하지만 Follow results의 endpoint 계약은 다르다. 기본 mark가 area라는 이유만으로 추천하지 말고 결과-item capability를 확인해야 한다. [조합 보고서 C02](option-audit-2026-10-25-compositions.md).

### C03 · P1 · Violin → Scatter의 같은 측정값 공유 축을 잘못 거부

**재현:** Penguins Species / Body Mass (g) / Sex → Violin → 오른쪽 + → Add Scatter. Y를 shared로 강제하지만 `Cannot share y: field meaning and scale mapping must be compatible across views.`가 난다. facet·overlay 없이도 재현된다. 공유를 해제할 파라미터가 없다.

앱은 원본 Body Mass (g)의 의미를 비교하고, native 공유 검사는 내부 Body Mass (g)_value 필드를 비교한다. 두 계층이 동일한 measurement lineage를 써야 한다. [실제 UI 증거](../../output/option-audit-2026-10-25/compositions/penguins-minimal-share.png).

### C04 · P1 · Adjacent Area에 지원하지 않는 measurement 속성을 전달

**재현:** Barley Bar → Follow results Line → facet → 오른쪽 + → Add Area. `Unknown createAreaPlot measurement option "fieldType".` 오류가 난다. 검사한 mapping·집계·scale·palette 변경으로도 해결되지 않는다.

일반 X/Y encoding 객체를 Area의 measurement 계약으로 제대로 변환하지 못한다. 공유·상속 과정에서 지원되는 속성만 타입별로 전달해야 한다. [조합 보고서 C04](option-audit-2026-10-25-compositions.md).

### C05 · P1 · Adjacent ECDF의 제공된 Color 필드가 잘못된 인자로 변환

**재현:** Iris Species / Sepal.Length → Beeswarm → 오른쪽 + → Add ECDF → Color / group=Species. `createECDFPlot color field must be a non-empty string.` 오류. 색상 없는 기본 ECDF는 성공한다.

ECDF의 color 문자열 계약을 다른 생성자의 channel 객체 형식과 구분해야 한다. [실제 UI 증거](../../output/option-audit-2026-10-25/compositions/iris-ecdf-color.png).

### C06 · P1 · Adjacent Rug에 양쪽 축·생성자 미지원 color를 주입

**재현:** Iris Beeswarm + Box layer + facet → 오른쪽 + → Rug: `requires exactly one of x or y`. 색상이 있는 Barley 원본에서는 `Unknown createRugPlot option "color".`가 난다. edge·opacity·scale 변경으로 해결되지 않는다.

한 축 전용 생성자에 원본의 양쪽 축·color를 일괄 상속한다. 소스 채널을 무조건 복사하지 말고 생성자의 지원 역할에 맞춰야 한다. [조합 보고서 C06](option-audit-2026-10-25-compositions.md).

### C07 · P1 · Adjacent 카드의 Color=None이 이전 색상을 다시 상속

**재현:** Bike dteday / cnt / season → Line → 오른쪽 + → Add Area → Color=None. `Field "season" must contain a nominal value at row 0.` 오류. facet·overlay 없이 재현된다. Fashion Area와 Budgets Line에서도 같은 계열을 관찰했다.

명시적인 None을 단순히 생략된 필드로 처리한 뒤 composition default가 이전 color를 다시 넣는 경로가 있다. 집계 데이터에서는 그 그룹 열이 이미 제거되어 오류로 이어진다. **값 상속 / 명시적 제거 / 사용자 지정**을 구분해야 한다. [실제 UI 증거](../../output/option-audit-2026-10-25/compositions/bike-area-no-color.png).

### C08 · P2 · 복합 차트의 자동 제목에 내부 파생 필드명이 노출

**재현:** Penguins Violin + Raincloud layer + facet → 옆 차트 추가 → Target=All → Add a title. 기본 제목이 `Body Mass (g)_value by Species`다.

사용자가 선택한 필드는 Body Mass (g)인데 밀도 계산용 suffix가 제목에 포함된다. 공유 축과 마찬가지로 사용자에게 보이는 제목도 원본 측정값의 의미에서 생성해야 한다. [3패널 결과](../../output/option-audit-2026-10-25/compositions/penguins-null-distributions-nested.png).

### C09 · P1 · 자동으로 Color를 공유한 첫 concat에서 색상 범례가 사라짐

**재현:** Fashion-MNIST x_pos, y_pos, label_name → Scatter → 오른쪽 + → Add Scatter. 처음 차트에는 10범주 색상 범례가 있지만 Y+Color를 자동 공유한 첫 concat 직후 어느 패널에도 범례가 없다. 이후 아래쪽 그룹 concat·저장·reload 후에도 돌아오지 않는다.

removeLegend를 호출하지 않았고 마지막 createGuides는 두 패널을 대상으로 한다. 저장된 native 상태를 복구해 확인하면 원본의 color legend config와 26개 관련 scene 참조가 concat 후 root·children 전체에서 0개다. 공유 범례를 억제하는 단계와 한 곳에 생성하는 단계의 소유권·순서를 함께 확인해야 한다. [native 상태 검사](../../output/option-audit-2026-10-25/compositions/fashion-legend-inspection.json), [결과 화면](../../output/option-audit-2026-10-25/compositions/fashion-point-nested.png).

### C10 · P2 · Facet guide 선택지가 실제 범례와 배치 제약을 반영하지 않음

**재현 A:** Barley의 10범주 색상 + Line overlay + facet에서 Facet guides의 Shared bottom/top → `Horizontal legend block requires more plot width.` 오류. **재현 B:** 색상 등의 범례 인코딩이 없는 Iris Point + Box facet에서 Shared right/top/bottom을 모두 활성화해 보여주지만 실행하면 범례 인코딩 부재로 거부한다. 실패 5개를 실제 브라우저에서도 확인했다.

native의 공간·인코딩 검증은 타당하다. 카드가 현재 guide capability를 반영하고, 지원되는 배치를 만들기 위한 여백·크기 조절 또는 불가 이유를 제공해야 한다. 동일한 facet policy를 다시 선택한 no-change 2회는 이 결함에서 제외했다. [후속 composition 편집 보고서](option-audit-2026-10-25-composition-editors.md).

### S01 · P1 · Radar가 고유 ID를 색상으로 묶어 214개 범례를 만듦

**재현:** Glass에서 Id_number, RI, Na, Mg, Al, Si, K, Ca, Ba, Fe, class → Radar → Apply. Id_number가 series ID이면서 color이고, class를 따로 색상으로 고를 초기 파라미터가 없다. 캔버스가 700 × 3920.5로 커지고 314 × 314 plot이 화면에서 약 60px로 줄어든다.

고유 식별자와 색상 역할을 분리하고, 낮은 cardinality의 선택된 class 또는 고정색을 기본으로 고려해야 한다. [상세 S1](option-audit-2026-10-25-semantics.md), [화면](../../output/option-audit-2026-10-25/semantics/glass-radar-id-default.png).

### S02 · P1 · 범례를 214개에서 6개로 줄여도 자동으로 커진 캔버스가 유지

**재현:** S01 상태에서 차원 편집 후 Encode color=class. 색상 범례는 6개가 되지만 높이는 3920.5 그대로다. 위·아래 여백만 약 1789/1817로 재배치되어 작은 차트 주변이 빈 공간이 된다.

자동 중심 맞춤은 전체 크기를 유지한 채 여백을 분배하므로, 자동 예약했던 공간이 풀리지 않는다. 사용자 크기와 자동 guide 예약량의 출처를 구분하고 후자를 다시 계산해야 한다. [화면](../../output/option-audit-2026-10-25/semantics/glass-radar-id-class-color.png).

### S03 · P2 · Radar 후속 차원 편집이 nominal 타입 힌트를 잃음

**재현:** S01에서 Edit radar dimensions → class 추가 → Apply. 초기에는 범주형이던 class/Id_number를 수치 차원으로 제안하며 class가 실제 숫자 축이 된다.

소유 차트의 원본 데이터를 타입 힌트 없이 다시 profile한다. 업로드·예제·사용자 스키마 수정에 사용한 필드 의미를 후속 편집에도 전달해야 한다. [상세 S3](option-audit-2026-10-25-semantics.md).

### S04 · P2 · Radar 차원 멤버십 하나만 바꿔도 기존 축 순서 전체가 뒤집힘

**재현:** S01에서 Edit radar dimensions는 RI,Na,Mg,Al,Si,K,Ca,Ba,Fe 순으로 보인다. class만 추가하면 실제 fields는 Fe,Ba,Ca,K,Si,Al,Mg,Na,RI,class가 된다. 순서 조절 UI도 없다.

후보가 reverse한 기본값을 만들지만 multiselect는 원본 choices 순서를 표시한다. 실제 선택 순서를 보여주고 reorder를 제공해야 하며, 멤버십 변경은 기존 순서를 보존해야 한다. [상세 S4](option-audit-2026-10-25-semantics.md), [편집 UI](../../output/option-audit-2026-10-25/semantics/glass-radar-id-edit-controls.png).

## 오류와 별개인 부족한 파라미터·표현

- **그룹 요약 Radar:** Wine의 class별 평균·중앙값 프로파일을 비교하는 카드 경로가 없다. 현재는 row-unique ID를 요구하므로 자연스러운 다변량 비교가 막힌다. Group by와 aggregation이 필요하다.
- **Radar 단위 정규화:** Glass의 Fe 범위는 공통 radial scale에서 약 1px인데 Si가 대부분을 차지한다. raw/common-unit과 per-dimension normalization을 명시적으로 선택할 수 있어야 한다. 자동으로 몰래 정규화하면 안 된다.
- **비율의 가중 집계:** Income의 pct sum·단순 mean은 계산상 맞지만 지역별 가구 비율을 뜻하지 않는다. weight=total을 사용한 weighted mean과 percent 표시를 제공하면 의미 혼동을 줄일 수 있다.
- **수치 연도의 bin 표시:** Global temperature는 2023까지인데 bin 중심이 2030으로 표시된다. 행 유실은 없고 기존 bin 정책에 따른 결과지만, `year`만 쓰기보다 bin 구간·집계 사실을 보여줘야 한다.
- **명시적 공유 해제와 오류 회복:** 자동 공유 판단이 틀렸을 때 카드에서 수정 가능한 경로가 없다. 지원되지 않는 조합은 이유와 수정 가능한 파라미터를 제공해야 한다.
- **facet·일반 패널 혼합의 All 편집:** Iris에서 첫 패널은 facet+Box, 나머지 두 패널은 Scatter일 때 All의 opacity 검색 결과가 없다. native 단일 target 목록 호출도 facet source 경유를 요구한다. 이미 지원되는 액션을 앱이 단순히 숨기는 오류라기보다, 혼합 구성의 전체 appearance 편집을 일관되게 라우팅할 계약이 부족한 경우다.

## 숫자가 맞는지도 별도로 확인

독립 산술·좌표 oracle 9개를 통과했다. 렌더가 예외 없이 끝난 것과 수치가 맞는 것은 별개로 검사했다. 좌표·집계 비교의 절대 허용 오차는 `1e-7`이고, 색상 값은 정확히 비교했다.

- Wine PCP 178개 경로 × 5차원=890좌표, Glass PCP 214 × 9=1,926좌표를 원본 min/max로 재계산했다.
- Wine PCP의 Proline만 log로 바꾼 뒤 890좌표를 다시 확인했다. 다른 네 축은 linear로 남고 178행이 유지된다.
- Fashion의 498점·996개 X/Y 좌표·498개 색상 매핑과 10범주를 확인했다.
- Income의 소득 구간 10개 순서, 50개 Bar의 그룹 합, 50개 Area 상단 vertex의 산술평균을 독립 계산과 대조했다.
- Temperature Area/Horizon의 원본 `(year, temp)` 144쌍이 순서대로 보존되고 8개 bin 평균이 맞는지 확인했다. Polar Line은 원본 144행과 vertex 144개를 대조하고, 음수 78개 관측값을 포함하는 전체 범위 `[-0.48, 1.17]`가 radial domain에 반영됐는지 확인했다. 극좌표 전체 좌표에 대한 oracle은 아니다.

[oracle 원시 결과](../../output/option-audit-2026-10-25/semantics/oracles.json), [원본 extent·행 대조](../../output/option-audit-2026-10-25/semantics/report-crosschecks.json). 이 검사에서는 행 유실이나 수치 불일치를 발견하지 않았다. 유한 좌표 검사는 명시한 PCP·Fashion 매핑에 적용했고, 모든 차트·변환의 전체 좌표를 검증했다는 뜻은 아니다.

## 검사 구분과 제한

- 빈 title/annotation 등 의도된 텍스트 검증, 범주 수보다 큰 facet columns의 동일한 그림, 원형 점 회전의 동일한 그림, 이미 같은 값인 no-change는 버그에서 제외했다.
- 초기 드라이버가 이전 mapping 상태를 전달하지 않거나 검색 그룹·함수명을 잘못 사용한 건 테스트 오류로 분리했다. 최소 재현은 수정한 드라이버로 다시 실행했다.
- Unemployment Area의 초기 30초 timeout은 확정 근거로 쓰지 않았다. 이후 전체 sweep 종료 뒤 별도 세션에서 49.193초를 관찰해 A14로 올렸다. 다른 파라미터 검사 도중의 실행 시간은 성능 벤치마크로 해석하지 않는다.
- Chrome 계열 로컬 UI 검증이다. Safari/Firefox, 실제 계정 저장·동시 수정, 배포, 모바일, 접근성, 모든 direct-manipulation 입력, 내보낸 PDF의 인쇄 품질은 이번 범위가 아니다.
- 모든 enum을 여러 차트에서 검사했더라도 모든 enum의 모든 조합을 전수 검사한 것은 아니다. 수치 경계·기본·중간값과 선택한 pair를 검사했다. 실행 예산으로 건너뛴 경우와 도달하지 못한 액션은 범위 집계에 남긴다.

## 세부 보고서와 재실행

- [파라미터·소유 차트 계약](option-audit-2026-10-25-parameters.md)
- [Overlay·facet·concat](option-audit-2026-10-25-compositions.md)
- [필드 의미·수치 검증](option-audit-2026-10-25-semantics.md)
- [후속 composition 편집](option-audit-2026-10-25-composition-editors.md)
- [Area 추천 지연 독립 측정](option-audit-2026-10-25-area-readiness.md)
- [범위 집계](option-audit-2026-10-25-coverage.md)
- 로컬 HTML: `output/option-audit-2026-10-25/report.html`

```sh
PORT=5205 SUPABASE_URL= SUPABASE_PUBLISHABLE_KEY= npm run dev
node scripts/audit-live-options-2026-10-25.mjs
node scripts/audit-reproductions-2026-10-25.mjs
node scripts/audit-compositions-2026-10-25.mjs
node scripts/audit-data-semantics-2026-10-25.mjs
node --expose-gc scripts/audit-parameters-2026-10-25.mjs --case glass-density
node --expose-gc scripts/audit-composition-editors-2026-10-25.mjs
node scripts/audit-area-readiness-2026-10-25.mjs
node scripts/summarize-option-parameters-2026-10-25.mjs
node scripts/build-option-audit-report-2026-10-25.mjs
```

전체 parameter case 목록은 `--list`, 단일 액션은 `--action`, 의존 액션을 먼저 적용할 때는 `--seed`를 사용한다. 병렬 실행은 메모리·CPU와 타이밍 측정을 고려해 제한한다. 생성된 PNG/SVG/JSON/HTML·프로젝트 덤프는 `output/`에만 두고 Git에서는 제외한다. 감사 코드와 이 보고서, 필요한 예제 런타임 자산만 저장한다.
