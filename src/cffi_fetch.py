"""TLS-impersonating fetch via curl_cffi. Called by subscope as subprocess.
Usage: python cffi_fetch.py <url> [impersonate] [header:value ...]
Outputs response body to stdout. Exits 1 on failure."""

import sys
from curl_cffi import requests

url = sys.argv[1]
imp = sys.argv[2] if len(sys.argv) > 2 else 'safari17_0'

# Extra headers from args: "Accept:application/json" etc.
headers = {}
for arg in sys.argv[3:]:
    if ':' in arg:
        k, v = arg.split(':', 1)
        headers[k.strip()] = v.strip()

targets = [imp] if imp != 'auto' else ['safari17_0', 'safari15_3', 'chrome131']

for t in targets:
    try:
        r = requests.get(url, impersonate=t, timeout=15, headers=headers, verify=False)
        if r.status_code == 200 and len(r.text) > 100:
            sys.stdout.write(r.text)
            sys.exit(0)
    except Exception:
        continue

sys.stderr.write(f'all impersonations failed for {url}')
sys.exit(1)
