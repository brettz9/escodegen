/*
  Copyright (C) 2011-2013 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2015 Ingvar Stepanyan <me@rreverser.com>
  Copyright (C) 2012 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2012 Joost-Wim Boekesteijn <joost-wim@boekesteijn.nl>
  Copyright (C) 2012 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012 Arpad Borsos <arpad.borsos@googlemail.com>
  Copyright (C) 2011 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2011 Arpad Borsos <arpad.borsos@googlemail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

import esprima from './3rdparty/esprima-2.7.1.js';
import escodegen from './loader.js';

const data = {
    'Harmony MetaProperty': {
        'class SomeClass { constructor() { if (new.target === SomeClass) { throw new Error(\'Boom\'); }}}': {
            type: 'Program',
            body: [ {
                type: 'ClassDeclaration',
                id: {
                    type: 'Identifier',
                    name: 'SomeClass'
                },
                superClass: null,
                body: {
                    type: 'ClassBody',
                    body: [
                        {
                            type: 'MethodDefinition',
                            key: {
                                type: 'Identifier',
                                name: 'constructor'
                            },
                            computed: false,
                            value: {
                                type: 'FunctionExpression',
                                id: null,
                                params: [],
                                defaults: [],
                                body: {
                                    type: 'BlockStatement',
                                    body: [
                                        {
                                            type: 'IfStatement',
                                            test: {
                                                type: 'BinaryExpression',
                                                operator: '===',
                                                left: {
                                                    type: 'MetaProperty',
                                                    meta: {
                                                        type: 'Identifier',
                                                        name: 'new'
                                                    },
                                                    property: {
                                                        type: 'Identifier',
                                                        name: 'target'
                                                    },
                                                },
                                                right: {
                                                    type: 'Identifier',
                                                    name: 'SomeClass'
                                                }
                                            },
                                            consequent: {
                                                type: 'BlockStatement',
                                                body: [
                                                    {
                                                        type: 'ThrowStatement',
                                                        argument: {
                                                            type: 'NewExpression',
                                                            callee: {
                                                                type: 'Identifier',
                                                                name: 'Error'
                                                            },
                                                            arguments: [
                                                                {
                                                                    type: 'Literal',
                                                                    value: 'Boom',
                                                                    raw: '\'Boom\''
                                                                }
                                                            ]
                                                        }
                                                    }
                                                ]
                                            },
                                            alternate: null
                                        }
                                    ]
                                },
                                generator: false,
                                expression: false
                            },
                            kind: 'constructor',
                            static: false
                        }
                    ],
                }
            }],
        }
    },
};

function updateDeeply(target, override) {
    function isHashObject(target) {
        return typeof target === 'object' && target instanceof Object && !(target instanceof RegExp);
    }

    for (const key in override) {
        if (Object.hasOwnProperty.call(override, key)) {
            const val = override[key];
            if (isHashObject(val)) {
                if (isHashObject(target[key])) {
                    updateDeeply(target[key], val);
                } else {
                    target[key] = updateDeeply({}, val);
                }
            } else {
                target[key] = val;
            }
        }
    }
    return target;
}

// Special handling for regular expression literal since we need to
// convert it to a string literal, otherwise it will be decoded
// as object "{}" and the regular expression would be lost.
function adjustRegexLiteral(key, value) {
    if (key === 'value' && value instanceof RegExp) {
        value = value.toString();
    }
    return value;
}

function testIdentity(code, syntax) {
    const options = {
        comment: false,
        range: false,
        loc: false,
        tokens: false,
        raw: false
    };

    let tree = esprima.parse(code, options);
    const expected = JSON.stringify(tree, adjustRegexLiteral, 4);
    tree = esprima.parse(escodegen.generate(tree), options);
    const actual = JSON.stringify(tree, adjustRegexLiteral, 4);
    tree = esprima.parse(escodegen.generate(syntax), options);
    const actual2 = JSON.stringify(tree, adjustRegexLiteral, 4);
    expect(actual).to.be.equal(expected);
    expect(actual2).to.be.equal(expected);
}

function testGenerate(expected, result) {
    let options = {
        indent: '    ',
        parse: esprima.parse
    };

    if (result.options) {
        options = updateDeeply(options, result.options);
    }

    const actual = escodegen.generate(result.generateFrom, options);
    expect(actual).to.be.equal(expected);
}

/*
function isGeneratorIdentityFixture(result) {
    return !Object.hasOwnProperty.call(result, 'generateFrom') &&
        !Object.hasOwnProperty.call(result, 'result');
}
*/

function runTest(code, result) {
    if (Object.hasOwnProperty.call(result, 'generateFrom')) {
        testGenerate(code, result);
    } else {
        testIdentity(code, result);
    }
}

describe('harmony 2.x test', function () {
    Object.entries(data).forEach(function ([category, sources]) {
        Object.entries(sources).forEach(function ([source, expected]) {
            it(category, function () {
                runTest(source, expected);
            });
        });
    });
});
/* vim: set sw=4 ts=4 et tw=80 : */
