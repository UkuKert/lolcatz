import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SafeMarkdown } from "../app/safe-markdown";

const render = (text: string) => renderToStaticMarkup(<SafeMarkdown>{text}</SafeMarkdown>);

test("formats Markdown and makes explicit and bare links safe new-tab links", () => {
  const html = render("# Heading\n\n**bold** and *italic*\n\n- item\n\n[link](https://example.com) and https://example.org\n\n```js\n<unsafe>\n```");
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<li>item<\/li>/);
  assert.equal((html.match(/target="_blank" rel="noopener noreferrer"/g) || []).length, 2);
  assert.match(html, /&lt;unsafe&gt;/);
});

test("discards executable HTML, embeds, images, and unsafe links", () => {
  const html = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert) [data](data:text/html,boom) [encoded](jav&#x61;script:alert)\n\n![tracking](https://example.com/pixel)\n\n<iframe src="https://example.com"></iframe>');
  assert.doesNotMatch(html, /<script|<img|<iframe|onerror=|href=|javascript:|data:text/);
});
