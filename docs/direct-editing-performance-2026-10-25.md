# Direct editing performance — 2026-10-25

드래그·글꼴 크기 변경의 메인 스레드 정지를 줄였다. 추천, 실시간 Canvas/코드 갱신,
드래그 중 옵션 섬네일 갱신, 실제 ggaction 호출, History와 저장 복원은 유지한다.

## 확인한 병목과 변경

- Worker 결과마다 현재 native 상태 전체를 JSON으로 읽고 검증한 다음,
  trace를 연결하며 다시 복제했다. 1,200행·6개 facet의 글꼴 변경 3회와 범례 드래그
  프로파일에서 `unpackProgramUpdate`의 누적 CPU 시간이 약 462ms였다.
- 내부 메시지를 불변 상태의 참조와 새 노드로 전송한다. facet 재생성으로 객체는
  새로 만들어졌어도 값이 동일한 데이터·그래픽은 기준 상태의 해당 경로를 재사용한다.
  참조는 객체 일련번호가 아닌 경로이므로 디스크에서 복원한 동일 상태에도 적용된다.
- UI의 새 노드 복원은 native immutable utility로 아래부터 소유권을 확정하고,
  약 4ms마다 입력·화면 갱신에 실행 기회를 준다. 완성 전 상태는 UI에 노출하지 않는다.
  공개 프로젝트 파일은 기존 persistence API와 검증을 그대로 사용한다.
- Typography 결과를 Worker에 다음 상태로 보관한다. 다른 Worker도 완성된 가이드
  상태를 받아서 이어가며 같은 작업을 다시 실행하지 않는다.
- 빠른 `+/-` 입력은 각 클릭과 크기 상한/하한을 보존하면서 한 번의 계산으로 합친다.
  같은 축·범례·제목의 여러 텍스트 역할은 하나의 native 편집으로 묶어 레이아웃 계산을 줄인다.
- 드래그 도중 조작 핸들 DOM을 재생성하지 않는다. 같은 native 상태의 조작 대상·경계와
  밑줄 좌표는 재사용한다. 범례/제목 드래그의 Canvas 래스터 밀도도 해제 전까지 유지한다.

## 비교 측정

macOS, headless Chrome, 1800×1200, DPR 1, Transition mode. 동일한 1,200행 데이터로
일반 산점도, 6개 facet, 2개 병치 차트를 만들고 전체 글꼴 크기 16→17→18 및 범례
모서리 40단계 드래그를 실행했다. 변경 전은 `26ea207`이다.

| 차트 | 최장 프레임 간격: 전 → 후 | 50ms 이상 메인 스레드 작업: 전 → 후 | 해당 작업 합계: 전 → 후 |
|---|---:|---:|---:|
| 산점도 | 16.8 → 16.8ms | 0 → 0 | 0 → 0ms |
| 6개 facet | 200.0 → 66.6ms | 6 → 0 | 786 → 0ms |
| 2개 병치 | 83.3 → 50.0ms | 4 → 0 | 308 → 0ms |

수치는 한 번의 동일 시나리오 비교이며 환경에 따라 달라진다. 프레임 간격과 Long Task는
다른 측정값이다. 여러 짧은 작업·레이아웃·paint가 겹치면 50ms 이상 작업이 없어도
프레임 간격이 길어질 수 있다. 모든 차트의 60fps를 보장하는 결과는 아니다.
원시 비교 자료는 로컬 `output/interaction-performance/dense-baseline.json`과
`dense-verified.json`, CPU 프로파일에 남겼다(생성물은 Git 제외).

## 회귀 검증과 재현

- native 상태·메시지·글꼴·가이드·병치 편집 69개 테스트 통과.
- 프로젝트/History/캔버스 resize/벡터 투영/섬네일 관련 34개 테스트 통과.
- 두 모드 × 일반/facet/병치의 글꼴·그룹 밑줄·Undo/Redo·저장/새로고침 6개 시나리오 통과.
- 같은 6개 조합에서 범례/제목/축 제목 미세 이동·도킹·History 합치기·복원 통과.
- 추가 밀집 차트 테스트는 빠른 `+` 4회를 한 Worker 작업으로 처리하고,
  드래그 중 핸들 유지·실제 Canvas 갱신·옵션 섬네일 갱신을 검증한다.
  Transition DPR 1 및 Preview DPR 2, 각각 3개 차트에서 통과했다.
  Plot resize는 글꼴/범례 편집을 Undo한 원래 상태에서 실제 확정까지 검사한다.

서버가 실행된 상태에서:

```sh
python test/browser/direct-editing-performance.py
PERF_MODE=preview PERF_DPI=2 python test/browser/direct-editing-performance.py
python test/browser/chart-typography.py
python test/browser/guide-position.py
```

Python 환경에 Playwright가 필요하다. 성능 테스트는 시간을 기기별 통과 조건으로
사용하지 않고 `output/direct-editing-performance/`에 측정값·스크린샷을 기록한다.
1,200행 병치의 여러 텍스트 역할을 동시에 편집할 때 native 계산·메시지 왕복은 여전히
약 0.5–0.8초 걸릴 수 있다. 이 비용은 Worker에서 처리하고, 입력/UI를 길게 막는
복원 작업을 없애는 것이 이번 변경의 핵심이다.

별도 확인 사항: 전체 텍스트를 22px로 키운 6개 facet에서 범례를 확대한 뒤 plot을
늘리면 native facet header 공간 검사가 거절하는 경우가 있다. 변경 전 `26ea207`
번들에서도 같은 순서로 재현했다. 이 기존 레이아웃 제약은 이번 성능 수정으로 해결된
것으로 집계하지 않았다. 재현 자료: 로컬 `output/interaction-performance/header-baseline.py`.
