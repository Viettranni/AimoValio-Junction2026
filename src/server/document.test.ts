import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DocumentExtraction } from '@/mastra/agents/document';
import { fetchableUrl } from '@/mcp/tools/documents';
import { DocumentError, documentContent, documentMessage, documentQuestions, documentType, isShoppingList, missingSlots, sheetsToText } from './document';

const event: DocumentExtraction = {
  lang: 'fi', eventName: 'Häät', eventType: 'wedding', deliveryDate: '2026-11-28', guests: 120, budget: null,
  diets: [{ diet: 'gluten_free', guests: 12 }, { diet: 'vegan', guests: null }],
  items: [{ name: 'kanan rintafilee', quantity: null, unit: null }, { name: 'basmatiriisi', quantity: null, unit: null }],
  notes: null, unreadable: [],
};
const list: DocumentExtraction = {
  ...event, eventName: null, eventType: null, guests: null, diets: [], deliveryDate: null,
  items: [{ name: 'Laktoositon maito', quantity: 60, unit: 'l' }, { name: 'Voi', quantity: 4, unit: 'kg' }, { name: 'Ruisleipä', quantity: 120, unit: 'pcs' }],
};

describe('order documents', () => {
  it('reads every row of the demo Excel as text', async () => {
    const bytes = readFileSync('docs/demo/pikkujoulut-tilaus.xlsx');
    const content = await documentContent(bytes, 'pikkujoulut-tilaus.xlsx', '');
    expect(content.kind).toBe('text');
    const text = content.kind === 'text' ? content.text : '';
    expect(text).toContain('# Sheet: Tilaus');
    expect(text).toContain('Toimitus\t2026-12-11');
    expect(text).toContain('Laktoositon maito\t60\tl');
    expect(text).toContain('Ruisleipä\t120\tkpl\tviipaloitu');
  });

  it('sends photos and PDFs to the reader as files, and refuses what it cannot read', async () => {
    expect((await documentContent(new Uint8Array([1, 2]), 'lappu.JPG', '')).kind).toBe('image');
    expect((await documentContent(new Uint8Array([1, 2]), 'x', 'application/pdf')).kind).toBe('pdf');
    await expect(documentContent(new Uint8Array([1]), 'old.xls', '')).rejects.toThrow(/xlsx/);
    await expect(documentContent(new Uint8Array([1]), 'a.zip', 'application/zip')).rejects.toBeInstanceOf(DocumentError);
    await expect(documentContent(new Uint8Array(), 'a.png', '')).rejects.toThrow(/empty/);
    expect(documentType('a.csv', 'application/octet-stream')).toBe('text/csv');
  });

  it('caps long sheets', () => {
    const text = sheetsToText([{ sheet: 'S', data: Array.from({ length: 500 }, (_, i) => [`row ${i}`, null]) }]);
    expect(text.split('\n')).toHaveLength(402);
    expect(text).toMatch(/more rows not read/);
  });

  it('an event asks for the budget and the uncounted diet; nothing is guessed', () => {
    expect(isShoppingList(event)).toBe(false);
    expect(missingSlots(event)).toEqual(['budget', 'diets']);
    expect(documentQuestions(event)).toEqual(['Is there a budget (EUR excl. VAT), or no limit?', 'How many guests are vegan?']);
  });

  it('a list with amounts is a shopping list that needs only a date', () => {
    expect(isShoppingList(list)).toBe(true);
    expect(missingSlots(list)).toEqual(['deliveryDate']);
  });

  it('writes what was read as the buyer\'s message, unreadable lines included', () => {
    expect(documentMessage({ ...event, unreadable: ['xx kg ?'] }, 'lappu.jpg', 'fi')).toBe([
      'Muistiinpanoistani (lappu.jpg):',
      '• Tilaisuus: Häät, 120 vierasta',
      '• Toimitus: 2026-11-28',
      '• Ruokavaliot: 12 gluteeniton, vegaani',
      '• Raaka-aineet: kanan rintafilee; basmatiriisi',
      '• Ei saatu selvää: "xx kg ?"',
    ].join('\n'));
    expect(documentMessage(list, 'list.xlsx', 'en')).toContain('• Ingredients: Laktoositon maito 60 l; Voi 4 kg; Ruisleipä 120 pcs');
  });

  it('downloads only from public https URLs', () => {
    expect(fetchableUrl('https://example.com/a.xlsx').hostname).toBe('example.com');
    for (const bad of ['http://example.com/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://192.168.1.2/a', 'https://10.0.0.1/a', 'nope']) {
      expect(() => fetchableUrl(bad)).toThrow();
    }
  });
});
