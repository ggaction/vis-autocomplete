# 감사 범위와 분모 — 2026-10-25

생성: 2026-10-25T13:15:39.179Z. [메인 보고서](option-audit-2026-10-25.md). 아래 수치는 서로 겹칠 수 있으므로 합쳐서 독립 테스트 수라고 부르지 않는다.

| 항목 | 기록 |
| --- | --- |
| 새 데이터 / 전체 예제 | 10 / 19 |
| Native 검사 데이터셋 / 차트 계열 | 11 / 29 |
| Native 파라미터 trial 기록 | 27479 |
| 양쪽 렌더러로 생성한 trial | 26330 |
| 관찰한 공개 action method / 파라미터 control ID | 123 / 548 |
| 기본 후보 persistence round-trip / 불일치 | 1195 / 0 |
| 실제 UI 파라미터 probe / 별도 composition probe | 999 / 3141 |
| 실제 UI 적용한 액션 / 저장 후 reload 시나리오 | 68 / 27 |
| 별도 중첩 composition 완성·undo/redo·reload | 4 |
| 후속 composition 편집 함수 / 값 변형 | 6 / 70 |
| 독립 수치 oracle 통과 | 9 / 9 |

## Native 파라미터 검사

40개 run 중 완료 38, 부분 기록 1, 초기 후보 부재 1. 1210개 카드 맥락에서 27479개 trial을 기록했다. 같은 native 호출로 정규화된 206개 변형은 중복 렌더링하지 않았다. 유효한 no-change 109개를 구분했다.

예상 입력 검증 거부 542건과 이전 드라이버 배치 오류 0건은 발견한 버그 개수에 포함하지 않는다. 예상 밖 예외 292회는 method/message 기준 58묶음이다. 이는 재현된 독립 결함 개수가 아니다. 같은 구조 문제의 반복, 아직 별도 최소 재현하지 않은 관찰도 포함된다. 메인 보고서의 재현 묶음이 우선이다.

- Two parallel native workers plus separate browser audits: times are not isolated UI benchmarks.
- Swap buttons do not have enumerated values and are excluded from generated-value counts; equivalent normalized mapping swaps may deduplicate to field-selection trials.
- Some early records lack activeKeys: observedActiveValues is a lower bound; observedValues includes retained inactive values and must not be called exact active-control coverage.
- Expected empty-string validation is excluded from bugs.
- Earlier initial mapping permutations without UI previousMapping are excluded as driver artifacts; corrected targeted reruns replace those initial-card records when present.
- Not every supported public ggaction function is an app recommendation; denominator is observed reachable cards in the listed states.
- Every rendered call was serialized to SVG and painted through the actual Canvas scene renderer; hashes/structural tests are not a human visual inspection of every result.

## 실행한 차트 계열

createAreaPlot, createBarPlot, createLinePlot, createPiePlot, createRadialBarPlot, createRosePlot, createScatterPlot, createHorizonPlot, createHeatmap, createDensityPlot, createECDFPlot, createHistogram, createRadarPlot, createRugPlot, createBeeswarmPlot, createBoxPlot, createDotPlot, createGradientPlot, createIntervalPlot, createLollipopPlot, createRaincloudPlot, createStripPlot, createViolinPlot, createTextPlot, createDumbbellPlot, createParallelCoordinates, createPolarLinePlot, createPolarScatterPlot, createRegressionPlot

## 실제 브라우저 검사

초기/후속 옵션 시나리오 29개 중 27개가 apply·저장·reload까지 완료했다. 999개 값 조작을 기록했고 pageerror는 0개다. 0개 probe의 자동화 중단은 정상 제품 결과로 세지 않는다.

| 미완료 시나리오 | 원인 |
| --- | --- |
| 04-createAreaPlot-unemployment | page.waitForFunction: Timeout 30000ms exceeded. |
| 26-createRadarPlot-wine | Error: Card unavailable: createRadarPlot  |

