export const prerender = true;
export const ssr = false;

// Preload all JS code on navigation so data-heavy routes start instantly.
export const preloadCode = 'navigation';

// Static builds — normalize URLs to no trailing slash (avoids 301 loops on Cloudflare Pages / Vercel).
export const trailingSlash = 'never';
