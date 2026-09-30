export function slideDocument(deck, index) {
  const css = deck.css.replace(/<\/style/gi, '<\\/style');
  const isReveal = deck.format?.includes('reveal');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:; base-uri 'none'; form-action 'none'"><style>${css}</style><style>
  html,body{margin:0!important;padding:0!important;width:${deck.width}px!important;height:${deck.height}px!important;overflow:hidden!important;background:#fff}
  .slidelink-page{width:${deck.width}px!important;height:${deck.height}px!important;max-width:none!important;max-height:none!important;min-height:0!important;margin:0!important;box-sizing:border-box!important;position:relative!important;left:0!important;top:0!important;transform:none!important;opacity:1!important;visibility:visible!important;animation:none!important;transition:none!important}
  .fragment{opacity:1!important;visibility:visible!important;transform:none!important}
  .notes,.speaker-notes,[data-speaker-notes]{display:none!important}
  </style></head><body>${isReveal ? '<div class="reveal"><div class="slides" style="position:static;transform:none;width:100%;height:100%">' : ''}${deck.slides[index].html}${isReveal ? '</div></div>' : ''}</body></html>`;
}

export function fitSlide(box, viewport, deck) {
  const scale = Math.min(viewport.clientWidth / deck.width, viewport.clientHeight / deck.height);
  box.style.width = `${deck.width}px`; box.style.height = `${deck.height}px`;
  box.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const input = document.createElement('textarea'); input.value = text;
    document.body.append(input); input.select(); const ok = document.execCommand('copy'); input.remove(); return ok;
  }
}
