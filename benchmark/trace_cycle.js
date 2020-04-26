const asts = require('./asts'),
    escodegen = require('../');

for (let j = 0; j < 50; j++) {
    for (let i = 0; i < asts.length; i++)
        escodegen.generate(asts[0]);
}

