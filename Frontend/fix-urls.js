const fs = require('fs');
const file = 'c:/mini/Frontend/src/main.jsx';

let code = fs.readFileSync(file, 'utf8');

// Replace standard quoted strings
code = code.replace(
    /'http:\/\/localhost:4000(.*?)'/g,
    '`${import.meta.env.VITE_API_URL || "http://localhost:4000"}$1`'
);

// Replace backtick strings (already wrapped in template literals)
code = code.replace(
    /`http:\/\/localhost:4000(.*?)`/g,
    '`${import.meta.env.VITE_API_URL || "http://localhost:4000"}$1`'
);

fs.writeFileSync(file, code);
console.log('Successfully replaced all localhost urls!');
