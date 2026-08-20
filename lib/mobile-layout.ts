export function usesCompactLandscapeLayout(width: number, height: number) {
  return Number.isFinite(width)
    && Number.isFinite(height)
    && width > height
    && height < 600;
}
