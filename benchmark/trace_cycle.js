const asts = require('./asts'),
    escodegen = require('../');

for (let j = 0; j < 50; j++) {
    for (const ast of asts)
        escodegen.generate(ast);
}
