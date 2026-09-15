/** @type {import('next').NextConfig} */
module.exports = {
  output: "standalone",
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/auth/callback",
          destination: "/api/auth/callback/passmower",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  env: {
    S3_PUBLIC_URL: process.env.S3_PUBLIC_URL || "https://minio.ee-lte-1.codemowers.io",
  },
};
