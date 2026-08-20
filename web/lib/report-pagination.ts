export function paginateReports<T>(items: T[], requestedPage: number, pageSize: number) {
  const safePageSize = Math.max(1, Math.trunc(pageSize) || 1);
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const page = Math.min(totalPages, Math.max(1, Math.trunc(requestedPage) || 1));
  const startIndex = (page - 1) * safePageSize;
  const pageItems = items.slice(startIndex, startIndex + safePageSize);
  return {
    items: pageItems,
    page,
    totalPages,
    start: pageItems.length ? startIndex + 1 : 0,
    end: startIndex + pageItems.length,
  };
}
