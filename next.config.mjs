import { withAvatarkit } from "@spatialwalk/avatarkit/next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow any origin in dev (cloudflare tunnel URLs change each restart)
allowedDevOrigins: ["*.trycloudflare.com"],
};

export default withAvatarkit(nextConfig);
