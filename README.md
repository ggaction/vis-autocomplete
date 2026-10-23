# ggaction Visualization Autocomplete

현재 `ChartProgram`을 받아 다음에 실행할 **기존 ggaction 공개 함수 한 번**을 추천한다.
추천 엔진과 로컬 웹 데모를 포함한다. 온라인 LLM 호출은 없다. 필요한 새 함수는 `vendor/ggaction`의 실제 라이브러리 API로 구현한다.

## 웹 데모

Node.js 20 이상과 Git이 필요하다. 수정한 ggaction 소스는 서브모듈로 고정되어 있으므로
처음에는 의존성 소스까지 함께 받는다.

```sh
git clone --recurse-submodules https://github.com/ggaction/vis-autocomplete.git
cd vis-autocomplete
npm ci
npm run dev
```

이미 서브모듈 없이 clone했다면 `git submodule update --init --recursive`를 먼저 실행한다.
소스·테스트·예제·학습된 모델은 저장소에 포함하며, `node_modules`, `output`, 코퍼스 다운로드
캐시는 포함하지 않는다. 따라서 웹 데모에는 코퍼스를 다시 다운로드할 필요가 없다.

[http://127.0.0.1:5173/](http://127.0.0.1:5173/)에서 실행한다. 준비된 `data/model.json`과 `data/initial-model.json`을 사용한다.

- **Cars 원본 406행·9개 열**을 기본으로 쓴다. Vega 원본과 값이 일치하며, null도 보존한다.
  출처는 `web/data/SOURCE.md`에 기록했다. Monthly sales 예제와 CSV/JSON 업로드도 지원한다.
- ggaction Code 오른쪽 위의 **− / +**는 코드 글자 크기를 8–20px 범위에서 1px씩 조절한다.
- History와 ggaction Code 우상단의 화살표로 각 패널을 접고 펼칠 수 있다. History를 접으면
  확보된 높이를 Current / Preview와 Option cards에 나눠주며, ggaction Code를 접으면 두 영역의
  가로폭이 넓어진다. 코드 펼침 상태·히스토리 위치·옵션 페이지는 유지하고 패널 접힘 설정은 새로고침 후에도 복원한다.
  고정폭 글꼴은 유지하며, 선택한 크기는 브라우저에 저장한다. **Copy code**는 접힌 설정·파라미터를
  포함한 전체 원문을 복사한다. 프리뷰 중에는 새 액션을 포함하고, 줄 번호·접기 표시·차이 표시는 제외한다.
- Current visualization에 차트가 있으면 **.png / .pdf / .svg**로 다운로드할 수 있다.
  ggaction의 공개 렌더러를 사용하며 PNG는 2× 해상도, PDF·SVG는 벡터 형식이다.
  범례·축·제목을 포함한 현재 확정 상태를 저장하고, 호버 프리뷰는 포함하지 않는다.
  Undo/Redo 및 History로 돌아간 상태도 저장할 수 있으며 데이터 표에서는 버튼을 숨긴다.
  내보내기는 `npm run dev`의 로컬 `/api/export/:format`에서 처리한다. 브라우저는 현재 차트의
  resolved `graphicSpec`만 보내며, 새 액션 실행이나 추천 재계산은 하지 않는다.
- 처음 Current visualization은 **전체 원본 데이터 표**다. 열을 차례로 클릭하면 X → Y → Color로 지정한다.
  이미 선택한 열을 다시 클릭하면 해제하고, 새 열은 비어 있는 X → Y → Color 순서로 채운다. 한 열이 여러 역할을 맡았다면 그 열의 역할을 함께 해제한다.
  Color는 선택 사항이며, 선택된 항목에만 드롭다운이 나타나 변수를 변경하거나 선택을 지울 수 있다.
  테이블 글씨는 9px, 각 열은 58px로 고정하고 긴 값은 말줄임/툴팁으로 표시한다. 전체 행·열은 표 안에서 스크롤한다.
- Preview는 옵션 카드에 호버하거나 키보드로 포커스했을 때 해당 차트를 표시하고, 벗어나면 비운다. History를 호버할 때는 해당 시점의 차트를 표시한다.
  시간형 scale에는 `zero`를 전달하지 않는다. 카드 호버 중에만 완성된 차트를 미리 보고 Apply로 확정한다.
- X/Y 선택 후 **선택한 2~3개 열만 투영한 데이터 통계**로 기존 유사 데이터셋 추천 엔진을 실행한다.
  ggaction plot 중 지정한 변수의 역할을 실제로 표현할 수 있는 차트를 제안한다.
  변수는 표에서 정하고, 초기 차트 카드에는 집계·회귀 모델 등 필요한 구성 파라미터만 표시한다(보통 3개 이하, 필요한 경우 4개).
  Bar·line·area·horizon은 기본 mean 집계이며 mean / median / sum / min / max를 고를 수 있다.
  Line·bar·area·horizon 모두 수치형 X/Y이면 **X bins (maximum) + Aggregation**을 표시한다.
  같은 X bin과 범주형 Color별로 Y를 집계한다. 가로 bar는 Y 범주와 Color별 X를 집계한다.
  Line은 native `x: { bin: { maxBins } }` + `y: { aggregate }`를 사용한다.
  범주형·시간형 X는 bin 없이 Y만 집계한다. 범주형 bar도 native encoding 집계를 사용한다.
  수치형 bar와 area·horizon은 실제 ggaction `createBinData`가 정한 경계로
  `createComputedData`에서 bin 중심을 계산하고 `createSummaryData`에서 Y를 집계한다.
  경계값(최댓값 포함)과 Color 그룹은 line과 동일하며, 준비 호출과 인자를 코드 뷰에도 표시한다.
  원본 X 열은 보존하고 파생 bin 열을 별도로 만든다. 시간형·범주형 area/horizon은 X별로 집계한다.
  추천된 차트 생성 자체는 여전히 public plot 함수 호출 하나이고, 원본 데이터는 보존한다.
  Regression은 원본 점을 유지하고 모델 및 Color 그룹별 / 전체 회귀를 고른다.
  Add regression의 Group 기본값은 현재 차트의 범주형 Color → Shape → 단일 facet 변수
  순서로 정한다. 연속형 Color나 관계없는 범주 열을 임의로 그룹으로 쓰지 않는다.
  Facet 패널별 유효 관측치와 서로 다른 X 값 수를 확인하며, 두 점으로만 적합 가능한 그룹은
  신뢰구간 없이 회귀선을 제공한다. 명시적으로 선택한 All observations와 기존 회귀 그룹은 보존한다.
  Box·violin 같은 분포 차트에는 원본 관측치를 사용하며 whisker·bandwidth 등 해당 차트의 구성만 노출한다.
- 기본 데이터 영역은 **314×314** 정사각형이다. native `createCanvas({ plot: ... })` 모드로 제목·범례의 여백만 자동 확보하므로 위치나 글자 크기를 바꾸어도 축 길이는 유지한다. 초기 바깥 크기는 700×430이며, 공간이 부족한 쪽만 커진다.
  Preview에서는 실제 마크·가이드 범위에 맞춰 SVG를 확대한다. Current에서는 캔버스 전체와 조절 손잡이를 표시한다.
- Current의 **Canvas 경계**를 드래그하면 차트의 축 길이는 유지하면서 바깥 여백을 조절한다.
  **Plot 아래쪽(X축)**을 내리면 Y축이 길어지고, 오른쪽 경계 또는 왼쪽 Y축을 당기면 X축이 길어진다.
  모서리 손잡이는 두 방향을 함께 조절한다. 실제 ggaction `editCanvas`를 실행해 드래그 중 차트와 코드를 갱신한다.
  마우스를 놓으면 히스토리 한 단계로 확정하고, Esc는 취소한다. 손잡이에 키보드 포커스를 주면 방향키로 1px, Shift+방향키로 10px 조절한다.
  축 레이블이 충돌하는 크기로 줄이면 마지막으로 유효한 크기와 요청한 크기 사이에서 가능한 크기를 찾는다.
  facet의 Plot 조절은 `editFacetSource({ action: { method: "editCanvas", options } })`로 모든 패널에 적용하고,
  facet 전체 Canvas 조절은 `editCompositionLayout({ padding })`으로 바깥 여백만 바꾼다.
  드래그 중 화면 배율은 고정하며, 한 번에 실행 중인 계산 하나와 최신 대기 요청 하나만 유지한다. Undo/Redo와 저장 프로젝트에도 그대로 반영된다.
- 플롯을 선택하면 마지막에 기본 설정인 `createGuides(...)`를 한 번 기록한다. 새 액션은 항상 그 앞에 추가하고, 변경된 인코딩에 맞춰 가이드와 범례를 다시 만든다. 프리뷰와 확정 결과는 같은 시퀀스를 실행하며, 추천 자체는 함수 호출 하나씩 유지한다.
- 초기 갤러리는 **한 줄에 5개씩 가로로 넘긴다**. 화살표·가로 스크롤·키보드 좌우 키를 지원하며 세로로 쌓지 않는다. 후속 추천은 선택한 그룹의 최대 5개를 한 줄에 모은다. 1·2번 카드는 기본 폭을 1.5배로 두며,
  호버한 카드는 옆으로 확장된다. 작은 Apply 버튼은 카드 오른쪽 위에 표시한다.
- 초기 차트 및 후속 **액션 카드 호버로 파라미터 선택지를 펼친다.** 선택지를 호버하면 차트와 코드의 변경분을 즉시 미리 본다.
  파라미터를 클릭하면 값을 고정하고, 카드 본체 클릭은 프리뷰만 선택한다. Apply를 클릭하면 현재 차트에 적용한다.
  확정 즉시 기존 카드를 모두 제거하고, 차트 이동이 끝나면 새 추천 카드들을 표시한다.
- Option cards 오른쪽의 **Undo / Redo**는 Apply한 변경을 한 단계씩 복원한다.
  차트·가이드·코드·추천을 함께 복원하고, 첫 차트 선택을 취소하면 선택한 변수를 유지한 데이터 표로 돌아간다.
  호버 프리뷰는 이력에 넣지 않으며, Undo 후 새 액션을 Apply하거나 데이터셋/변수를 바꾸면 Redo 이력을 지운다.
- Option cards 아래의 **History**는 Apply한 순서대로 차트 섬네일을 가로로 표시한다.
  섬네일 호버(또는 키보드 포커스)는 과거 차트와 코드를 Preview에 표시하고, 벗어나면 Preview를 비운다.
  클릭하면 해당 시점의 차트·가이드·코드·추천을 복원한다. 이후 기록은 새 액션을 Apply할 때까지 클릭 또는 Redo로 다시 방문할 수 있다.
  클릭한 위치의 세로선은 History 밖으로 이동해도 유지하며, 새로운 옵션 카드를 선택하면 해제한다.
  현재 시점은 테두리로 강조하고 Encoding / Transform / Style 색상을 사용한다. 섬네일 SVG는 한 번만 생성해 재사용한다.
  Current / Preview 높이는 기존의 80%로 줄였고, 축소한 옵션 카드 아래에 History 공간을 확보했다.
- 차트 선택 후 추천은 **Encoding / Transform / Style** 버튼을 클릭해서 전환한다.
  각 그룹에서 미사용 액션을 먼저, 이미 적용한 액션을 뒤에 두고 각각 기존 논문 점수로 정렬한 뒤,
  함수 포함관계에 따라 아직 Apply하지 않은 상위 함수로 올려 최대 5개씩 표시한다(전체 top 5를 자른 뒤 분류하지 않는다).
  축·범례·제목·레이블은 Style, 범주 정렬은 Transform에 포함한다. 탭 변경은 차트를 확정하거나 이력에 기록하지 않는다.
  원본과 동일하게 Encoding `#0a6fc2`, Transform `#d6861a`, Style `#1f9d55`를 버튼·카드 강조에 사용한다.
  초기 차트 종류 갤러리는 기존 구성을 유지하며, 그룹별 추천도 실제 ggaction 함수 호출 하나씩 실행한다.
  그룹 버튼 옆의 검색창은 현재 그룹 전체 페이지의 액션을 키워드로 필터한다. 함수명·카드 이름·관련 표현(예: transparency/opacity, thickness/stroke width)과 가벼운 오타를 지원한다.
  검색은 상위 함수로 올리기 전의 전체 후보를 필터하므로 세부 함수에 바로 접근할 수 있다. 원래 공동출현 점수와 순서는 유지한다.
- 위치 추천은 좌표계와 원본 데이터 소유자를 함께 확인한다. Rose/Radial bar의 **Encode radius (R)**는
  변수·sum/count·area/radius-length를 하나의 `encodeR` 호출로 편집한다. Text/Rug의 X/Y,
  Polar의 Theta/R, Area/Rect의 범위 끝, 평행좌표의 차원도 같은 후보 생성 경로에서 처리한다.
  분포·ECDF·회귀·구간 차트는 원본 변수를 담당하는 공개 편집 함수로 연결해 종속 마크를 함께 갱신한다.
  이미 사용한 채널도 뒤쪽 페이지와 검색에서 계속 찾을 수 있다.
  [누락 원인, 적용 범위, 검증 방법](docs/recommendation-coverage.md)을 참고한다.
  이미 사용한 액션도 검색할 수 있고, 검색어를 지우거나 Escape를 누르면 계층 추천 카드를 복원한다. 그룹을 바꿔도 검색어를 유지한다.
  검색어만 바뀌면 해당 차트/그룹의 순위를 재사용하고, 검색 결과의 현재 페이지만 실제 ggaction 호출로 검증한다.
  숫자는 슬라이더 위의 포인터 위치로 조정하고, 클릭하면 고정하며 다시 클릭하면 고정을 해제한다.
  손잡이는 연속적으로 움직이지만 표시 숫자·코드·차트에는 파라미터의 단계 간격을 적용한다.
  같은 값 구간 안에서 움직일 때는 차트를 다시 계산하지 않는다.
  모드·필드 호버는 차트와 코드만 미리 바꾸며, 선택 영역의 표시/숨김은 클릭한 값으로 유지한다.
  카드 사이의 틈에서는 펼침을 유지하고, 다른 카드로 이동하거나 갤러리를 벗어나면 전환한다.
  실제 포인터 이동과 키보드 포커스를 구분해 프리뷰를 한 프레임에 한 번 갱신한다.
  카드·선택지·슬라이더는 문서 전체의 화면 좌표(`screenX/Y`)를 공유한다.
  레이아웃/배율 변화로 생기는 enter/leave나 같은 화면 위치의 client 좌표 변화는 새 선택으로 처리하지 않는다.
- 차트를 선택한 뒤부터 엔진이 계산한 상위 5개 함수를 순서대로 표시한다.
- Current visualization, Preview, Option cards, ggaction Code를 제공한다. 코드에서 새 호출은 초록색으로 표시한다.
  캔버스·테마·데이터·초기 축 같은 준비 호출은 접힌 `Setup` 그룹으로 표시한다. 그룹을 열면 실제 함수들을 볼 수 있고 각 함수 인자도 개별적으로 펼친다.
  프리뷰 중인 새 함수는 인자를 전부 펼치고, 확정 후 0.7초 동안 유지한 뒤 `함수명(...)`으로 접는다. 적용된 함수는 클릭해서 다시 펼칠 수 있다.
  호버를 끝내면 현재 코드를 복원한다. 후속 추천을 적용할 때마다 최상위 함수 호출이 정확히 하나 증가한다.
- 후속 액션 카드에는 최대 3개의 파라미터 그룹을 표시한다. 집계 막대의 수치 색상처럼 집계 방식을 따로 골라야 할 때만 4개다.
  연속형 매핑의 최소·최대 슬라이더는 하나의 범위 그룹이다. 흰색 UI와 차트는 Arial, 코드 뷰는 고정폭 폰트를 사용한다.
- Encode color, size, opacity, stroke color는 **Fixed / Variable** 모드를 제공한다.
  Fixed는 색상 견본/사용자 지정 색상 또는 상수 슬라이더, Variable은 필드와 팔레트/범위를 고른다.
  각각 실제 `encodeColor({ value })`, `encodeSize({ value })`, `encodeOpacity({ value })`, `encodeStroke({ value })`를 호출한다.
  크기의 값과 범위 단위는 px²다. 모드 전환은 기존 매핑·상수·해당 범례를 네이티브 라이브러리에서 정리한다.
- 초기 표에서 선택한 X·Y·Color도 후속 인코딩 카드의 뒤쪽 페이지에서 다시 찾고 변경할 수 있다.
  Color를 고르지 않았다면 Encode color는 미사용 액션으로 앞쪽 순위에 참여한다.
  같은 `encodeX`·`encodeY`를 사용하는 X bin·Y 집계와 축·색상 스케일 편집은 계속 제공한다.
- 점 크기는 `encodeSize` 카드 하나로 통합한다. `encodePointRadius`는 별도로 추천하지 않으며,
  Fixed 면적과 Variable 매핑을 같은 카드에서 고른다.
- UI는 `includeRevisions: true, deprioritizeAppliedActions: true, hierarchy: true`로 이미 적용한 액션을 제거하지 않고 미사용 액션 뒤에 배치한다.
  변수 매핑과 Fixed 값, Transform/Style 액션도 대상이며, 마크 기본 외형은 적용 이력으로 세지 않는다.
  현재 차트의 적용 이력에서 판단하므로 Undo/Redo와 히스토리 이동에도 맞게 반영된다. 뒤쪽 카드는 기존 페이지 이동으로 찾는다.
  추가 추천은 기존 논문 점수, 수정 추천은 교체할 요소를 뺀 같은 평균 공식을 사용하며,
  Fixed와 Variable을 별도 순위나 임의의 가산점으로 나누지 않는다. 엔진의 기본값은 여전히 additions-only다.
- 색상·테두리 색상 팔레트는 데이터 유형에 맞는 대표 5개를 바로 보여주고, 나머지는 `More` 메뉴로 제공한다. 메뉴의 항목도 호버하면 프리뷰, 클릭하면 파라미터 고정, Apply하면 차트에 반영된다. 범주형 15개·연속형 53개 ggaction 팔레트를 지원한다.
- Style 카드는 최대 4개 파라미터를 제공한다. Adjust axes와 개별 X/Y 축에서 레이블 크기·간격·축 굵기를 조절하고, 연속 축은 눈금 수, 범주 축은 위치를 선택한다. 세부 축·범례·마크·제목 카드는 색상·회전·두께·간격 등 해당 함수가 지원하는 옵션을 제공한다. 추가 마크 스타일은 변경했을 때만 적용하여 기존 변수 매핑을 유지한다.
  Edit label placement는 corpus 객체 프리셋 대신 Position·Gap·Overflow·Leader line을 제공한다.
  현재 레이블 설정과 연결선 스타일을 보존하며, source mark에 허용되는 위치만 선택할 수 있다.
- `editArcMark`의 반지름·조각 간격은 Encoding의 **Adjust arc geometry**, 투명도·윤곽선은 Style의 **Adjust arc appearance**로 나눈다. 코퍼스의 혼합 호출은 목적별 인자만 사용하고 각 카드는 동일한 공개 함수 한 번을 호출한다. 픽셀/비율 반지름과 도 단위 간격을 개별 슬라이더로 표시하며, 간격 범위는 가장 작은 조각과 facet 패널에 맞춘다. 로즈·방사형 막대의 측정 반지름은 기존 radial scale 카드에서 조절한다.
- Adjust grid의 Cartesian 방향은 **Vertical / Horizontal / Both**다. Both는 한 `editGrid` 호출에서 양쪽 스타일을 수정한다.
  자동 가이드가 한 방향을 생략했다면 실제 `createGrid` 준비 호출을 코드에 표시한 뒤 편집한다.
- Jitter points는 **X / Y / Both**와 Spread를 제공한다. Both는 한 `jitterPoints({ channel: 'both', maxOffset: { pixels: … } })` 호출로 양 축을 독립적으로 흔든다. 다시 적용할 때 이전 offset은 누적하지 않는다.
- 복합 차트의 변수·구성 편집은 소유 차트의 공개 함수를 사용한다. Raincloud는 구름·박스·점을 함께 갱신하고,
  Radar의 차원 목록·순서는 `editRadarPlot({ target, wide: { fields } })`로 바꾼다.
  Density·Violin의 밀도 설정, Horizon의 밴드·기준선·범위, Endpoint의 집계·기준선,
  Parallel의 차원별 scale, ECDF의 그룹·가중치도 생성 후 편집할 수 있다.
  회귀 모델에 따라 degree/span/robust fit/interval이 바뀌며, 선택한 그룹의 유효 표본 수에 맞춰 범위를 제한한다.
- 분포 차트의 통계는 밀도 격자나 요약 결과 행 대신 원자료 관측치에서 계산한다.
  변수·필터·방향을 바꿔도 연결된 통계선을 갱신하며, 통계·주석은 검색에서 다시 찾아 여러 번 추가할 수 있다.
  Horizon의 접힌 Y 좌표에는 원자료 통계선을 제공하지 않는다. 유효한 수치 X 축의 통계는 사용할 수 있다.

UI에서 고른 변수의 역할을 다른 열로 바꾸거나 선택한 Color를 무시하지 않는다.
X·Y가 수치형이고 Color가 수치형 또는 시간형이면 Scatter / Regression / Text 외에 Line / Area / Bar / Heatmap도 제안한다.
Line·Area·Bar는 Color를 기본 최대 3구간으로 나누어 순서 있는 색상 그룹으로 표현한다.
X bins·Y Aggregation·Color bins의 세 파라미터로 조절하며, 연속형 Color의 값마다 별도 시리즈를 만들지 않는다.
Heatmap은 X·Y 구간별로 선택한 Color를 기본 mean으로 집계한다(Bins per axis·Color aggregation).
시간형 Color도 같은 연속형 처리 경로를 사용한다. 실제 ggaction `createComputedData`의 `parseTime`으로
파생 timestamp 열을 만들고, Line·Area·Bar는 `createBinData`의 구간으로 묶는다. UTC 날짜 구간을
범례에 표시하며 원래 날짜 열은 보존한다. Heatmap은 셀별 timestamp를 mean / median / min / max로
집계하고 `temporalUnit: "timestamp"`로 인코딩한다. 날짜의 sum은 제공하지 않는다.
범주형 X/Y의 Heatmap도 셀별 Color를 먼저 집계하여 같은 위치의 rect가 겹치지 않게 한다.
일부 Color 그룹에 X 값이 하나뿐이어도 다른 유효한 Line·Area 시리즈는 유지하며,
그룹별 회귀가 불가능하면 Regression의 전체 관측치 모델을 기본으로 제공한다.
구간화와 집계는 실제 `createBinData` / `createComputedData` / `createSummaryData` 준비 호출로 기록·재실행한다.
숫자 구간의 마지막 상한을 포함하고, 원본 선택 열과 행을 보존하며, 파생 열 이름 충돌도 피한다.
Color가 없는 두 수치 열의 heatmap은 기존처럼 셀 빈도를 사용한다. 별도의 범주형 Color는 셀 빈도와 동시에 표현하지 못하므로 제외한다.
단변량·Polar·다변량 차트는 해당 차트의 변수 역할과 자료 조건에 따라 제안한다.
Box·Gradient와 Radar도 초기 Color 선택을 유지하면서 생성할 수 있다.
기존 프로그래밍 API에서 `selection` 없이 호출하는 경우에는 전체 데이터의 plot 후보 및 코퍼스 기반 변수 기본값을 유지한다.
차트 선택 이후의 액션 순위와 공동출현 점수는 아래 논문 공식을 그대로 사용한다. 후속 액션의 기본 인자는 기존 데이터 규칙을 사용한다.
결측값이 있는 열도 변수 선택지에 포함한다. 원본 행과 null은 보존하고, 선택한 열의 결측 행은
코드 뷰에도 기록되는 실제 ggaction `filterData` 준비 호출로 별도 파생 데이터에서 제외한다.
예를 들어 Horsepower–Miles_per_Gallon 산점도는 원본 406행 중 유효한 392행을 그리며,
변수 적합성은 실제 ggaction 실행으로 검증한다.

넓은 화면의 호버를 확인하려면 `/test/fixtures/hover-viewport.html`을 연다.
실제 앱을 1440×900, 1920×1080, 2560×1440 iframe에 표시하고 포인터 이벤트와 선택 전환을 기록한다.
iframe을 축소 표시해도 내부 미디어 쿼리는 선택한 폭을 사용한다. 물리적 모니터의 배율이나 주사율을 에뮬레이션하는 것은 아니다.

## 실행

Node.js 20 이상과 Git이 필요하다.

```sh
npm ci
npm run corpus:update
npm test
npm run demo
```

이미 이 작업 공간에는 전체 코퍼스와 학습 결과가 준비되어 있다. 바로 `npm run demo`를 실행해도 된다.
원본 입력은 `.cache/chart-datasets/`에 보존한다. 학습 결과는 `data/`, 실행 예제 결과는 `output/`에 생성한다.

## 무엇으로 학습했는가

[ggaction/chart-datasets](https://github.com/ggaction/chart-datasets/tree/main/charts)의 **모든 차트**를 사용한다.
현재 스냅샷은 차트 **1,213개**, 번역 프로그램 **8,788개**, 전체 데이터 파일 **1,213개**다.
저장소 커밋, 실제 ggaction 버전, 각 차트의 사용 여부는 `data/corpus-report.json`에 기록된다.

- 모든 G1–G8 프로그램을 파싱하고, 모든 `data.json`을 끝까지 읽는다.
- 번역 코드와 데이터의 SHA-256을 각 차트의 `metadata.json`과 대조한다.
- 모든 번역 단계에서 추출한 디자인 요소를 **차트 ID별로 합집합**한다.
- 같은 요소가 여러 단계/레이어에서 반복되어도 차트 한 개에서는 한 번만 센다.
- 통계의 분모는 전체 차트 수다. 번역 프로그램 8,788개를 서로 다른 차트로 세지 않는다.
- 파싱·해시·단계 목록 오류가 생기면 학습을 실패시키고 이전 `model.json`을 보존한다.
- Git으로 전체 디렉터리를 찾는다. GitHub Contents API의 1,000개 목록 제한을 사용하지 않는다.

코퍼스 코드를 실행해서 학습하는 것은 아니다. Acorn으로 소스를 정적으로 읽고 공개 함수와 인자의 디자인 의미를 추출한다.
이 과정은 모든 원본 차트의 렌더링을 재현하거나 픽셀 동등성을 확인하는 과정과 구분된다.
여러 수준의 번역본을 합치므로 고수준 호출이 숨긴 디자인 세부 요소도 통계에 포함된다.

원본 데이터와 번역본의 출처·이용 조건은 코퍼스의 `LICENSE`, `DATA_SOURCES.md`, 차트별 `metadata.json`에 보존된다.
이 프로젝트는 원본 데이터에 새로운 라이선스를 부여하지 않는다.

## 첫 차트는 어떻게 추천하는가

`데이터 통계 추출 → 비슷한 데이터셋 검색 → 그 이웃에서 사용한 차트 비율 집계` 순서다.
별도의 신경망이나 수동 차트 적합도 점수를 추가하지 않는다.

- 전체 1,213개 차트를 읽고, 동일한 데이터는 **843개 데이터셋**, 알려진 공통 원본 URL까지 연결하면 **842개 원본 계열**로 묶었다.
- 행·열 수, 타입 구성, 결측률, 고유값 수, 분포, 변수 관계, 시간 특성의 **31개 통계**를 계산한다.
- 통계가 비슷한 원본 계열을 최대 40개 찾는다. 같은 계열의 변형은 가장 가까운 데이터셋 하나만 이웃으로 쓴다.
- 각 데이터셋 안에서 차트 종류의 비율을 구한다. G1–G8은 차트 한 개이며, Scatter+Line 같은 복합 차트는 한 표를 나누어 갖는다.
- 거리가 가까운 이웃일수록 큰 가중치를 주어 그 비율을 평균한다. 같은 통계 벡터의 이웃이 있으면 그 일치 이웃만 사용한다.
- 데이터가 실제로 그릴 수 있는 plot을 먼저 표시한다. 증거가 없는 plot도 점수 0으로 뒤에서 찾아볼 수 있다.

선택 제약이 없는 API에서 Cars의 첫 다섯 개는 Scatter → Heatmap → Interval → Bar → Line이다.
웹 UI는 `recommend(rows, profile, { selection: { x, y, color } })`를 사용하므로 선택한 열에 따라 순위와 후보가 달라진다.
Monthly sales에서는 Bar → Line → Scatter → Area → Regression으로 달라진다.
Cars도 코퍼스에 포함되어 있으므로 Cars 결과는 새로운 데이터에 대한 성능 검증으로 해석하지 않는다.

원본 계열을 통째로 분리한 검증에서는 182개 데이터셋을 테스트에 남겼다. 이웃 수와 거리 가중치는 나머지 데이터의 교차검증에서 선택했다.
관측된 차트 종류의 비중을 맞힌 정도로 평가했으며, 첫 추천은 **67.0%**(고정 순서 23.0%, 전체 빈도순 31.1%),
상위 다섯 개는 **95.9%**(고정 순서 90.9%, 전체 빈도순 94.8%)다.
이는 현재 코퍼스에서의 관측 종류 예측 성능이며, 사용자가 가장 원하는 차트나 시각화 품질을 입증하는 값은 아니다.

알고리즘·거리 수식·중복 제거·평가 범위는 [docs/initial-recommendations.md](docs/initial-recommendations.md)에 정리했다.
`npm run demo:initial`을 실행하면 함수 인자와 각 이웃의 점수 기여도를 `output/initial-demo.json`에서 확인할 수 있다.

## 차트 선택 이후 점수가 의미하는 것

[논문 §4.1](https://www.hyeonjeon.com/assets/pdf/jeon26vis2.pdf)의 공식을 사용한다.

```text
N = 학습에 사용한 전체 차트 수
c(a, b) = a와 b가 모두 있는 차트 수 / N
q(V, t) = 현재 차트 V의 각 디자인 요소 s에 대한 c(s, t)의 산술평균
```

조건부 확률, 기하평균, 가산점, 수동 순서 보정, 평활화는 사용하지 않는다.
모르는 요소와의 공동출현은 0이다. 동점이면 함수/대상 식별자의 사전순으로 표시한다.

예제 산점도의 현재 요소는 다음 네 개다.

```text
data.tabular, mark.point, encoding.x, encoding.y
```

이 상태에서 `createAxes(...)`의 점수는 다음처럼 설명할 수 있다.

```text
(607/1213 + 397/1213 + 1172/1213 + 1171/1213) / 4 = 0.689819
```

각 숫자는 해당 현재 요소와 축이 함께 나타나는 차트 수다.
이 점수는 흔한 디자인 조합의 정도이며, 성공 확률이나 사용자의 의도를 만족할 확률이 아니다.
공식은 논문을 따르지만 **학습 코퍼스와 요소 분류는 ggaction 번역본을 기준으로 새로 구성**했다.
따라서 기존 논문의 모델 자체를 복제한 것으로 해석하면 안 된다.

## 추천 하나가 어떻게 실행되는가

```js
import { readFile } from 'node:fs/promises';
import { createRecommendationEngine, applyRecommendation } from './src/index.js';
import { makeScenarios } from './examples/scenarios.js';

const model = JSON.parse(await readFile('./data/model.json', 'utf8'));
const engine = createRecommendationEngine(model);
const program = makeScenarios()[3].program; // x/y를 설정한 산점도

const result = engine.recommend(program);
console.log(result.recommendations.map(r => ({
  function: r.method, arguments: r.args, score: r.score,
})));

const recommendation = result.recommendations[0];
const next = applyRecommendation(program, recommendation);
// 실제로 실행한 저작 호출 하나:
// program.createAxes({ coordinate: { id: 'main' } })
```

추천에는 다음 정보가 들어 있다.

| 필드 | 의미 |
|---|---|
| `method`, `args`, `call` | 실제 ggaction 공개 함수명, 인자, 읽을 수 있는 호출 문자열 |
| `score`, `explanation` | 순위 점수와 모든 현재 요소의 공동출현 기여도 |
| `hierarchy` | 계층 추천에서 원래 점수를 제공한 함수·feature·순위와 상위 함수로의 변경 여부 |
| `alternatives` | 같은 함수에서 선택 가능한 필드/인자 조합. 모두 실행 검증됨 |
| `validation` | 정적 검사, 실제 적용, 최상위 액션 한 개 증가, 변화 여부, SVG 직렬화 여부 |
| `nextContext` | 데이터 변환 뒤 다음 추천에서 명시할 데이터/마크 대상 |

`call`은 설명용 문자열이다. 실행에 `eval`을 사용하지 않는다.
같은 함수의 필드 선택지가 많아도 추천 순위를 도배하지 않도록 하나로 묶는다.
각 대안은 동일한 디자인 요소로 점수를 받으며, 기본 인자는 위의 데이터 기반 규칙으로 결정한다.
필드 선택 자체를 학습한 순위 모델은 아직 없다.

### 공출현 추천 뒤의 함수 계층

`hierarchy: true`는 **먼저 공동출현으로 정렬한 후** 각 후보를 같은 그룹의 가능한 상위 함수로 올린다.
예를 들어 `editYAxisTitle`이 가장 높은 점수를 받았어도 아직 `editAxes`를 Apply하지 않았다면
`editAxes`가 **원래 `editYAxisTitle`의 점수와 순위**로 나온다. 상위 함수 자체 점수로 다시 정렬하거나
여러 하위 함수 점수를 더하지 않는다. 같은 상위 카드로 모이는 후보는 최초(최상위) 자리 하나로 합친다.

`editAxes` Apply 후에는 `editYAxis`, 그다음에는 `editYAxisTitle`로 내려간다. 호버·카드 표시만으로는
진행하지 않으며, 자동 `createGuides`와 함수 내부의 호출도 Apply로 세지 않는다. 진행 상태는 현재
저작 프로그램의 최상위 이력에서 계산하므로 Undo/Redo·History·저장 프로젝트 복원도 같은 규칙을 따른다.
이미 적용한 상위 함수는 뒤쪽에서 다시 수정할 수 있다.
일반 추천은 미사용 액션 다음에 사용한 액션을 이어 붙인 하나의 대기열을 5개씩 나눈다.
중간 페이지는 5개를 채우고 마지막 페이지에만 남은 슬롯을 비워둔다.
미사용 액션은 공동출현 순서를 유지하고, 사용한 액션은 마지막 적용 시점 순서로
배치해 방금 적용하거나 재사용한 액션이 맨 뒤로 간다. 점수 자체는 바꾸지 않으며 검색도 이 순서를 유지한다.
기본 파라미터가 현재 차트와 같아도 사용한 카드를 삭제하지 않는다. 현재 차트 섬네일과 편집기를
유지하고, 같은 설정의 Apply는 히스토리를 중복 생성하지 않는다. `createTitle`·`createRegression`은
생성 후 실제 공개 편집 함수인 `editTitle`·`editRegression`으로 뒤쪽에서 제공한다.
제목 카드는 제목·부제목 텍스트, 두 글자 크기, 위치를 제공한다. 글자 크기는 한 그룹에 묶고
bold/normal 선택은 표시하지 않는다. Edit Title에서 부제목을 비우면 기존 부제목을 제거한다.

관계는 `src/action-hierarchy.js`의 공개 함수 포함관계로 관리한다. 축·범례·그리드, 복합 인코딩,
회귀·통계 참조 계열에 같은 알고리즘을 적용한다. **현재 후보에 실제 인자와 편집기가 있는 상위 함수만**
선택한다. 없는 상위 함수나 실행할 수 없는 상위 함수는 건너뛰고 다음 상위/원래 함수를 사용한다.
독립적인 인코딩·변환은 그대로 남으며, 이름의 접두사나 내부 호출만 보고 임의의 부모를 만들지 않는다.
Encoding 후보의 부모를 Style에서 가져오는 식으로 탭을 바꾸지 않고, 다른 마크의 범례/축도 혼합하지 않는다.

검색은 이 단계를 우회해 세부 함수까지 직접 찾는다. 일반 카드는 상위 함수의 실제 인자·편집기·코드를
사용하고 Apply는 그 공개 함수 한 번을 호출한다. 원래 추천의 근거는 `hierarchy.sourceMethod`,
`sourceFeature`, `sourceRank`, `sourceScore`와 `explanation`에 보존한다. Node API 기본값인
`hierarchy: false`는 기존 전체 후보 실험과 함수 가용성 검사에 사용할 수 있다.

```js
// 다른 필드 대안을 선택해도 함수 호출은 한 번이다.
const next = applyRecommendation(program, recommendation, { alternative: 1 });
const following = engine.recommend(next, recommendation.alternatives[1].nextContext);
```

미리보기 검증과 실제 적용은 같은 함수와 인자를 사용한다.
원래 프로그램은 바뀌지 않는다. 추천을 만든 뒤 차트가 달라졌으면 추천을 다시 받아야 한다.
`createRegression` 내부의 중첩 액션은 ggaction이 실행한다. 추천기가 별도 준비·수정 액션을 덧붙이지 않는다.

마크만 있거나 좌표가 일부만 있는 상태는 아직 렌더링할 수 없는 **저작 중인 상태**다.
이때 추천은 유지하고 `validation.renderStatus = "pending-position-encoding"`을 반환한다.
완성된 좌표 상태에서는 ggaction SVG 직렬화도 검증한다. 픽셀 가시성 검사를 했다는 뜻은 아니다.

## 사용 가능한 함수

앱은 `file:vendor/ggaction` 의존성을 사용하므로 Node와 브라우저가 같은 소스를 실행한다.

### 성능과 실행 경로

추천 후보 전체와 논문의 순위 공식은 유지한다. 모든 추천은 실제 ggaction 호출·비교·검사·SVG 검증을 통과해야 한다.
브라우저에서는 `engine.rank(view, { group, ...options })`로 선택한 그룹의 후보만 실행 없이 정렬한다.
이 결과와 파라미터 대안의 `validation.status`는 `pending`이며, `applyRecommendation` 토큰으로 사용할 수 없다.
Worker는 공출현 순위에서 상위 함수로 올린 카드 기본값만 검증해 유효한 5개를 채운 뒤 반환한다.
실패한 기본값은 다른 대안을 시도하고, 상위 함수의 어떤 기본값도 유효하지 않으면 다음 상위 함수나
원래 하위 후보를 검증한다. 중복 상위 카드와 숨겨진 하위 후보는 실행하지 않는다.
실행한 기본값과 미검증 파라미터 대안을 구분한다.
다음 페이지와 다른 그룹은 사용자가 열 때 준비하며, 파라미터 변경은 호버/선택 시 동일한 native 경로로 검증한다.
페이지 요청은 차트 상태·context·그룹·페이지별로 캐시한다. 그룹별 순위와 사전 예약 페이지 수는 실제 검증 결과에 따라 유지/축소한다.
Node의 `engine.recommend` 기본값은 기존처럼 모든 대안을 검증하므로 전체 검증과 비교 실험에 사용할 수 있다.
공통 `src/prepare.js`가 편집 prefix와 최종 `createGuides`를 구분하고, 같은 상태/인자의 검증·프리뷰를 재사용한다.
ggaction은 불변 리소스의 정확한 구조 비교와 변경되지 않은 그래픽 항목을 재사용하고, 불변 입력의 반복 회귀 계산을 캐시한다.

브라우저는 추천용/실시간 프리뷰용 module Worker를 따로 사용한다. 연속 파라미터 입력은 실행 중 하나와 최신 대기 하나만 유지한다.
Apply는 호버 중인 값이 아닌 고정된 값을 검증·확정하며, 이동 애니메이션 중 다음 추천을 계산한다.
추천은 기존 순위대로 한 후보씩 검증해 전달한다. 먼저 준비된 카드는 고정된 슬롯에서 바로 사용할 수 있고,
느린 facet/회귀 프리뷰가 나머지 카드·Undo·탭·검색을 막지 않는다. 새 요청은 후보 사이에서 이전 요청을 중단한다.
미완성 페이지는 완성된 캐시로 취급하지 않으며, 다시 열면 기존 검증 결과부터 이어서 채운다.
프리뷰에는 SVG·실제 호출 인자·메타데이터를 반환한다. Apply 후에는 Worker의 확정 상태를 다음 계산에 재사용한다.
동일한 상태·액션·파라미터의 호버 프리뷰가 진행 중이면 Apply도 그 작업을 기다려 사용한다. 실패한 작업은 다시 시도할 수 있다.
Apply는 Worker가 완성한 가이드 포함 상태까지 전달받아 메인 스레드에서 축·범례·facet을 다시 계산하지 않는다.
다른 역할의 Worker도 직전 기준 상태가 있으면 완성된 변경분을 받아 이어가므로, 같은 확정 액션을 다시 실행하지 않는다.
최초 접속 이후의 상태 전달은 현재 native 상태와 기존 액션 트리의 참조·변경분으로 처리하여, 과거 전체 materialization 기록을 매번 복제하지 않는다.
한동안 쓰지 않은 Worker와 퇴출된 Undo 상태도 알려진 상태가 있으면 같은 변경분 전달을 사용하며, 기준 상태가 없을 때만 전체 snapshot을 복원한다.
전체 native trace·하위 facet 상태·프로젝트 저장 형식과 최종 `createGuides` 호출은 유지한다.
복제한 SVG의 리소스 ID는 표시 위치별로 분리한다. 그룹 변경은 카드 DOM과 고정 파라미터를 복원하며 Undo/Redo도 동일한 native 상태를 복원한다.
클라이언트/카드 캐시는 최근 8개 상태, Worker 상태는 12개로 제한한다. 클라이언트 프리뷰는 상태별 64개,
공통 준비 결과는 128개로 제한하며 퇴출된 이력은 다시 계산한다.
Current/Preview의 전체 SVG 템플릿은 최근 8개만 보관한다. 카드·히스토리 섬네일은 같은 native SVG를 벡터 이미지로 표시하여 마크마다 DOM을 누적하지 않는다.
코드 뷰는 떠난 프리뷰의 인자 DOM·타이머를 해제하고, Undo/Redo용 접기 상태만 최대 128개 보관한다.
접힌 함수의 인자 DOM은 펼칠 때 생성하며, 프리뷰와 Apply 후 0.7초 유지·접기 애니메이션은 그대로 동작한다.
히스토리와 자동 저장은 이전의 불변 액션 인자와 검증된 메타데이터를 공유한다. 입력 파일은 그대로 검증하며,
저장 파일 형식·원자적 저장·Undo/Redo를 유지하면서 매 편집마다 전체 과거 인자를 다시 복제하지 않는다.
Facet header 간격은 ggaction이 보고한 실제 최소 간격으로 재검증하고, 추가 guide 충돌에만 기존 탐색을 사용한다.
ggaction은 완료된 액션에서 삭제된 리소스 목록을 WeakMap으로 재사용한다.
따라서 테마를 유지하는 후속 편집이 오래된 facet 내부 trace를 매번 깊이 순회하지 않는다. 히스토리와 테마 적용 순서는 유지한다.
카드 호버는 펼친 뒤의 배치를 한 번 계산하고, Web Animations의 transform으로 이동·확대한다.
매 프레임 flex 너비·높이를 다시 계산하거나 복잡한 SVG 섬네일을 다시 그리지 않는다.
내부 글자·컨트롤·차트는 역변환으로 크기와 비율을 유지하며, 빠른 호버 전환은 현재 보이는 위치에서 이어진다.
프리뷰 차트·코드 갱신은 카드 애니메이션을 시작한 다음 프레임에 처리한다.
`/test/fixtures/card-motion.html`은 중간 프레임의 배치·글자·차트 비율, 호버 중단과 종료를 확인한다.
Playwright Python으로 `test/browser/card-motion.py`를 실행하면 두 화면 크기에서 실제 호버·슬라이더 고정·Apply·키보드·패널 접기를 검증한다.

`npm run dev`는 같은 `vendor/ggaction` 소스로 Worker를 먼저 번들링한다. 소스 수정 후 실행 중인 서버를 유지한다면
`npm run build:workers` 후 페이지를 새로고침한다. `npm run update`도 라이브러리 갱신 뒤 Worker를 다시 만든다.

`npm run benchmark:recommendations`는 Cars의 새 상태 3개씩에서 기존 전체 검증 경로와 현재 그룹의 첫 5개 준비 경로를 비교해
`output/performance-lazy.json`을 만든다. 다음 페이지·그룹 전환·반복 페이지와 native 상태 복원 시간도 별도로 측정한다.
첫 페이지 준비에는 5개 native 기본값의 검증·가이드·SVG가 포함되며 새 Worker 상태 복원은 별도로 측정한다.
라이브러리·데이터·실행 환경이 달라지면 보고서를 다시 생성해 비교한다.
`npm run benchmark:performance`는 기존 저수준 준비/회귀/파라미터 캐시 벤치마크다.
`npm run benchmark:session`은 같은 Cars facet에서 41회 편집하며 전체 snapshot 경로와 변경분 경로를 비교한다.
전달량·복원·추천 시간과 최종 semantic/graphic/trace 동등성을 `output/progressive-latency/session-benchmark.json`에 기록한다.
`/test/fixtures/thumbnail-render.html`, `code-retention.html`, `code-settlement.html`, `history-workflow.html`로 섬네일·프리뷰 DOM 해제·코드 접기·히스토리를 브라우저에서 확인할 수 있다.
`/test/fixtures/recommendation-stream.html`은 조기 카드 전달·요청 취소·중단된 페이지 재개·스트리밍 카드 Apply를 실제 Worker로 검증한다.
`/test/fixtures/apply-availability.html`은 프리뷰 대기·동일값·유효하지 않은 입력에서 Apply 클릭을 받고, 선택한 값만 확정하며 수정 후에도 계속 적용할 수 있는지 검증한다.
이 수치는 브라우저 DOM/paint와 Worker 메시지 왕복을 제외하며 전체 화면 응답 시간을 의미하지 않는다.

이전의 32개 수동 실행 목록은 제거했다. `catalog:check`가 실제 공개 TypeScript 선언에서
실행 목록을 재생성하고 런타임·inspection을 대조한다. 내부 materialization 함수는 포함하지 않는다.
후보는 현재 마크·스케일·축·범례·데이터 계보에 맞춰 구성하며, 코퍼스에서 읽은 실제 스타일
호출도 현재 리소스에 연결해 대안으로 검증한다. 대표적인 추가 함수들은 다음과 같다.

```text
createPointMark, createLineMark, createBarMark, createAreaMark
encodeX, encodeY, encodeColor, encodeSize, encodeShape
createRegression, createAxes, createLegend, createTitle, editPointMark
createComputedData, createSummaryData
editBarMark, editLineMark, editAreaMark, encodeStroke, encodeOpacity
orderCategories, createMarkLabels
editAxes, editLegend, editXAxis, editYAxis, editThetaAxis, editRadialAxis, editParallelAxis, editGrid, editTitle
encodeAngle, encodeBarWidth, encodeStrokeWidth, encodeStrokeDash, encodeGroup, encodePathOrder
filterMarks, editFilteredData, editSummaryData, editComputedData, editBinData, editWindowData, editSortedData
layoutSeries, jitterPoints, packPoints, createStatisticalReference
editXScale, editYScale, editColorScale, editStrokeScale, editSizeScale, editOpacityScale, editParallelScale
editXAxisLabels, editYAxisLabels, editXAxisTicks, editYAxisTicks, editXAxisLine, editYAxisLine
editXAxisTitle, editYAxisTitle, editXAxisTicksAndLabels, editYAxisTicksAndLabels
editLegendLabels, editLegendTitle, editLegendLayout, editLegendSymbols, editLegendBorder, editLegendBlock
editRectMark, editArcMark, editRuleMark, editTickMark, editTextMark, editBoxPlot, editErrorBar, editErrorBand
editCanvas, editCoordinate, createAnnotation
```

`npm run catalog:check`는 설치된 런타임, 공개 TypeScript 선언, `describeAction`을 대조한다.
초기 갤러리의 plot 함수도 포함한다. 공개 실행 목록의 크기는 라이브러리 갱신에 따라 바뀌며, 모든 차트에
동시에 적용 가능한 추천 개수와 다르다. 리소스 생성은 초기 설정에, 기존 가이드 생성은
수정 함수에, 데이터 생성은 실제 사용 중인 파생 데이터의 수정 함수에 연결한다.
결과는 `data/action-catalog.json`에 기록한다. 실제 추천도 `describeAction`과 실행 검증을 통과해야 한다.
각 코퍼스 함수의 역할과 대응 함수도 이 보고서에 남긴다. `data/action-evidence.json`에는
전체 코퍼스에서 추출한 함수별 빈도·공개 파라미터·정적 호출 예제가 들어 있다.
새 차트가 추가되면 `corpus:update`가 이것과 모델을 함께 갱신한다. 함수명 접두사만으로
파싱하던 제한도 없애 `layoutSeries`, `removeEncoding`, `bindMarkData`, `applyTextMetrics`
같은 공개 함수가 통계에서 빠지지 않게 했다. 측정 프로필처럼 현재 차트에 그대로 재사용할 수 없는
설정도 누락시키지 않고 역할을 구분해 보고한다.

Encoding / Transform / Style은 수정 추천까지 포함한 전체 원래 순위를 각각 유지한다. 일반 화면은
계층에서 합친 카드를 그룹별로 5개씩 가로 페이지에 제공하며 6위 이후를 버리지 않는다.
세부 함수는 상위 함수 Apply 또는 검색으로 접근한다. 점수 보정이나 빈 카드 채우기는 없다.
분류는 `src/recommendation-groups.js`에서 공통으로 결정하며, 후보 생성·그룹 필터·검색·facet source 편집에 같은 기준을 적용한다.

- **Encoding**: 변수와 시각 속성의 대응. 모든 스케일 편집(X/Y/Color뿐 아니라 size, opacity, stroke, polar, parallel 포함), 범주·경로의 시각적 순서, 데이터 값 라벨, facet 및 공유 스케일.
- **Transform**: 집계·bin·필터·회귀·통계 계산과 stack/normalize, jitter/packing 같은 표시 위치 계산. 데이터 자체의 정렬도 여기에 속한다.
- **Style**: 축·범례·제목·마크의 외형, 고정 설명문, facet 간격과 패널 배치.

같은 함수도 카드의 목적을 구분한다. `encodeY`의 변수 변경은 Encoding, 집계 변경은 Transform이다.
`editBoxPlot`의 변수 변경·수염 통계 계산·선과 박스 꾸미기도 각각 분리한다.
분류를 바꿔도 학습된 공출현 feature와 점수는 바꾸지 않는다.

`output/recommendation-coverage.json`은 실제 선택 흐름으로 만든 차트마다 그룹별 후보 수,
프리뷰/Apply용 네이티브 호출 검증 결과, 탈락 원인을 기록한다.
`data.tabular`, `encoding.color` 같은 문자열은 학습용 분류 이름이며 실행하는 액션 이름이 아니다.

원본에 숫자 문자열이 있으면 `createComputedData`의 `toNumber` 표현식을 이용하는 호출을 제안한다.
숫자로 보이는 앞자리 0 식별자, 혼합 타입, 결측값을 몰래 바꾸지 않는다.
순수 범주형 데이터에는 `createSummaryData`의 `count` 집계를 제안할 수 있다.

## 추가 옵션과 현재 범위

```js
engine.recommend(program, {
  target: 'points',               // 마크가 여러 개면 필수
  // data: 'dataset-id',          // 마크 없이 데이터가 여러 개면 필수
  fields: ['Horsepower', 'Miles_per_Gallon', 'Origin'],
  fieldTypes: { Origin: 'nominal' },
  category: 'encoding',           // mark | encoding | transform | guide | style
  excludeMappedChannels: ['x', 'y', 'color'], // omit already established variable choices
  limit: 5,
});
```

기본 추천은 논문의 조건 `t ∉ T_V`를 따른다. 이미 있는 디자인 요소는 신규 추천에서 제외한다.
기존 인코딩의 필드를 바꾸는 실험은 `includeRevisions: true`로 명시적으로 켤 수 있다.
이 확장에서는 교체할 요소를 현재 요소 집합에서 뺀 뒤 같은 산술평균 공식을 적용하고 `kind: "revision"`으로 표시한다.
웹 데모는 size/opacity/stroke 등의 모드·값을 다시 편집할 때 이 확장을 사용한다.
`excludeMappedChannels`로 지정한 채널은 실제 변수 매핑이 있을 때만 인코딩 후보에서 제외한다(기본값 `[]`).
웹 데모는 이 제외 옵션을 사용하지 않는다. 대신 `deprioritizeAppliedActions: true`로 이미 사용한 액션을 뒤에 남긴다.
이 옵션은 점수를 바꾸지 않으며, 미사용/사용 두 묶음 각각에서 점수와 기존 동점 정렬을 유지한다. 활성 그룹/페이지만 지연 검증하는 방식도 유지한다.
엔진 기본 동작과 논문 방식 검증은 수정 확장을 끈 상태로 유지한다.

상세 인코딩 추천은 단일 차트 프로그램의 점·선·막대·영역 저작을 중심으로 한다.
초기 갤러리는 분포·극좌표·다차원 plot도 지원하지만 후속 추천의 범위는 차트에 따라 제한된다.
합성 차트는 자식 `ChartProgram`을 직접 넘겨야 한다. 임의의 함수 전체에 대한 추천을 지원한다는 뜻은 아니다.
혼합 타입과 비유한 값처럼 타입을 안전하게 해석할 수 없는 열은 후보에서 제외한다.
결측값만으로 열을 제외하지 않으며, 각 ggaction 액션의 실제 제약에 따라 후보를 검증한다.
색상 변수는 X/Y와 같아도 허용한다. 집계 막대의 다른 수치 색상 변수에는 명시적인 집계를 전달한다.
데이터 및 차트 제약으로 추천이 없을 수도 있다.
코퍼스의 모든 차트를 학습에 쓰는 것과 그 모든 차트 종류를 생성할 수 있는 것은 별개의 범위다.

## 검증과 결과 파일

```sh
npm run catalog:check     # 카탈로그가 ggaction의 기존 공개 함수인지 확인
npm test                 # 수식, 단일 호출, 불변성, 오류, 업데이트 시나리오
npm run demo             # 작은 설명용 상태 6개 + 실제 코퍼스 데이터 예제
npm run demo:initial     # Cars / Monthly sales 초기 순위와 근거
npm run validate:initial # 전체 데이터로 초기 추천 함수 실행 검증
npm run validate:corpus  # 전체 차트 통계 재계산 + 각 데이터로 추천 엔진 실행
```

`node --test test/canvas-resize.test.js`는 캔버스·축 길이의 독립 조절과 facet의 공개 호출을 검증한다.
Apply로 확정하면 Preview의 차트가 560ms 동안 Current로 이동해 새 시각화가 된다.
Preview와 Current의 서로 다른 표시 배율을 연결하고, 코드 패널의 자동 스크롤은 전환을 취소하지 않는다.
`test/browser/chart-transfer.py`는 최초/후속 Apply, 착지 좌표, 내부 스크롤 및 동작 줄이기 설정을 검증한다.
캔버스·축 경계를 드래그하면 반대쪽 경계도 대칭으로 움직인다. Current view는 캔버스 전체를
가로·세로 중앙에 두되, 드래그 중에는 시작 시 표시 배율을 유지한다. 놓은 뒤에만 280ms 동안
공간에 맞춰 같은 비율로 확대·축소한다(동작 줄이기 설정에서는 즉시 적용). 드래그 중 뷰를
넘는 부분은 잘라 표시하며 페이지 크기를 늘리지 않는다. 표시 배율과 무관하게
코드·히스토리·내보내기에는 실제 ggaction 크기가 유지된다.
Canvas 내부에서는 차트·축·범례의 실제 경계 바깥에 남는 여백을 양쪽에 균등하게 배분한다.
Facet은 바깥 padding뿐 아니라 source Canvas의 margin도 조절하므로, 위 여백이 작아도
아래에 남는 공간을 줄일 수 있다. 정렬은 공개 `editCanvas`/`editFacetSource`/
`editCompositionLayout` 호출로 기록하며, 저장된 이전 세션도 같은 방식으로 정렬한다.
명시적으로 배치한 가이드와 충돌하는 재배치는 적용하지 않는다.
`test/browser/canvas-centering.py`는 불균등한 facet 여백 복원·축소·Undo/Redo·새로고침을 검사한다.
크기 드래그 중 보이는 옵션 카드의 섬네일도 resize → 해당 옵션의 공개 ggaction 호출 순서로
갱신한다. Current/code와 별도 worker에서 한 번의 섬네일 순회와 최신 대기 요청만 유지한다.
크기만 확정할 때는 카드 DOM·페이지·검색·고정한 파라미터를 유지하며 추천 순위를 재계산하지 않는다.
연속한 Canvas/Plot resize는 하나의 히스토리 셀을 갱신한다. 코드와 native 실행 기록도
그룹 시작 전 상태에 최종 크기만 적용해 길이가 누적되지 않는다. Facet의 source 여백과
composition padding도 함께 보존한다. 다른 액션 적용, 히스토리 이동, 새로고침은 그룹을 끝낸다.
Undo는 연속 resize 이전 크기로, Redo는 마지막 크기로 돌아간다.
`test/browser/resize-history.py`는 연속 드래그, 코드 길이, 취소, 복원과 새 분기를 검증한다.
드래그 위치는 requestAnimationFrame마다 기존 Canvas의 compositor transform으로 즉시
반영한다. Native 계산을 기다릴 때는 마지막 렌더를 등비 확대·축소해 중앙에 배치하며,
글자·점·범례를 가로·세로로 다르게 늘리지 않는다. 실제 축 길이와 가이드 배치는 도착한 ggaction
결과로 갱신한다. 경계선은 현재 표시된 차트와 일치하며, 포인터를 놓으면 검증된 native 결과로
확정한다. 드래그 세션 동안 Current와 섬네일의 래스터 배율을 고정해 같은 장면을
크기 변화만으로 다시 그리지 않는다. 새 native 결과는 계속 반영하고, 완료·취소 시 표시 크기에
맞는 해상도로 다시 맞춘다.
`test/browser/resize-raster-budget.py`는 고해상도 화면의 두 모드에서 worker가 늦어도
불필요한 재그리기가 0회인지, worker 재개 후 Current와 모든 섬네일이 갱신되는지 검사한다.
`test/browser/resize-aspect.py`는 worker를 지연시켜도 Current와 섬네일의 비율이 유지되는지 검증한다.
실행 중인 앱에서 Playwright Python으로 `test/browser/canvas-resize.py`를 실행하면 드래그 중 코드,
취소·Undo/Redo·새로고침·SVG 내보내기, facet·파이, 키보드와 창 크기 변경,
드래그 중 중앙 정렬과 종료 후 자동 확대·축소를 확인한다.
`test/browser/resize-release-fit.py`는 드래그 중 배율 고정, 종료 후 등비 애니메이션, 동작 줄이기를 검증한다.
Facet의 All plots 경계는 범례를 제외한 모든 셀의 plot 영역을 감싼다. 각 셀의 크기는
행·열 수에 맞춰 나누어 바뀌므로, 셀이 많아져도 전체 경계가 포인터 이동량만큼 움직인다.
빈 조합을 생략한 facetGrid도 실제 행·열 도메인으로 계산한다. `test/browser/facet-resize.py`는
CSV 업로드로 만든 여러 행의 산점도·막대·박스 facet에서 축/경계 정렬, 드래그 이동량,
종료 후 맞춤, 최소 크기, 취소·Undo/Redo를 검증한다.
`test/browser/resize-card-continuity.py`는 resize 이후 지연 로딩 페이지, 검색과 파라미터 유지,
기존 카드 Apply 및 Undo를 검증한다. `test/resize-thumbnails.test.js`는 실제 native 썸네일 결과와
요청 병합·취소 이후 오래된 결과 차단을 검증한다.
`test/browser/resize-performance.py`는 같은 산점도/facet 드래그에서 실제 화면 갱신 프레임,
섬네일 갱신 프레임, 프레임 간격과 worker 지연을 측정한다. 결과 JSON/스크린샷은 `output/`에 저장한다.
`test/browser/resize-alignment.py`는 worker를 지연시킨 상태로 가로·세로 압축과 캔버스 드래그를
검사한다. Current에는 Canvas 표면 하나만 남아야 하고, 실제 축의 화면 좌표와 조절 박스가
일치해야 한다. 박스는 예상 native 배치가 아니라 현재 이미지와 동일한 변환행렬을 따른다.

`/test/fixtures/history-workflow.html`의 **Run history workflow checks**는 실제 Cars 데이터로
Apply 기록, 호버/코드 프리뷰, 클릭 복원, Undo/Redo, 분기, 그룹 색상, 가로 스크롤과 높이를 검증한다.
`/test/fixtures/apply-layout.html`은 넓은 화면과 좁은 화면에서 Apply 전후를 프레임마다 측정한다.
준비 상태와 오류는 오른쪽 위의 고정된 안내 영역에 표시해 작업 영역 위치와 문서 높이를 바꾸지 않는다.
`/test/fixtures/chart-viewport.html`은 실제 ggaction 차트 13개의 확대·축 비율·가이드 잘림·캐시·원본 불변성을 확인한다.

- `data/model.json`: 배포 가능한 공동출현 모델과 출처 정보.
- `data/observations.json`: 모든 차트별 디자인 요소. 통계 집계를 직접 추적할 수 있다.
- `data/corpus-report.json`: 전체 차트/프로그램/데이터 목록과 해시 확인 후 생성한 수집 보고서.
- `data/initial-model.json`: 데이터 통계, 차트 사용 비율, 선택된 이웃 수·거리 가중치, 원본 출처.
- `data/initial-corpus-report.json`: 모든 차트의 중복 제거·분류·미해석 여부와 사용한 plot 목록.
- `data/initial-evaluation.json`: 원본 계열 분리, 개발 교차검증, 독립 테스트와 기준 모델 비교.
- `output/initial-demo.json`: 초기 차트 함수 인자·기본값 출처·이웃별 점수 기여도.
- `output/initial-validation.json`: 전체 데이터 파일의 초기 추천 실행 결과와 호환되지 않는 사례.
- `data/action-catalog.json`: 기존 공개 함수만 사용한다는 카탈로그 검사 결과.
- `output/demo/recommendations.json`: 함수 호출, 대안 인자, 점수 계산의 전체 예제 결과.
- `output/demo/*.svg`: 렌더링 가능한 예제 상태와 후보 결과. 미완성 좌표 상태에는 SVG를 만들지 않는다.
- `output/corpus-validation.json`: 전체 차트 데이터에 대한 엔진 실행 결과.

통계 학습은 전체 데이터를 읽는다. 실행 검증의 규모를 제한하기 위해 전체 코퍼스의 각 표에서
최대 첫 128행과 사용 가능한 열 6개로 작은 차트 상태를 만든다. 원본 8,788개 프로그램을
모두 실행하거나 전체 데이터 행으로 원본 그림을 재현한 테스트는 아니다.
추천이 없는 사례와 제외된 후보도 별도로 기록한다.

## 나중에 차트가 추가되면

라이브러리 소스는 `vendor/ggaction`에 있고, 브랜치는 `codex/edit-axes-autocomplete`다. `editAxes({ x: {...}, y: {...} })`는 기존 축만 수정하며 한 최상위 액션 안에서 각 축 editor를 호출한다. Polar는 `theta`/`radius`, Parallel은 `parallel` 옵션으로 기존 editor 옵션을 전달한다. 누락된 축 생성, binding 변경, 빈 edit는 허용하지 않는다. 공개 타입·inspection·계약·문서·라이브러리 테스트도 함께 추가했다.

기존 scatter/bar 파사드의 `missing: "skip"` 전달 수정도 이 소스로 옮겼다. 설치 후 `node_modules`를 수정하는 패치 단계는 제거했다. 원본 Cars 406행은 그대로 유지한다.

기본 가이드가 있으면 생성 대신 `editAxes`, `editLegend`, `editGrid`를 추천한다. 제목은 별도 요소이므로 없으면 `createTitle`, 있으면 `editTitle`이다. 모든 추천은 실제 공개 함수 호출 한 번이다. 마지막 `createGuides`에서 처음 생긴 범례를 편집하려면, 그 범례의 실제 `createLegend` 준비 호출을 코드에 명시하고 `editLegend`를 실행한다. 마지막에는 여전히 `createGuides` 하나만 둔다. 미리보기와 Apply는 동일한 준비와 편집 호출을 사용한다.

전체 코퍼스의 축 편집(`editXAxis`/`editYAxis`/Polar/Parallel)을 `action.editAxes` 계열로 함께 집계한다. 차트별 중복 제거와 논문의 산술평균 점수 공식은 유지한다. 새 API의 학습 증거를 가짜 빈도나 점수 보정으로 만들지 않는다.

```sh
npm run corpus:update
```

최신 저장소를 가져오고 전체 차트 디렉터리를 다시 발견해 **공동출현 모델과 초기 추천 인덱스를 함께 재계산**한다. 원본 명세도 수집해 Histogram과 Bar 같은 의미 차이를 구분한다. 변경되지 않은 데이터의 통계는 버전별 캐시를 재사용하되, 모든 입력 SHA-256 검사는 매번 수행한다.
새 차트를 위한 ID 목록이나 차트 수를 코드에 수동으로 추가할 필요가 없다.
코퍼스에 로컬 변경이 있으면 덮어쓰지 않고 중단한다.

ggaction 최신 버전까지 함께 반영하고 검증하려면:

```sh
git -C vendor/ggaction switch codex/edit-axes-autocomplete
npm run update
```

새 clone의 서브모듈은 재현성을 위해 고정 커밋으로 시작한다. 위 `switch`는 업데이트 작업을
기존 기능 브랜치에서 수행하도록 한다. 업데이트 후에는 부모 저장소에서도 변경된
`vendor/ggaction` 커밋 포인터와 재학습 결과를 함께 커밋한다.

ggaction upstream 소스를 현재 기능 브랜치에 merge → 라이브러리 테스트 → 공개 함수 카탈로그 확인 → 코퍼스 갱신/재학습
→ 테스트 → 예제 실행 → 전체 코퍼스 데이터 실행 검증을 순서대로 수행한다.
백그라운드 자동 실행을 예약한 것은 아니다. 최신 API가 바뀌면 검사 실패를 확인하고 호환성을 수정해야 한다.

## 코드 읽는 순서

1. `src/initial-recommender.js`, `src/selected-plots.js`: 선택한 열의 초기 차트 순위와 역할 고정. `examples/initial-demo.js`는 선택 제약 없는 API 예제다.
2. `src/dataset-profile.js`, `scripts/initial-corpus.js`: 데이터 통계, 중복 제거, 평가.
3. `examples/demo.js`: 사용자가 보는 입력과 추천 결과.
4. `src/engine.js`: 후보 생성 → 검사 → 점수 계산 → 단일 호출 적용.
5. `src/catalog.js`: 추천하는 공개 함수와 실제 인자 구성.
6. `src/model.js`: 논문의 짧은 점수 공식.
7. `src/semantics.js`: 코드와 현재 상태가 공유하는 디자인 요소 분류.
8. `src/corpus.js`, `scripts/train-corpus.js`: 전체 코퍼스 추출과 집계.

숫자형 X의 막대 차트는 `createBarPlot({ x: { field, bin }, y: { field, aggregate } })`를 직접 사용한다.
각 막대는 실제 bin 구간을 채우며, 비어 있는 bin은 간격으로 남는다. 범주형 Color가 있으면 초기 카드에서
Overlay(기본), Stack, Normalize, Dodge를 고를 수 있고, 이후 Transform의 `layoutSeries({ mode })`로도 바꿀 수 있다.
Area/horizon은 기존처럼 native 요약 데이터를 따로 준비한다.

통계 참조는 Add statistic 카드와 ggaction 공개 함수 `createStatisticalReference` 하나로 제공한다.
평균·중앙값·최소·최대는 `statistic`으로 선택하며 기본 선은 진한 회색(#222222), 2.5px 실선이다.
Middle 50% / Middle 95%는 `statistics`에 각각 25–75 / 2.5–97.5 백분위 쌍을 전달한다.
이는 데이터 중앙 구간이며 평균의 신뢰구간과 다르다. 라이브러리 내부에서 기존 선·구간 액션에 위임하고,
프리뷰·Apply·Worker·코드 뷰는 항상 동일한 공개 함수 호출 하나를 사용한다.

추천 누락 검증은 `npm run audit:actions`로 실행한다. 29개 시작 차트에서 실제 공개 ggaction 호출을 독립적으로 실행해, 지원되는 외형 인코딩과 facet이 추천 후보에 남아 있는지 비교하고 모든 카드의 기본 파라미터를 검증한다. 결과와 탈락 이유는 `output/action-availability-audit.json`에 기록된다. `diagnostics.candidateCoverage`는 후보 생성, 이미 적용된 채널 제외, 그룹 제외, 실제 검증 실패를 구분한다.

Encoding에는 native `facet`/`facetGrid`도 포함된다. Facet 이후의 source 편집은 공개 `editFacetSource({action:{method,options}})` 한 번으로 수행하며, 마지막 `createGuides`가 패널의 가이드를 갱신한다. 외형 채널 지원 범위는 ggaction의 inspection과 실제 action이 공유하는 정책을 따른다.

고정값 후보는 서로 다른 두 값을 제공한다. 현재 기본값과 같은 한 후보가 `no-change`여도 함수 전체를 제외하지 않고 실제로 변화를 만드는 값을 선택한다. Line의 Color/Dash는 native series 추론을 따르며, Area의 경로별 외형은 실제 그룹 grain에서 상수인 필드만 제공한다. 논문의 순위 계산식은 그대로 유지한다. 고정값 인코딩도 현재 시각화의 적용된 primitive로 기록하며, facet source 편집은 원래 함수의 primitive를 사용한다.

초기 차트 누락은 `npm run audit:initial-options`로 별도 검사한다. Cars의 수치·범주·시간 축과
Color를 조합한 32개 선택에서 모든 후보를 native 호출로 검증하며, 반드시 존재해야 하는 차트가
사라진 경우도 실패로 처리한다. 결과는 `output/initial-option-audit.json`에 기록되고 `npm run update`에도 포함된다.
`diagnostics.chartEligibility`와 갤러리의 `data-chart-eligibility`에는 29개 plot의 포함·제외 사유를,
`data-chart-preparation-failures`에는 실제 프리뷰 검증 실패를 기록한다.

초기 차트 카드의 `Scales & palette` 그룹에서 수치 X/Y의 Linear·Log·Sqrt·Symlog와
Color palette를 설정한다. 날짜축은 native Time scale을 유지하고, 범주축에는 수치 scale을
제안하지 않는다. 0 기준선이 필요한 막대/영역 또는 0 이하 값·bin 경계가 있는 축에서는
Log를 비활성화한다. 기존 bin·집계·회귀 파라미터는 그대로 유지한다. Palette는 타입에 맞는
대표 5개와 More 목록을 제공하며 호버 프리뷰와 Apply에 같은 값을 사용한다.
설정은 `createScatterPlot({ x: { scale: … }, … })` 등 해당 공개 생성 함수의 인자로 기록한다.
이미 매핑된 X/Y/Color의 scale 편집 카드는 사용한 카드로 간주하여 미사용 카드 뒤로 보낸다.
공출현 점수를 바꾸거나 카드를 제거하지 않으며, 검색·페이지 이동·히스토리 복원에서도 유지한다.
`python test/browser/initial-scales.py`는 두 모드에서 파라미터 호버·고정·Apply,
scale 카드 검색과 Undo/Redo·새로고침 후 코드 복원을 검사한다.

## 코퍼스 기반 파라미터 기본값

`npm run corpus:train` / `npm run corpus:update`는 전체 차트의 명시적 설정을
`data/parameter-defaults.json`과 두 추천 모델에 함께 집계한다. 같은 차트의 G1–G8 단계나
반복 호출은 중복 투표하지 않는다. 한 차트에서 같은 파라미터의 서로 다른 값이 등장하면
그 차트의 한 표를 값들에 균등 분배한다. 함수별로 가장 많은 표를 받은 **현재 편집기에서
허용되는 값**을 기본값으로 사용한다. 연속 파라미터도 관측된 값의 최빈값을 사용하며,
명시적인 설정이 있는 차트가 3개 미만이면 기존 유효 기본값을 유지한다.

`src/parameter-defaults.js`는 데이터 필드명·리소스 ID·제목·표현식을 옮기지 않고
안전한 설정 경로만 수집한다. `src/control-defaults.js`는 편집기의 순수 인자 생성기를
통해 컨트롤과 native 옵션 경로를 연결한다. 따라서 새 컨트롤도 해당 경로에 증거가 있으면
같은 기본값 정책을 적용한다. Create/Edit의 동일 옵션은 함께 집계하지만 Radius→Size처럼
단위가 다른 별칭은 섞지 않는다. 초기 차트 컨트롤과 후속 액션 모두 이 경로를 사용한다.
데이터 의존 필드 바인딩은 기존 초기 추천기를 따르며, setup에서만 결정되는 파라미터나
수집 가능한 명시적 증거가 없는 컨트롤은 기존 기본값을 유지한다.

Encode stroke color는 프로젝트 선호값인 **Fixed / #000000**을 우선한다.
코퍼스에서 Fixed 모드가 우세하지만 검정 자체가 최빈색은 아니므로 이를 학습 결과로
표시하지 않는다. 다른 기본값의 `defaultDecisions`에는 `source`, `path`, `observedCharts`,
선택값의 `charts`와 `weight`가 기록된다. 실제 차트에서 무효이거나 변화가 없는 기본값은
기존 native 검증과 대안 값으로 대체하며, worker가 검증한 `parameterValues`를 그대로
카드에 전달한다. 사용자가 선택한 값은 변경하지 않으며 액션 순위의 논문 점수도 바꾸지 않는다.

이 빈도는 번역된 차트 코퍼스의 관측 설정이다. 사용자의 실제 클릭 로그나 설정을 생략한
라이브러리 기본값까지 추정한 빈도는 아니다. 새 차트가 추가되면 위 갱신 명령에서 다시 학습한다.


## 데이터 해석, 역할 선택과 작업 복구

`Upload dataset`은 CSV와 JSON을 같은 `src/data-import.js` 경로로 해석한다.
미리보기에서 날짜 형식, 숫자/범주/순서형 타입, 결측 토큰, 중첩 JSON 경로,
열 이름과 포함 여부를 조정할 수 있다. 원본 값과 해석 설정은 함께 보존한다.
테이블의 `Types` 또는 `Project → Data types`로 다시 해석하면 새 데이터셋 버전으로
추가하므로 이전 차트와 히스토리도 데이터셋 메뉴에서 다시 열 수 있다.

X만 선택해 Histogram, Density, ECDF, Rug 등의 분포 차트로 시작할 수 있다.
차트가 추가 역할을 필요로 하면 카드에서 끝값, 범위, 차원, 식별자를 선택한다.
날짜 X의 달력 집계는 UTC를 사용한다. 현재 집계 단위와 맞지 않는 인코딩이나
0 기준선을 요구하는 막대의 Log처럼 성립하지 않는 선택은 이유를 표시한다.
카드를 누르면 미리보고 **Apply만 확정**한다.

테이블은 행과 열을 함께 가상화한다. `Find a dataset field`와 타입 필터로
넓은 원본 데이터의 모든 열을 찾을 수 있다. Cars 외에 Tips, Iris, Seattle weather,
Stocks, Gapminder, Barley, Iowa electricity를 제공하며 원본 출처는
`web/data/sources.json`에 기록되어 있다. 지도는 구현 범위에서 제외한다.

데이터셋마다 차트와 Undo/Redo 히스토리를 보관한다. History의 `0. Variables`에
호버하면 선택한 축을 미리 보고, 클릭하면 X/Y/Color 선택을 유지한 데이터 표로 돌아간다.
이동만 하면 이후 히스토리는 유지되므로 Redo나 섬네일로 기존 차트로 돌아갈 수 있다.
변수를 바꾸거나 다른 차트를 Apply하면 그 지점에서 새로 분기한다.
상단바의 `Reset`은 현재 데이터셋을 유지하면서 차트, X/Y/Color 선택, 검색과
히스토리를 초기화한다. 초기화한 상태도 자동 저장되며 다른 데이터셋의 작업은 유지된다.
이 브라우저의 IndexedDB에 자동 저장하고 새로고침 시 복구한다. 원본 데이터는
한 번 저장하고 일반 액션 적용에서는 히스토리 메타데이터만 갱신한다.
`Project → Save project`의 `.visauto.json` 파일로 다른 세션에서도 이어서 작업한다.
프로젝트를 읽을 때는 등록된 ggaction 공개 호출만 재생하며 JavaScript를 평가하지 않는다.

Facet와 Facet grid, Arrange facets의 간격은 `spacing: "plot"`으로 데이터 영역
사이를 잰다. 원본 캔버스의 축·범례 여백이 패널 사이에 반복되지 않는다.
`Minimum gap`은 원하는 최소 간격이며, 제목·축 라벨이 실제로 겹칠 때만
ggaction 검증을 통해 필요한 간격까지 늘린다. 최종 간격과 이후 가이드 편집에
필요한 `editCompositionLayout` 호출은 코드와 프로젝트에 명시적으로 저장된다.

ggaction Code의 `.mjs`는 데이터, 전체 공개 호출, native SVG 저장 코드를 함께 내보낸다.
파일 주석에 기록된 ggaction 소스를 설치한 Node 프로젝트에서 `node 파일명.mjs`로
실행하면 `chart.svg`를 생성한다. Current/Preview의 `Expand`는 compact layout을
유지하면서 차트를 크게 읽는 기능이다. 기존 PNG/PDF/SVG 다운로드도 유지한다.

## Preview mode와 Transition mode

상단 토글의 기본값인 **Preview mode**는 Current/Preview 두 뷰와 Apply 시 이동
애니메이션을 유지한다. **Transition mode**에서는 한 뷰 안에서 카드·파라미터에
호버한 결과로 전환한다. 호버를 빼면 마지막 확정 상태로 돌아가고 **Apply만**
차트·코드·히스토리에 반영한다. 빠르게 다른 카드로 이동하면 현재 보이는 중간
프레임에서 다음 결과로 이어진다. Undo/Redo, History, 크기 조절과 내보내기는
확정된 ggaction 프로그램을 기준으로 작동한다.
크기·불투명도·선 굵기·간격 등 연속 슬라이더는 80ms의 짧은 보간으로 포인터를 따라간다.
Facet 열 개수·bin 개수 등 구조를 바꾸는 슬라이더와 카드 간 이동은 300ms를 유지한다.
정수 step만으로 구분하지 않으므로 글꼴 크기도 짧게 전환한다. `test/browser/parameter-motion.py`는
키보드·빠른 호버·구조 변경 및 Preview mode 유지 여부를 검사한다.

전환은 별도 저장소 [ggaction/transition](https://github.com/ggaction/transition)의
`@ggaction/transition`을 `vendor/transition` 서브모듈로 사용한다. ggaction의
`createTransitionScene` (`ggaction/scene`)이 불변 프로그램에서 읽기 전용 장면을
만들고, 패키지의 `planTransition`과 `createTransitionPlayer`가 대응과 재생을
담당한다. 새로운 액션이 기존 ggaction 도형을 만들면 액션별 애니메이션 등록은
필요 없다. 동일 데이터 도형의 위치·크기·색을 보간하며, 대응이 불분명하거나
도형 구조가 달라지면 해당 도형만 fade한다. 이 분기는 잘못된 점끼리 연결하는
움직임을 피한다. `prefers-reduced-motion`에서는 즉시 전환한다.

카드 결과 장면은 호버 시에만 worker에서 준비하고, 늦게 도착한 이전 요청은
화면에 반영하지 않는다. 재생기는 계산된 장면만 사용하며, 제한된 캐시와
공유 clipping 리소스를 정리해 반복 호버로 SVG 노드가 누적되지 않게 한다.
일반 호버 종료에서는 완성된 재생기를 잠시 분리해 보관하고 다시 사용하며,
Apply·Undo·데이터 변경·모드 전환에서는 초기화한다. 복잡한 SVG가 프레임을 반복해서
놓치면 차트 갱신만 일시적으로 약 30fps로 조절해 카드 애니메이션과 포인터에
여유를 준다. 전환 시간과 최종 차트는 유지하며 여유가 생기면 원래 갱신 빈도로 돌아간다.
npm 배포용 선언과 패키지 구조는 포함하지만 npm 레지스트리에는 아직 발행하지
않았다. 현재 소스는 서브모듈 또는 패키지 저장소의 GitHub 설치로 사용한다.

브라우저 검증은 dev server 실행 후 Playwright와 Pillow가 설치된 Python에서
실행한다. 아래 스크립트는 macOS의 Google Chrome을 사용한다.

```sh
python test/browser/transition-mode.py
python test/browser/transition-workflows.py
python test/browser/transition-player.py
python test/browser/transition-hover.py
```

`transition-player.py`는 16개 차트 사례의 native SVG와 전환 결과를 픽셀 비교하고,
각 사례에서 20ms 간격으로 60회 목적지를 바꾼 뒤 최종 도형·리소스 수를 검사한다.
`transition-workflows.py`는 5개 데이터셋의 실제 카드 호버, 파라미터, Apply와 Undo를
검사한다. 패키지 자체의 interruption/리소스 정리/reduced-motion 검사는
`vendor/transition`에서 `npm test`와 `npm run test:browser`로 실행한다.

`transition-hover.py`는 2560×1440, 2배 픽셀 밀도에서 Iris의 색·테두리·크기·불투명도·모양·Facet을 연속 적용한 뒤, 세 차례 반복 호버의 프레임 간격과 DOM 수를 기록한다. 시간 수치는 실행 장비에 따라 달라지므로 고정 성능 합격선으로 쓰지 않는다.


## Canvas display and transitions

Current, Preview, option/history thumbnails, enlarged views and Apply flights
use native Canvas surfaces. Ordinary charts call ggaction `render`; Transition
mode uses version-2 `createTransitionScene(..., {format: 'canvas'})` and
`renderTransitionScene` through `@ggaction/transition`'s Canvas player. The worker
transfers concrete graphics rather than serialized SVG. Native SVG/PDF/PNG
exports and editable project/code formats remain available.

Display fitting preserves logical geometry and follows display density. Preview
framing measures painted Canvas bounds once per candidate. Resize thumbnails
retain their Canvas elements and compositor feedback while workers compute the
exact chart. Detached galleries release resize observation. Transitions retarget
from the visible frame; dense scenes blend bounded Canvas snapshots. SVG playback
remains available in the transition package for other consumers.

Run `test/browser/transition-player.py` for native endpoint comparisons across
16 chart families and rapid retargets, `canvas-surfaces.py` for fitted views,
enlargement and downloads, `transition-hover.py` for repeated real
option hover at 2x DPI, and `canvas-performance.py` for an identical-scene
SVG/Canvas comparison. `canvas-resize.py`, `resize-alignment.py`,
`chart-transfer.py`, `card-motion.py` and `initial-scales.py` cover direct resize,
Apply flights, option controls, both modes and restored sessions. Generated
screenshots, measurements and test logs remain under ignored `output/`.

## Workspace orientation

The header's Horizontal / Vertical controls change the workspace without
rebuilding charts or recommendations. Preview mode defaults to Horizontal;
Transition mode defaults to Vertical. Each mode remembers an explicit layout
choice locally. The active Preview/Transition mode is also saved immediately;
reload restores that mode and its layout together, even before choosing a chart.
The HTML bootstrap applies these preferences before the first paint, so loading
the application module cannot briefly expose the default Preview layout.
These view preferences remain separate from chart history and project data.
Vertical splits the authoring width 50:50 between charts on the
left and options on the right,
with a fixed middle divider: ranks 1–2 occupy the upper half and ranks 3–5 the
lower half. Cards expand vertically within their half without moving neighboring
cards or the divider. Short pages retain their empty slots. Preview's two charts
are stacked in the left column. Code and History remain independently foldable.

Panel boundaries can be dragged to resize visualization/options, Current/Preview,
History, and ggaction Code. Sizes are stored separately for each mode and layout.
`Reset sizes` in the header restores all default panel proportions; it does not
change the chart, history, layout orientation, or panel folding. Divider arrow
keys resize by 12px (Shift: 40px), double-click resets that divider, and Escape
cancels an active drag. Responsive stacked Code uses a horizontal divider.
`test/browser/workspace-resize.py` checks live panel resizing, mounted Canvas/card
identity, folding, persistence, reset and keyboard/cancel behavior.

Run `python test/browser/workspace-layout.py` against the dev server to check
both modes, fixed half-height regions, live parameters, Apply, paging, search,
panel folding and saved preferences at laptop, desktop and narrow window sizes.

Used-action ordering follows the encoding channel and its bound scale together.
Applying `encodeSize`, for example, moves both the size mapping and
`editSizeScale` behind unused actions, using that Apply's position in history.
The same policy covers color, stroke, opacity, shape, width/dash, Cartesian,
polar, offset and parallel scales, including facet source edits and bundled
encodings. Explicit scale edits resolve actual scale consumers, so editing a
different mark does not advance this mark's queue unless they share that scale.
Cards remain searchable and editable; co-occurrence scores are unchanged.

Changing a facet partition field (including either facet-grid dimension) preserves
the chosen guide ownership and scale resolution. It does not silently switch
shared legends to per-cell legends or assign independent color scales. The Facet
guides control labels the native `legend: false` policy as **Per facet**: it
disables parent promotion, rather than removing the children's legend recipes.


### Direct guide editing

Hover a chart title, subtitle, legend or Cartesian, polar or parallel axis title to reveal only its
bounding box. Drag the corner to resize its typography; legend boxes also accept
all four edges and corners, with a larger handle hit area. Short-axis drags on wide
or tall legends control the scale directly instead of being diluted by the other dimension.
Categorical legend symbols
and spacing scale together. Gradient legends resize their strip length/thickness
and typography, while continuous legends displayed as symbols use symbol spacing.
Data-scaled size/stroke samples retain their encoding.
Use **Together** to resize title and subtitle as one block. Drag title or legend
text to a plot edge to choose its position and alignment; the normal ggaction
preparer fits margins and guides. Faceted titles support all four edges as well.

Both Preview and Transition modes update the chart and ggaction Code during the
drag. Release commits one native edit/history step; Escape cancels, and Undo/Redo
restores the result. Chart/canvas resize boxes appear only near their own edges.
`test/guide-manipulation.test.js` covers native edits, facet replay and encoding
preservation; `test/browser/guide-editor.py` exercises actual mouse drags in both modes.

`test/browser/legend-resize.py` checks actual grow/shrink drags for categorical,
continuous color/stroke and symbol legends, in both modes with and without facets.
`test/browser/legend-resize-edges.py` covers all eight resize directions on bottom
color and combined color/shape legends, with live code updates and Undo restoration.

Consecutive moves of the same title block or legend update one history cell and
one move call in ggaction Code, including the live preview. Undo returns to the
state before that move run. Moving another element, applying a different action,
or navigating history starts a new run; cancelling a drag leaves the run intact.
`test/browser/guide-move-history.py` checks code/history compaction, cancellation,
Undo/Redo, resource changes, branching and saved-project restoration in both modes.
