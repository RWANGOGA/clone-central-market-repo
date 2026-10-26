import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * `output: 'standalone'` is only right for the Docker image.
 *
 * Dockerfile.api copies `.next/standalone` into a slim runner and starts it with
 * `node server.js`, which is exactly what standalone exists to make small. Render
 * does the opposite: it keeps the whole install and runs `npm start`, which is
 * `next start` — and `next start` refuses to work under standalone, warning on
 * every boot that you should run the standalone server instead. Both hosts run
 * the same build command, so the mode has to come from the environment: the
 * Dockerfile opts in, Render's plain build stays on the default output that
 * `next start` fully supports.
 */
const standalone = process.env.NEXT_STANDALONE === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(standalone ? { output: 'standalone' } : {}),
  outputFileTracingRoot: apiDir,
};

export default nextConfig;