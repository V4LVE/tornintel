// Pure helpers behind useTableView: searching, sorting and paging client-side lists.

export type SortDirection = 'asc' | 'desc'
export type SortState<TKey extends string> = {
  key: TKey
  direction: SortDirection
}
export type SortValue = number | string | null | undefined

export const PAGE_SIZES = [10, 25, 50, 100] as const

// Every whitespace-separated word must appear in one of the fields.
export function matchesQuery(
  fields: readonly (string | number | null | undefined)[],
  query: string,
) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = fields
    .filter((field) => field !== null && field !== undefined)
    .join(' ')
    .toLowerCase()
  return words.every((word) => haystack.includes(word))
}

// Stable sort; missing values always go last so "unknown" never tops a list.
export function sortItems<T>(
  items: readonly T[],
  value: (item: T) => SortValue,
  direction: SortDirection,
) {
  const sign = direction === 'asc' ? 1 : -1
  return items
    .map((item, index) => ({ item, index, value: value(item) }))
    .sort((left, right) => {
      const leftMissing = isMissing(left.value)
      const rightMissing = isMissing(right.value)
      if (leftMissing || rightMissing) {
        return leftMissing === rightMissing
          ? left.index - right.index
          : leftMissing
            ? 1
            : -1
      }
      const order =
        typeof left.value === 'number' && typeof right.value === 'number'
          ? left.value - right.value
          : String(left.value).localeCompare(String(right.value), 'en', {
              numeric: true,
              sensitivity: 'base',
            })
      return order === 0 ? left.index - right.index : order * sign
    })
    .map(({ item }) => item)
}

// Clicking a column cycles ascending, descending, then back to the default order.
export function nextSort<TKey extends string>(
  current: SortState<TKey> | null,
  key: TKey,
): SortState<TKey> | null {
  if (current?.key !== key) return { key, direction: 'asc' }
  return current.direction === 'asc' ? { key, direction: 'desc' } : null
}

// The page is clamped, so a list that shrinks on refresh never shows an empty page.
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(Math.max(1, Math.floor(page)), pageCount)
  const start = (current - 1) * pageSize
  const pageItems = items.slice(start, start + pageSize)
  return {
    items: pageItems,
    page: current,
    pageCount,
    // One-based positions for "Showing 26–50 of 120".
    first: pageItems.length ? start + 1 : 0,
    last: start + pageItems.length,
  }
}

// Page buttons to show: the first, the last and a window around the current one.
export function pageRange(page: number, pageCount: number, around = 1) {
  const pages: (number | 'gap')[] = []
  for (let value = 1; value <= pageCount; value++) {
    const inWindow = Math.abs(value - page) <= around
    // A gap of a single page is shown as that page instead of an ellipsis.
    const bridgesGap =
      (value === 2 && page - around === 3) ||
      (value === pageCount - 1 && page + around === pageCount - 2)
    if (value === 1 || value === pageCount || inWindow || bridgesGap) {
      pages.push(value)
    } else if (pages.at(-1) !== 'gap') {
      pages.push('gap')
    }
  }
  return pages
}

function isMissing(value: SortValue) {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (typeof value === 'number' && !Number.isFinite(value))
  )
}
