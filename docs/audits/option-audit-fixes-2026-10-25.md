# v0.0.2 — 옵션 카드 감사 후속 수정과 검증

대상은 [원본 감사](option-audit-2026-10-25.md)의 A01–A14, C01–C10, S01–S04와 별도 개선점 6개다. 원본 감사는 당시 발견 상태를 보존한다. 이 문서는 수정 내용과 재검증을 구분해 기록한다.

## 수정 내역

| ID | 수정한 계약과 동작 |
| --- | --- |
| A01 | Beeswarm·Strip·Raincloud·endpoint 계열의 결측 정책을 소유 차트에 보존하고, 후속 매핑에 따라 complete-case 파생 데이터를 갱신한다. 내부 필터 ID는 원본 데이터 역할로 노출하지 않는다. |
| A02 | PCP Color=None은 palette까지 제거해 유효한 무색상 차트를 만든다. |
| A03 | 편집한 범례와 새 범례를 같은 외곽 배치에서 함께 계산한다. 사용자 지정 간격·미세 드래그는 유지한다. |
| A04 | 통계 Group by는 선택한 population에 실제로 존재하는 필드만 제공한다. |
| A05 | Beeswarm·Strip의 packing/jitter 범주 슬롯 제약을 파라미터 선택에 반영한다. |
| A06 | 밀도·구간 추정이 성립하는 관측값과 그룹을 기준으로 필터 경계를 정한다. 퇴화하는 선택은 이유를 표시한다. |
| A07 | Density·ECDF의 값/통계 축 역할을 fitting에 연결한다. 비선형 tick이 계속 겹치면 실제 집계·공유 domain의 endpoint를 명시하며 count/values/rounding은 혼용하지 않는다. |
| A08 | 필드·타입·집계·series grain을 함께 갱신한다. 통계 reference의 scale 변경은 기존 공유 scale ID를 유지한다. Polar category 변경은 소유 guide를 갱신한다. |
| A09 | Area의 합성 null 행 대신 관측된 원본/요약 grain에서 재매핑한다. Stack에 필요한 alignment도 새 key/group으로 다시 만든다. |
| A10 | 범례 종류별로 overflow 인자를 구분한다. Color와 별개 field의 dash 범례는 독립 owner를 갖고, 같은 field는 결합한다. |
| A11 | Theta·Radial·Parallel 개별 축 편집을 추천과 검색에 연결한다. |
| A12 | Shape scale에 실제 shape range 선택을 제공한다. |
| A13 | Stroke dash scale의 잘못된 reverse 인자를 제거하고 공개 range 파라미터로 편집한다. |
| A14 | Composition snapshot 전송과 facet guide 제거를 일괄 처리하고, layout fingerprint의 문자별 BigInt 할당을 제거한다. 데이터나 추천 기능을 줄이지 않는다. |
| C01 | 독립 layer의 위치·series layout 정책을 실제 source와 맞춘다. 가로 Line의 범주 Y와 수치 X를 지원한다. |
| C02 | Follow results는 실제 단일 endpoint가 있는 결과만 제공한다. Violin의 관측값 Layer 경로는 유지한다. |
| C03 | 공유 축의 의미를 내부 파생 열 이름 대신 원본 measurement lineage로 비교한다. 카드에서 Independent로 해제할 수 있다. |
| C04 | Area measurement에 지원되지 않는 일반 channel 속성을 복사하지 않는다. |
| C05 | ECDF의 Color/group 선택을 생성자의 실제 인자 계약으로 변환한다. |
| C06 | Rug의 단일 축·edge·무색상 생성 계약을 지킨다. |
| C07 | `plot.inherit.color: false`로 명시적 Color=None과 생략된 상속을 구분한다. |
| C08 | 자동 제목은 원본 변수와 통계 의미를 사용한다. 내부 density suffix나 dependent overlay ID를 제목에 쓰지 않는다. |
| C09 | 화면에만 존재하던 자동 범례를 concat 이전 명시적 guide 호출로 보존한다. 공유 범례 수집 후에도 한 개가 남고, 공유 해제 후에도 child guide가 유지된다. |
| C10 | 범례 인코딩이 없는 facet에서는 shared legend 선택을 비활성화하고 이유를 표시한다. 공간이 필요한 정상 배치는 공개 guide/layout 호출로 fitting한다. |
| S01 | Radar의 series ID와 Color를 분리한다. 낮은 cardinality 그룹과 명시된 평균 profile을 기본으로 쓰며 고유 ID 214개를 기본 색상 범례로 만들지 않는다. |
| S02 | Exact plot 크기는 유지하고 자동 guide 여백만 회수한다. 사용자가 지정한 여백과 자동 예약 공간의 출처를 persistence에도 유지한다. |
| S03 | Radar 차원 편집에 원본 타입 힌트를 전달한다. 숫자로 저장된 class/ID가 자동으로 수치 축이 되지 않는다. |
| S04 | 차원 선택 UI가 실제 축 순서를 표시하고 재정렬을 지원한다. 멤버십만 바꾸면 기존 순서를 유지한다. |

