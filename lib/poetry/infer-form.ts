export interface FormResult {
  primary: string | null;
  source: 'inferred' | 'source-tag' | 'passthrough';
  confidence: number;
}

const CN_PUNCT = /[，。！？、；：""''《》【】（）()·…—\s]/g;

function countChars(line: string): number {
  return Array.from(line.replace(CN_PUNCT, '')).length;
}

export function inferFormFromParagraphs(paragraphs: string[]): FormResult {
  const lines = paragraphs.map(p => p.trim()).filter(p => p.length > 0);
  if (lines.length === 0) return { primary: null, source: 'inferred', confidence: 0 };

  const lengths = lines.map(countChars);
  const uniqueLengths = [...new Set(lengths)];

  // Length mode
  let lengthMode: '五言' | '七言' | '杂言';
  if (uniqueLengths.length === 1) {
    if (uniqueLengths[0] === 5) lengthMode = '五言';
    else if (uniqueLengths[0] === 7) lengthMode = '七言';
    else {
      // 5 or 7 with extra chars (like 9 char lines) - treat as 古风
      return { primary: `${uniqueLengths[0]}言古风`, source: 'inferred', confidence: 0.6 };
    }
  } else {
    lengthMode = '杂言';
  }

  // Line count mode
  const lineCount = lines.length;
  let lineMode: '绝句' | '律诗' | '古风';
  let confidence = 1.0;
  if (lineCount === 4) lineMode = '绝句';
  else if (lineCount === 8) lineMode = '律诗';
  else {
    lineMode = '古风';
    confidence = 0.7;
  }

  // Combine
  if (lengthMode === '杂言') {
    return { primary: '杂言古风', source: 'inferred', confidence };
  }
  const lengthStr = lengthMode === '五言' ? '五' : '七';
  if (lineMode === '绝句') return { primary: `${lengthStr}绝`, source: 'inferred', confidence };
  if (lineMode === '律诗') return { primary: `${lengthStr}律`, source: 'inferred', confidence };
  return { primary: `${lengthMode}古风`, source: 'inferred', confidence };
}

const SOURCE_TAG_MAP: Record<string, string> = {
  '五言绝句': '五绝',
  '七言绝句': '七绝',
  '五言律诗': '五律',
  '七言律诗': '七律',
};

export function resolveFormFromSource(type: string | null, rhythmic: string | null, category: string): FormResult {
  // 词: passthrough 词牌名
  if (category === 'song' && rhythmic && rhythmic.length > 0) {
    return { primary: rhythmic, source: 'passthrough', confidence: 1.0 };
  }
  // 元曲: 套数/小令
  if (category === 'yuan' && (type === '套数' || type === '小令')) {
    return { primary: type, source: 'source-tag', confidence: 1.0 };
  }
  if (!type) return { primary: null, source: 'source-tag', confidence: 0 };
  // Map chinese-poetry legacy names to canonical
  const canonical = SOURCE_TAG_MAP[type] ?? type;
  return { primary: canonical, source: 'source-tag', confidence: 1.0 };
}

export function mergeForm(struct: FormResult, source: FormResult): FormResult {
  if (source.primary !== null && source.confidence > 0) return source;
  if (struct.primary !== null) return struct;
  return { primary: null, source: 'inferred', confidence: 0 };
}