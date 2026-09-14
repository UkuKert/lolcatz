import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Can I Haz Kubernetes",
  description: "4chan-style image board on Kubernetes",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #ffffee; color: #800000; font-family: arial, helvetica, sans-serif; font-size: 13px; }
          header { background: #af0a0f; color: white; padding: 8px 16px; display: flex; align-items: center; gap: 16px; }
          header h1 { font-size: 18px; }
          nav a { color: white; text-decoration: none; margin-right: 12px; }
          nav a:hover { text-decoration: underline; }
          main { padding: 16px; }
          .board-nav { background: #d6daf0; padding: 4px 8px; margin-bottom: 8px; }
          .board-nav a { color: #34345c; margin: 0 4px; }
          .post { border: 1px solid #d9bfb7; background: #f0e0d6; margin: 8px 0; padding: 8px; display: inline-block; max-width: 250px; vertical-align: top; margin-right: 8px; }
          .post img { max-width: 200px; max-height: 200px; display: block; margin-bottom: 4px; cursor: pointer; }
          .post .title { font-weight: bold; color: #0f0c5d; }
          .post .tags { color: #800000; font-size: 11px; margin-top: 4px; }
          .post .meta { color: #666; font-size: 11px; }
          .upload-form { background: #d6daf0; border: 1px solid #b7c5d9; padding: 12px; margin-bottom: 16px; max-width: 500px; }
          .upload-form h2 { margin-bottom: 8px; color: #34345c; }
          .upload-form input, .upload-form select, .upload-form textarea { display: block; margin: 4px 0 8px; width: 100%; padding: 4px; border: 1px solid #aaa; }
          .upload-form button { background: #af0a0f; color: white; border: none; padding: 6px 16px; cursor: pointer; }
          .thread { border: 1px solid #d9bfb7; background: #f0e0d6; padding: 12px; margin: 12px 0; }
          .thread img { max-width: 300px; float: left; margin-right: 12px; }
          .reply { background: #d6daf0; border: 1px solid #b7c5d9; margin: 8px 0; padding: 8px; clear: left; }
          .search-bar { margin-bottom: 12px; display: flex; gap: 8px; }
          .search-bar input { padding: 4px; border: 1px solid #aaa; flex: 1; }
          .search-bar button { background: #af0a0f; color: white; border: none; padding: 4px 12px; cursor: pointer; }
        `}</style>
      </head>
      <body>
        <header>
          <h1>🐱 Can I Haz Kubernetes</h1>
          <nav>
            {["b","g","k","a","mu","v"].map(b => (
              <a key={b} href={`/board/${b}`}>/{b}/</a>
            ))}
            <a href="/search">Search</a>
          </nav>
        </header>
        <div className="board-nav">
          [<a href="/">Home</a>] — imageboard powered by Kubernetes
        </div>
        <main>{children}</main>
      </body>
    </html>
  );
}