Wine Radar는 고유 행 ID 없는 그룹 요약 경로가 없어 초기 후보가 없었고, Glass Radar는 별도 UI 및 native 검사에서 생성했다. Unemployment Area는 초기 Apply 후 추천 준비 대기를 초과했다. 이후 전체 sweep 종료 뒤 별도 기본값 세션에서 49.193초로 재현해 메인 A14의 성능 문제로 확정했다. 구체적 병목 함수는 미확정이다. 원시 live 기록 중 함수명/검색 그룹을 잘못 지정한 후속 카드 부재도 제품 결함으로 세지 않았다.

Composition은 12개 데이터셋 / 242개 카드 맥락 / 3141개 probe를 기록했다. 일부 최초 시나리오의 드라이버 중단 후 4개 저장된 composition을 별도로 이어서 3패널 구성·공통 제목·Undo/Redo·reload까지 확인했다. 전체 상세와 샘플링 정책은 [조합 보고서](option-audit-2026-10-25-compositions.md)에 있다.

## 공개 API 대비 관찰 범위

현재 public method 294개 중 native 카드 감사에서 123개를 관찰했다. 데이터 준비, persistence, 제거, facade의 세부 primitive 등은 모두 독립 추천 카드가 아니다. Overlay/adjacent/Layer는 별도의 composition UI 감사에 있으므로 이 native 카드 숫자에 없다는 이유로 미검사라고 판단하면 안 된다. 반대로 모든 공개 API를 검사했다고 말할 수도 없다.

Unobserved means not reached in these sampled states, not missing or broken. Corpus policy distinguishes aliases/setup/data preparation/initial plots and dependent resources; composition and low-level resource states are audited separately by other agents.

| 관찰하지 않은 direct recommendation | alias / 경로 |
| --- | --- |
| bindMarkData | bindMarkData |
| createAdjacentPlot | Explicit native chart composition and scoped editing. |
| createCoordinate | createCoordinate |
| createErrorBand | createErrorBand |
| createErrorBar | createErrorBar |
| createLayerPlot | Explicit native chart composition and scoped editing. |
| createParallelAxes | createParallelAxes |
| createParallelAxis | createParallelAxis |
| createRadialAxis | createRadialAxis |
| createRadialAxisLabels | createRadialAxisLabels |
| createRadialAxisLine | createRadialAxisLine |
| createRadialAxisTicks | createRadialAxisTicks |
| createRadialAxisTitle | createRadialAxisTitle |
| createReferenceBand | createReferenceBand |
| createReferenceLine | createReferenceLine |
| createRegressionBand | createRegressionBand |
| createRegressionLine | createRegressionLine |
| createThetaAxis | createThetaAxis |
| createThetaAxisLabels | createThetaAxisLabels |
| createThetaAxisLine | createThetaAxisLine |
| createThetaAxisTicks | createThetaAxisTicks |
| createThetaAxisTitle | createThetaAxisTitle |
| editBinData | editBinData |
| editCompositionLayout | Retained facet templates support native source and layout editing. |
| editCompositionScales | Explicit native chart composition and scoped editing. |
| editComputedData | editComputedData |
| editDensityData | editDensityData |
| editDerivedData | editDerivedData |
| editECDFData | editECDFData |
| editErrorBand | editErrorBand |
| editErrorBandBoundary | editErrorBandBoundary |
| editFacetGuides | Retained facet templates support native source and layout editing. |
| editFacetHeaders | Retained facet templates support native source and layout editing. |
| editFacetScales | Retained facet templates support native source and layout editing. |
| editFacetSource | Retained facet templates support native source and layout editing. |
| editFlattenData | editFlattenData |
| editFoldData | editFoldData |
| editImputedData | editImputedData |
| editIntervalData | editIntervalData |
| editLookupData | editLookupData |
| editMarkLabelSelection | editMarkLabelSelection |
| editMarkSelection | editMarkSelection |
| editNormalizedData | editNormalizedData |
| editOverlay | Explicit native chart composition and scoped editing. |
| editParallelAxis | editParallelAxis |
| editRadialAxis | editRadialAxis |
| editRadialAxisLabels | editRadialAxisLabels |
| editRadialAxisLine | editRadialAxisLine |
| editRadialAxisTicks | editRadialAxisTicks |
| editRadialAxisTitle | editRadialAxisTitle |
| editRadialGrid | editRadialGrid |
| editRegressionBand | editRegressionBand |
| editRegressionData | editRegressionData |
| editRegressionLine | editRegressionLine |
| editRegressionStatisticsData | editRegressionStatisticsData |
| editScale | editScale |
| editSortedData | editSortedData |
| editStackData | editStackData |
| editStrokeDashScale | editStrokeDashScale |
| editThetaAxis | editThetaAxis |
| editThetaAxisLabels | editThetaAxisLabels |
| editThetaAxisLine | editThetaAxisLine |
| editThetaAxisTicks | editThetaAxisTicks |
| editThetaAxisTitle | editThetaAxisTitle |
| editThetaGrid | editThetaGrid |
| editTimeUnitData | editTimeUnitData |
| editWindowData | editWindowData |
| editYOffsetScale | editYOffsetScale |
| encodeChannels | encodeChannels |
| encodeDensity | encodeDensity |
| encodeDx | encodeDx |
| encodeDy | encodeDy |
| encodeHistogram | encodeHistogram |
| encodeHorizon | encodeHorizon |
| encodePathOrder | encodePathOrder |
| encodeX2 | encodeX2 |
| encodeXRange | encodeXRange |
| encodeYOffset | encodeYOffset |
| encodeYRange | encodeYRange |
| fitCanvas | fitCanvas |
| highlightMarks | highlightMarks |
| insertCompositionChild | insertCompositionChild |
| layoutLabels | layoutLabels |
| removeCategoryOrder | removeCategoryOrder |
| removeCompositionChild | removeCompositionChild |
| removeCoordinate | removeCoordinate |
| removeData | removeData |
| removeEncoding | removeEncoding |
| removeGrid | removeGrid |
| removeJitter | removeJitter |
| removeLabelLayout | removeLabelLayout |
| removeLegend | removeLegend |
| removeMark | removeMark |
| removeMarkFilter | removeMarkFilter |
| removeMarkHighlight | removeMarkHighlight |
| removeMarkLabels | removeMarkLabels |
| removeMarkSelection | removeMarkSelection |
| removeParallelAxes | removeParallelAxes |
| removeParallelAxis | removeParallelAxis |
| removePathOrder | removePathOrder |
| removePointPacking | removePointPacking |
| removePointRadius | removePointRadius |
| removeRadialAxis | removeRadialAxis |
| removeScale | removeScale |
| removeTextMetrics | removeTextMetrics |
| removeTheme | removeTheme |
| removeThetaAxis | removeThetaAxis |
| removeTitle | removeTitle |
| removeXAxis | removeXAxis |
| removeYAxis | removeYAxis |
| reorderCompositionChildren | reorderCompositionChildren |
| repeatCharts | Retained facet templates support native source and layout editing. |
| replaceCompositionChild | replaceCompositionChild |
| reviseData | reviseData |

