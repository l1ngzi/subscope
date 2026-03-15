// Node-only script — extracts X auth_token from Chrome's existing session
// Usage: node x-auth.cjs
// Output: auth_token value to stdout

const { chromium } = require('playwright')
const { join } = require('path')
const { homedir } = require('os')

const CHROME_USER_DATA = join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data')

async function main() {
  // Launch Chrome with the user's actual profile — already logged in
  const context = await chromium.launchPersistentContext(CHROME_USER_DATA, {
    headless: false,
    channel: 'chrome',
    args: ['--profile-directory=Default'],
  })

  const page = await context.newPage()
  await page.goto('https://x.com/home', {
    waitUntil: 'domcontentloaded',
    timeout: 15000,
  })

  const url = page.url()
  const isLoggedIn = !url.includes('/login') && !url.includes('/i/flow')

  if (isLoggedIn) {
    // Already logged in — grab cookie and close
    const cookies = await context.cookies('https://x.com')
    const token = cookies.find(c => c.name === 'auth_token')?.value
    await page.close()
    await context.close()
    if (token) {
      process.stdout.write(token)
      return
    }
    process.stderr.write('Logged in but no auth_token cookie found.\n')
    process.exit(1)
  }

  // Not logged in — navigate to login, wait for user
  await page.goto('https://x.com/login', {
    waitUntil: 'domcontentloaded',
    timeout: 15000,
  })
  process.stderr.write('Please log in to X in the browser window...\n')

  // Poll for auth_token cookie (2 minutes max)
  let token = null
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000)
    const cookies = await context.cookies('https://x.com')
    const found = cookies.find(c => c.name === 'auth_token')
    if (found) {
      token = found.value
      break
    }
  }

  await page.close()
  await context.close()

  if (token) {
    process.stdout.write(token)
  } else {
    process.stderr.write('Login timed out.\n')
    process.exit(1)
  }
}

main().catch(err => {
  process.stderr.write(err.message + '\n')
  process.exit(1)
})