추가 개선점도 구현했다.

- Radar 그룹별 mean/median profile. 앱은 사용 중인 요약 방식을 표시하며, native API는 요약을 생략하면 개별 관측값을 유지한다.
- 명시적 per-dimension minmax normalization. 기본은 원래 단위이며, 정규화 전 profile 값과 원본 관측값도 보존한다.
- 비율 필드의 비가중 mean/percent 기본값과 선택 가능한 weighted mean. Weighted mean을 선택하면 Weight 입력에 사용할 열을 표시하고 변경할 수 있다. 각 표시 그룹의 가중치 합이 양수인지 실제 native summary/bin 계획으로 확인하며, bin 변경 후에도 다시 검증한다.
- Bar/Line의 native bin 경계 tick과 `(binned)` 표시. Area/Horizon은 `(bin centers)`로 표시해 원본 관측 연도와 구분한다. 후속 bin 변경 후 오래된 labelMap이 남지 않는다.
- Shared/Independent 선택과 비호환 이유를 카드에서 제공한다. 상위 composition의 공유를 해제하는 실제 공개 호출도 생성한다.
- `target: { childPath, id, facetSource: true }`로 facet source와 일반 패널을 섞은 All 편집을 하나의 공개 액션으로 전달한다.

수정 중 회귀 검사에서 발견한 문제도 포함했다. 기존 고정 Canvas·primitive composition·범례 pixel oracle을 보존했고, 내부 데이터 lineage, 미세 범례 이동, mixed All 카드의 파라미터 빌더와 native 함수명 전달, 생성 코드 예제의 enum 값도 함께 검증한다.

## 성능 측정

동일한 Unemployment 1,708행의 date / rate / series → 기본 Area → Apply를 새 Chromium 세션에서 실행했다. 다른 감사·테스트 프로세스를 멈춘 상태에서 측정했고, 시스템의 일반 백그라운드 프로세스는 유지했다.

| 측정 | 첫 추천 5개 준비 |
| --- | ---: |
| 원본 감사 | 49.193초 |
| 수정 후 첫 독립 실행 | 9.691초 |
| 수정 후 반복 독립 실행 | 9.708초 |
| 최종 릴리즈 후보 독립 실행 | 9.574초 |
| 최종 후보 Chromium renderer CPU 4배 감속 | 10.320초 |

최종 후보는 원본 감사보다 약 80.5% 감소했다. 1초 간격 관찰값이므로 sub-millisecond 정밀도의 벤치마크가 아니다. 정상 실행에서 빠르게 카드 15번을 오간 구간의 frame interval p95는 16.7ms, 최대는 16.8ms였고 long task는 없었다. 4배 감속은 Chromium의 renderer throttle이며 모든 worker와 운영체제를 저사양 기기로 재현한다는 뜻은 아니다. 최종 감속 구간의 frame interval p95는 33.3ms, 최대는 50.1ms였으며 55ms long task가 한 번 있었다. 두 실행 모두 현재 Canvas·History가 유지됐고 JavaScript 오류는 없었다. 최종 측정 JSON·PNG는 `output/audit-fixes/performance/release-normal/`과 `release-throttled/`에 있다.

원인은 주로 worker의 큰 immutable 그래픽 트리 준비였다. 이미 완성된 child snapshot을 property별로 재작성하고, facet마다 graphic map을 반복 복사·제거하는 비용을 줄였다. 표시 데이터, facet panel, mark 수를 줄이거나 사용자 파라미터를 생략하는 최적화는 사용하지 않았다. 모든 하드웨어·무한한 데이터 크기에서 일정 프레임률을 보장하는 결과는 아니다.

재실행:

```sh
AUDIT_FOLDER=output/audit-fixes/performance/browser-normal node scripts/audit-area-readiness-2026-10-25.mjs
CPU_THROTTLE=4 AUDIT_FOLDER=output/audit-fixes/performance/browser-throttled node scripts/audit-area-readiness-2026-10-25.mjs
```

## 브라우저 번들 크기 검토

같은 staged package·Vite 설정으로 ggaction 기준 commit `aa8f1e28`과 수정 후보를 비교했다. 기준 commit 자체가 기존 Full 464,500 / Basic 239,000바이트 상한을 이미 초과하고 있어, 전체 초과량을 이번 수정의 증가량으로 해석하지 않는다.

