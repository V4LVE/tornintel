import { useState } from 'react'
import type { SortState, SortValue } from '#/lib/table-view/table-view'
import {
  matchesQuery,
  nextSort,
  paginate,
  sortItems,
} from '#/lib/table-view/table-view'

export type TableFilter<T, TFilter extends string> = {
  id: TFilter
  label: string
  // Left out for the "show everything" tab.
  test?: (item: T) => boolean
}

export type TableViewOptions<
  T,
  TFilter extends string,
  TSort extends string,
> = {
  // Values matched by the search box; leave out to hide it.
  search?: (item: T) => readonly (string | number | null | undefined)[]
  // Tabs in display order; the first one is selected by default.
  filters?: readonly TableFilter<T, TFilter>[]
  sorts?: Record<TSort, (item: T) => SortValue>
  defaultSort?: SortState<TSort> | null
  pageSize?: number
}

export type TableView<
  T,
  TFilter extends string,
  TSort extends string,
> = ReturnType<typeof useTableView<T, TFilter, TSort>>

// Search, filter tabs, column sorting and pagination for a client-side list.
// Changing what is shown returns to the first page; data refreshes keep the page.
export function useTableView<
  T,
  TFilter extends string = string,
  TSort extends string = string,
>(items: readonly T[], options: TableViewOptions<T, TFilter, TSort> = {}) {
  const { search, filters = [], sorts, defaultSort = null } = options
  const [query, setQueryState] = useState('')
  const [filterId, setFilterState] = useState<TFilter | undefined>(
    filters[0]?.id,
  )
  const [sort, setSortState] = useState<SortState<TSort> | null>(defaultSort)
  const [pageSize, setPageSizeState] = useState(options.pageSize ?? 25)
  const [page, setPage] = useState(1)

  const searched = search
    ? items.filter((item) => matchesQuery(search(item), query))
    : items
  const filterCounts = Object.fromEntries(
    filters.map((filter) => [
      filter.id,
      filter.test ? searched.filter(filter.test).length : searched.length,
    ]),
  ) as Record<TFilter, number>
  const activeFilter = filters.find((filter) => filter.id === filterId)
  const filtered = activeFilter?.test
    ? searched.filter(activeFilter.test)
    : searched
  const sortValue = sort && sorts?.[sort.key]
  const sorted =
    sort && sortValue
      ? sortItems(filtered, sortValue, sort.direction)
      : filtered
  const current = paginate(sorted, page, pageSize)
  // Remember the clamped page; otherwise a list that shrinks and grows back
  // jumps to the old page without the viewer doing anything.
  if (current.page !== page) setPage(current.page)

  return {
    query,
    setQuery(next: string) {
      setQueryState(next)
      setPage(1)
    },
    filters,
    filter: activeFilter?.id,
    filterCounts,
    setFilter(next: TFilter) {
      setFilterState(next)
      setPage(1)
    },
    sort,
    setSort(next: SortState<TSort> | null) {
      setSortState(next)
      setPage(1)
    },
    toggleSort(key: TSort) {
      setSortState((value) => nextSort(value, key))
      setPage(1)
    },
    pageSize,
    setPageSize(next: number) {
      setPageSizeState(next)
      setPage(1)
    },
    page: current.page,
    pageCount: current.pageCount,
    setPage,
    pageItems: current.items,
    first: current.first,
    last: current.last,
    // Matches after search and filter, before paging.
    matchCount: sorted.length,
    total: items.length,
    hasSearch: Boolean(search),
  }
}
