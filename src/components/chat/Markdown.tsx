'use client';

import { useState, ReactElement, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { Check, Copy, Eye, Code2, X } from 'lucide-react';

/* ---------------- code block with copy + live html preview ---------------- */

function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in (node as Record<string, unknown>)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    return extractText(el.props?.children);
  }
  return '';
}

function CodeBlock({ lang, raw, children }: { lang: string; raw: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);
  const isHtml = lang === 'html' || lang === 'svg';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = raw;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-950 last:mb-0">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-3 py-1.5">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          <Code2 className="h-3 w-3" />
          {lang}
        </span>
        <div className="flex items-center gap-1">
          {isHtml && (
            <button
              onClick={() => setPreview((p) => !p)}
              className="flex min-h-[28px] items-center gap-1 rounded-md px-2 py-1 text-[11px] text-amber-300 transition hover:bg-amber-500/10"
              aria-label="Toggle live preview"
            >
              <Eye className="h-3 w-3" />
              {preview ? 'Code' : 'Preview'}
            </button>
          )}
          <button
            onClick={copy}
            className="flex min-h-[28px] items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Copy code"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      {preview ? (
        <div>
          <div className="flex items-center justify-between border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
              <Eye className="h-3 w-3" />
              Live Preview — rendered result
            </span>
            <button
              onClick={() => setPreview(false)}
              className="flex min-h-[24px] items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-amber-200 transition hover:bg-amber-500/20"
              aria-label="Close live preview"
            >
              <X className="h-3 w-3" />
              Close
            </button>
          </div>
          <iframe
            title="Live preview"
            srcDoc={raw}
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            className="h-[420px] w-full bg-white"
          />
        </div>
      ) : (
        <pre className="max-w-full overflow-x-auto p-3 text-xs leading-relaxed text-zinc-200">
          {children}
        </pre>
      )}
    </div>
  );
}

/* ---------------- markdown ---------------- */

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body text-sm leading-relaxed break-words">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
          h1: ({ children }) => <h1 className="mb-2 text-base font-bold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 text-base font-bold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 text-sm font-bold">{children}</h3>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-red-400 underline underline-offset-2"
            >
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            <a href={typeof src === 'string' ? src : '#'} target="_blank" rel="noopener noreferrer">
              <img
                src={typeof src === 'string' ? src : ''}
                alt={alt ?? 'generated image'}
                loading="lazy"
                className="my-2 max-h-80 max-w-full rounded-xl border border-zinc-700/70 object-contain"
              />
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold text-red-300">{children}</strong>,
          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-2 border-red-500/60 pl-3 text-zinc-400">{children}</blockquote>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className ?? '') || String(children).includes('\n');
            if (isBlock) {
              return (
                <code className={`${className ?? ''} block font-mono text-xs leading-relaxed`} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-[0.8em] text-red-300" {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => {
            const el = children as ReactElement<{ className?: string; children?: ReactNode }>;
            const className: string = el?.props?.className ?? '';
            const lang = /language-(\w+)/.exec(className)?.[1] ?? 'text';
            const raw = extractText(el?.props?.children);
            return (
              <CodeBlock lang={lang} raw={raw}>
                {children}
              </CodeBlock>
            );
          },
          table: ({ children }) => (
            <div className="mb-2 max-w-full overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border border-zinc-700/70 px-2 py-1">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