전체 역할별 미관찰 목록·비활성 선택지·control별 값은 [원시 coverage.json](../../output/option-audit-2026-10-25/parameters/coverage.json)에 있다.

## 실행 예산·조건부 값의 한계

카드당 최대 trial 예산으로 0개 생성 후보를 건너뛰었다.  느린 상태에는 별도 wall-clock cap을 두었고 부분 기록을 유지했다. 초기 무효값의 모든 교차조합, 모든 실수값, 모든 가능한 액션 순열을 검사하지 않았다.

control의 observedValues에는 inactive 상태로 보존된 값이 포함될 수 있다. 초기 일부 기록에 activeKeys가 없어 exact active-control coverage를 주장하지 않는다. 조건부 control의 표시를 직접 확인한 브라우저 검사와 이후 activeKeys 기록을 별도로 참고해야 한다.

## 액션별 파라미터 기록

아래 시도 수는 해당 action의 여러 차트 맥락을 합한 값이며, 반복·예상 거부를 포함한다.

| Action | 맥락 | control ID | 시도 | 예상 밖 예외 |
| --- | --- | --- | --- | --- |
| createAnnotation | 25 | 4 | 625 | 0 |
| createAreaPlot | 2 | 13 | 295 | 0 |
| createBarPlot | 2 | 8 | 215 | 1 |
| createBeeswarmPlot | 1 | 8 | 89 | 0 |
| createBoxPlot | 1 | 8 | 37 | 0 |
| createDensityPlot | 1 | 7 | 33 | 1 |
| createDotPlot | 1 | 7 | 16 | 0 |
| createDumbbellPlot | 1 | 4 | 4 | 0 |
| createECDFPlot | 1 | 4 | 1 | 0 |
| createGradientPlot | 1 | 10 | 56 | 0 |
| createHeatmap | 1 | 9 | 270 | 0 |
| createHistogram | 1 | 5 | 15 | 0 |
| createHorizonPlot | 2 | 8 | 53 | 0 |
| createIntervalPlot | 1 | 9 | 106 | 0 |
| createLinePlot | 2 | 12 | 322 | 0 |
| createLollipopPlot | 1 | 8 | 22 | 0 |
| createMarkLabels | 18 | 6 | 267 | 0 |
| createOverlay | 21 | 6 | 151 | 0 |
| createParallelCoordinates | 1 | 4 | 37 | 7 |
| createPiePlot | 1 | 3 | 18 | 0 |
| createPolarLinePlot | 1 | 6 | 133 | 0 |
| createPolarScatterPlot | 1 | 5 | 127 | 0 |
| createRadarPlot | 1 | 4 | 27 | 0 |
| createRadialBarPlot | 1 | 3 | 18 | 0 |
| createRaincloudPlot | 1 | 8 | 31 | 0 |
| createRegression | 2 | 4 | 56 | 0 |
| createRegressionPlot | 1 | 10 | 185 | 0 |
| createRosePlot | 1 | 3 | 18 | 0 |
| createRugPlot | 1 | 4 | 15 | 0 |
| createScatterPlot | 2 | 7 | 372 | 0 |
| createStatisticalReference | 26 | 4 | 800 | 18 |
| createStripPlot | 1 | 8 | 103 | 0 |
| createTextPlot | 1 | 7 | 126 | 0 |
| createTitle | 33 | 5 | 1155 | 0 |
| createViolinPlot | 1 | 11 | 79 | 0 |
| editArcMark | 3 | 6 | 43 | 0 |
| editAreaMark | 6 | 4 | 182 | 0 |
| editAxes | 33 | 6 | 1263 | 0 |
| editBarMark | 4 | 4 | 108 | 0 |
| editBin2DData | 1 | 3 | 11 | 0 |
| editBoxPlot | 1 | 10 | 47 | 0 |
| editCanvas | 33 | 1 | 132 | 0 |
| editColorScale | 22 | 8 | 663 | 0 |
| editCompleteData | 2 | 0 | 2 | 0 |
| editCoordinate | 26 | 1 | 104 | 0 |
| editDensity | 1 | 3 | 14 | 0 |
| editECDFPlot | 1 | 3 | 21 | 0 |
| editEndpointPlot | 3 | 6 | 60 | 4 |
| editErrorBar | 1 | 2 | 8 | 0 |
| editFilteredData | 10 | 7 | 77 | 8 |
| editGradientPlot | 1 | 10 | 92 | 0 |
| editGrid | 31 | 4 | 713 | 0 |
| editHorizon | 2 | 6 | 256 | 0 |
| editHorizontalGrid | 22 | 3 | 396 | 0 |
| editLegend | 19 | 6 | 530 | 0 |
| editLegendBlock | 20 | 3 | 360 | 0 |
| editLegendBorder | 20 | 4 | 580 | 0 |
| editLegendLabels | 20 | 4 | 500 | 0 |
| editLegendLayout | 19 | 3 | 361 | 0 |
| editLegendSymbols | 1 | 3 | 15 | 0 |
| editLegendTitle | 20 | 4 | 500 | 0 |
| editLineMark | 6 | 7 | 110 | 0 |
| editMarkLabelPlacement | 1 | 4 | 13 | 0 |
| editOpacityScale | 1 | 2 | 9 | 0 |
| editParallelScale | 1 | 4 | 21 | 0 |
| editPointMark | 10 | 4 | 270 | 0 |
| editRadarPlot | 1 | 1 | 14 | 2 |
| editRaincloudPlot | 1 | 6 | 28 | 2 |
| editRectMark | 2 | 4 | 53 | 0 |
| editRegression | 3 | 6 | 75 | 0 |
| editRScale | 5 | 2 | 10 | 0 |
| editRuleMark | 1 | 4 | 26 | 0 |
| editShapeScale | 1 | 0 | 1 | 0 |
| editSizeScale | 1 | 2 | 9 | 0 |
| editStrokeScale | 1 | 2 | 18 | 0 |
| editStrokeWidthScale | 1 | 2 | 9 | 0 |
| editSummaryData | 4 | 2 | 59 | 0 |
| editTextMark | 1 | 4 | 26 | 0 |
| editThetaScale | 6 | 1 | 12 | 0 |
| editTickMark | 1 | 4 | 27 | 0 |
| editTitle | 1 | 5 | 35 | 0 |
| editVerticalGrid | 4 | 3 | 72 | 0 |
| editViolinPlot | 1 | 6 | 30 | 0 |
| editXAxis | 27 | 6 | 797 | 0 |
| editXAxisLabels | 26 | 4 | 702 | 0 |
| editXAxisLine | 26 | 2 | 312 | 0 |
| editXAxisTicks | 26 | 4 | 628 | 0 |
| editXAxisTicksAndLabels | 26 | 7 | 551 | 0 |
| editXAxisTitle | 25 | 4 | 700 | 0 |
| editXOffsetScale | 2 | 1 | 4 | 0 |
| editXScale | 27 | 3 | 111 | 0 |
| editYAxis | 23 | 6 | 771 | 0 |
| editYAxisLabels | 23 | 4 | 621 | 0 |
| editYAxisLine | 23 | 2 | 276 | 0 |
| editYAxisTicks | 23 | 4 | 635 | 0 |
| editYAxisTicksAndLabels | 23 | 7 | 566 | 0 |
| editYAxisTitle | 23 | 4 | 644 | 0 |
| editYScale | 27 | 3 | 168 | 0 |
| encodeAngle | 11 | 3 | 108 | 0 |
| encodeBarWidth | 3 | 1 | 12 | 0 |
| encodeColor | 33 | 4 | 2295 | 1 |
| encodeGroup | 14 | 1 | 30 | 12 |
| encodeOpacity | 22 | 5 | 243 | 14 |
| encodeParallelCoordinates | 1 | 1 | 16 | 0 |
| encodeR | 4 | 3 | 48 | 0 |
| encodeShape | 9 | 1 | 14 | 1 |
| encodeSize | 10 | 5 | 223 | 0 |
| encodeStroke | 34 | 4 | 963 | 43 |
| encodeStrokeDash | 7 | 3 | 27 | 1 |
| encodeStrokeWidth | 9 | 5 | 77 | 15 |
| encodeText | 1 | 1 | 2 | 0 |
| encodeTheta | 5 | 1 | 57 | 26 |
| encodeX | 15 | 3 | 315 | 106 |
| encodeXOffset | 5 | 1 | 14 | 8 |
| encodeY | 15 | 4 | 299 | 12 |
| encodeY2 | 2 | 1 | 3 | 0 |
| facet | 31 | 3 | 454 | 3 |
| facetGrid | 20 | 3 | 230 | 7 |
| filterMarks | 26 | 5 | 411 | 0 |
| jitterPoints | 8 | 2 | 64 | 0 |
| layoutSeries | 4 | 1 | 17 | 0 |
| orderCategories | 13 | 3 | 211 | 0 |
| packPoints | 2 | 2 | 18 | 0 |

