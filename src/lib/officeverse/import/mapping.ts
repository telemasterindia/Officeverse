/**
 * Officeverse — spreadsheet-column → Officeverse-field mapping (Phase 7). PURE.
 */
import {
  fieldsForMode,
  findFieldByHeader,
  requiredKeys,
  type FieldDef,
  type ImportMode,
} from "./fields";

/** field key → source header (or "" for "not mapped"). */
export type ColumnMapping = Record<string, string>;

export interface MappingReport {
  mapping: ColumnMapping;
  /** headers that did not auto-map to any field */
  unmappedHeaders: string[];
  /** required field keys with no column */
  missingRequired: string[];
  /** mapping entries pointing at a header not present in the file */
  invalidTargets: Array<{ field: string; header: string }>;
  /** two fields mapped to the same header */
  duplicateHeaders: string[];
}

export function autoDetectMapping(headers: string[], mode: ImportMode): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<string>();
  for (const header of headers) {
    const field = findFieldByHeader(header, mode);
    if (field && !mapping[field.key] && !taken.has(header)) {
      mapping[field.key] = header;
      taken.add(header);
    }
  }
  return mapping;
}

export function analyzeMapping(
  mapping: ColumnMapping,
  headers: string[],
  mode: ImportMode,
): MappingReport {
  const headerSet = new Set(headers);
  const fields = fieldsForMode(mode);
  const fieldKeys = new Set(fields.map((f) => f.key));

  const used = new Map<string, string[]>(); // header -> [fieldKeys]
  const invalidTargets: Array<{ field: string; header: string }> = [];

  for (const [field, header] of Object.entries(mapping)) {
    if (!header) continue;
    if (!fieldKeys.has(field)) {
      invalidTargets.push({ field, header });
      continue;
    }
    if (!headerSet.has(header)) {
      invalidTargets.push({ field, header });
      continue;
    }
    used.set(header, [...(used.get(header) ?? []), field]);
  }

  const mappedHeaders = new Set(Object.values(mapping).filter((h) => h && headerSet.has(h)));
  const unmappedHeaders = headers.filter((h) => !mappedHeaders.has(h));

  const missingRequired = requiredKeys(mode).filter(
    (k) => !mapping[k] || !headerSet.has(mapping[k]!),
  );

  const duplicateHeaders = [...used.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([header]) => header);

  return { mapping, unmappedHeaders, missingRequired, invalidTargets, duplicateHeaders };
}

export function isMappingComplete(report: MappingReport): boolean {
  return (
    report.missingRequired.length === 0 &&
    report.invalidTargets.length === 0 &&
    report.duplicateHeaders.length === 0
  );
}

export function fieldOptions(mode: ImportMode): FieldDef[] {
  return fieldsForMode(mode);
}
