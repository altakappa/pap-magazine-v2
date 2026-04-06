/**
 * Image optimization utility for Supabase Storage
 * Generates optimized URLs with transform parameters
 */

/**
 * Get optimized URL with width, quality, and format parameters
 * Uses Supabase Storage image rendering API
 */
function getOptimizedUrl(originalUrl, opts) {
  opts = opts || {};
  var width = opts.width || 1200;
  var quality = opts.quality || 80;
  var format = opts.format || 'webp';

  // Supabase Storage supports image transforms via URL params
  // Format: /storage/v1/render/image/public/{bucket}/{path}?width=X&quality=Y&format=Z
  if (originalUrl && originalUrl.includes('/storage/v1/object/public/')) {
    return originalUrl.replace(
      '/storage/v1/object/public/',
      '/storage/v1/render/image/public/'
    ) + '?width=' + width + '&quality=' + quality + '&format=' + format;
  }
  return originalUrl; // Return as-is if not a Supabase storage URL
}

/**
 * Create optimized versions of all gallery images
 * Returns array with original + multiple sizes
 */
function optimizeGallery(fileUrls) {
  if (!fileUrls || !Array.isArray(fileUrls)) return [];
  return fileUrls.map(function(url) {
    return {
      original: url,
      large: getOptimizedUrl(url, { width: 1600, quality: 85 }),
      medium: getOptimizedUrl(url, { width: 1200, quality: 80 }),
      thumbnail: getOptimizedUrl(url, { width: 400, quality: 75 }),
    };
  });
}

/**
 * Get optimized thumbnail (small, compressed)
 */
function getOptimizedThumbnail(url) {
  return getOptimizedUrl(url, { width: 600, quality: 80, format: 'webp' });
}

/**
 * Get optimized hero/cover image (large, high quality)
 */
function getOptimizedHero(url) {
  return getOptimizedUrl(url, { width: 1600, quality: 85, format: 'webp' });
}

module.exports = { getOptimizedUrl, optimizeGallery, getOptimizedThumbnail, getOptimizedHero };
