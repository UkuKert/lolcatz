import type { Metadata } from "next";
import { Providers } from "./providers";
import { AuthStatus } from "./auth-status";
import { Tagline } from "./tagline";
import { Navigation } from "./navigation";

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
          body { min-height: 100vh; background: radial-gradient(circle at top, #fff8e7 0, #f7eadf 48%, #eadbd2 100%); color: #651c20; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
          header { background: linear-gradient(115deg, #8f0710, #c51e2c 55%, #ef6a3a); color: white; padding: 13px max(18px, calc((100vw - 1200px) / 2)); display: flex; align-items: center; gap: 24px; box-shadow: 0 5px 20px rgba(79, 8, 15, .25); }
          header h1 { font-size: 18px; white-space: nowrap; }
          header h1 a { color: white; text-decoration: none; }
          nav { display: flex; flex-wrap: wrap; gap: 12px; }
          nav a { color: white; text-decoration: none; padding: 4px 7px; border-radius: 6px; transition: background .15s ease, transform .15s ease; }
          nav a:hover { text-decoration: underline; }
          nav a.active { background: white; color: #af0a0f; font-weight: bold; box-shadow: 0 2px 8px rgba(63, 0, 5, .18); }
          .auth-status { margin-left: auto; color: white; font-size: 12px; display: flex; align-items: center; gap: 10px; }
          .auth-status > a { color: white; }
          .auth-status button, .auth-button { background: transparent; color: white; border: 1px solid rgba(255,255,255,.75); padding: 3px 8px; cursor: pointer; }
          .auth-status button { border: 0; padding: 0; text-decoration: underline; }
          .profile-link { color: white; display: flex; align-items: center; gap: 7px; text-decoration: none; }
          .profile-link img { width: 28px; height: 28px; border-radius: 50%; border: 1px solid rgba(255,255,255,.75); }
          .auth-button { margin-left: auto; }
          main { padding: 28px 18px; max-width: 1200px; margin: 0 auto; }
          .board-nav { background: rgba(255,255,255,.72); backdrop-filter: blur(8px); padding: 7px max(18px, calc((100vw - 1200px) / 2)); border-bottom: 1px solid rgba(128,0,0,.12); box-shadow: 0 2px 8px rgba(80,30,20,.06); display: flex; align-items: center; gap: 4px; }
          .board-nav a { color: #34345c; margin: 0 4px; }
          .source-link { margin-left: auto !important; }
          .tagline { font-style: italic; }
          .post { width: 222px; border: 1px solid rgba(137,78,67,.22); border-radius: 10px; background: rgba(255,255,255,.68); margin: 8px 8px 8px 0; padding: 10px; display: inline-block; vertical-align: top; box-shadow: 0 4px 14px rgba(74,35,27,.09); transition: transform .15s ease, box-shadow .15s ease; }
          .post:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(74,35,27,.14); }
          .post > a:first-child { display: block; width: 200px; height: 200px; margin-bottom: 4px; overflow: hidden; border-radius: 6px; background: rgba(137,78,67,.1); }
          .post > a:first-child img { width: 100%; height: 100%; display: block; object-fit: cover; cursor: pointer; }
          .post .title { font-weight: bold; color: #0f0c5d; }
          .tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
          .tag-badge { display: inline-flex; align-items: center; width: fit-content; padding: 2px 7px; color: #8f0710; background: #fae1da; border: 1px solid rgba(143,7,16,.18); border-radius: 999px; font-size: 11px; font-weight: 700; line-height: 1.4; text-decoration: none; box-shadow: 0 1px 2px rgba(89,18,16,.06); }
          a.tag-badge:hover { color: white; background: #af0a0f; border-color: #af0a0f; }
          .active-tag-filter { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; }
          .map-badge { display: inline-flex; align-items: center; width: fit-content; margin-top: 7px; padding: 3px 8px; color: #245b4b; background: #dff2e9; border: 1px solid rgba(36,91,75,.2); border-radius: 999px; font-size: 11px; font-weight: 700; text-decoration: none; }
          .map-badge:hover { color: white; background: #28735d; }
          .exif-details { max-width: 430px; margin-top: 10px; color: #5d5353; font-size: 12px; }
          .exif-details summary { cursor: pointer; color: #34345c; font-weight: 700; }
          .exif-details dl { margin-top: 6px; }
          .exif-details dl > div { display: grid; grid-template-columns: 85px 1fr; gap: 8px; padding: 2px 0; }
          .exif-details dt { color: #806b69; }
          .post .meta { color: #666; font-size: 11px; }
          .delete-post { width: 100%; margin-top: 9px; padding: 5px 8px; color: #a20d1b; background: transparent; border: 1px solid rgba(162,13,27,.35); border-radius: 6px; cursor: pointer; font: inherit; font-size: 12px; transition: color .15s ease, background .15s ease; }
          .delete-post:hover:not(:disabled) { color: white; background: #a20d1b; }
          .delete-post:disabled { cursor: wait; opacity: .55; }
          .upload-form { background: #d6daf0; border: 1px solid #b7c5d9; padding: 12px; margin-bottom: 16px; max-width: 500px; }
          .upload-form h2 { margin-bottom: 8px; color: #34345c; }
          .upload-form input, .upload-form select, .upload-form textarea { display: block; margin: 4px 0 8px; width: 100%; padding: 4px; border: 1px solid #aaa; }
          .upload-form button { background: #af0a0f; color: white; border: none; padding: 6px 16px; cursor: pointer; }
          .upload-progress { margin: 8px 0 10px; }
          .upload-progress-label { display: flex; justify-content: space-between; color: #555; font-size: 11px; margin-bottom: 4px; }
          .upload-progress-track { height: 8px; overflow: hidden; background: rgba(52,52,92,.14); border-radius: 999px; box-shadow: inset 0 1px 2px rgba(0,0,0,.12); }
          .upload-progress-fill { height: 100%; background: linear-gradient(90deg, #af0a0f, #ef6a3a); border-radius: inherit; transition: width .12s ease-out; }
          .field-hint { color: #665f69; font-size: 11px; font-weight: normal; margin: -3px 0 9px; }
          .upload-list { max-height: 150px; overflow: auto; margin-top: 7px; border: 1px solid rgba(52,52,92,.12); border-radius: 6px; background: rgba(255,255,255,.42); }
          .upload-item { display: flex; justify-content: space-between; gap: 12px; padding: 4px 7px; color: #555; font-size: 11px; border-bottom: 1px solid rgba(52,52,92,.08); }
          .upload-item:last-child { border-bottom: 0; }
          .upload-item span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .upload-item-done { color: #117743; }
          .upload-item-error { color: #a20d1b; }
          .ocr-text { margin-top: 9px; padding-top: 8px; border-top: 1px solid rgba(52,52,92,.15); }
          .ocr-text pre { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; color: #34345c; }
          .cli-snippet { max-width: 100%; overflow-x: auto; white-space: pre; text-align: left; padding: 10px; background: #1f2033; color: #f7f4ed; border-radius: 6px; }
          .auth-prompt { background: #f0e0d6; border: 1px solid #d9bfb7; padding: 18px; max-width: 500px; margin-bottom: 16px; }
          .auth-prompt h3 { color: #34345c; margin-bottom: 6px; }
          .auth-prompt p { color: #555; margin-bottom: 12px; }
          .auth-prompt button { background: #34345c; color: white; border: 0; padding: 7px 14px; cursor: pointer; }
          .profile-card { background: #f0e0d6; border: 1px solid #d9bfb7; padding: 16px; margin-bottom: 18px; display: flex; gap: 16px; align-items: flex-start; }
          .cli-upload-card { display: block; width: 100%; box-sizing: border-box; }
          .profile-card > img { width: 96px; height: 96px; border-radius: 50%; border: 2px solid white; }
          .attributes { border-collapse: collapse; color: #333; }
          .attributes th, .attributes td { padding: 4px 10px 4px 0; text-align: left; vertical-align: top; }
          .attributes th { color: #800000; }
          .thread { border: 1px solid #d9bfb7; background: #f0e0d6; padding: 12px; margin: 12px 0; }
          .thread img { max-width: 300px; float: left; margin-right: 12px; }
          .reply { background: #d6daf0; border: 1px solid #b7c5d9; margin: 8px 0; padding: 8px; clear: left; }
          .search-bar { margin-bottom: 12px; display: flex; gap: 8px; }
          .search-bar input { padding: 4px; border: 1px solid #aaa; flex: 1; }
          .search-bar button { background: #af0a0f; color: white; border: none; padding: 4px 12px; cursor: pointer; }
          .home-intro { margin-bottom: 22px; }
          .home-intro h2 { color: #33131a; font-size: clamp(26px, 4vw, 38px); letter-spacing: -.03em; margin: 3px 0 5px; }
          .home-intro p { color: #745d5e; font-size: 15px; }
          .eyebrow { color: #b51525; font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
          .board-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
          .board-card { min-height: 92px; display: flex; align-items: center; gap: 14px; padding: 17px; color: inherit; text-decoration: none; background: rgba(255,255,255,.78); border: 1px solid rgba(137,78,67,.18); border-radius: 14px; box-shadow: 0 5px 18px rgba(74,35,27,.08); transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
          .board-card:hover { transform: translateY(-3px); border-color: rgba(181,21,37,.45); box-shadow: 0 10px 25px rgba(74,35,27,.13); }
          .board-icon { width: 46px; height: 46px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 12px; background: linear-gradient(145deg, #fff4e7, #f5d5c9); font-size: 23px; }
          .board-details { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
          .board-details strong { color: #9d101c; font-size: 18px; }
          .board-details span { color: #6e5555; }
          .post-count { display: flex; flex-direction: column; align-items: flex-end; color: #806b69; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
          .post-count strong { color: #30171a; font-size: 19px; line-height: 1.1; letter-spacing: 0; }
          @media (max-width: 720px) { header { align-items: flex-start; flex-wrap: wrap; } .auth-status, .auth-button { margin-left: 0; } main { padding: 12px; } }
        `}</style>
      </head>
      <body>
        <Providers>
        <header>
          <h1><a href="/">🐱 Can I Haz Kubernetes</a></h1>
          <Navigation />
          <AuthStatus />
        </header>
        <div className="board-nav">
          <span>[<a href="/">Home</a>] — <Tagline /></span>
          <a className="source-link" href="https://github.com/codemowers/lolcatz" target="_blank" rel="noopener noreferrer">Source</a>
        </div>
        <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
