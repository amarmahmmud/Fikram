import fs from 'fs';

const data = JSON.parse(fs.readFileSync('training-data/inspected-records.json', 'utf8'));

console.log('Total matched records:', data.length);
console.log();

// 1. Records with approximate language (these are corruption signals)
console.log('=== Records with APPROXIMATE language (roughly/about/nearly/around) ===');
for (const r of data) {
  if (/\b(roughly|about|nearly|approximately|around)\b/i.test(r.completion)) {
    console.log(`[${r.index}] Q: ${r.prompt}`);
    console.log(`   A: ${r.completion}`);
    console.log();
  }
}

// 2. Check if "Solar Panel Installer" appears ANYWHERE in the full JSONL
console.log('=== "Solar Panel Installer" in full JSONL? ===');
// We need the full JSONL to check this - but we can check the inspected records
const solarHits = data.filter(r =>
  (r.prompt + ' ' + r.completion).toLowerCase().includes('solar')
);
console.log(`Solar mentions in inspected records: ${solarHits.length}`);
for (const r of solarHits) {
  console.log(`  [${r.index}] ${r.prompt}`);
}

// 3. Check all IMF records for subject consistency
console.log('\n=== IMF exposure records (checking for advanced/developing economy swaps) ===');
const imfRecords = data.filter(r =>
  (r.prompt + ' ' + r.completion).toLowerCase().includes('imf') ||
  (r.prompt + ' ' + r.completion).toLowerCase().includes('exposure')
);
for (const r of imfRecords) {
  const hasAdvanced = r.completion.toLowerCase().includes('advanced econom');
  const hasDeveloping = r.completion.toLowerCase().includes('developing econom');
  const nums = r.completion.match(/\d+%/g) || [];
  console.log(`[${r.index}] ${hasAdvanced ? '✓ advanced' : '  '} ${hasDeveloping ? '✓ developing' : '  '} nums=${nums.join(',')}`);
  console.log(`   Q: ${r.prompt}`);
  console.log(`   A: ${r.completion}`);
  console.log();
}

// 4. McKinsey records - check for 29.5% consistency
console.log('=== McKinsey automation % records ===');
const mckRecords = data.filter(r =>
  (r.prompt + ' ' + r.completion).toLowerCase().includes('mckinsey')
);
for (const r of mckRecords) {
  const nums = r.completion.match(/[\d.]+%/g) || [];
  console.log(`[${r.index}] nums=${nums.join(',')} Q: ${r.prompt}`);
  console.log(`   A: ${r.completion.substring(0, 200)}`);
  console.log();
}

// 5. BLS records
console.log('=== BLS records ===');
const blsRecords = data.filter(r =>
  (r.prompt + ' ' + r.completion).toLowerCase().includes('bls') ||
  (r.prompt + ' ' + r.completion).toLowerCase().includes('bureau of labor')
);
for (const r of blsRecords) {
  console.log(`[${r.index}] Q: ${r.prompt}`);
  console.log(`   A: ${r.completion}`);
  console.log();
}
