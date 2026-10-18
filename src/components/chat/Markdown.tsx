'use client';

import ReactMarkdown from 'react-markdown';

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
          pre: ({ children }) => (
            <pre className="mb-2 max-w-full overflow-x-auto rounded-xl border border-zinc-700/70 bg-zinc-950 p-3 text-xs text-zinc-200 last:mb-0">
              {children}
            </pre>
          ),
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
