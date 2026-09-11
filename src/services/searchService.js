import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';

/**
 * arXiv API로 키워드 관련 최신 논문을 검색합니다.
 * 완전 무료, API 키 불필요.
 * @param {string} keywords - 쉼표로 구분된 검색 키워드
 * @param {number} maxResults
 * @returns {Promise<Array<{title, summary, url, published}>>}
 */
export async function searchArxiv(keywords, maxResults = 5) {
  const query = keywords
    .split(',')
    .map((k) => `all:${encodeURIComponent(k.trim())}`)
    .join('+AND+');

  const url = `http://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`arXiv API 오류: ${res.status}`);

  const xml = await res.text();
  const parsed = await parseStringPromise(xml);
  const entries = parsed.feed.entry || [];

  return entries.map((e) => ({
    title: e.title[0].trim().replace(/\s+/g, ' '),
    summary: e.summary[0].trim().replace(/\s+/g, ' '),
    url: e.id[0],
    published: e.published[0],
  }));
}

/**
 * 향후 다른 소스(뉴스 API, IEEE Xplore 등)를 붙이고 싶으면
 * 이 파일에 searchNews() 같은 함수를 추가하고
 * scheduler.js의 runTopicCheck()에서 함께 호출하면 됩니다.
 */