| gzip 크기 | 기준 commit | 수정 후보 | 이번 순증 |
| --- | ---: | ---: | ---: |
| Full | 476,183 | 481,383 | 5,200바이트 (1.09%) |
| Basic | 241,647 | 244,242 | 2,595바이트 (1.07%) |
| SVG | 7,566 | 7,566 | 0 |

위 비교는 Node 23.5.0의 동일 압축기에서 실행했으며 최종 path-layer 색상·Area opacity 수정을 포함한다. 같은 수정 후보의 minified JavaScript를 지원 버전 Node 20.20.2·22.23.4·24.22.1의 zlib로 직접 압축하면 세 버전 모두 Full 481,548 / Basic 244,737 / SVG 7,578바이트다. 이 최댓값을 포함하는 최소 1,000바이트 단위로 상한을 Full 482,000 / Basic 245,000으로 조정했다. SVG 상한 25,000은 유지한다.

번들에 새로 포함된 모듈은 Full에서 Area 정렬 정책과 complete-case 데이터 소유자 두 개, Basic에서 Area 정렬 정책 하나다. 기존 guide fitting·Radar 요약·position/legend 소유권 코드 증가도 확인했다. 최종 모듈 수는 Full 574 / Basic 347 / SVG 19이며 Node/MCP/knowledge 모듈은 포함되지 않았다. 이 비교는 번들 다운로드 크기이며 실행 시간 향상 수치와는 별개다. 기준선 비교는 `output/audit-fixes/browser-bundle-review.json`, 최종 chunk 해시·tarball 해시·지원 Node별 재압축 수치는 `output/audit-fixes/bundle-final/measurement.json`과 같은 폴더의 `node-20.json`, `node-22.json`, `node-24.json`에 남겼다.

## 검증 근거

- Native: 데이터 소유권·불변성·public types·selector/모듈 경계·공유 축·primitive/native 렌더링 비교·범례 배치·persistence를 검사한다.
- 앱: 추천 → 파라미터 빌더 → 실제 public call → Apply와 생성 코드 replay가 같은 그림을 만드는지 검사한다. Density 2×2 scale/normalization, Bike 가로 symlog, stat-reference 공유 scale, legend 증감, exact fit을 별도 회귀로 고정했다.
- 통계 의미: Income의 모든 지역×소득 구간을 `sum(pct × total) / sum(total)` 독립 산술과 비교했다. 일부 그룹의 가중치 합만 0인 4행 fixture로 잘못된 Weight 선택의 비활성화·대체 열 선택·bin 변경 후 유효성 회복을 검사했다. 최신 의미/예제 데이터 회귀는 11개가 통과했다.
- 패키지: 기존 installed-package consumer에 `authoring/radar-profile-summary`를 추가했다. 평균·중앙값의 고정 기대값, minmax 결과, 축 순서 변경, source 보존, persistence와 SVG/Canvas scene 생성을 검사한다. 초기 실행의 TypeScript fixture·번들 상한 실패를 수정한 뒤 최종 `npm run test:package`가 exit 0으로 완료됐다. 실제 설치 tarball에서 이 case를 포함한 Node runtime 182/182와 MCP·TypeScript·tutorial·Full/Basic/SVG bundle 검사가 모두 통과했다. 로그는 `output/audit-fixes/package-v002-final.log`, 해당 `ggaction-0.0.25.tgz`의 SHA256은 `340b02ea83da798ade780c08942aeaa71bb327d647659a947a05305f9f54e1f3`다. 이 해시는 위 지원 Node gzip 재측정 artifact와 같다. 패키지 설치·검증 성공과 npm 공개 배포 여부는 별개다.
- 실제 UI: 격리된 모의 계정으로 Apply·Undo/Redo·새로고침을 확인한다. Glass median/minmax Radar, Wine PCP Color=None, Iris ECDF 3개 그룹은 오류 없이 통과했다. Composition의 다중 데이터셋/overlay/facet/adjacent 검사는 별도 스크립트로 실행한다.
- [의미·수치 수정 상세](option-audit-2026-10-25-semantic-fixes.md), `test/parameter-owner-contracts.test.js`, `test/audit-guide-layout-regressions.test.js`, `test/audit-composition-fixes.test.js`, `scripts/audit-composition-fixes-2026-10-25.mjs`.

