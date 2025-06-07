const fs = require('fs');
const path = require('path');

// Path to the problematic Deck.ts file
const deckTsPath = path.join(
    __dirname,
    '../node_modules/anki-apkg-parser/src/core/Deck.ts',
);

try {
    console.log('Patching anki-apkg-parser module...');

    // Read the file content
    let content = fs.readFileSync(deckTsPath, 'utf8');

    // Replace the problematic import.meta.url usage
    content = content.replace(
        'const __filename = fileURLToPath(import.meta.url);',
        "const __filename = 'dummy_filename'; // Patched for CommonJS compatibility",
    );

    // Write back the modified content
    fs.writeFileSync(deckTsPath, content);

    console.log('Patch applied successfully!');
} catch (error) {
    console.error('Failed to apply patch:', error);
    process.exit(1);
}
