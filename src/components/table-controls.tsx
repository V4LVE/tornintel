import type { ReactNode } from 'react'
import type { TableView } from '#/lib/hooks/use-table-view'
import { PAGE_SIZES, pageRange } from '#/lib/table-view/table-view'

// Shared controls for tables driven by useTableView. They render inside a
// .panel: toolbar above the table, footer with pagination below it.

export function TableToolbar<T, TFilter extends string, TSort extends string>({
  view,
  placeholder = 'Search by name or ID',
  children,
}: {
  view: TableView<T, TFilter, TSort>
  placeholder?: string
  // Extra controls shown next to the search box.
  children?: ReactNode
}) {
  return (
    <div className="table-toolbar">
      {view.filters.length > 0 ? (
        <div className="table-tabs" role="tablist">
          {view.filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={view.filter === filter.id}
              className={
                view.filter === filter.id ? 'table-tab selected' : 'table-tab'
              }
              onClick={() => view.setFilter(filter.id)}
            >
              {filter.label}
              <em>{view.filterCounts[filter.id]}</em>
            </button>
          ))}
        </div>
      ) : (
        <span />
      )}
      <div className="table-toolbar-actions">
        {children}
        {view.hasSearch && (
          <label className="table-search">
            <span aria-hidden="true">&#9906;</span>
            <input
              type="search"
              value={view.query}
              onChange={(event) => view.setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') view.setQuery('')
              }}
              placeholder={placeholder}
              aria-label={placeholder}
            />
            {view.query && (
              <button
                type="button"
                className="table-search-clear"
                onClick={() => view.setQuery('')}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </label>
        )}
      </div>
    </div>
  )
}

export function SortHeader<T, TFilter extends string, TSort extends string>({
  view,
  column,
  children,
}: {
  view: TableView<T, TFilter, TSort>
  column: TSort
  children: ReactNode
}) {
  const direction = view.sort?.key === column ? view.sort.direction : null
  return (
    <th
      aria-sort={
        direction === 'asc'
          ? 'ascending'
          : direction === 'desc'
            ? 'descending'
            : undefined
      }
    >
      <button
        type="button"
        className={direction ? 'table-sort active' : 'table-sort'}
        onClick={() => view.toggleSort(column)}
      >
        {children}
        <span aria-hidden="true">
          {direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}
        </span>
      </button>
    </th>
  )
}

// Shown under the table when filters hide every row of a non-empty list.
export function TableEmpty<T, TFilter extends string, TSort extends string>({
  view,
  noun = 'rows',
}: {
  view: TableView<T, TFilter, TSort>
  noun?: string
}) {
  if (view.total === 0 || view.matchCount > 0) return null
  return (
    <div className="empty-state table-empty">
      No {noun} match this view.{' '}
      <button
        type="button"
        className="text-button"
        onClick={() => {
          view.setQuery('')
          const first = view.filters.at(0)
          if (first) view.setFilter(first.id)
        }}
      >
        Clear search and filters
      </button>
    </div>
  )
}

export function TablePagination<
  T,
  TFilter extends string,
  TSort extends string,
>({
  view,
  noun = 'rows',
  children,
}: {
  view: TableView<T, TFilter, TSort>
  noun?: string
  // A short note shown under the row count.
  children?: ReactNode
}) {
  const filtered = view.matchCount < view.total
  return (
    <div className="table-footer">
      <div className="table-footer-info">
        <span>
          {view.matchCount === 0
            ? `No ${noun}`
            : `Showing ${view.first}–${view.last} of ${view.matchCount} ${noun}`}
          {filtered && ` (filtered from ${view.total})`}
        </span>
        {children && <small>{children}</small>}
      </div>
      <div className="table-pager">
        {view.matchCount > PAGE_SIZES[0] && (
          <label className="table-page-size">
            Rows
            <select
              value={view.pageSize}
              onChange={(event) => view.setPageSize(Number(event.target.value))}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
        {view.pageCount > 1 && (
          <nav className="pagination" aria-label="Pagination">
            <button
              type="button"
              onClick={() => view.setPage(view.page - 1)}
              disabled={view.page === 1}
              aria-label="Previous page"
            >
              ‹
            </button>
            {pageRange(view.page, view.pageCount).map((item, index) =>
              item === 'gap' ? (
                <span key={`gap-${index}`} className="pagination-gap">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={item === view.page ? 'page-active' : undefined}
                  aria-current={item === view.page ? 'page' : undefined}
                  onClick={() => view.setPage(item)}
                >
                  {item}
                </button>
              ),
            )}
            <button
              type="button"
              onClick={() => view.setPage(view.page + 1)}
              disabled={view.page === view.pageCount}
              aria-label="Next page"
            >
              ›
            </button>
          </nav>
        )}
      </div>
    </div>
  )
}
