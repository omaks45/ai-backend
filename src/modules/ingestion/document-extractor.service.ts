
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
export type DocumentFormat = 'text' | 'pdf' | 'markdown';

export interface ExtractionResult {
    text: string;
    format: DocumentFormat;
    pageCount?: number;
    characterCount: number;
}

const FORMAT_MAP: Record<string, DocumentFormat> = {
    txt:  'text',
    text: 'text',
    md:   'markdown',
    mdx:  'markdown',
    pdf:  'pdf',
};

@Injectable()
export class DocumentExtractorService {
    private readonly logger = new Logger(DocumentExtractorService.name);

    //  Format detection

    detectFormat(filename: string): DocumentFormat {
        const ext = filename.split('.').pop()?.toLowerCase() ?? '';
        const format = FORMAT_MAP[ext];

        if (!format) {
        throw new BadRequestException(
            `Unsupported file format: .${ext}. Supported: ${Object.keys(FORMAT_MAP).join(', ')}`,
        );
        }

        return format;
    }

    //  Text extraction

    async extract(
        content: Buffer | string,
        filename: string,
    ): Promise<ExtractionResult> {
        const format = this.detectFormat(filename);

        this.logger.debug('Extracting text', { filename, format });

        const result = await this.extractByFormat(content, format);

        this.logger.debug('Extraction complete', {
        format,
        characterCount: result.characterCount,
        pageCount: result.pageCount,
        });

        return result;
    }

    //  Format-specific extractors 

    private async extractByFormat(
        content: Buffer | string,
        format: DocumentFormat,
    ): Promise<ExtractionResult> {
        switch (format) {
        case 'text':
            return this.extractText(content);

        case 'markdown':
            return this.extractMarkdown(content);

        case 'pdf':
            return this.extractPdf(content);
        }
    }

    private extractText(content: Buffer | string): ExtractionResult {
        const text = this.toUtf8(content);
        const cleaned = this.normaliseWhitespace(text);

        return {
        text: cleaned,
        format: 'text',
        characterCount: cleaned.length,
        };
    }

    private extractMarkdown(content: Buffer | string): ExtractionResult {
        const raw = this.toUtf8(content);
        const text = this.stripMarkdown(raw);
        const cleaned = this.normaliseWhitespace(text);

        return {
        text: cleaned,
        format: 'markdown',
        characterCount: cleaned.length,
        };
    }

    private async extractPdf(content: Buffer | string): Promise<ExtractionResult> {
        // Dynamic import — pdf-parse is optional; graceful error if not installed
        let pdfParse: (buf: Buffer) => Promise<{ text: string; numpages: number }>;

        try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        pdfParse = require('pdf-parse');
        } catch {
        throw new BadRequestException(
            'PDF parsing is not available. Install pdf-parse to enable it.',
        );
        }

        const buffer =
        typeof content === 'string'
            ? Buffer.from(content, 'base64')
            : content;

        const parsed = await pdfParse(buffer);
        const cleaned = this.normaliseWhitespace(parsed.text);

        return {
        text: cleaned,
        format: 'pdf',
        pageCount: parsed.numpages,
        characterCount: cleaned.length,
        };
    }

    //  Utility methods

    private toUtf8(content: Buffer | string): string {
        return typeof content === 'string'
        ? content
        : content.toString('utf-8');
    }

    /**
     * Strip Markdown formatting, preserving the readable text.
     * Order matters — process block-level before inline.
     */
    private stripMarkdown(text: string): string {
        return text
        // Fenced code blocks
        .replace(/```[\s\S]*?```/g, '')
        // Inline code
        .replace(/`[^`]*`/g, '')
        // ATX headings (# Heading)
        .replace(/^#{1,6}\s+/gm, '')
        // Bold + italic
        .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
        .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
        // Markdown links [text](url)
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // Images ![alt](url)
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
        // Horizontal rules
        .replace(/^[-*_]{3,}\s*$/gm, '')
        // Block quotes
        .replace(/^>\s+/gm, '')
        // Unordered list markers
        .replace(/^[\-*+]\s+/gm, '')
        // Ordered list markers (1. 2. etc.)
        .replace(/^\d+\.\s+/gm, '')
        .trim();
    }

    /**
     * Normalise whitespace: collapse 3+ newlines to 2, collapse multiple spaces.
     */
    normaliseWhitespace(text: string): string {
        return text
        .replace(/\r\n/g, '\n')        // Windows line endings
        .replace(/\r/g, '\n')           // Old Mac line endings
        .replace(/\n{3,}/g, '\n\n')     // Excessive blank lines
        .replace(/[ \t]{2,}/g, ' ')     // Multiple spaces/tabs
        .trim();
    }
}
