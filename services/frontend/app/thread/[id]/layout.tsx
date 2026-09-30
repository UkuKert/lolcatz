import { threadMetadata } from "../../../lib/thread-metadata";

export async function generateMetadata({ params }: { params: { id: string } }) {
  return threadMetadata(params.id, {
    browseURL: process.env.BROWSE_URL,
    siteURL: process.env.NEXTAUTH_URL,
  });
}

export default function ThreadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
