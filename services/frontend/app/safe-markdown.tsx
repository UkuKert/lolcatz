import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Raw HTML is discarded. Only web links are allowed, including GFM autolinks;
// remote images, embeds and executable URLs cannot become active elements.
export function SafeMarkdown({ children }: { children: string }) {
  return <div className="post-markdown"><Markdown
    remarkPlugins={[remarkGfm]}
    skipHtml
    allowedElements={["p", "br", "strong", "em", "del", "a", "code", "pre", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "table", "thead", "tbody", "tr", "th", "td"]}
    urlTransform={value => {
      try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.href : "";
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        return "";
      }
    }}
    components={{ a: ({ href, children }) => href
      ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      : <>{children}</> }}
  >{children}</Markdown></div>;
}
