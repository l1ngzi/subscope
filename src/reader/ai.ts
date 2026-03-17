import type { SiteRule } from './types.ts'

export const aiRules: SiteRule[] = [
  {
    test: u => u.includes('anthropic.com'),
    selector: 'article',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[\|–—]\s*Anthropic$/, '').trim(),
    pick: $ => {
      const $body = $('[class*="Body-module"][class*="__body"]').first().clone()
      // Strip carousel pagination (e.g. "01 /04")
      $body.find('*').each((_, el) => {
        if (/^\d{2}\s*\/\d{2}$/.test($(el).text().trim())) $(el).remove()
      })
      return $body
    },
  },
  {
    test: u => /claude\.com\/blog\/.+/.test(u),
    selector: '.u-rich-text-blog',
    title: 'h1',
    pick: $ => {
      const $body = $('.u-rich-text-blog:not(.w-condition-invisible)').first().clone()
      $body.find('figure').remove()
      return $body
    },
  },
  {
    test: u => u.includes('support.claude.com') && u.includes('/articles/'),
    selector: '.article_body article',
    title: 'h1',
    pick: $ => {
      const $article = $('.article_body article').clone()
      $article.find('section.related_articles').remove()
      return $article
    },
  },
  {
    test: u => u.includes('api-docs.deepseek.com'),
    selector: '.theme-doc-markdown.markdown',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*\|.*$/, '').trim(),
  },
  {
    test: u => u.includes('x.ai/news/'),
    selector: 'article, main',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*\|\s*xAI$/, '').trim(),
    pick: $ => {
      const $prose = $('.prose.prose-invert').first().clone()
      if (!$prose.length) return $prose
      $prose.find('[class*="not-prose"]').remove()
      // Strip "Join the Journey" recruitment CTA
      $prose.find('*').each((_, el) => {
        if (/^Join the Journey$/i.test($(el).text().trim())) {
          $(el).nextAll().remove()
          $(el).remove()
        }
      })
      return $prose
    },
  },
  {
    test: u => u.includes('openai.com/index/') || u.includes('openai.com/research/'),
    selector: 'article',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*\|\s*OpenAI$/, '').trim(),
    // No feedUrl — RSS only has summaries. Cloudflare blocks HTTP, falls through to Playwright.
    pick: $ => {
      const $article = $('article').first().clone()
      // Strip "Keep reading" / related articles section, Loading... placeholders, and metadata labels
      $article.find('*').each((_, el) => {
        const t = $(el).text().trim()
        if (/^(Keep reading|View all|Loading)\.{0,3}$/i.test(t)) $(el).remove()
      })
      // Strip trailing recommended article cards (contain dates like "Mar 5, 2026")
      $article.find('[class*="CardGrid"], [class*="HubPeek"], [class*="RelatedStories"]').remove()
      return $article
    },
  },
  {
    test: u => u.includes('deepmind.google'),
    selector: 'main',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[—–-]\s*Google DeepMind$/, '').trim(),
    feedUrl: 'https://deepmind.google/blog/rss.xml',
    pick: $ => {
      const $main = $('main').clone()
      // Remove "Related Posts" section and any trailing promo sections
      $main.find('section').each((_, el) => {
        if (/related\s+posts/i.test($(el).text())) $(el).remove()
      })
      const sections = $main.find('main > section, section').toArray()
      if (sections.length > 0) {
        const last = sections[sections.length - 1]
        if (last && $(last).find('p').length === 0) $(last).remove()
      }
      // Strip hero metadata (date, category, author name)
      $main.find('*').each((_, el) => {
        const t = $(el).text().trim()
        if (/^\w+\s+\d{1,2},\s+\d{4}$/i.test(t)) $(el).remove() // "March 10, 2026"
        if (/^(Research|Blog post|Article)$/i.test(t)) $(el).remove()
      })
      return $main
    },
  },
  {
    test: u => u.includes('blog.google'),
    selector: 'article, main',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[|–—]\s*(Google|The Keyword).*$/, '').trim(),
    pick: $ => {
      const $body = $('.article-container__content, section.article-container, article').first().clone()
      $body.find('[class*="related"], [class*="newsletter"], [class*="social"], [class*="author-container"], footer, .article-hero, .audio-player-tts, [class*="article-tags"]').remove()
      return $body
    },
  },
  {
    test: u => u.includes('nvidianews.nvidia.com') || u.includes('nvidia.com/blog'),
    selector: '.article-body, article, main',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[|–—]\s*NVIDIA$/, '').trim(),
  },
  // ── Other ──
  {
    test: u => u.includes('github.com') && /\/releases\/tag\//.test(u),
    selector: '.markdown-body',
    title: 'title',
    cleanTitle: t => t.replace(/\s*·\s*GitHub$/, '').trim(),
    pick: $ => $('[data-test-selector="body-content"]').first(),
  },
]
