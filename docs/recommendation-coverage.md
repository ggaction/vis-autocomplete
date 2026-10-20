# 추천 누락을 검증하는 방법

추천 빈도와 실행 가능성은 서로 다른 단계다. 공출현이 적거나 없는 기능도 실제 ggaction 공개 함수와
유효한 파라미터가 있으면 후보가 된다. 순서는 기존 논문의 공출현 점수로 결정한다. 이미 적용한 액션은
삭제하지 않고 뒤로 보내며, 포함관계에 따른 상위 액션 표시와 검색의 세부 액션 접근을 유지한다.

## 수정한 원인

| 원인 | 수정 |
| --- | --- |
| Polar 후보 코드가 arc를 일괄 제외하여 Rose/Radial bar의 R·Theta가 생성되지 않음 | 좌표계, native descriptor, 채널의 데이터 역할로 위치 후보 생성 |
| 학습의 `encoding.r`와 실행 상태의 `encoding.radius` 불일치 | 학습·현재 상태·이미 적용한 채널 판정에 같은 정규화 함수 사용. 점의 glyph radius는 `encoding.size`로 구분 |
| 29개 초기 plot 중 일부만 마크 의미를 학습에 포함 | 전체 plot을 실제 root mark에 대응. `encodeChannels`, 평행좌표, 추가 채널과 polar axes도 공통 feature 체계 사용 |
| Cartesian 위치 편집이 기본 마크에만 한정 | Text/Rug, Area/Rect 범위 끝, Polar categorical angle 및 숫자 radius, 평행좌표 차원 포함 |
| 분포·통계 차트에서 계산된 열을 원본 변수처럼 취급 | Box/Violin/Gradient/ECDF/Endpoint는 해당 공개 owner editor로 연결. Interval은 소유한 `editErrorBar` 사용. Bin2D는 원본 X/Y와 bins를 `editBin2DData`로 편집 |
| 회귀 차트의 점과 적합선이 서로 다른 변수를 사용 | 같은 데이터·변수에 연결된 fit은 native `sourceBinding: 'follow'`를 명시적 setup으로 활성화한 뒤 `encodeX`/`encodeY`로 점과 fit을 함께 갱신. 이 setup도 코드와 저장 프로젝트에 기록 |
| ggaction 사전 검사기가 ECDF 등의 원본 변수를 파생 테이블에서 검색 | plot editor의 source dataset을 검사. 일반 encoder는 실제 mark-bound dataset을 계속 검사 |
| Gradient의 경계·중앙값이 서로 다른 축 제목으로 해석됨 | ggaction에서 모두 같은 원본 measure 제목으로 추론. 방향 변경과 사용자 지정 제목 보존 검증 |
| Interval 편집 후 구간과 중앙 점이 다른 dataset을 사용 | ggaction에서 facade 소유 중앙 점·caps·연결된 labels를 같은 revision으로 갱신. 위치·방향 변경도 함께 반영 |
| measured radius에 일반 stroke용 `[1, 5]` range 추천 | R scale의 실제 `radialMapping`을 편집. `encodeR`에는 sum/count와 area/radius-length 제공 |
| 원형 차트 색상 변수를 열 이름만으로 제한 | sector 내부에서 값이 일정한지 실제 데이터로 확인 |
| 같은 파라미터 카드에 서로 모순되는 선택지 포함 | bar bin/aggregate, area range, line aggregate, 서로 다른 regression/endpoint 변수, explicit scale domain을 확인 |
| line/area 통계를 visible mark 개수로 계산하려다 거절 | 해당 series의 bound rows 사용; 지원되지 않는 population 선택은 비활성화 |
| Rose 합계→개수 변경 후 방사축 눈금이 겹쳐 프리뷰 실패 | 기존 가이드 스타일을 보존하면서 눈금 수를 다시 맞춤. remove/create 가이드 호출을 명시적 setup/후속 호출로 반환해 프리뷰·Apply·저장·재실행을 일치시킴 |

`src/position-candidates.js`는 후보와 원본 데이터 소유 관계를 담당하고, `web/parameters.js`는 해당
공개 호출을 만드는 편집기를 담당한다. 학습은 `src/semantics.js`의 같은 용어를 사용한다.
카드 하나의 추천 호출은 여전히 실제 공개 함수 하나다. 가이드 생성 같은 기존 명시적 setup은 별도다.

## 재현 가능한 검증

```sh
npm test
npm run audit:actions
npm run corpus:train
npm run build:workers
```

- `test/position-coverage.test.js`: 추천 서비스 → 파라미터 편집 → 단일 native 호출 → SVG를 검증한다.
  sum/count와 area/length의 조합, 수치 변수가 없는 count-only Rose, 음수 polar radius, source-role 편집,
  기존 채널의 후순위 유지, 회귀 및 구간의 전체 owner 갱신을 포함한다.
- `test/worker-guide-replay.test.js`: 실제 Cars에서 sum→count 변경에 필요한 방사축 재배치를 확인하고
  worker의 프리뷰 SVG와 저장·재실행한 SVG가 동일함을 확인한다.
- `scripts/audit-action-availability.js`: 29개 plot을 만들고 세 그룹의 모든 페이지를 검사한다.
  후보 생성기에 의존하지 않는 native 호출로 지원 가능한 액션을 먼저 확인한 뒤 실제 제공 여부를 비교한다.
  제공된 카드의 기본 파라미터와 위치·owner 편집기의 선택지도 실제 준비/렌더링 경로로 검증한다.
- 코퍼스 학습은 1,213개 차트의 8,788개 프로그램을 전부 사용하며 누락을 허용하지 않는다.
  feature 추출 버전과 ggaction 소스 commit을 모델 provenance에 기록한다.
- 브라우저 검증은 기존 사용자 상태와 분리된 Chrome에서 차트 선택, 검색, 호버 프리뷰, 파라미터 고정,
  Apply, 새로고침 복원을 확인한다. 보고서·스크린샷은 Git에서 제외한 `output/`에 저장한다.

2026-10-20의 29개 plot 감사에서는 174개 지원 확인 probe와 총 578개 제공 카드의 기본 실행,
대상 파라미터 선택지 검사를 통과했다(누락 0, 파라미터 오류 0). 전체 앱 테스트 228개와
ggaction의 관련 검사·가이드·통계 소유자 회귀 테스트도 통과했다. Chrome에서는 Rose의
sum/count·변수·면적/길이 프리뷰와 Apply/재로드, Regression 및 Interval의 변수 변경/Apply를 확인했다.
이 결과는 해당 fixture와 실행한 조합의 범위이며,
임의 데이터와 모든 액션 조합의 무오류를 보장하지 않는다.

Horizon처럼 원본 역할을 편집하는 공개 owner 함수가 아직 없는 경우, 내부 fold/band 경계 열을
임의의 원본 변수로 바꾸는 추천으로 대체하지 않는다. 새로운 공개 편집 계약은 라이브러리에서 다룬다.
열린 그룹·페이지의 기본값만 실행 검증하는 기존 지연 처리도 유지한다.
