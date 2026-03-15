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

  // Wait for initial tweets
  await page.waitForSelector('article', { timeout: 10000 }).catch(() => {})

  // Scroll multiple times to load more tweets
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(1500)
  }

  // Scroll back to top to ensure all loaded
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(500)

  // Extract tweets from DOM
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

      // Check if this is a reply by looking for "Replying to" text
      const replyingTo = article.querySelector('[data-testid="reply"]')

      // Check the tweet author — look for the username in status link
      const tweetUser = href.split('/')[1]?.toLowerCase() || ''

      // Only collect tweets from the target user
      if (tweetUser !== targetUser.toLowerCase()) continue

      results.push({
        id: idMatch[1],
        text: textEl.innerText || '',
        date: timeEl ? timeEl.getAttribute('datetime') : '',
        // DOM doesn't directly expose reply chain, but we can detect
        // consecutive tweets from same user as a thread
      })
    }
    return results
  }, username)

  await browser.close()

  // Post-process: detect threads by consecutive tweets from same time
  // (X shows threads as consecutive articles with close timestamps)
  if (tweets.length > 1) {
    for (let i = 1; i < tweets.length; i++) {
      const prev = tweets[i - 1]
      const curr = tweets[i]
      if (prev.date && curr.date) {
        const gap = Math.abs(new Date(prev.date).getTime() - new Date(curr.date).getTime())
        // Tweets within 2 minutes of each other from same user = likely thread
        if (gap < 120_000) {
          curr.replyToId = prev.id
          curr.convId = tweets.find((t, j) => {
            // Walk back to find thread start
            let k = i
            while (k > 0 && tweets[k].replyToId) k--
            return j === k
          })?.id || prev.id
        }
      }
    }
  }

  // Set convId for root tweets
  for (const t of tweets) {
    if (!t.convId) t.convId = t.id
    if (!t.replyToId) t.replyToId = null
  }

  process.stdout.write(JSON.stringify(tweets))
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
