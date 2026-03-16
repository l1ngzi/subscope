import { join } from 'path'
import { UA } from './lib.ts'

// Playwright via system Chrome — anti-bot bypass for BLS, IMF, etc.
// Spawned through node (not Bun) due to oven-sh/bun#27977
export const fetchWithBrowser = (url: string): string => {
  const projectRoot = join(import.meta.dir, '..')
  const script = [
    `const{chromium}=require('playwright');`,
    `(async()=>{`,
    `const b=await chromium.launch({headless:true,channel:'chrome',`,
    `args:['--disable-blink-features=AutomationControlled','--ignore-certificate-errors']});`,
    `const ctx=await b.newContext({ignoreHTTPSErrors:true,userAgent:${JSON.stringify(UA)}});`,
    `const p=await ctx.newPage();`,
    `await p.addInitScript(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>false})});`,
    `await p.goto(${JSON.stringify(url)},{waitUntil:'domcontentloaded',timeout:20000});`,
    `process.stdout.write(await p.content());`,
    `await b.close();`,
    `})().catch(e=>{process.stderr.write(e.message);process.exit(1)});`,
  ].join('')
  const r = Bun.spawnSync(['node', '-e', script], {
    stdout: 'pipe', stderr: 'pipe', timeout: 30_000,
    cwd: projectRoot,
    env: { ...process.env, NODE_PATH: join(projectRoot, 'node_modules') },
  })
  if (r.exitCode !== 0) {
    throw new Error(`Browser fetch failed: ${new TextDecoder().decode(r.stderr).trim() || 'unknown error'}`)
  }
  return new TextDecoder().decode(r.stdout)
}
