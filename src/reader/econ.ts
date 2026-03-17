import type { SiteRule } from './types.ts'

export const econRules: SiteRule[] = [
  {
    test: u => u.includes('bea.gov'),
    selector: '.field--name-body.field--item',
    title: 'title',
    cleanTitle: t => t.replace(/\s*\|.*$/, '').trim(),
    pick: $ => $('.field--name-body.field--item').first(),
  },
  {
    test: u => u.includes('pbc.gov.cn'),
    selector: '#zoom',
    title: '.zw_title, h1, title',
  },
  {
    test: u => u.includes('stats.gov.cn'),
    selector: '.txt-content',
    title: 'title',
    cleanTitle: t => t.replace(/\s*[-–—]\s*国家统计局.*$/, '').trim(),
  },
  {
    test: u => u.includes('federalreserve.gov'),
    selector: '#article .col-xs-12.col-sm-8.col-md-8',
    title: '#article h3.title, h3.title',
    pick: $ => {
      const divs = $('#article .col-xs-12.col-sm-8.col-md-8')
      return divs.length > 1 ? divs.eq(1) : divs
    },
  },
  {
    test: u => u.includes('sec.gov/Archives'),
    selector: 'body',
    title: 'title',
    pick: $ => {
      const $body = $('body').clone()
      $body.find('[style*="display:none"], [style*="display: none"], ix\\:hidden, .xbrl').remove()
      return $body
    },
  },
  {
    test: u => u.includes('bls.gov'),
    selector: '#bodytext, pre, .centerDiv',
    headers: {
      'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1',
    },
    title: 'h2, h1, title',
    pick: $ => {
      const $body = $('#bodytext').first().clone()
      if (!$body.length) return $('pre').first().clone()
      // Convert <pre> blocks to <p> paragraphs, truncate at "Technical Note"
      $body.find('pre').each((_, el) => {
        let text = $(el).text()
        const techIdx = text.indexOf('Technical Note')
        if (techIdx > 0) text = text.slice(0, techIdx)
        const $div = $('<div>')
        text.split(/\n{2,}/).forEach(p => {
          const t = p.trim().replace(/\n/g, ' ')
          if (t) $div.append(`<p>${t}</p>`)
        })
        $(el).replaceWith($div)
      })
      // Strip embargo header
      const $first = $body.find('p').first()
      if (/^Transmission of material/i.test($first.text())) $first.remove()
      // Strip Table N listings, footer links, and metadata
      $body.children('div, span').each((_, el) => {
        const t = $(el).text().trim()
        if (/^Table \d+\./i.test(t) || /^(HTML version|The PDF version|News release charts|Supplemental Files|Table of Contents$|Last Modified)/i.test(t)) $(el).remove()
      })
      return $body
    },
  },
  {
    test: u => u.includes('ecb.europa.eu'),
    selector: 'main .section',
    title: 'main .title h1, title',
  },
  {
    test: u => u.includes('home.treasury.gov'),
    selector: 'article, .node__content',
    title: 'title',
    cleanTitle: t => t.replace(/\s*\|\s*U\.S\. Department.*$/, '').trim(),
    pick: $ => {
      const $article = $('article .field--name-body .field__item')
      if ($article.length && $article.text().trim().length > 100) return $article
      const $newsBody = $('.field--name-field-news-body')
      if ($newsBody.length && $newsBody.text().trim().length > 100) return $newsBody
      const desc = $('meta[property="og:description"]').attr('content')
      if (desc) {
        const $div = $('<div>')
        desc.split(/\s{2,}/).forEach(p => $div.append(`<p>${p.trim()}</p>`))
        return $div
      }
      return $('body')
    },
  },
  {
    test: u => u.includes('imf.org'),
    selector: 'article .column-padding, article',
    title: 'h1, title',
    cleanTitle: t => t.replace(/\s*[-–]\s*IMF$/, '').trim(),
    pick: $ => {
      const $body = $('article .column-padding, article').first().clone()
      // Strip IMF Communications Department footer block
      $body.find('*').each((_, el) => {
        const t = $(el).text().trim()
        if (/^IMF Communications Department$/i.test(t) || /^MEDIA RELATIONS$/i.test(t) || /^PRESS OFFICER$/i.test(t)) {
          $(el).nextAll().remove()
          $(el).remove()
        }
      })
      return $body
    },
  },
  {
    test: u => u.includes('csrc.gov.cn'),
    selector: '.detail-news',
    title: 'title',
    cleanTitle: t => t.replace(/\s*[-–—_]\s*中国证券监督管理委员会.*$/, '').trim(),
  },
  {
    test: u => u.includes('mof.gov.cn'),
    selector: '.xwfb_content, .TRS_Editor, .pages_content',
    title: 'title',
    cleanTitle: t => t.replace(/\s*[-–—_]\s*中华人民共和国财政部.*$/, '').trim(),
  },
  {
    test: u => u.includes('safe.gov.cn'),
    selector: '.detail_content, .Custom_UnionStyle',
    title: 'title',
    cleanTitle: t => t.replace(/\s*[_\-–—]\s*(国家外汇管理局|数据解读|要闻发布|政策法规解读|公开招考|通知公告).*$/, '').trim(),
  },
  {
    test: u => u.includes('nfra.gov.cn'),
    selector: '.Section0, .content, article',
    title: '.wenzhang-title.ng-binding, h1, .detail-title, title',
    cleanTitle: t => t.replace(/\s*[-–—_]\s*国家金融监督管理总局.*$/, '').trim(),
  },
  {
    test: u => u.includes('boj.or.jp'),
    selector: 'div.outline, main#contents',
    title: 'main#contents h1, h1',
    cleanTitle: t => t
      .replace(/\s*\[Speech\]\s*/i, '')
      .replace(/\s*[-–—]\s*Bank of Japan$/, '')
      .replace(/(.)(?=Speech at |Remarks at |Address at |Keynote )/g, '$1 — ')
      .trim(),
  },
  {
    test: u => u.includes('eia.gov/todayinenergy'),
    selector: '.tie-article',
    title: '.tie-article h2, title',
    cleanTitle: t => t.replace(/\s*[-–—]\s*(U\.S\. Energy|Today in Energy|EIA).*$/, '').trim(),
  },
  {
    test: u => u.includes('iea.org'),
    selector: 'article, main',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[-–—|]\s*IEA$/, '').trim(),
    pick: $ => {
      const $body = $('section.o-page, article, main').first().clone()
      // Strip leading metadata (category label "News", date, share buttons)
      $body.find('*').each((_, el) => {
        const t = $(el).text().trim()
        if (/^(News|Press release|Commentary|Report)$/i.test(t) || /^\d{1,2}\s+\w+\s+\d{4}$/.test(t)) $(el).remove()
      })
      return $body
    },
  },
  {
    test: u => u.includes('consumerfinance.gov'),
    selector: '.m-full-width-text, article, main',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[|–—]\s*Consumer Financial Protection Bureau$/, '').trim(),
  },
  {
    test: u => u.includes('iaea.org'),
    selector: 'article, .field--name-body',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*\|\s*IAEA$/, '').trim(),
  },
  // EU Presscorner: handled via JSON API in reader/index.ts (Angular SPA bypass)
  {
    test: u => u.includes('cftc.gov'),  // before ftc.gov (cftc.gov contains ftc.gov)
    selector: 'article .field--name-body',
    title: 'title',
    cleanTitle: t => t.replace(/\s*\|\s*CFTC$/, '').trim(),
  },
  {
    test: u => u.includes('ftc.gov'),
    selector: '.node__content .field--name-body',
    title: 'h1.node-title',
    cleanTitle: t => t.replace(/\s*\|\s*(Federal Trade Commission|FTC)$/, '').trim(),
  },
  {
    test: u => u.includes('nato.int'),
    selector: '.ca04-rich-text',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[-–—]\s*NATO$/, '').replace(/^NATO\s*[-–—]\s*/, '').trim(),
  },
  {
    test: u => u.includes('news.un.org'),
    selector: '.paragraph--type--one-column-text',
    title: 'h1, title',
    cleanTitle: t => t.replace(/\s*\|\s*UN News$/, '').trim(),
    pick: $ => {
      const $body = $('.paragraph--type--one-column-text').first().clone()
      $body.find('[class*="twitter"], [class*="soundcloud"], [class*="embed"], [class*="social-media"]').remove()
      // Strip bare platform names from embed placeholders
      $body.find('*').each((_, el) => {
        if (/^(Soundcloud|Tweet URL|Instagram)$/i.test($(el).text().trim())) $(el).remove()
      })
      return $body
    },
  },
  {
    test: u => u.includes('who.int'),
    selector: 'article, .content-block',
    title: 'h1',
  },
  {
    test: u => u.includes('wto.org'),
    selector: '.centerCol',
    title: 'h1, title',
    cleanTitle: t => t.replace(/\s*[-–—|]\s*WTO.*$/, '').trim(),
  },
]
