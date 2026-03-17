import type { SiteRule } from './types.ts'

export const newsRules: SiteRule[] = [
  {
    test: u => u.includes('bbc.com') || u.includes('bbci.co.uk'),
    selector: 'article',
    title: 'article h1, h1',
    pick: $ => {
      const $div = $('<div>')
      $('[data-component="text-block"], [data-component="subheadline-block"]').each((_, el) => $div.append($(el).clone()))
      if ($div.children().length) return $div
      return $('article')
    },
  },
  {
    test: u => u.includes('france24.com'),
    selector: '.t-content__body, article',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[-–—]\s*France\s*24$/, '').trim(),
  },
  {
    test: u => u.includes('dw.com'),
    selector: '.rich-text',
    title: 'article h1, h1',
    cleanTitle: t => t.replace(/\s*[|–—]\s*DW.*$/, '').trim(),
    pick: $ => {
      const $body = $('.rich-text').first().clone()
      $body.find('.advertisement, figure, .vjs-wrapper, .rich-text-ad').remove()
      return $body
    },
  },
  {
    test: u => u.includes('aljazeera.com'),
    selector: '.wysiwyg',
    title: 'h1',
    pick: $ => {
      const $body = $('.wysiwyg').first().clone()
      $body.find('figure, section, [class*="container--ads"]').remove()
      return $body
    },
  },
  {
    test: u => u.includes('tass.com'),
    selector: '.text-content',
    title: 'h1',
  },
  {
    test: u => u.includes('yna.co.kr'),
    selector: 'article.story-news',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*\|\s*(연합뉴스|Yonhap).*$/, '').trim(),
    pick: $ => {
      const $div = $('<div>')
      $('article.story-news').children('p').each((_, el) => {
        const t = $(el).text().trim()
        if (!t) return
        // Skip email + (END) byline, keyword tags
        if (/[a-z0-9._%+-]+@[a-z0-9.-]+/i.test(t) || /\(END\)/i.test(t)) return
        $div.append($(el).clone())
      })
      return $div
    },
  },
  {
    test: u => u.includes('abc.net.au'),
    selector: '[class*="engagement_target"]',
    title: 'h1',
    pick: $ => {
      const $body = $('[class*="engagement_target"]').first().clone()
      $body.find('aside, figure, [class*="embed"], [class*="twitter"], [class*="social"]').remove()
      // Strip "Loading ... content" placeholders
      $body.find('*').each((_, el) => {
        if (/^Loading\s+\w+\s+content$/i.test($(el).text().trim())) $(el).remove()
      })
      return $body
    },
  },
  {
    test: u => u.includes('cbc.ca'),
    selector: '.story',
    title: 'h1',
    pick: $ => {
      const $div = $('<div>')
      $('.story').children('p, h2, h3').each((_, el) => $div.append($(el).clone()))
      return $div
    },
  },
  {
    test: u => u.includes('apnews.com'),
    selector: '.RichTextStoryBody',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[|–—]\s*AP News$/, '').trim(),
    pick: $ => {
      const $body = $('.RichTextStoryBody').first().clone()
      $body.find('[class*="RelatedStories"], [class*="Advertisement"], [class*="CardGrid"], [class*="HubPeek"]').remove()
      // Strip "N MIN READ" labels from related story cards
      $body.find('span, div').each((_, el) => {
        if (/^\d+\s*MIN READ$/.test($(el).text().trim())) $(el).remove()
      })
      return $body
    },
  },
  {
    test: u => u.includes('focustaiwan.tw'),
    selector: '.PrimarySide .paragraph',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[|–—]\s*Focus Taiwan$/, '').trim(),
    pick: $ => {
      const $body = $('.PrimarySide .paragraph').first().clone()
      // Strip CNA wire-service markers like "Enditem/ls"
      $body.find('p').each((_, el) => {
        if (/^Enditem/i.test($(el).text().trim())) $(el).remove()
      })
      return $body
    },
  },
  {
    test: u => u.includes('thehindu.com'),
    selector: '.articlebodycontent',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[|–—]\s*The Hindu$/, '').trim(),
    pick: $ => {
      const $body = $('.articlebodycontent').first().clone()
      $body.find('.related-topics, [class*="publish-time"], [class*="comments"], [class*="share-page"], [class*="article-ad"], [class*="spliter"]').remove()
      return $body
    },
  },
  {
    test: u => u.includes('channelnewsasia.com'),
    selector: '.content-wrapper, .content-detail__description, article',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[-–—]\s*CNA$/, '').trim(),
    pick: $ => {
      const $body = $('.content-wrapper').first().clone()
      // Strip CNA Games widget, related stories, ads
      $body.find('*').each((_, el) => {
        const t = $(el).text().trim()
        if (/^CNA Games$/i.test(t) || /^(Show More|Also worth reading|Related topics?)$/i.test(t)) {
          $(el).nextAll().remove()
          $(el).remove()
        }
      })
      $body.find('[class*="embed"], [class*="related"], [class*="ad-"]').remove()
      return $body
    },
  },
  {
    test: u => u.includes('aa.com.tr'),
    selector: '.detay-icerik, article',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[|–—]\s*Anadolu Aj?[ae]n[sc][ıi].*$/, '').trim(),
    pick: $ => {
      const $body = $('.detay-icerik').first().clone()
      // Strip empty headings, share section, related topics, subscription notice
      $body.find('.detay-paylas, h6').remove()
      $body.find('a[href*="subscription"]').each((_, el) => $(el).parent().remove())
      return $body
    },
  },
  {
    test: u => u.includes('nhk.or.jp') || u.includes('nhk.jp'),
    selector: '.p-detail__body, article, main',
    title: 'h1',
  },
  {
    test: u => u.includes('people.com.cn'),
    selector: '.rm_txt_con',
    title: 'h1, title',
    cleanTitle: t => t.replace(/\s*[-–—]+.*人民网.*$/, '').trim(),
    pick: $ => {
      const $body = $('.rm_txt_con').first().clone()
      $body.find('.edit, .page_num, .text_pic_news').remove()
      $body.find('p').each((_, el) => {
        if (/^\s*[\(（]责编[：:]/.test($(el).text())) $(el).remove()
      })
      return $body
    },
  },
  {
    test: u => u.includes('news.cctv.com'),
    selector: '.content_area',
    title: 'title',
    cleanTitle: t => t.replace(/[_\-–—]\s*(新闻频道|央视网).*$/g, '').trim(),
  },
  {
    test: u => u.includes('news.cn'),
    selector: '#detailContent',
    title: 'h1',
    cleanTitle: t => t.replace(/\s*[-–—]\s*新华网$/, '').trim(),
  },
]
