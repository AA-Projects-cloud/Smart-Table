const fs = require('fs');
const file = 'c:/mini/Frontend/src/main.jsx';

let code = fs.readFileSync(file, 'utf8');

// The backend saves profiles which sometimes returns `year` as a string.
// `studentYear` then strictly compares against YEAR_DATA array holding number values.
// We relax the check globally.
code = code.replace(
    /YEAR_DATA\.find\(y => y\.year === studentYear\)/g,
    'YEAR_DATA.find(y => Number(y.year) === Number(studentYear))'
);

// We also ensure `profile.year` is parsed upon fetching
code = code.replace(
    /if \(profile\.year\) setStudentYear\(profile\.year\);/g,
    'if (profile.year) setStudentYear(Number(profile.year));'
);

fs.writeFileSync(file, code);
console.log('Fixed year matching bug.');
