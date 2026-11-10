import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

/**
 * عارض موحّد لنصوص الذكاء الاصطناعي.
 * Markdown يُحوَّل إلى عناصر حقيقية (عناوين، قوائم، عريض، جداول، معادلات)
 * بدل إزالة الرموز يدويًا أو عرضها كما هي.
 */
const components: Components = {
  h1: ({ children }) => <h1 className="md-heading md-h1">{children}</h1>,
  h2: ({ children }) => <h2 className="md-heading md-h2">{children}</h2>,
  h3: ({ children }) => <h3 className="md-heading md-h3">{children}</h3>,
  h4: ({ children }) => <h4 className="md-heading md-h4">{children}</h4>,
  h5: ({ children }) => <h5 className="md-heading md-h5">{children}</h5>,
  h6: ({ children }) => <h6 className="md-heading md-h6">{children}</h6>,
  p: ({ children }) => <p className="md-paragraph">{children}</p>,
  strong: ({ children }) => <strong className="md-strong">{children}</strong>,
  em: ({ children }) => <em className="md-em">{children}</em>,
  ul: ({ children }) => <ul className="md-list md-ul">{children}</ul>,
  ol: ({ children }) => <ol className="md-list md-ol">{children}</ol>,
  li: ({ children }) => <li className="md-list-item">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="md-note">
      <span className="md-note-mark" aria-hidden="true">
        ملاحظة
      </span>
      {children}
    </blockquote>
  ),
  hr: () => <hr className="md-rule" />,
  a: ({ href, children }) => (
    <a className="md-link" href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="md-table-wrap">
      <table className="md-table">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="md-th">{children}</th>,
  td: ({ children }) => <td className="md-td">{children}</td>,
  pre: ({ children }) => <pre className="md-pre">{children}</pre>,
  code: ({ className, children }) => {
    const block = Boolean(className?.includes('language-'));
    return <code className={block ? 'md-code-block' : 'md-inline-code'}>{children}</code>;
  },
  input: ({ type, checked }) => (
    <input className="md-checkbox" type={type} checked={checked} readOnly />
  ),
};

export function MarkdownText({
  content,
  className = '',
  compact = false,
  ariaLabel,
}: {
  content: string;
  className?: string;
  compact?: boolean;
  ariaLabel?: string;
}) {
  if (!content?.trim()) return null;
  return (
    <div
      dir="rtl"
      className={`markdown-body${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}
      aria-label={ariaLabel}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
