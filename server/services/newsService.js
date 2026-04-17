// ---------------------------------------------------------------------------
// News Service
// Fetches breaking sports news from NewsAPI.org for relevance to tipped fixtures
// ---------------------------------------------------------------------------

const https = require('https');

class NewsService {
  constructor() {
    this.apiKey = process.env.NEWS_API_KEY || '';
    this._cache = new Map();
    this._cacheTTL = 15 * 60 * 1000; // 15 minutes
    if (this.apiKey) {
      console.log('[News] NewsAPI configured');
    } else {
      console.log('[News] No NEWS_API_KEY — news service disabled');
    }
  }

  isAvailable() { return !!this.apiKey; }

  /**
   * Internal: make a GET request to NewsAPI
   */
  _fetch(url) {
    var self = this;
    return new Promise(function(resolve, reject) {
      // Check cache
      var cached = self._cache.get(url);
      if (cached && (Date.now() - cached.timestamp) < self._cacheTTL) {
        return resolve(cached.data);
      }

      https.get(url, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try {
            var parsed = JSON.parse(data);
            if (parsed.status === 'ok') {
              var articles = (parsed.articles || []).map(function(a) {
                return {
                  title: a.title || '',
                  description: a.description || '',
                  url: a.url || '',
                  source: (a.source && a.source.name) ? a.source.name : '',
                  publishedAt: a.publishedAt || '',
                  urlToImage: a.urlToImage || '',
                };
              });
              self._cache.set(url, { data: articles, timestamp: Date.now() });
              resolve(articles);
            } else {
              console.error('[News] API error:', parsed.message || 'Unknown error');
              resolve([]);
            }
          } catch (e) {
            console.error('[News] Parse error:', e.message);
            resolve([]);
          }
        });
      }).on('error', function(err) {
        console.error('[News] Request error:', err.message);
        resolve([]);
      });
    });
  }

  /**
   * Fetch latest UK sports headlines
   */
  async fetchSportsNews() {
    try {
      if (!this.isAvailable()) return [];
      var url = 'https://newsapi.org/v2/top-headlines?country=gb&category=sports&pageSize=20&apiKey=' + this.apiKey;
      return await this._fetch(url);
    } catch (err) {
      console.error('[News] fetchSportsNews error:', err.message);
      return [];
    }
  }

  /**
   * Fetch news about a specific team
   */
  async fetchTeamNews(teamName) {
    try {
      if (!this.isAvailable() || !teamName) return [];
      var encoded = encodeURIComponent('"' + teamName + '"');
      var url = 'https://newsapi.org/v2/everything?q=' + encoded + '&language=en&sortBy=publishedAt&pageSize=10&apiKey=' + this.apiKey;
      var articles = await this._fetch(url);

      // Filter to last 48 hours
      var cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      return articles.filter(function(a) {
        return a.publishedAt && a.publishedAt >= cutoff;
      });
    } catch (err) {
      console.error('[News] fetchTeamNews error:', err.message);
      return [];
    }
  }

  /**
   * Fetch horse racing news
   */
  async fetchRacingNews() {
    try {
      if (!this.isAvailable()) return [];
      var url = 'https://newsapi.org/v2/everything?q=horse+racing+UK&language=en&sortBy=publishedAt&pageSize=10&apiKey=' + this.apiKey;
      var articles = await this._fetch(url);

      // Filter to last 24 hours
      var cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      return articles.filter(function(a) {
        return a.publishedAt && a.publishedAt >= cutoff;
      });
    } catch (err) {
      console.error('[News] fetchRacingNews error:', err.message);
      return [];
    }
  }

  /**
   * Scan for news relevant to today's tipped selections
   */
  async scanForRelevantNews(tips) {
    try {
      if (!this.isAvailable() || !tips || tips.length === 0) return [];

      var relevantKeywords = [
        'injury', 'ruled out', 'doubt', 'suspended', 'banned', 'fitness',
        'lineup', 'team news', 'non-runner', 'withdrawn', 'doubtful',
        'hamstring', 'knee', 'ankle', 'muscle', 'concussion',
      ];

      // Extract unique team/selection names (max 5 to manage API quota)
      var names = [];
      for (var i = 0; i < tips.length && names.length < 5; i++) {
        var tip = tips[i];
        if (tip.sport === 'football' && tip.event) {
          // Extract team names from event string (e.g. "Arsenal vs Chelsea")
          var parts = tip.event.split(/\s+(?:vs?\.?|at|@)\s+/i);
          for (var p = 0; p < parts.length; p++) {
            var name = parts[p].trim();
            if (name && names.indexOf(name) === -1 && names.length < 5) {
              names.push(name);
            }
          }
        } else if (tip.sport === 'racing' && tip.selection) {
          // Use horse name for racing tips
          var horseName = tip.selection.replace(/\s*\([A-Za-z]{2,4}\)\s*$/, '').trim();
          if (horseName && names.indexOf(horseName) === -1 && names.length < 5) {
            names.push(horseName);
          }
        }
      }

      var results = [];

      // Fetch news for each unique name
      for (var ni = 0; ni < names.length; ni++) {
        var articles = await this.fetchTeamNews(names[ni]);
        if (articles.length === 0) continue;

        // Find matching tips
        var matchingTips = tips.filter(function(t) {
          var eventStr = ((t.event || '') + ' ' + (t.selection || '')).toLowerCase();
          return eventStr.indexOf(names[ni].toLowerCase()) !== -1;
        });

        // Determine relevance
        for (var ai = 0; ai < articles.length; ai++) {
          var article = articles[ai];
          var articleText = ((article.title || '') + ' ' + (article.description || '')).toLowerCase();
          var foundKeywords = [];

          for (var ki = 0; ki < relevantKeywords.length; ki++) {
            if (articleText.indexOf(relevantKeywords[ki]) !== -1) {
              foundKeywords.push(relevantKeywords[ki]);
            }
          }

          var relevance = 'low';
          if (foundKeywords.length > 0) {
            // Check for high-relevance keywords (injury/withdrawal)
            var highKeywords = ['injury', 'ruled out', 'suspended', 'banned', 'non-runner', 'withdrawn'];
            var hasHigh = foundKeywords.some(function(kw) {
              return highKeywords.indexOf(kw) !== -1;
            });
            relevance = hasHigh ? 'high' : 'medium';
          } else if (articleText.indexOf(names[ni].toLowerCase()) !== -1) {
            relevance = 'medium';
          }

          results.push({
            searchTerm: names[ni],
            tips: matchingTips,
            article: article,
            relevance: relevance,
            keywords: foundKeywords,
          });
        }
      }

      // Also fetch general racing news if we have racing tips
      var hasRacing = tips.some(function(t) { return t.sport === 'racing'; });
      if (hasRacing) {
        var racingNews = await this.fetchRacingNews();
        for (var ri = 0; ri < racingNews.length; ri++) {
          var rArticle = racingNews[ri];
          var rText = ((rArticle.title || '') + ' ' + (rArticle.description || '')).toLowerCase();
          var rKeywords = [];
          for (var rki = 0; rki < relevantKeywords.length; rki++) {
            if (rText.indexOf(relevantKeywords[rki]) !== -1) {
              rKeywords.push(relevantKeywords[rki]);
            }
          }
          results.push({
            searchTerm: 'Horse Racing',
            tips: [],
            article: rArticle,
            relevance: rKeywords.length > 0 ? 'medium' : 'low',
            keywords: rKeywords,
          });
        }
      }

      // Sort: high relevance first, then medium, then low
      var order = { high: 0, medium: 1, low: 2 };
      results.sort(function(a, b) {
        return (order[a.relevance] || 2) - (order[b.relevance] || 2);
      });

      return results;
    } catch (err) {
      console.error('[News] scanForRelevantNews error:', err.message);
      return [];
    }
  }

  /**
   * Format news results as HTML digest
   */
  formatNewsDigest(relevantNews) {
    if (!relevantNews || relevantNews.length === 0) {
      return '<p>No breaking news affecting today\'s selections.</p>';
    }

    var html = '';
    var grouped = { high: [], medium: [], low: [] };
    for (var i = 0; i < relevantNews.length; i++) {
      var r = relevantNews[i].relevance || 'low';
      if (grouped[r]) grouped[r].push(relevantNews[i]);
    }

    if (grouped.high.length > 0) {
      html += '<h4 style="color:#ef4444;">\u26A0\uFE0F High Impact News</h4><ul>';
      for (var hi = 0; hi < grouped.high.length; hi++) {
        var h = grouped.high[hi];
        html += '<li><strong>' + (h.article.source || '') + ':</strong> ';
        html += '<a href="' + (h.article.url || '#') + '" target="_blank">' + (h.article.title || '') + '</a>';
        if (h.keywords.length > 0) {
          html += ' <span style="color:#ef4444;">(' + h.keywords.join(', ') + ')</span>';
        }
        html += '</li>';
      }
      html += '</ul>';
    }

    if (grouped.medium.length > 0) {
      html += '<h4 style="color:#f59e0b;">\uD83D\uDCF0 Team Updates</h4><ul>';
      for (var mi = 0; mi < grouped.medium.length; mi++) {
        var m = grouped.medium[mi];
        html += '<li><strong>' + (m.article.source || '') + ':</strong> ';
        html += '<a href="' + (m.article.url || '#') + '" target="_blank">' + (m.article.title || '') + '</a></li>';
      }
      html += '</ul>';
    }

    if (grouped.low.length > 0) {
      html += '<h4 style="color:var(--text-secondary);">\uD83D\uDCCB General Sports News</h4><ul>';
      for (var li = 0; li < Math.min(grouped.low.length, 5); li++) {
        var l = grouped.low[li];
        html += '<li><strong>' + (l.article.source || '') + ':</strong> ';
        html += '<a href="' + (l.article.url || '#') + '" target="_blank">' + (l.article.title || '') + '</a></li>';
      }
      html += '</ul>';
    }

    return html;
  }
}

module.exports = new NewsService();
