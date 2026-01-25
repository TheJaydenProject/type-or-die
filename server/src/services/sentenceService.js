const db = require('../config/database');
const redis = require('../config/redis');

class SentenceService {
  constructor() {
    this.CACHE_PREFIX = 'sentences:pool:';
    this.CACHE_TTL = 3600;
  }

  async selectSentences(count) {
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
        
        const sentences = fallbackResult.rows.map(row => row.text);
        console.log(`Used fallback query for ${sentences.length} sentences`);
        return sentences;
      }

      const sentences = result.rows.map(row => row.text);

      console.log(`Selected ${sentences.length} random sentences`);
      console.log(`   Sample: "${sentences[0]}" ... "${sentences[sentences.length - 1]}"`);
      
      return sentences;

    } catch (error) {
      console.error('Error selecting sentences:', error.message);
      throw error;
    }
  }

  validateSentence(text) {
    const errors = [];
    
    const words = text.trim().split(/\s+/);
    if (words.length < 5 || words.length > 10) {
      errors.push(`Word count ${words.length} not in range [5,10]`);
    }
    
    if (text.length > 100) {
      errors.push(`Sentence too long: ${text.length} chars`);
    }
    
    if (!/^[a-zA-Z0-9\s.,!?'-]+$/.test(text)) {
      errors.push('Non-English characters detected');
    }
    
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

  async getPoolStats() {
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
    } catch (error) {
      console.error('Error getting pool stats:', error.message);
      throw error;
    }
  }
}

module.exports = new SentenceService();