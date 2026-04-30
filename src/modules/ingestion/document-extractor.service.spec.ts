
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DocumentExtractorService } from './document-extractor.service';

describe('DocumentExtractorService', () => {
    let service: DocumentExtractorService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
        providers: [DocumentExtractorService],
        }).compile();

        service = module.get<DocumentExtractorService>(DocumentExtractorService);
    });

    //  detectFormat

    describe('detectFormat', () => {
        it.each([
        ['report.txt',  'text'],
        ['notes.text',  'text'],
        ['readme.md',   'markdown'],
        ['page.mdx',    'markdown'],
        ['manual.pdf',  'pdf'],
        ])('detects %s as %s', (filename, expected) => {
        expect(service.detectFormat(filename)).toBe(expected);
        });

        it('is case-insensitive for extensions', () => {
        expect(service.detectFormat('Report.TXT')).toBe('text');
        });

        it('throws BadRequestException for unsupported formats', () => {
        expect(() => service.detectFormat('image.png')).toThrow(BadRequestException);
        expect(() => service.detectFormat('doc.docx')).toThrow(BadRequestException);
        });

        it('throws for files with no extension', () => {
        expect(() => service.detectFormat('noextension')).toThrow(BadRequestException);
        });
    });

    //  extract (text)

    describe('extract — text', () => {
        it('returns extracted text with characterCount', async () => {
        const result = await service.extract('Hello World', 'test.txt');
        expect(result.text).toBe('Hello World');
        expect(result.format).toBe('text');
        expect(result.characterCount).toBe(11);
        });

        it('accepts a Buffer', async () => {
        const buf = Buffer.from('Buffer content', 'utf-8');
        const result = await service.extract(buf, 'test.txt');
        expect(result.text).toBe('Buffer content');
        });

        it('normalises Windows line endings', async () => {
        const result = await service.extract('line1\r\nline2', 'test.txt');
        expect(result.text).toBe('line1\nline2');
        });

        it('collapses excessive blank lines', async () => {
        const result = await service.extract('A\n\n\n\nB', 'test.txt');
        expect(result.text).toBe('A\n\nB');
        });
    });

    //  extract (markdown)

    describe('extract — markdown', () => {
        it('strips ATX headings', async () => {
        const result = await service.extract('# Title\n\nBody text.', 'readme.md');
        expect(result.text).toContain('Title');
        expect(result.text).toContain('Body text.');
        expect(result.text).not.toContain('#');
        });

        it('strips bold and italic markers', async () => {
        const result = await service.extract('**bold** and _italic_', 'readme.md');
        expect(result.text).toContain('bold');
        expect(result.text).toContain('italic');
        expect(result.text).not.toContain('**');
        expect(result.text).not.toContain('_');
        });

        it('converts links to plain text', async () => {
        const result = await service.extract('[Click here](https://example.com)', 'readme.md');
        expect(result.text).toContain('Click here');
        expect(result.text).not.toContain('https://');
        });

        it('strips fenced code blocks', async () => {
        const md = '```js\nconsole.log("hi")\n```';
        const result = await service.extract(md, 'readme.md');
        expect(result.text).not.toContain('console.log');
        });

        it('strips list markers', async () => {
        const md = '- Item one\n- Item two\n1. First\n2. Second';
        const result = await service.extract(md, 'readme.md');
        expect(result.text).toContain('Item one');
        expect(result.text).not.toMatch(/^[-*+]\s/m);
        expect(result.text).not.toMatch(/^\d+\.\s/m);
        });
    });

    //  normaliseWhitespace

    describe('normaliseWhitespace', () => {
        it('collapses multiple spaces to one', () => {
        expect(service.normaliseWhitespace('a   b')).toBe('a b');
        });

        it('trims leading and trailing whitespace', () => {
        expect(service.normaliseWhitespace('  hello  ')).toBe('hello');
        });

        it('preserves single paragraph breaks', () => {
        const result = service.normaliseWhitespace('para1\n\npara2');
        expect(result).toBe('para1\n\npara2');
        });
    });
});
