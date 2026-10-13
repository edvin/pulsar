/**
 * A small, safe Markdown: everything is escaped first, then **bold**, *italic*, `code`,
 * [links](https://…) (http/https/mailto only), "- " lists, "### " headings and paragraphs.
 * No raw HTML ever survives.
 */
import { esc } from './html.ts';

function inline(s: string): string {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_m, text: string, href: string) => `<a href="${href}" rel="nofollow noopener" target="_blank">${text}</a>`);
  // Bare links.
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, pre: string, href: string) => `${pre}<a href="${href}" rel="nofollow noopener" target="_blank">${href}</a>`);
  return out;
}

export function markdown(src: string): string {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = []; let list: string[] = [];
  const flush = () => {
    if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; }
    if (list.length) { out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`); list = []; }
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) { flush(); continue; }
    const li = /^[-*]\s+(.*)$/.exec(t);
    if (li) { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } list.push(li[1]!); continue; }
    const h = /^#{1,4}\s+(.*)$/.exec(t);
    if (h) { flush(); out.push(`<h4>${inline(h[1]!)}</h4>`); continue; }
    if (list.length) flush();
    para.push(t);
  }
  flush();
  return out.join('');
}

/** Markdown as plain text (feeds, Slack, webhooks). */
export const plain = (src: string) => String(src ?? '').replace(/\*\*|`/g, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/^#{1,4}\s+/gm, '');
