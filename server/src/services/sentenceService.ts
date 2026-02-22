import db from "../config/database.js";

interface SentenceRow {
	text: string;
}

interface PoolStatsRow {
	total: string;
	avg_words: number;
	avg_chars: number;
	easy_count: string;
	medium_count: string;
	hard_count: string;
}

interface SentenceValidationResult {
	valid: boolean;
	errors: string[];
	wordCount: number;
	charCount: number;
}

class SentenceService {
	async selectSentences(count: number): Promise<string[]> {
		// Split count by difficulty: 30% EASY, remainder to MEDIUM (no HARD)
		const easyCount = Math.floor(count * 0.3);
		const mediumCount = count - easyCount;

		const baseWhere = `
			is_active = TRUE
			AND language = 'en'
			AND contains_emoji = FALSE
		`;

		const fetchByDifficulty = async (
			difficulty: string,
			limit: number,
		): Promise<string[]> => {
			const result = await db.query(
				`SELECT text FROM sentences WHERE ${baseWhere} AND difficulty = $1 ORDER BY RANDOM() LIMIT $2`,
				[difficulty, limit],
			);
			if (result.rows.length < limit) {
				throw new Error(
					`Insufficient ${difficulty} sentences in pool (need ${limit}, got ${result.rows.length})`,
				);
			}
			return result.rows.map((row: SentenceRow) => row.text);
		};

		try {
			const [easy, medium] = await Promise.all([
				fetchByDifficulty("EASY", easyCount),
				fetchByDifficulty("MEDIUM", mediumCount),
			]);

			// Order: easy first, then medium
			const all = [...easy, ...medium];

			console.log(
				`Selected ${all.length} sentences (${easyCount} easy, ${mediumCount} medium)`,
			);
			return all;
		} catch (error) {
			console.error(
				"Error selecting sentences:",
				error instanceof Error ? error.message : error,
			);
			throw error;
		}
	}

	validateSentence(text: string): SentenceValidationResult {
		const errors: string[] = [];

		const words = text.trim().split(/\s+/);

		if (words.length < 5 || words.length > 10) {
			errors.push(`Word count ${words.length} not in range [5,10]`);
		}

		if (text.length > 100) {
			errors.push(`Sentence too long: ${text.length} chars`);
		}

		if (!/^[a-zA-Z0-9\s.,!?'-]+$/.test(text)) {
			errors.push("Non-English characters detected");
		}

		// Unicode emoji ranges aren't caught by the alphanumeric check above
		const emojiRegex = /[\u{1F600}-\u{1F64F}]/u;
		if (emojiRegex.test(text)) {
			errors.push("Emoji detected");
		}

		return {
			valid: errors.length === 0,
			errors: errors,
			wordCount: words.length,
			charCount: text.length,
		};
	}

	async getPoolStats(): Promise<PoolStatsRow> {
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
			console.error(
				"Error getting pool stats:",
				error instanceof Error ? error.message : error,
			);
			throw error;
		}
	}
}

export default new SentenceService();
