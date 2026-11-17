<script lang="ts">
  import {
    columnFilteringFeature,
    createFilteredRowModel,
    createPaginatedRowModel,
    createTable,
    globalFilteringFeature,
    rowPaginationFeature,
    tableFeatures,
    type PaginationState,
    type ColumnDef,
  } from "@tanstack/svelte-table";
  import IconChevronLeft from "@tabler/icons-svelte/icons/chevron-left";
  import IconChevronRight from "@tabler/icons-svelte/icons/chevron-right";
  import IconInfoCircle from "@tabler/icons-svelte/icons/info-circle";
  import IconSearch from "@tabler/icons-svelte/icons/search";
  import IconTable from "@tabler/icons-svelte/icons/table";
  import { t } from "../../app/i18n.svelte";
  import Modal from "../../components/Modal.svelte";
  import type { RowSnapshot } from "../../lib/contracts/generated/qpcr/RowSnapshot.js";
  import type { SheetSnapshot } from "../../lib/contracts/generated/qpcr/SheetSnapshot.js";
  import type { QpcrAuditResult } from "../../lib/contracts/generated/qpcr/QpcrAuditResult.js";
  import { cellText } from "./snapshot.js";

  let {
    snapshot,
    caption,
    audit = null,
    auditType = "source",
    auditFailed = false,
  }: {
    snapshot: SheetSnapshot;
    caption: string;
    audit?: QpcrAuditResult | null;
    auditType?: "source" | "transformed";
    auditFailed?: boolean;
  } = $props();
  let open = $state(false);
  let search = $state("");
  let pagination = $state<PaginationState>({ pageIndex: 0, pageSize: 50 });

  const features = tableFeatures({
    columnFilteringFeature,
    globalFilteringFeature,
    filteredRowModel: createFilteredRowModel(),
    rowPaginationFeature,
    paginatedRowModel: createPaginatedRowModel(),
  });

  const columns = $derived.by((): Array<ColumnDef<typeof features, RowSnapshot>> =>
    Array.from({ length: snapshot.columnCount }, (_, index) => {
      const col = index + 1;
      return {
        id: `column-${col}`,
        header: previewColumnLabel(col),
        accessorFn: (row) =>
          cellText(row.cells.find((cell) => cell.col === col)?.value ?? { t: "empty" }),
      };
    }),
  );
  const indexedCells = $derived.by(
    () =>
      new Map(
        snapshot.rows.map((row) => [
          row.row,
          new Map(row.cells.map((cell) => [cell.col, cell])),
        ]),
      ),
  );

  const table = createTable({
    features,
    get data() {
      return snapshot.rows;
    },
    get columns() {
      return columns;
    },
    state: {
      get globalFilter() {
        return search;
      },
      get pagination() {
        return pagination;
      },
    },
    onGlobalFilterChange: (next) => {
      search = typeof next === "function" ? next(search) : String(next ?? "");
      pagination = { ...pagination, pageIndex: 0 };
    },
    onPaginationChange: (next) => {
      pagination = typeof next === "function" ? next(pagination) : next;
    },
    globalFilterFn: (row, columnId, value) => {
      // TanStack tests a global filter against each eligible column. Evaluate
      // the row-wide worksheet search once, through its first column only.
      if (columnId !== "column-1") return false;
      const query = String(value ?? "").trim().toLocaleLowerCase();
      return !query || row.original.cells.some((cell) =>
        cellText(cell.value).toLocaleLowerCase().includes(query),
      );
    },
  });

  const filteredCount = $derived(table.getFilteredRowModel().rows.length);
  const pageCount = $derived(table.getPageCount());
  const hasYellowFill = $derived(
    snapshot.rows.some((row) => row.cells.some((cell) => cell.yellowFill)),
  );
  const auditMetrics = $derived.by(() => {
    if (!audit) return [];
    return auditType === "source"
      ? [
          { label: t("qpcr.auditAccepted"), value: audit.acceptedRows },
          { label: t("qpcr.auditSkipped"), value: audit.skippedRows },
          { label: t("qpcr.auditMissingCt"), value: audit.missingCtRows },
          { label: t("qpcr.auditInvalidCt"), value: audit.invalidCtRows },
          { label: t("qpcr.auditImputed"), value: audit.imputedCells },
        ]
      : [
          { label: t("qpcr.auditRows"), value: audit.dataRows },
          { label: t("qpcr.auditSamples"), value: audit.sampleCount },
          { label: t("qpcr.auditGenes"), value: audit.geneCount },
          { label: t("qpcr.auditImputed"), value: audit.imputedCells },
          { label: t("qpcr.auditMissing"), value: audit.incompleteCells },
        ];
  });

  function previewColumnLabel(col: number): string {
    let index = col;
    let label = "";
    while (index > 0) {
      const remainder = (index - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      index = Math.floor((index - 1) / 26);
    }
    return label;
  }

  function getCell(row: RowSnapshot, col: number) {
    return indexedCells.get(row.row)?.get(col);
  }
</script>

<section class="mynx-card flex min-w-0 flex-col">
  <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
    <div class="flex min-w-0 items-center gap-2">
      <IconTable size={14} stroke={1.75} aria-hidden="true" />
      <h2 class="mynx-truncate text-[12px] font-semibold">{caption}</h2>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <span class="mynx-chip text-[10px]">
        {t("qpcr.previewDimensions", { rows: snapshot.rowCount, cols: snapshot.columnCount })}
      </span>
      <button type="button" class="mynx-btn !h-7 gap-1.5 !px-2 text-[11px]" onclick={() => (open = true)}>
        <IconSearch size={13} stroke={1.75} aria-hidden="true" />
        {t("qpcr.previewOpenFull")}
      </button>
    </div>
  </div>

  <div class="p-3">
    {#if hasYellowFill}
      <p class="mb-2 flex items-center gap-1.5 text-[11px] text-text-secondary">
        <span class="h-2.5 w-2.5 shrink-0 rounded-sm border border-warning/50 bg-warning/30" aria-hidden="true"></span>
        {t("qpcr.previewYellowLegend")}
      </p>
    {/if}
    <!-- Intentional keyboard target for horizontal worksheet-table scrolling. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="max-w-full overflow-auto rounded-md border border-border"
      tabindex="0"
      role="region"
      aria-label={t("qpcr.previewTableAria", { sheet: snapshot.name })}
    >
      <table class="w-max min-w-full border-separate border-spacing-0 text-left text-[11px]">
        <caption class="sr-only">{caption} · {snapshot.name}</caption>
        <thead class="sticky top-0 z-[1] bg-surface-2 text-text-secondary">
          <tr>
            <th scope="col" class="border-b border-r border-border px-2 py-1.5 font-medium">#</th>
            {#each table.getAllLeafColumns().slice(0, 6) as column (column.id)}
              <th scope="col" class="border-b border-r border-border px-2 py-1.5 font-medium">
                {column.columnDef.header}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each snapshot.rows.slice(0, 6) as row (row.row)}
            <tr class="hover:bg-surface-2/60">
              <th scope="row" class="border-b border-r border-border px-2 py-1.5 font-normal text-text-secondary">
                {row.row}
              </th>
              {#each table.getAllLeafColumns().slice(0, 6) as column (column.id)}
                {@const col = Number(column.id.replace("column-", ""))}
                {@const cell = getCell(row, col)}
                {@const value = cell ? cellText(cell.value) : ""}
                <td
                  class="max-w-40 border-b border-r border-border px-2 py-1.5 {cell?.yellowFill ? 'bg-warning/20' : ''}"
                  title={cell?.yellowFill ? t("qpcr.previewYellowCell") : value || "—"}
                  aria-label={cell?.yellowFill ? t("qpcr.previewCellAria", { value: value || "—" }) : undefined}
                >
                  <span class="mynx-truncate block">{value || "—"}</span>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="mt-2 text-[11px] text-text-secondary">
      {t("qpcr.previewRange", {
        rows: Math.min(snapshot.rows.length, 6),
        cols: Math.min(snapshot.columnCount, 6),
      })}
    </p>
  </div>

  {#if auditFailed}
    <div class="border-t border-border px-3 py-2.5">
      <p class="flex items-start gap-1.5 text-[11px] leading-relaxed text-warning" role="status">
        <IconInfoCircle size={14} stroke={1.7} class="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{t("qpcr.auditFailed")}</span>
      </p>
    </div>
  {:else if audit}
    <div class="flex flex-col gap-1.5 border-t border-border bg-surface-2/25 px-3 py-2.5">
      <div class="flex min-w-0 items-center justify-between gap-2">
        <h3 class="mynx-truncate text-[12px] font-semibold text-text">
          {t(auditType === "source" ? "qpcr.auditTitle" : "qpcr.auditSummary")}
        </h3>
        <span class="mynx-chip shrink-0 text-[10px]">
          {auditType === "source" ? t("qpcr.auditReadOnly") : t("qpcr.auditQc")}
        </span>
      </div>
      <dl class="grid grid-cols-2 gap-x-5 gap-y-1 sm:grid-cols-3">
        {#each auditMetrics as metric (metric.label)}
          <div class="flex min-w-0 items-baseline justify-between gap-2 border-b border-border/70 py-1">
            <dt class="mynx-truncate text-[11px] text-text-secondary" title={metric.label}>
              {metric.label}
            </dt>
            <dd class="shrink-0 text-[12px] font-semibold tabular-nums text-text">
              {metric.value}
            </dd>
          </div>
        {/each}
      </dl>
      <p class="text-[11px] leading-relaxed text-text-secondary">
        {t(auditType === "source" ? "qpcr.auditHint" : "qpcr.auditTransformedHint")}
      </p>
      {#if auditType === "source" && audit.issueRows.length > 0}
        <p class="text-[11px] leading-relaxed text-warning">
          {t("qpcr.auditIssueRows")}: {audit.issueRows.join(", ")}
        </p>
      {/if}
    </div>
  {/if}
</section>

<Modal bind:open title={caption} description={t("qpcr.previewFullHint", { sheet: snapshot.name })} width={1120}>
  <div class="flex min-w-0 flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <label class="relative min-w-56 flex-1">
        <span class="sr-only">{t("qpcr.previewSearch")}</span>
        <IconSearch size={14} stroke={1.75} aria-hidden="true" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
        <input
          class="mynx-input w-full !pl-8"
          type="search"
          value={search}
          placeholder={t("qpcr.previewSearchPlaceholder")}
          oninput={(event) => table.setGlobalFilter(event.currentTarget.value)}
        />
      </label>
      <span class="mynx-chip text-[11px]" aria-live="polite">
        {t("qpcr.previewMatchCount", { count: filteredCount })}
      </span>
      {#if hasYellowFill}
        <span class="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <span class="h-2.5 w-2.5 rounded-sm border border-warning/50 bg-warning/30" aria-hidden="true"></span>
          {t("qpcr.previewYellowLegend")}
        </span>
      {/if}
    </div>

    <!-- Keep the header and workbook row numbers in view while scanning wide sheets. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="max-h-[min(58vh,560px)] max-w-full overflow-auto rounded-md border border-border"
      tabindex="0"
      role="region"
      aria-label={t("qpcr.previewTableAria", { sheet: snapshot.name })}
    >
      <table class="w-max min-w-full border-separate border-spacing-0 text-left text-[12px]">
        <caption class="sr-only">{caption} · {snapshot.name}</caption>
        <thead class="sticky top-0 z-20 bg-surface-2 text-text-secondary">
          <tr>
            <th scope="col" class="sticky left-0 z-30 border-b border-r border-border bg-surface-2 px-3 py-2 font-medium">#</th>
            {#each table.getAllLeafColumns() as column (column.id)}
              <th scope="col" class="min-w-24 border-b border-r border-border px-3 py-2 font-medium">
                {column.columnDef.header}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each table.getRowModel().rows as tableRow (tableRow.id)}
            {@const row = tableRow.original}
            <tr class="group">
              <th scope="row" class="sticky left-0 z-[1] border-b border-r border-border bg-surface px-3 py-1.5 text-right font-mono text-[11px] font-normal text-text-secondary group-hover:bg-surface-2">
                {row.row}
              </th>
              {#each table.getAllLeafColumns() as column (column.id)}
                {@const col = Number(column.id.replace("column-", ""))}
                {@const cell = getCell(row, col)}
                {@const value = cell ? cellText(cell.value) : ""}
                <td
                  class="max-w-56 border-b border-r border-border px-3 py-1.5 align-top group-hover:bg-surface-2/60 {cell?.yellowFill ? 'bg-warning/20' : ''}"
                  title={cell?.yellowFill ? t("qpcr.previewYellowCell") : value || "—"}
                  aria-label={cell?.yellowFill ? t("qpcr.previewCellAria", { value: value || "—" }) : undefined}
                >
                  <span class="mynx-truncate block">{value || "—"}</span>
                </td>
              {/each}
            </tr>
          {:else}
            <tr>
              <td colspan={Math.max(1, snapshot.columnCount + 1)} class="px-4 py-10 text-center text-[12px] text-text-secondary">
                {t("qpcr.previewNoMatches")}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <label class="flex items-center gap-2 text-[11px] text-text-secondary">
        {t("qpcr.previewRowsPerPage")}
        <select
          class="mynx-input !h-7 !py-0 text-[11px]"
          value={pagination.pageSize}
          onchange={(event) => table.setPageSize(Number(event.currentTarget.value))}
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </label>
      <div class="flex items-center gap-2">
        <span class="min-w-20 text-center text-[11px] text-text-secondary">
          {t("qpcr.previewPage", { current: Math.min(pagination.pageIndex + 1, Math.max(pageCount, 1)), total: Math.max(pageCount, 1) })}
        </span>
        <button
          type="button"
          class="mynx-btn !h-7 !w-7 !p-0"
          aria-label={t("qpcr.previewPreviousPage")}
          disabled={!table.getCanPreviousPage()}
          onclick={() => table.previousPage()}
        ><IconChevronLeft size={15} stroke={1.75} aria-hidden="true" /></button>
        <button
          type="button"
          class="mynx-btn !h-7 !w-7 !p-0"
          aria-label={t("qpcr.previewNextPage")}
          disabled={!table.getCanNextPage()}
          onclick={() => table.nextPage()}
        ><IconChevronRight size={15} stroke={1.75} aria-hidden="true" /></button>
      </div>
    </div>
  </div>
</Modal>
