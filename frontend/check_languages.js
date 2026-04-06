const fs = require('fs');

const files = ['subscribe.html', 'submission.html', 'pullletter.html', 'auth.html'];
const expectedLanguages = ['ko', 'en', 'it', 'fr', 'es', 'ja', 'zh', 'ru'];

console.log('\n=== FINAL LANGUAGE SUPPORT VERIFICATION ===\n');

files.forEach(file => {
  console.log(`File: ${file}`);
  const content = fs.readFileSync(file, 'utf8');
  
  // Check language selector dropdown
  const selectMatch = content.match(/<select[^>]*id="langSelect"[^>]*>[\s\S]*?<\/select>/);
  if (selectMatch) {
    const optionMatches = selectMatch[0].match(/value="([a-z]{2})"/g);
    const selectedLangs = optionMatches ? optionMatches.map(o => o.slice(7, 9)) : [];
    const missing = expectedLanguages.filter(l => !selectedLangs.includes(l));
    
    if (missing.length === 0) {
      console.log(`  ✓ Language selector: All 8 languages present`);
    } else {
      console.log(`  ✗ Language selector: Missing ${missing.join(', ')}`);
    }
  }
  
  // Check L object languages
  const lMatch = content.match(/var L\s*=\s*\{([\s\S]*?)\n\};/);
  if (lMatch) {
    const lContent = lMatch[1];
    const langMatches = lContent.match(/([a-z]{2}):\{/g);
    const langObjects = langMatches ? langMatches.map(m => m.slice(0, 2)) : [];
    const missing = expectedLanguages.filter(l => !langObjects.includes(l));
    
    if (missing.length === 0) {
      console.log(`  ✓ L object: All 8 languages present`);
      
      // Check Russian specifically
      const ruMatch = lContent.match(/ru:\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/);
      if (ruMatch) {
        const ruStr = ruMatch[0];
        const propCount = (ruStr.match(/:/g) || []).length - 1; // -1 for the opening 'ru:'
        console.log(`  ✓ Russian (ru): ${propCount} properties defined`);
      }
    } else {
      console.log(`  ✗ L object: Missing ${missing.join(', ')}`);
    }
  }
  
  // Verify syntax
  const scriptMatch = content.match(/<script>([\s\S]*?)<\/script>/);
  if (scriptMatch) {
    try {
      new Function(scriptMatch[1]);
      console.log(`  ✓ JavaScript syntax: Valid`);
    } catch(e) {
      console.log(`  ✗ JavaScript syntax error: ${e.message.substring(0, 60)}`);
    }
  }
  
  console.log('');
});

console.log('=== SUMMARY ===');
console.log('✓ All 4 files checked');
console.log('✓ All files should have 8 languages (ko, en, it, fr, es, ja, zh, ru)');
console.log('✓ Russian (ru) language object should be complete with all properties');