## 예외 관찰 부록

아래는 자동 검사에서 분리한 method/message 묶음이다. 모든 행을 독립적인 확정 버그로 세지 않는다. 재현·설명은 메인 및 세부 보고서를 참고한다.

| Action | 관찰 메시지 | 분류 | 횟수 | 맥락 |
| --- | --- | --- | --- | --- |
| encodeX | Field "casual" must contain a finite number at row 2. | generated-area-gap-remapping | 5 | bike-area.json |
| createBarPlot | The x-axis labels overlap each other. | automatic-axis-fitting | 1 | bike-bar.json |
| encodeX | xOffset scale "xOffset" requires one shared resolved x categorical slot. | generic-owner-role-series-constraints | 9 | bike-bar.json, income-bar.json |
| encodeX | Bar x encoding requires a quantitative field opposite a categorical position. | generic-owner-role-series-constraints | 44 | bike-bar.json, income-bar.json |
| encodeXOffset | Offset field conflicts with the stored series group. | generic-owner-role-series-constraints | 8 | bike-bar.json, income-bar.json |
| facetGrid | Line series on mark "plot" requires at least two aggregate points. | generic-owner-role-series-constraints | 1 | bike-line.json |
| encodeY | Aggregate "mean" does not support field type "nominal". | generic-owner-role-series-constraints | 6 | bike-line.json, unemployment-line.json |
| encodeY | Aggregate "mean" does not support field type "ordinal". | generic-owner-role-series-constraints | 4 | bike-line.json, unemployment-line.json |
| encodeY | Aggregate "mean" does not support field type "temporal". | generic-owner-role-series-constraints | 2 | bike-line.json, unemployment-line.json |
| encodeGroup | Line series on mark "plot" requires at least two aggregate points. | generic-owner-role-series-constraints | 1 | bike-line.json |
| encodeGroup | Path color field "season" must have one value within each series. | generic-owner-role-series-constraints | 6 | bike-line.json |
| encodeTheta | arc theta position does not support field type "temporal". | specialized-polar-horizon-owner-constraints | 1 | bike-pie.json |
| encodeTheta | Arc category "0" must resolve to one color value. | specialized-polar-horizon-owner-constraints | 2 | bike-pie.json |
| encodeTheta | Arc category "3" must resolve to one color value. | specialized-polar-horizon-owner-constraints | 1 | bike-pie.json |
| encodeTheta | Arc category "1" must resolve to one color value. | specialized-polar-horizon-owner-constraints | 2 | bike-pie.json |
| encodeTheta | Arc category "2" must resolve to one color value. | specialized-polar-horizon-owner-constraints | 1 | bike-pie.json |
| encodeTheta | Quantitative arc theta does not support aggregate. | specialized-polar-horizon-owner-constraints | 7 | bike-pie.json |
| encodeTheta | Polar guide values must be inside the scale domain. | specialized-polar-horizon-owner-constraints | 7 | bike-radial.json, bike-rose.json |
| encodeTheta | Measured Arc category "3" must resolve to one color value. | specialized-polar-horizon-owner-constraints | 1 | bike-radial.json |
| encodeTheta | Measured Arc category "6" must resolve to one color value. | specialized-polar-horizon-owner-constraints | 2 | bike-radial.json, bike-rose.json |
| encodeTheta | Measured Arc category "1" must resolve to one color value. | specialized-polar-horizon-owner-constraints | 2 | bike-rose.json |
| encodeX | Field "value" must contain a finite number at row 7. | generated-area-gap-remapping | 4 | budget-area.json |
| encodeX | Cannot rebind x guides from shared scale "x" while it has other consumers. | shared-guide-ownership | 4 | cars-scatter-seeded-statisticalReference-editRuleMark,encodeX,encodeY,encodeStroke,encodeStrokeWidth,encodeStrokeDash.json |
| encodeGroup | horizon path mark "plot" must group by "plotHorizonGroup"; use editHorizon. | specialized-polar-horizon-owner-constraints | 4 | employment-horizon.json, temperature-horizon.json |
| createDensityPlot | The y-axis labels overlap each other. | automatic-axis-fitting | 1 | glass-density.json |
| createStatisticalReference | Statistical reference groupBy field "RI_value" is missing at item 0. | statistic-population-field-mismatch | 2 | glass-density.json |
| createStatisticalReference | Statistical reference groupBy field "RI_density" is missing at item 0. | statistic-population-field-mismatch | 1 | glass-density.json |
| createStatisticalReference | Statistical reference groupBy field "__plotECDFData_cumulative" is missing at item 0. | statistic-population-field-mismatch | 2 | glass-ecdf.json |
| createStatisticalReference | Statistical reference groupBy field "__plotECDFData_probability" is missing at item 0. | statistic-population-field-mismatch | 1 | glass-ecdf.json |
| createStatisticalReference | Statistical reference groupBy field "__plotECDFData_value" is missing at item 0. | statistic-population-field-mismatch | 1 | glass-ecdf.json |
| encodeStroke | In-plot legend group does not fit the plot inset. | automatic-legend-capacity | 33 | glass-radar.json, unemployment-line.json |
| encodeStroke | Unknown createLegend option "overflow". | continuous-legend-overflow-leak | 9 | glass-radar.json |
| encodeStrokeWidth | In-plot legend group does not fit the plot inset. | automatic-legend-capacity | 15 | glass-radar.json |
| encodeOpacity | Unknown createLegend option "overflow". | continuous-legend-overflow-leak | 14 | glass-radar.json |
| encodeStrokeDash | createCategoricalLegend requires a missing legend for series. | legend-ownership-recreation | 1 | glass-radar.json |
| editRadarPlot | Theta axis labels require sufficient non-overlapping Canvas space. | radar-dimension-guide-capacity | 2 | glass-radar.json |
| encodeColor | Field "Sex" must contain a nominal value at row 7. | newly-mapped-missing-field | 1 | penguins-beeswarm.json |
| encodeStroke | Field "Sex" must contain a nominal value at row 7. | newly-mapped-missing-field | 1 | penguins-beeswarm.json |
| encodeShape | Field "Sex" must contain a nominal value at row 7. | newly-mapped-missing-field | 1 | penguins-beeswarm.json |
| encodeX | Point packing requires a categorical position scale with a positive slot. | generic-owner-role-series-constraints | 20 | penguins-beeswarm.json |
| editEndpointPlot | createDotPlot category field "Sex" has an invalid value at row 7. | newly-mapped-missing-field | 2 | penguins-dot.json |
| editFilteredData | Density observed extent requires varying finite values. | filter-estimator-feasibility | 6 | penguins-gradient.json, penguins-raincloud.json, penguins-violin.json |
| editFilteredData | Scale "plotX" requires an explicit domain for empty data. | filter-estimator-feasibility | 2 | penguins-interval.json |
| editEndpointPlot | createLollipopPlot category field "Sex" has an invalid value at row 7. | newly-mapped-missing-field | 2 | penguins-lollipop.json |
| editRaincloudPlot | Field "Sex" must contain a nominal value at row 7. | newly-mapped-missing-field | 2 | penguins-raincloud.json |
| createStatisticalReference | Statistical reference groupBy field "Body Mass (g)_value" is missing at item 0. | statistic-population-field-mismatch | 2 | penguins-raincloud.json, penguins-violin.json |
| createStatisticalReference | Statistical reference groupBy field "Body Mass (g)_density" is missing at item 0. | statistic-population-field-mismatch | 2 | penguins-raincloud.json, penguins-violin.json |
| facetGrid | Field "Sex" must contain a nominal value at row 3. | newly-mapped-missing-field | 6 | penguins-strip.json |
| encodeX | Band point jitter requires a categorical position scale with a positive slot. | generic-owner-role-series-constraints | 20 | penguins-strip.json |
| createStatisticalReference | Statistical reference groupBy field "plotHorizonSign" is missing at item 0. | statistic-population-field-mismatch | 2 | temperature-horizon.json |
| createStatisticalReference | Statistical reference groupBy field "plotHorizonGroup" is missing at item 0. | statistic-population-field-mismatch | 1 | temperature-horizon.json |
| createStatisticalReference | Statistical reference groupBy field "plotHorizonColor" is missing at item 0. | statistic-population-field-mismatch | 1 | temperature-horizon.json |
| createStatisticalReference | Statistical reference groupBy field "plotHorizonX" is missing at item 0. | statistic-population-field-mismatch | 1 | temperature-horizon.json |
| createStatisticalReference | Statistical reference groupBy field "plotHorizonUpper" is missing at item 0. | statistic-population-field-mismatch | 1 | temperature-horizon.json |
| createStatisticalReference | Statistical reference groupBy field "plotHorizonBand" is missing at item 0. | statistic-population-field-mismatch | 1 | temperature-horizon.json |
| facet | Facet headers require sufficient non-overlapping space above every child plot. | facet-header-capacity | 3 | unemployment-line.json |
| encodeGroup | Path color field "series" must have one value within each series. | generic-owner-role-series-constraints | 1 | unemployment-line.json |
| createParallelCoordinates | encodeColor requires exactly one of value or field. | cleared-pcp-color-retains-scale | 7 | wine-pcp.json |
