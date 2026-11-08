import type { Comparison, RnaSeqConfig } from "@/lib/rnaseq/types";

/** 当前可执行的比较:case/control 都是已配置分组且不相同 */
export function validComparisonsOf(config: RnaSeqConfig): Comparison[] {
  return (config.comparisons || []).filter(
    (c) =>
      !!c.case &&
      !!c.control &&
      c.case !== c.control &&
      !!config.groups[c.case]?.length &&
      !!config.groups[c.control]?.length,
  );
}
