const fs = require('fs');
let c = fs.readFileSync('src/application/dashboard.ts','utf8');
let lines = c.split(/\r?\n/);

// Insert render functions after renderFooter (line 388, 0-indexed: 387)
const newFns = [
'',
'function renderLoginPage(error?: string): string {',
'  const errorHtml = error',
'    ? `+"`"+`<p style="color:var(--status-missing);margin-bottom:1rem">`+"${"+`htmlEscape(error)}</p>`+"`"+`',
'    : "";',
'  return `+"`"+`<!DOCTYPE html>',
'<html lang="en">',
'<head>',
'  <meta charset="utf-8" />',
'  <meta name="viewport" content="width=device-width, initial-scale=1" />',
'  <title>Login — Harness Dashboard</title>',
'  <style>`+"${"+`CSS}`,
// ... continuing
];
