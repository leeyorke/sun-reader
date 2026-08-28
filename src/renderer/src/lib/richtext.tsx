/**
 * 正文行内富文本渲染
 *
 * EPUB 正文是主进程剥掉标签后的纯文本，部分由 Markdown 转换而来的书籍
 * （如 DDIA 中文版）会把 `[文字](链接)`、`**加粗**`、裸 URL 原样留在段落里。
 * 这里在渲染时把它们转换为友好样式：链接以主题色下划线展示、点击经主进程
 * openExternal 用系统浏览器打开；加粗还原为 <strong>。
 */

import * as React from 'react';

/** 依次匹配：markdown 链接 | markdown 加粗 | 裸 URL（排除常见中文尾随标点） */
const INLINE_RE =
  /(\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\))|(\*\*([^*\n]+)\*\*)|(https?:\/\/[^\s<>"'】」），。；：！？]+)/g;

function openExternal(url: string) {
  window.electronAPI?.app.openExternal(url).catch(() => {
    /* ignore */
  });
}

function LinkText({ text, url }: { text: string; url: string }) {
  return (
    <a
      data-ext-link
      href={url}
      title={`${text} · ${url}`}
      className="text-primary underline decoration-primary/40 underline-offset-2 break-all"
      onClick={(e) => {
        e.preventDefault();
        openExternal(url);
      }}
    >
      {text}
    </a>
  );
}

/** 把段落文本渲染为 React 节点数组；无匹配时返回单元素数组（原文） */
export function renderInlineMarkup(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));

    if (m[2] !== undefined && m[3] !== undefined) {
      // [文字](http url)
      nodes.push(<LinkText key={key++} text={m[2]} url={m[3]} />);
    } else if (m[5] !== undefined) {
      // **加粗**
      nodes.push(
        <strong key={key++} className="font-bold">
          {m[5]}
        </strong>
      );
    } else if (m[6] !== undefined) {
      // 裸 URL
      nodes.push(<LinkText key={key++} text={m[6]} url={m[6]} />);
    }

    last = idx + m[0].length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
