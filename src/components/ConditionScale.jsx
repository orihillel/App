import { COLORS } from '../lib/colors.js';

// A labeled, color-coded POOR→FAIR→GOOD→FIRING scale with a marker at the exact score
// position — same continuous score the globe's gradient uses, just shown as a bar instead
// of a hue. Reused on the home hero and in the globe's legend so both speak the same visual
// language instead of the globe using a gradient and the home page using a flat text badge.
export function ConditionScale({ score, compact }) {
  const hasScore = score != null && Number.isFinite(score);
  const t = Math.max(0, Math.min(1, ((hasScore ? score : 0) + 5) / 15));
  const segments = [
    { label: 'POOR', color: COLORS.poor },
    { label: 'FAIR', color: COLORS.gold },
    { label: 'GOOD', color: COLORS.teal },
    { label: 'FIRING', color: COLORS.tealBright },
  ];
  return (
    <div>
      <div style={{ display: 'flex', height: compact ? 5 : 6, borderRadius: 3, overflow: 'visible', position: 'relative' }}>
        {segments.map((s, i) => (
          <div key={s.label} style={{ flex: 1, background: s.color, borderRadius: i === 0 ? '3px 0 0 3px' : i === segments.length - 1 ? '0 3px 3px 0' : 0 }} />
        ))}
        {hasScore && (
          <div style={{ position: 'absolute', left: (t * 100) + '%', top: -3, width: 2, height: (compact ? 5 : 6) + 6, background: COLORS.foam, borderRadius: 1, transform: 'translateX(-1px)', boxShadow: '0 0 0 1px rgba(7,15,24,0.6)' }} />
        )}
      </div>
      {!compact && (
        <div className="flex justify-between" style={{ marginTop: 4 }}>
          {segments.map((s) => (
            <span key={s.label} style={{ fontSize: 8.5, color: COLORS.foamDim, letterSpacing: '0.03em' }}>{s.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}
