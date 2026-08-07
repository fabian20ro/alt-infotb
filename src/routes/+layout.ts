export const prerender = true;
export const ssr = false;

// Static builds — normalize URLs to no trailing slash (avoids 301 loops on Cloudflare Pages / Vercel).
export const trailingSlash = 'never';
