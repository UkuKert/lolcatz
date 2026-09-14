/** @type {import('next').NextConfig} */
module.exports = {
  output: "standalone",
  env: {
    S3_PUBLIC_URL: process.env.S3_PUBLIC_URL || "http://minio.ee-lte-1.codemowers.io",
  },
  async rewrites() {
    return [
      { source: "/api/upload/:path*",   destination: `${process.env.UPLOADER_URL || "http://lolcatz-uploader:8080"}/:path*` },
      { source: "/api/browse/:path*",   destination: `${process.env.BROWSE_URL   || "http://lolcatz-browse:8080"}/:path*` },
      { source: "/api/search/:path*",   destination: `${process.env.SEARCH_URL   || "http://lolcatz-search:8080"}/:path*` },
      { source: "/api/comments/:path*", destination: `${process.env.COMMENTS_URL || "http://lolcatz-comments:8080"}/:path*` },
    ];
  },
};
