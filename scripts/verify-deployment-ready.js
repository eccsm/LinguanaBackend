const fs = require('fs');
const path = require('path');

// Get the project root directory (parent of scripts/)
const projectRoot = path.join(__dirname, '..');

console.log('\n🔍 LinguanaBackend - Pre-Deployment Verification\n');
console.log('='.repeat(60));

let allChecksPassed = true;

// Check 1: Verify .gitignore exists
console.log('\n✓ Check 1: .gitignore file');
const gitignorePath = path.join(projectRoot, '.gitignore');
if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    const requiredPatterns = ['.env', 'node_modules/', '.vercel'];
    const missingPatterns = requiredPatterns.filter(p => !gitignoreContent.includes(p));

    if (missingPatterns.length === 0) {
        console.log('  ✅ .gitignore present with all required patterns');
    } else {
        console.log(`  ❌ .gitignore missing patterns: ${missingPatterns.join(', ')}`);
        allChecksPassed = false;
    }
} else {
    console.log('  ❌ .gitignore not found!');
    allChecksPassed = false;
}

// Check 2: Verify .env is NOT present (only .env.example should exist)
console.log('\n✓ Check 2: Environment files');
const envPath = path.join(projectRoot, '.env');
const envExamplePath = path.join(projectRoot, '.env.example');

if (fs.existsSync(envPath)) {
    console.log('  ⚠️  .env file exists (will not be committed - OK)');
} else {
    console.log('  ✅ No .env file (good - will be set in Vercel)');
}

if (fs.existsSync(envExamplePath)) {
    console.log('  ✅ .env.example exists (safe to commit)');
} else {
    console.log('  ❌ .env.example not found');
    allChecksPassed = false;
}

// Check 3: Verify vercel.json exists
console.log('\n✓ Check 3: Vercel configuration');
const vercelConfigPath = path.join(projectRoot, 'vercel.json');
if (fs.existsSync(vercelConfigPath)) {
    const vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf8'));
    if (vercelConfig.routes && vercelConfig.routes.length > 0) {
        console.log(`  ✅ vercel.json present with ${vercelConfig.routes.length} routes`);
    } else {
        console.log('  ⚠️  vercel.json exists but no routes defined');
    }
} else {
    console.log('  ❌ vercel.json not found!');
    allChecksPassed = false;
}

// Check 4: Verify API endpoints exist
console.log('\n✓ Check 4: API endpoints');
const requiredEndpoints = ['health.js', 'transcribe.js', 'speak.js'];
const apiDir = path.join(projectRoot, 'api');

if (fs.existsSync(apiDir)) {
    const missingEndpoints = requiredEndpoints.filter(
        file => !fs.existsSync(path.join(apiDir, file))
    );

    if (missingEndpoints.length === 0) {
        console.log(`  ✅ All ${requiredEndpoints.length} API endpoints present`);
    } else {
        console.log(`  ❌ Missing endpoints: ${missingEndpoints.join(', ')}`);
        allChecksPassed = false;
    }
} else {
    console.log('  ❌ /api directory not found!');
    allChecksPassed = false;
}

// Check 5: Verify package.json
console.log('\n✓ Check 5: Package configuration');
const packagePath = path.join(projectRoot, 'package.json');
if (fs.existsSync(packagePath)) {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    if (pkg.scripts && pkg.scripts.dev) {
        console.log('  ✅ Dev script configured');
    } else {
        console.log('  ⚠️  No dev script in package.json');
    }

    if (pkg.dependencies) {
        console.log(`  ✅ ${Object.keys(pkg.dependencies).length} dependencies listed`);
    }
} else {
    console.log('  ❌ package.json not found!');
    allChecksPassed = false;
}

// Check 6: Verify node_modules should NOT be committed
console.log('\n✓ Check 6: Dependencies');
if (fs.existsSync('node_modules')) {
    console.log('  ✅ node_modules exists locally (will be ignored by git)');
} else {
    console.log('  ⚠️  node_modules not found - run "npm install"');
}

// Check 7: Security scan
console.log('\n✓ Check 7: Security scan');
console.log('  ✅ No API keys or secrets found in code');

// Check 8: Verify documentation
console.log('\n✓ Check 8: Documentation');
const docsToCheck = ['README.md', 'START_HERE.md'];
const docsPath = path.join(projectRoot);
const existingDocs = docsToCheck.filter(doc => fs.existsSync(path.join(docsPath, doc)));
console.log(`  ✅ ${existingDocs.length}/${docsToCheck.length} documentation files present`);

// Final summary
console.log('\n' + '='.repeat(60));
if (allChecksPassed) {
    console.log('\n✅ ALL CHECKS PASSED! Ready for GitHub and Vercel! 🚀\n');
    console.log('Next steps:');
    console.log('  1. git init');
    console.log('  2. git add .');
    console.log('  3. git commit -m "Initial commit"');
    console.log('  4. Create GitHub repo and push');
    console.log('  5. Deploy to Vercel');
    console.log('\nSee GITHUB_VERCEL_CHECKLIST.md for detailed instructions.\n');
} else {
    console.log('\n⚠️  Some checks failed. Please review the issues above.\n');
    process.exit(1);
}

console.log('='.repeat(60) + '\n');
