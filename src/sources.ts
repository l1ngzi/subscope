// ── Source registry ──
// All sources are defined here. Config only stores active/inactive state.
// To add a source: add an entry below. To remove: delete it.

import type { SourceType } from './types.ts'

export interface SourceDef {
  url: string
  group: string
  type?: SourceType // default: auto-detect
}

const S = (url: string, group: string, type?: SourceType): SourceDef => ({ url, group, type })

export const SOURCE_REGISTRY: SourceDef[] = [
  // ── AI / Anthropic ──
  S('https://www.anthropic.com/blog', 'ai/anthropic'),
  S('https://www.anthropic.com/research', 'ai/anthropic'),
  S('https://www.anthropic.com/engineering', 'ai/anthropic'),
  S('https://www.youtube.com/@anthropic-ai', 'ai/anthropic', 'youtube'),
  S('https://x.com/AnthropicAI', 'ai/anthropic', 'twitter'),

  // ── AI / Claude ──
  S('https://www.claude.com/blog', 'ai/claude'),
  S('https://support.claude.com/en/collections/18031876-usage-and-limits', 'ai/claude'),
  S('https://support.claude.com/en/articles/12138966-release-notes', 'ai/claude'),
  S('https://www.youtube.com/@claude', 'ai/claude', 'youtube'),
  S('https://x.com/claudeai', 'ai/claude', 'twitter'),

  // ── AI / OpenAI ──
  S('https://openai.com/news/rss.xml', 'ai/openai'),
  S('https://www.youtube.com/@OpenAI', 'ai/openai', 'youtube'),
  S('https://x.com/OpenAI', 'ai/openai', 'twitter'),

  // ── AI / DeepMind ──
  S('https://deepmind.google/blog/rss.xml', 'ai/deepmind'),
  S('https://www.youtube.com/@GoogleDeepMind', 'ai/deepmind', 'youtube'),
  S('https://x.com/GoogleDeepMind', 'ai/deepmind', 'twitter'),

  // ── AI / DeepSeek ──
  S('https://api-docs.deepseek.com/updates', 'ai/deepseek'),
  S('https://x.com/deepseek_ai', 'ai/deepseek', 'twitter'),

  // ── AI / xAI ──
  S('https://x.ai/news', 'ai/xai'),
  S('https://x.com/xai', 'ai/xai', 'twitter'),

  // ── Economics / Central Banks ──
  S('https://www.federalreserve.gov/feeds/press_monetary.xml', 'econ/fed'),
  S('https://www.ecb.europa.eu/rss/press.html', 'econ/ecb'),
  S('https://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html', 'econ/pboc'),
  S('https://www.boj.or.jp/en/about/press/index.htm', 'econ/boj'),

  // ── Economics / China Regulators ──
  S('https://www.stats.gov.cn/sj/zxfb/', 'econ/nbs'),
  S('http://www.csrc.gov.cn/csrc/c100028/common_list.shtml', 'econ/csrc'),
  S('https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/', 'econ/mof'),
  S('https://www.safe.gov.cn/safe/whxw/index.html', 'econ/safe'),
  S('https://www.nfra.gov.cn/cn/view/pages/ItemList.html?itemPId=914&itemId=915&itemUrl=ItemListRightList.html&itemName=监管动态', 'econ/nfra'),

  // ── Economics / US & International ──
  S('https://efts.sec.gov/LATEST/search-index?q=%22%22&forms=8-K', 'econ/sec'),
  S('https://www.bea.gov/news/current-releases', 'econ/bea'),
  S('https://www.bls.gov/feed/bls_latest.rss', 'econ/bls'),
  S('https://home.treasury.gov/news/press-releases', 'econ/treasury'),
  S('https://www.imf.org/en/News', 'econ/imf'),

  // ── News / China ──
  S('https://news.cctv.com/world/', 'news/cctv'),
  S('https://news.cctv.com/china/', 'news/cctv'),
  S('http://www.news.cn/world/', 'news/xinhua'),
  S('http://www.news.cn/china/', 'news/xinhua'),
  S('http://world.people.com.cn/', 'news/people'),

  // ── News / Global ──
  S('https://feeds.bbci.co.uk/news/world/rss.xml', 'news/bbc'),
  S('https://www.france24.com/en/rss', 'news/france24'),
  S('https://rss.dw.com/rdf/rss-en-all', 'news/dw'),
  S('https://www3.nhk.or.jp/nhkworld/en/news/', 'news/nhk'),
  S('https://www.aljazeera.com/xml/rss/all.xml', 'news/aljazeera'),
  S('https://tass.com/rss/v2.xml', 'news/tass'),
  S('https://en.yna.co.kr/RSS/news.xml', 'news/yonhap'),
  S('https://www.abc.net.au/news/feed/45910/rss.xml', 'news/abc-au'),
  S('https://rss.cbc.ca/lineup/world.xml', 'news/cbc'),
  S('https://apnews.com/hub/world-news', 'news/ap'),
  S('https://feeds.feedburner.com/rsscna/engnews/', 'news/focustw'),
  S('https://www.thehindu.com/news/international/feeder/default.rss', 'news/thehindu'),

  // ── Energy ──
  S('https://www.iea.org/news', 'energy/iea'),
  S('https://www.eia.gov/rss/todayinenergy.xml', 'energy/eia'),
  S('https://www.energy.gov/newsroom', 'energy/doe'),
  S('https://www.opec.org/press-releases.html', 'energy/opec'),
  S('https://www.irena.org/News', 'energy/irena'),

  // ── International Organizations ──
  S('https://news.un.org/feed/subscribe/en/news/all/rss.xml', 'intl/un'),
  S('https://www.who.int/rss-feeds/news-english.xml', 'intl/who'),
  S('https://www.iaea.org/newscenter/pressreleases', 'intl/iaea'),
  S('https://www.wto.org/english/news_e/news_e.htm', 'intl/wto'),

  // ── Regulation ──
  S('https://ec.europa.eu/commission/presscorner/home/en', 'reg/eu'),
  S('https://www.ftc.gov/feeds/press-release.xml', 'reg/ftc'),
]
