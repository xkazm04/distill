// The worm: the condenser coil from the wordmark, as a decorative line. A prolate trochoid (a point on a rolling wheel
// further out than its rim) draws a spring seen from the side; each turn is one loop.
const ADVANCE = 7; // wheel radius: how far the coil moves along per radian
const LOOP = 15;   // arm length: how tall each loop is (> ADVANCE, so it loops)

function coilPath(turns: number): { d: string; width: number; height: number } {
  const end = turns * 2 * Math.PI;
  const pts: string[] = [];
  for (let t = 0; t <= end + 1e-6; t += 0.12) {
    const x = ADVANCE * t - LOOP * Math.sin(t) + LOOP;
    const y = LOOP - LOOP * Math.cos(t) + 2;
    pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return { d: `M${pts.join("L")}`, width: ADVANCE * end + 2 * LOOP, height: 2 * LOOP + 4 };
}

/** `fill`: keep the loop height and run as far as the box is wide (extra turns are clipped), instead of shrinking. */
export function Coil({ turns = 6, className, fill = false }: { turns?: number; className?: string; fill?: boolean }) {
  const { d, width, height } = coilPath(turns);
  return (
    <svg className={`coil ${className ?? ""}`} viewBox={`0 0 ${width.toFixed(0)} ${height}`} preserveAspectRatio={fill ? "xMinYMid slice" : "xMidYMid meet"} aria-hidden="true" focusable="false">
      <path d={d} pathLength={1} />
    </svg>
  );
}
