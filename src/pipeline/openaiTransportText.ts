export type OpenAiTextSanitizeStats = {
  changed: boolean;
  removedControlChars: number;
  replacedInvalidSurrogates: number;
};

export function emptyOpenAiTextSanitizeStats(): OpenAiTextSanitizeStats {
  return {
    changed: false,
    removedControlChars: 0,
    replacedInvalidSurrogates: 0,
  };
}

export function mergeOpenAiTextSanitizeStats(
  parts: readonly OpenAiTextSanitizeStats[],
): OpenAiTextSanitizeStats {
  return parts.reduce<OpenAiTextSanitizeStats>(
    (acc, part) => ({
      changed: acc.changed || part.changed,
      removedControlChars: acc.removedControlChars + part.removedControlChars,
      replacedInvalidSurrogates: acc.replacedInvalidSurrogates + part.replacedInvalidSurrogates,
    }),
    emptyOpenAiTextSanitizeStats(),
  );
}

export function sanitizeOpenAiTransportText(input: string): {
  text: string;
  stats: OpenAiTextSanitizeStats;
} {
  let removedControlChars = 0;
  let replacedInvalidSurrogates = 0;
  let out = "";

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);

    const isAllowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    if (code <= 0x1f && !isAllowedWhitespace) {
      removedControlChars += 1;
      out += " ";
      continue;
    }

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i]! + input[i + 1]!;
        i += 1;
        continue;
      }
      replacedInvalidSurrogates += 1;
      out += " ";
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      replacedInvalidSurrogates += 1;
      out += " ";
      continue;
    }

    out += input[i]!;
  }

  return {
    text: out,
    stats: {
      changed: removedControlChars > 0 || replacedInvalidSurrogates > 0,
      removedControlChars,
      replacedInvalidSurrogates,
    },
  };
}
