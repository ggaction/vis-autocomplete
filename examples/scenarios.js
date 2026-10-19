import { chart } from 'ggaction';

// Small synthetic data for explaining each authoring step; NEVER training data.
export const cars = [
  { Horsepower: 80, Miles_per_Gallon: 34, Weight: 2100, Origin: 'Japan', Cylinders: 4 },
  { Horsepower: 95, Miles_per_Gallon: 30, Weight: 2300, Origin: 'Europe', Cylinders: 4 },
  { Horsepower: 110, Miles_per_Gallon: 27, Weight: 2600, Origin: 'USA', Cylinders: 6 },
  { Horsepower: 120, Miles_per_Gallon: 25, Weight: 2750, Origin: 'Japan', Cylinders: 6 },
  { Horsepower: 135, Miles_per_Gallon: 24, Weight: 3000, Origin: 'Europe', Cylinders: 6 },
  { Horsepower: 150, Miles_per_Gallon: 20, Weight: 3300, Origin: 'USA', Cylinders: 8 },
  { Horsepower: 165, Miles_per_Gallon: 18, Weight: 3500, Origin: 'Japan', Cylinders: 8 },
  { Horsepower: 180, Miles_per_Gallon: 16, Weight: 3800, Origin: 'USA', Cylinders: 8 },
  { Horsepower: 105, Miles_per_Gallon: 29, Weight: 2450, Origin: 'Japan', Cylinders: 4 },
  { Horsepower: 140, Miles_per_Gallon: 22, Weight: 3100, Origin: 'Europe', Cylinders: 6 },
  { Horsepower: 155, Miles_per_Gallon: 21, Weight: 3350, Origin: 'USA', Cylinders: 8 },
  { Horsepower: 90, Miles_per_Gallon: 32, Weight: 2200, Origin: 'Europe', Cylinders: 4 },
];

export function makeScenarios() {
  const data = chart().createCanvas({ width: 700, height: 450,
    margin: { left: 80, right: 180, top: 45, bottom: 70 } }).createData({ id: 'cars', values: cars });
  const points = data.createPointMark({ id: 'points' });
  const x = points.encodeX({ target: 'points', field: 'Horsepower', fieldType: 'quantitative' });
  const xy = x.encodeY({ target: 'points', field: 'Miles_per_Gallon', fieldType: 'quantitative' });
  const colored = xy.encodeColor({ target: 'points', field: 'Origin', fieldType: 'nominal' });
  const bars = data.createBarMark({ id: 'bars' })
    .encodeX({ target: 'bars', field: 'Origin', fieldType: 'nominal' })
    .encodeY({ target: 'bars', field: 'Miles_per_Gallon', aggregate: 'mean' });
  return [
    { id: '01-data-only', label: '데이터만 있는 상태', program: data },
    { id: '02-point-mark', label: '점 마크만 만든 상태', program: points },
    { id: '03-x-only', label: 'x축까지 설정한 상태', program: x },
    { id: '04-scatter', label: 'x/y 산점도', program: xy },
    { id: '05-colored', label: '색상이 있는 산점도', program: colored },
    { id: '06-bars', label: '그룹별 평균 막대 차트', program: bars },
  ];
}
