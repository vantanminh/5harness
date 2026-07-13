// Merge render functions into dashboard.ts
const fs = require('fs');

let dash = fs.readFileSync('src/application/dashboard.ts', 'utf8');
let renderFns = fs.readFileSync('scripts/dashboard-auth-render.ts', 'utf8');

// Find the renderFooter function closing brace insertion point
const marker = '\nfunction renderHome(projects: ProjectSummary[]): string {';
const idx = dash.indexOf(marker);
if (idx > 0) {
  dash = dash.substring(0, idx) + '\n' + renderFns + '\n' + dash.substring(idx);
  console.log('OK: inserted render functions');
} else {
  console.log('ERROR: marker not found');
}

// Add nav to home page: replace <h1>Harness Dashboard</h1>...<p class="muted">
// The home page is the LAST occurrence (after renderLoginPage was inserted).
// Find all occurrences and use the last one.
const searchStr = '<h1>Harness Dashboard</h1>';
let lastIdx = -1;
let searchIdx = 0;
while (true) {
  const found = dash.indexOf(searchStr, searchIdx);
  if (found === -1) break;
  lastIdx = found;
  searchIdx = found + 1;
}

if (lastIdx > 0) {
  // Read forward to find the end of the <p class="muted"> line
  const afterH1 = dash.substring(lastIdx + searchStr.length);
  const mutedMarker = '<p class="muted">Local read-only view';
  const mutedIdx = afterH1.indexOf(mutedMarker);
  if (mutedIdx > 0) {
    const navBlock = '\n  <div class="nav">\n' +
      '    <a href="/settings">Settings</a>\n' +
      '    <form method="post" action="/api/auth/logout" style="display:inline">\n' +
      '      <button type="submit" style="background:none;border:none;color:var(--link);cursor:pointer;font-size:0.9rem;padding:0;text-decoration:none;font-family:inherit">Logout</button>\n' +
      '    </form>\n' +
      '  </div>\n  ';
    const prefix = dash.substring(0, lastIdx + searchStr.length);
    const suffix = dash.substring(lastIdx + searchStr.length);
    dash = prefix + navBlock + suffix;
    console.log('OK: added home nav');
  } else {
    console.log('WARNING: muted paragraph not found');
  }
} else {
  console.log('WARNING: Harness Dashboard not found');
}

fs.writeFileSync('src/application/dashboard.ts', dash, 'utf8');
console.log('Done');

