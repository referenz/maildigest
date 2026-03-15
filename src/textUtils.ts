function decodeBasicHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function htmlToText(html: string): string {
  return decodeBasicHtmlEntities(
    html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  );
}

function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripQuotedReply(input: string): string {
  const lines = input.split("\n");
  const result: string[] = [];

  const cutPatterns = [
    /^On .+ wrote:$/i,
    /^Am .+ schrieb .+:$/i,
    /^Von:\s.+$/i,
    /^Gesendet:\s.+$/i,
    /^Betreff:\s.+$/i,
    /^>+/,
    /^-{2,}\s*Original Message\s*-{2,}$/i,
    /^_{2,}$/i,
  ];

  for (const line of lines) {
    if (result.length > 3 && cutPatterns.some((rx) => rx.test(line.trim()))) {
      break;
    }
    result.push(line);
  }

  return result.join("\n").trim();
}

export function smartTrim(raw: string, maxLen: number): string {
  let text = raw;

  if (/<[a-z][\s\S]*>/i.test(text)) {
    text = htmlToText(text);
  } else {
    text = decodeBasicHtmlEntities(text);
  }

  text = normalizeWhitespace(text);
  text = stripQuotedReply(text);

  if (text.length <= maxLen) {
    return text;
  }

  const candidate = text.slice(0, maxLen);
  const cutAt = Math.max(
    candidate.lastIndexOf("\n\n"),
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? "),
  );

  if (cutAt > maxLen * 0.6) {
    return candidate.slice(0, cutAt + 1).trim();
  }

  return `${candidate.trim()} …`;
}

export function formatAddress(name?: string, address?: string): string {
  const cleanName = (name ?? "").trim();
  const cleanAddress = (address ?? "").trim();

  if (cleanName && cleanAddress) {
    return `${cleanName} <${cleanAddress}>`;
  }
  if (cleanName) {
    return cleanName;
  }
  if (cleanAddress) {
    return cleanAddress;
  }
  return "";
}
