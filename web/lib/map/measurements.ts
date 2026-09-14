/** Project numeric+unit spans only; never return free text or assert a sample pairing. */
export function measurementCandidates(text: string | null): string[] {
  return [...new Set(text?.match(/(?<![\w.])(?:[<>≤≥]=?\s*)?[+-]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?\s*(?:f\/cc|fibers?\/cc|s\/mm\^?2|structures?\/mm2|ppm|ppb|ppt|[µu]g\/m3|mg\/m3|mg\/kg|[µu]g\/g|ng\/m3|%)(?![\w/])/gi) || [])];
}
