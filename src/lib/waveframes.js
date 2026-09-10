// A frame of the animated swell week, as a person would say it.
//
// The build anchors its frames to UTC six-hourly boundaries, because every device animating the
// same build has to step through the same instants. Nobody checks a forecast in UTC, though, so
// what the label says is the reader's own clock: "Thu 3pm" is a time you can be at the beach
// for, "2026-09-12T21:00" is a timestamp.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function frameLabel(iso, now = null) {
  if (typeof iso !== 'string' || !iso) return '';
  // The build writes "YYYY-MM-DDTHH:MM" with no zone, and it means UTC. Appending the Z is what
  // makes the Date honour that rather than reading it as local time -- which would be silently
  // wrong by the viewer's own offset, and correct only in London.
  const d = new Date(/[Zz]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const hour = (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'am' : 'pm');
  // "Today"/"Tomorrow" where they apply, because a day name three days out is useful and a day
  // name for this afternoon is a small puzzle.
  if (now) {
    const ref = new Date(now);
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const tomorrow = new Date(ref.getTime() + 24 * 3600e3);
    if (sameDay(d, ref)) return 'Today ' + hour;
    if (sameDay(d, tomorrow)) return 'Tomorrow ' + hour;
  }
  return DAYS[d.getDay()] + ' ' + hour;
}
