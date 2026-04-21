export function splitIntoChunks(text: string, maxWords = 500): string[] {
    const words = text.split(/\s+/);
    const chunks: string[] = [];

    for (let i = 0; i < words.length; i += maxWords) {
        const chunk = words.slice(i, i + maxWords).join(' ').trim();
        if (chunk) chunks.push(chunk);
    }

    return chunks.length > 0 ? chunks : [text];
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.33);
}