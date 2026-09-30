import { JSDOM } from 'jsdom';

const NOTE_SELECTOR = '.notes, .speaker-notes, [data-speaker-notes], .pv-script';
const BLOCKED = 'script, iframe, object, embed, form, input, button, textarea, select, meta, base, link, template';

export function splitNotes(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return null;
  if (/^---\s*$/m.test(normalized)) return normalized.split(/^---\s*$/m).map(s => s.trim());
  if (/^#{1,3}\s+(?:Slide\s+\d+|第\s*\d+\s*页)(?:\s.*)?$/im.test(normalized)) {
    const blocks = normalized.split(/^#{1,3}\s+(?:Slide\s+\d+|第\s*\d+\s*页)(?:[^\n]*)$/im);
    if (blocks[0].trim()) throw new Error('请把讲稿内容放在第一个“# Slide 1”标题之后。');
    return blocks.slice(1).map(s => s.trim());
  }
  return [normalized];
}

export function importDeck({ html, notes = '', notesPages, title = '', width = 1200, height = 675 }) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('请上传一个 HTML slide 文件。');
  if (Buffer.byteLength(html) > 6 * 1024 * 1024) throw new Error('HTML 文件不能超过 6 MB。');
  if (typeof notes !== 'string' || notes.length > 500000) throw new Error('讲稿不能超过 50 万字。');
  width = Number(width); height = Number(height);
  if (![width, height].every(n => Number.isInteger(n) && n >= 200 && n <= 4000)) throw new Error('画布宽高须为 200–4000 的整数。');
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
    if (!slides.length) throw new Error('未找到分页。每页需使用 .slide、data-slide、data-lecture-slide 或 Reveal.js section。');
    if (slides.length > 120) throw new Error('第一版每份演示最多支持 120 页。');
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
    if (notesPages !== undefined && (!Array.isArray(notesPages) || notesPages.some(n => typeof n !== 'string') || notesPages.join('').length > 500000)) throw new Error('逐页讲稿格式不正确，或超过 50 万字。');
    const scripts = notesPages || splitNotes(notes) || embeddedNotes;
    if (scripts.length !== slides.length) throw new Error(`识别到 ${slides.length} 页 slides，但讲稿分成了 ${scripts.length} 页。请用单独一行 --- 分隔每一页（无稿页也保留空白段）。`);
    const css = [...doc.querySelectorAll('style')].map(el => el.textContent).join('\n');
    const warnings = ['以静态页面导入：上传 HTML 中的 JavaScript、交互动画和内嵌播放器不会运行。'];
    if (doc.querySelector('link[rel="stylesheet"]')) warnings.push('检测到外部 CSS；请先把 CSS 内联到 HTML 中，当前版本不加载外链样式表。');
    const relative = [...doc.querySelectorAll('[src]')].some(el => !/^(?:data:|https:\/\/)/i.test(el.getAttribute('src')));
    if (relative || /url\(\s*['"]?(?!data:|https:|#)[^)]/i.test(css)) warnings.push('检测到相对资源路径；图片和字体应内嵌为 data URL，或使用公开 HTTPS 地址。');
    if (format.includes('reveal')) warnings.push('Reveal.js 的嵌套页会展开成线性页序，fragment 全部显示；请检查预览及画布尺寸。');
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
