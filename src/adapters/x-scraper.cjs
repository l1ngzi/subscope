// Node-only script — scrapes X profile via Playwright
// Usage: node x-scraper.cjs <username> <auth_token>
// Output: JSON array of { id, text, date, replyToId, convId } to stdout

const { chromium } = require('playwright')

const [,, username, authToken] = process.argv

if (!username || !authToken) {
  console.error('Usage: node x-scraper.cjs <username> <auth_token>')
  process.exit(1)
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()

  await context.addCookies([{
    name: 'auth_token',
    value: authToken,
    domain: '.x.com',
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'None',
  }])

  const page = await context.newPage()
  await page.goto(`https://x.com/${username}`, {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  })

  await page.waitForSelector('article', { timeout: 10000 }).catch(() => {})

  // Scroll to load more tweets
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(1500)
  }

  // Extract tweets from DOM
  // X profile shows threads as consecutive articles.
  // Between threads there's usually a "Show this thread" link or a gap.
  // We detect threads by checking if an article has the "thread indicator"
  // (a vertical line connecting to the next tweet).
  const tweets = await page.evaluate((targetUser) => {
    const articles = document.querySelectorAll('article')
    const results = []

    for (const article of articles) {
      const textEl = article.querySelector('[data-testid="tweetText"]')
      const timeEl = article.querySelector('time')
      const statusLink = article.querySelector('a[href*="/status/"]')

      if (!textEl || !statusLink) continue

      const href = statusLink.getAttribute('href') || ''
      const idMatch = href.match(/\/status\/(\d+)/)
      if (!idMatch) continue

      const tweetUser = href.split('/')[1]?.toLowerCase() || ''
      if (tweetUser !== targetUser.toLowerCase()) continue

      // Detect if this tweet connects to the next (thread indicator)
      // X uses a vertical line/connector between thread tweets
      const hasThreadLine = article.querySelector('[data-testid="Tweet-User-Avatar"] + div') !== null
        || article.innerHTML.includes('self-stretch')

      results.push({
        id: idMatch[1],
        text: textEl.innerText || '',
        date: timeEl ? timeEl.getAttribute('datetime') : '',
        isPartOfThread: false, // will be set in post-processing
      })
    }
    return results
  }, username)

  await browser.close()

  // Post-process: detect threads
  // On a profile page, threads appear as consecutive tweets from the same user.
  // The FIRST tweet in a group of consecutive same-user tweets is the root.
  // Subsequent ones are replies in the thread.
  // A "gap" (different date by > 1 hour) between consecutive tweets starts a new thread.
  const ONE_HOUR = 3600_000

  for (let i = 0; i < tweets.length; i++) {
    tweets[i].replyToId = null
    tweets[i].convId = tweets[i].id
  }

  for (let i = 1; i < tweets.length; i++) {
    const prev = tweets[i - 1]
    const curr = tweets[i]

    if (!prev.date || !curr.date) continue

    const gap = Math.abs(new Date(curr.date).getTime() - new Date(prev.date).getTime())

    // Consecutive tweets within 1 hour = same thread
    if (gap < ONE_HOUR) {
      // Find the thread root by walking back
      let rootIdx = i - 1
      while (rootIdx > 0 && tweets[rootIdx].replyToId !== null) {
        rootIdx--
      }
      curr.replyToId = prev.id
      curr.convId = tweets[rootIdx].id
      // Also update all tweets in this thread to share convId
      for (let j = rootIdx; j <= i; j++) {
        tweets[j].convId = tweets[rootIdx].id
      }
    }
  }

  process.stdout.write(JSON.stringify(tweets))
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
