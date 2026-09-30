import { JSDOM } from 'jsdom';

const NOTE_SELECTOR = '.notes, .speaker-notes, [data-speaker-notes], .pv-script';
const BLOCKED = 'script, iframe, object, embed, form, input, button, textarea, select, meta, base, link, template';

export function splitNotes(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return null;
  if (/^---\s*$/m.test(normalized)) return normalized.split(/^---\s*$/m).map(s => s.trim());
  if (/^#{1,3}\s+(?:Slide\s+\d+|第\s*\d+\s*页)(?:\s.*)?$/im.test(normalized)) {
    const blocks = normalized.split(/^#{1,3}\s+(?:Slide\s+\d+|第\s*\d+\s*页)(?:[^\n]*)$/im);
    if (blocks[0].trim()) throw new Error("Put notes after the first # Slide 1 heading.");
    return blocks.slice(1).map(s => s.trim());
  }
  return [normalized];
}

export function importDeck({ html, notes = '', notesPages, title = '', width = 1200, height = 675 }) {
  if (typeof html !== 'string' || !html.trim()) throw new Error("Upload an HTML slide file.");
  if (Buffer.byteLength(html) > 6 * 1024 * 1024) throw new Error("HTML files must be under 6 MB.");
  if (typeof notes !== 'string' || notes.length > 500000) throw new Error("Notes must be under 500,000 characters.");
  width = Number(width); height = Number(height);
  if (![width, height].every(n => Number.isInteger(n) && n >= 200 && n <= 4000)) throw new Error("Slide dimensions must be integers from 200 to 4000.");
  // jsdom does not execute scripts or load remote resources here.
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document;
    let slides = [];
    let format = '';
    for (const selector of ['[data-lecture-slide]', '[data-slide]', '.reveal .slides section', '.slide']) {
      const found = [...doc.querySelectorAll(selector)].filter(el => !el.querySelector(selector));
      if (found.length) { slides = found; format = selector; break; }
    }
    if (!slides.length) throw new Error("No slides found. Use .slide, data-slide, data-lecture-slide or Reveal.js sections.");
    if (slides.length > 120) throw new Error('A presentation can have up to 120 slides.');
    const embeddedNotes = slides.map(slide => {
      const inner = slide.querySelector(NOTE_SELECTOR);
      const sibling = slide.nextElementSibling?.matches(NOTE_SELECTOR) ? slide.nextElementSibling : slide.parentElement?.nextElementSibling;
      const source = inner || (sibling?.matches(NOTE_SELECTOR) ? sibling : null);
      if (!source) return '';
      const copy = source.cloneNode(true);
      copy.querySelectorAll('.nlabel, script, style').forEach(el => el.remove());
      copy.querySelectorAll('p, li, h1, h2, h3, br').forEach(el => el.after(doc.createTextNode('\n\n')));
      return copy.textContent.trim();
    });
    if (notesPages !== undefined && (!Array.isArray(notesPages) || notesPages.some(n => typeof n !== 'string') || notesPages.join('').length > 500000)) throw new Error("Invalid slide notes or more than 500,000 characters.");
    const scripts = notesPages || splitNotes(notes) || embeddedNotes;
    if (scripts.length !== slides.length) throw new Error(`Found ${slides.length} slides but ${scripts.length} note sections. Separate each page with --- on its own line, including empty pages.`);
    const css = [...doc.querySelectorAll('style')].map(el => el.textContent).join('\n');
    const warnings = ['Imported as static pages. JavaScript, interactive animations and embedded players will not run.'];
    if (doc.querySelector('link[rel="stylesheet"]')) warnings.push('External CSS detected. Inline styles in the HTML; external stylesheets are not loaded.');
    const relative = [...doc.querySelectorAll('[src]')].some(el => !/^(?:data:|https:\/\/)/i.test(el.getAttribute('src')));
    if (relative || /url\(\s*['"]?(?!data:|https:|#)[^)]/i.test(css)) warnings.push("Relative assets detected. Embed images and fonts as data URLs or use public HTTPS URLs.");
    if (format.includes('reveal')) warnings.push("Reveal.js nested slides are flattened and fragments are shown. Check the preview and slide size.");
    const titleText = String(title || doc.title || 'Untitled presentation').slice(0, 150);
    const cleanSlides = slides.map((slide, index) => {
      const cloned = slide.cloneNode(true);
      cloned.querySelectorAll(NOTE_SELECTOR).forEach(el => el.remove());
      cloned.querySelectorAll(BLOCKED).forEach(el => el.remove());
      for (const el of [cloned, ...cloned.querySelectorAll('*')]) {
        for (const attr of [...el.attributes]) {
          if (/^on/i.test(attr.name) || /notes|script|srcdoc/i.test(attr.name) || ['contenteditable', 'autofocus', 'formaction'].includes(attr.name)) el.removeAttribute(attr.name);
          if (['href', 'xlink:href'].includes(attr.name) && !attr.value.startsWith('#')) el.removeAttribute(attr.name);
          if (['src', 'poster'].includes(attr.name) && !/^(?:data:image\/|https:\/\/)/i.test(attr.value)) el.removeAttribute(attr.name);
        }
      }
      const walker = doc.createTreeWalker(cloned, dom.window.NodeFilter.SHOW_COMMENT);
      const comments = []; while (walker.nextNode()) comments.push(walker.currentNode);
      comments.forEach(el => el.remove());
      cloned.classList.add('slidelink-page');
      cloned.removeAttribute('hidden');
      return { html: cloned.outerHTML, title: (cloned.querySelector('h1,h2,h3')?.textContent || `Slide ${index + 1}`).trim().slice(0, 160) };
    });
    return { title: titleText, width, height, css, slides: cleanSlides, notes: scripts, warnings, format };
  } finally { dom.window.close(); }
}
