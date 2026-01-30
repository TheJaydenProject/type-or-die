import db from '../config/database.js';

interface SentenceValidationResult {
  valid: boolean;
  errors: string[];
  wordCount: number;
  charCount: number;
}

class SentenceService {
  private CACHE_PREFIX: string;
  private CACHE_TTL: number;

  constructor() {
    this.CACHE_PREFIX = 'sentences:pool:';
    this.CACHE_TTL = 3600;
  }

  async selectSentences(count: number): Promise<string[]> {
    // TABLESAMPLE BERNOULLI is efficient for large tables but imprecise for small ones
    const query = `
      SELECT text
      FROM sentences TABLESAMPLE BERNOULLI(10)
      WHERE 
        is_active = TRUE
        AND language = 'en'
        AND contains_emoji = FALSE
        AND word_count BETWEEN 5 AND 10
      ORDER BY RANDOM()
      LIMIT $1
    `;

    try {
      const result = await db.query(query, [count]);
      
      // Fallback: If Bernoulli sampling yields insufficient rows (common in small tables),
      // force a standard full-table scan.
      if (result.rows.length < count) {
        const fallbackQuery = `
          SELECT text
          FROM sentences
          WHERE 
            is_active = TRUE
            AND language = 'en'
            AND contains_emoji = FALSE
            AND word_count BETWEEN 5 AND 10
          ORDER BY RANDOM()
          LIMIT $1
        `;
        const fallbackResult = await db.query(fallbackQuery, [count]);
        
        if (fallbackResult.rows.length < count) {
          throw new Error(
            `Insufficient sentences in pool. Need ${count}, got ${fallbackResult.rows.length}`
          );
        }
        
        const sentences = fallbackResult.rows.map((row: any) => row.text);
        console.log(`Used fallback query for ${sentences.length} sentences`);
        return sentences;
      }

      const sentences = result.rows.map((row: any) => row.text);

      console.log(`Selected ${sentences.length} random sentences`);
      // Debug logging for sample verification
      if (sentences.length > 0) {
        console.log(`   Sample: "${sentences[0]}" ... "${sentences[sentences.length - 1]}"`);
      }
      
      return sentences;

    } catch (error: any) {
      console.error('Error selecting sentences:', error.message);
      throw error;
    }
  }

  validateSentence(text: string): SentenceValidationResult {
    const errors: string[] = [];
    
    // Normalize spaces
    const words = text.trim().split(/\s+/);
    
    if (words.length < 5 || words.length > 10) {
      errors.push(`Word count ${words.length} not in range [5,10]`);
    }
    
    if (text.length > 100) {
      errors.push(`Sentence too long: ${text.length} chars`);
    }
    
    // Strict alphanumeric check + basic punctuation
    if (!/^[a-zA-Z0-9\s.,!?'-]+$/.test(text)) {
      errors.push('Non-English characters detected');
    }
    
    // Basic emoji range check
    const emojiRegex = /[\u{1F600}-\u{1F64F}]/u;
    if (emojiRegex.test(text)) {
      errors.push('Emoji detected');
    }
    
    return {
      valid: errors.length === 0,
      errors: errors,
      wordCount: words.length,
      charCount: text.length
    };
  }

  async getPoolStats(): Promise<any> {
    const query = `
      SELECT 
        COUNT(*) as total,
        AVG(word_count)::int as avg_words,
        AVG(char_count)::int as avg_chars,
        COUNT(CASE WHEN difficulty = 'EASY' THEN 1 END) as easy_count,
        COUNT(CASE WHEN difficulty = 'MEDIUM' THEN 1 END) as medium_count,
        COUNT(CASE WHEN difficulty = 'HARD' THEN 1 END) as hard_count
      FROM sentences
      WHERE is_active = TRUE
    `;

    try {
      const result = await db.query(query);
      return result.rows[0];
    } catch (error: any) {
      console.error('Error getting pool stats:', error.message);
      throw error;
    }
  }
}

export default new SentenceService();