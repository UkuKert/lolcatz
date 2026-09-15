"use client";

import { usePathname } from "next/navigation";

const boards = ["b", "g", "k", "a", "mu", "v"];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav>
      {boards.map(board => {
        const href = `/board/${board}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <a key={board} href={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            /{board}/
          </a>
        );
      })}
      <a href="/search" className={pathname === "/search" ? "active" : undefined} aria-current={pathname === "/search" ? "page" : undefined}>
        Search
      </a>
    </nav>
  );
}
