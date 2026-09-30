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
};