마지막 혼합 All 검증에서 발견한 Area의 opacity 공백도 기존 공개 `encodeOpacity`로 해결했다. 고정값과 series 내 일정한 필드값을 지원하며, 실제 worker 추천에서 facet Area·Line overlay·일반 Line을 하나의 공개 호출로 편집하는 앱 회귀 1개와 native 회귀 5개가 통과했다. PCP의 ordinal 축에서는 적용할 수 없는 tick count를 숨기고 수치 축으로 바꾸면 다시 제공한다. Numeric Line 집계는 임의 bin 없이 정확한 원값별 grain을 유지하며, 런타임과 TypeScript 모두 양쪽 축의 동시 집계를 거부한다. 이 축·소유자 집중 회귀 25개와 TypeScript consumer fixture 검증도 통과했으며, 최종 설치 패키지·전체 검사 결과와는 구분한다.

마지막 Iris UI 검사에서는 연속 색상을 가진 Scatter 위에 Line layer를 추가할 때, 관측값마다 다른 색상을 단일 경로에 그대로 상속해 기본 카드가 실패했다. 수정 후 원본 Scatter 색상은 보존하고 새 경로에는 호환되는 색상만 상속하며, Color·Group by를 직접 선택할 수 있다. 기본값·Single color·Color=Species·Group by=Species의 4개 미리보기와 Apply·Undo/Redo·저장·새로고침이 실제 UI에서 통과했다. 이어서 새로고침 후 Code가 30초 이상 비어 있는 별도 회귀도 확인했다. 계정 복원 중의 commit guard가 hover preview와 함께 Code 갱신까지 막던 원인을 고쳐, `showSnapshot`에서 확정 코드를 직접 복원한다. 최종 검사는 추가 포인터 이벤트 없이 `createScatterPlot`·`createLayerPlot`이 모두 표시됨을 확인했고, Code 244자·첫 페이지 카드 5개 준비·JavaScript 오류 0개를 기록했다. 이때 `1 / …`는 다음 페이지를 열 때 계산하는 전체 페이지 수이며 첫 페이지 로딩 중을 뜻하지 않는다. 실패 당시와 수정 후 결과를 구분한 회귀는 `scripts/test-path-layer-color-browser.js`, 최종 JSON·안정 상태 PNG는 `output/option-audit-2026-10-25/path-layer-color-final/`에 있다.

## 최종 릴리즈 후보 검증

| 검사 | 결과 |
| --- | --- |
| ggaction 전체 unit·contract·chart·gate·docs 검사 | 6,113 통과, 실패·생략 0 |
| 앱 전체 회귀 검사 | 661 통과, 124개 격리 프로세스 실패 0 |
| 실제 설치 패키지 | Node runtime 182/182, MCP·TypeScript·tutorial·browser bundle 모두 통과 |
| 프로덕션 빌드 | 통과, 배포 dependency pin과 실제 submodule 일치 |
| Cloud browser | 설정 누락·서비스 실패·재시도·모바일 화면 통과 |
| 계정 browser | 가입·로그인·동의·자동 저장·새 기기 복원·프로젝트 목록·복제·삭제·신고·토큰 갱신·로그아웃 격리 통과 |
| 차트 browser | 두 view mode의 Apply·코드 replay·Undo/Redo·재접속, 선택·글꼴·드래그·facet/concat 범례 편집 통과 |
| production dependency audit | 알려진 취약점 0 |

계정 browser 검사는 모의 Supabase transport를 사용한다. 실제 사용자 데이터나 인증 메일을 변경하지 않는다. 앞선 병렬 실행 중 호스트 정체로 끝난 timeout 결과는 성공으로 세지 않았으며, 위 수치는 최종 소스에서 다시 실행한 완료 로그 기준이다. `native-release-candidate.log`, `app-release-candidate.log`, `build-release-candidate.log`, `cloud-browser-release-candidate.log`, `cloud-auth-release-candidate.log`와 `dependency-audit-release-candidate.log`가 근거다. 새로고침 후 코드 표시 검증도 배포 CI의 계정 browser 검사에 추가했다.

앱 버전은 사용자 지정 `v0.0.2`, ggaction pin은 `36eb336f86bc4587b9363dc56d649417b9e43d0f`다. 라이브러리 커밋을 먼저 푸시하고 원격 SHA를 확인했다. [배포 workflow](https://github.com/ggaction/vis-autocomplete/actions/workflows/cloud.yml)는 네 개의 전체 회귀 shard, browser 검사, 실제 production Docker 기동을 다시 확인한 뒤에만 태그 커밋을 배포한다. 배포 후 live `/healthz`가 정확한 커밋을 반환해야 [v0.0.2 릴리즈](https://github.com/ggaction/vis-autocomplete/releases/tag/v0.0.2)와 dependency pin을 담은 `release-manifest.json`이 생성된다.

수치형 파라미터의 모든 실수 값, 모든 업로드 스키마, 모든 액션 순열을 전수 검사한 것은 아니다. 로그·PNG·프로젝트 덤프는 `output/audit-fixes/` 등에 두고 Git에서 제외한다.
