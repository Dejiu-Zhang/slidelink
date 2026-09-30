// Private note marks are anchored to text, not a percentage of the scroll area.
export const emptyNotesInk = () => ({ v: 1, pages: {} });

export function remapStrokes(strokes, before, after) {
  if (before === after) return strokes;
  let start = 0, end = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  while (end < Math.min(before.length, after.length) - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const removedEnd = before.length - end, delta = after.length - before.length;
  // Marks on replaced words are discarded; unaffected text keeps its marks.
  return strokes.filter(s => s.points.every(p => p.a < 0 || p.a < start || p.a >= removedEnd)).map(s => ({
    ...s, points: s.points.map(p => ({ ...p, a: p.a >= removedEnd && p.a >= 0 ? p.a + delta : p.a }))
  }));
}

export function validateNotesInk(value, notes) {
  if (value === undefined) return emptyNotesInk();
  const fail = () => { throw new Error('Invalid note annotations or annotation limit exceeded.'); };
  if (!value || value.v !== 1 || !value.pages || typeof value.pages !== 'object' || Array.isArray(value.pages)) fail();
  if (JSON.stringify(value).length > 4000000) fail();
  const result = emptyNotesInk();
  let pointCount = 0, strokeCount = 0;
  for (const [page, data] of Object.entries(value.pages)) {
    if (!/^(0|[1-9]\d*)$/.test(page) || +page >= notes.length || !data || data.text !== notes[+page] || !Array.isArray(data.strokes)) fail();
    const strokes = data.strokes.map(s => {
      if (!s || !['r','b','k','h'].includes(s.tool) || !Number.isFinite(s.width) || s.width < .5 || s.width > 80 || typeof s.pressure !== 'boolean' || !Array.isArray(s.points) || !s.points.length || s.points.length > 10000) fail();
      if (++strokeCount > 2000) fail();
      const points = s.points.map(p => {
        if (++pointCount > 50000 || !p || !Number.isInteger(p.a) || p.a < -1 || p.a >= Math.max(1, data.text.length) || ![p.x,p.y,p.p].every(Number.isFinite) || Math.abs(p.x) > 100000 || Math.abs(p.y) > 100000 || p.p < 0 || p.p > 1) fail();
        return { a:p.a, x:p.x, y:p.y, p:p.p };
      });
      return { tool:s.tool, width:s.width, pressure:s.pressure, points };
    });
    if (strokes.length) result.pages[page] = { text:data.text, strokes };
  }
  return result;
}
