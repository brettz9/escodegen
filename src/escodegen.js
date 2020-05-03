/*
  Copyright (C) 2012-2014 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2015 Ingvar Stepanyan <me@rreverser.com>
  Copyright (C) 2014 Ivan Nikulin <ifaaan@gmail.com>
  Copyright (C) 2012-2013 Michael Ficarra <escodegen.copyright@michael.ficarra.me>
  Copyright (C) 2012-2013 Mathias Bynens <mathias@qiwi.be>
  Copyright (C) 2013 Irakli Gozalishvili <rfobic@gmail.com>
  Copyright (C) 2012 Robert Gust-Bardon <donate@robert.gust-bardon.org>
  Copyright (C) 2012 John Freeman <jfreeman08@gmail.com>
  Copyright (C) 2011-2012 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2012 Joost-Wim Boekesteijn <joost-wim@boekesteijn.nl>
  Copyright (C) 2012 Kris Kowal <kris.kowal@cixar.com>
  Copyright (C) 2012 Arpad Borsos <arpad.borsos@googlemail.com>

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

(function () {
    'use strict';

    let SourceNode,
        base,
        indent,
        json,
        renumber,
        hexadecimal,
        quotes,
        escapeless,
        newline,
        space,
        parentheses,
        semicolons,
        safeConcatenation,
        directive,
        extra,
        parse,
        sourceMap,
        sourceCode,
        preserveBlankLines;

    const estraverse = require('estraverse');
    const esutils = require('esutils');

    const { Syntax } = estraverse;

    // Generation is done by generateExpression.
    function isExpression(node) {
        return Object.hasOwnProperty.call(CodeGenerator.Expression, node.type);
    }

    // Generation is done by generateStatement.
    function isStatement(node) {
        return Object.hasOwnProperty.call(CodeGenerator.Statement, node.type);
    }

    const Precedence = {
        Sequence: 0,
        Yield: 1,
        Assignment: 1,
        Conditional: 2,
        ArrowFunction: 2,
        LogicalOR: 3,
        LogicalAND: 4,
        BitwiseOR: 5,
        BitwiseXOR: 6,
        BitwiseAND: 7,
        Equality: 8,
        Relational: 9,
        BitwiseSHIFT: 10,
        Additive: 11,
        Multiplicative: 12,
        Exponentiation: 13,
        Await: 14,
        Unary: 14,
        Postfix: 15,
        Call: 16,
        New: 17,
        TaggedTemplate: 18,
        Member: 19,
        Primary: 20
    };

    const BinaryPrecedence = {
        '||': Precedence.LogicalOR,
        '&&': Precedence.LogicalAND,
        '|': Precedence.BitwiseOR,
        '^': Precedence.BitwiseXOR,
        '&': Precedence.BitwiseAND,
        '==': Precedence.Equality,
        '!=': Precedence.Equality,
        '===': Precedence.Equality,
        '!==': Precedence.Equality,
        is: Precedence.Equality,
        isnt: Precedence.Equality,
        '<': Precedence.Relational,
        '>': Precedence.Relational,
        '<=': Precedence.Relational,
        '>=': Precedence.Relational,
        in: Precedence.Relational,
        instanceof: Precedence.Relational,
        '<<': Precedence.BitwiseSHIFT,
        '>>': Precedence.BitwiseSHIFT,
        '>>>': Precedence.BitwiseSHIFT,
        '+': Precedence.Additive,
        '-': Precedence.Additive,
        '*': Precedence.Multiplicative,
        '%': Precedence.Multiplicative,
        '/': Precedence.Multiplicative,
        '**': Precedence.Exponentiation
    };

    //Flags
    const F_ALLOW_IN = 1,
        F_ALLOW_CALL = 1 << 1,
        F_ALLOW_UNPARATH_NEW = 1 << 2,
        F_FUNC_BODY = 1 << 3,
        F_DIRECTIVE_CTX = 1 << 4,
        F_SEMICOLON_OPT = 1 << 5;

    //Expression flag sets
    //NOTE: Flag order:
    // F_ALLOW_IN
    // F_ALLOW_CALL
    // F_ALLOW_UNPARATH_NEW
    const E_FTT = F_ALLOW_CALL | F_ALLOW_UNPARATH_NEW,
        E_TTF = F_ALLOW_IN | F_ALLOW_CALL,
        E_TTT = F_ALLOW_IN | F_ALLOW_CALL | F_ALLOW_UNPARATH_NEW,
        E_TFF = F_ALLOW_IN,
        E_FFT = F_ALLOW_UNPARATH_NEW,
        E_TFT = F_ALLOW_IN | F_ALLOW_UNPARATH_NEW;

    //Statement flag sets
    //NOTE: Flag order:
    // F_ALLOW_IN
    // F_FUNC_BODY
    // F_DIRECTIVE_CTX
    // F_SEMICOLON_OPT
    const S_TFFF = F_ALLOW_IN,
        S_TFFT = F_ALLOW_IN | F_SEMICOLON_OPT,
        S_FFFF = 0x00,
        S_TFTF = F_ALLOW_IN | F_DIRECTIVE_CTX,
        S_TTFF = F_ALLOW_IN | F_FUNC_BODY;

    function getDefaultOptions() {
        // default options
        return {
            indent: null,
            base: null,
            parse: null,
            comment: false,
            format: {
                indent: {
                    style: '    ',
                    base: 0,
                    adjustMultilineComment: false
                },
                newline: '\n',
                space: ' ',
                json: false,
                renumber: false,
                hexadecimal: false,
                quotes: 'single',
                escapeless: false,
                compact: false,
                parentheses: true,
                semicolons: true,
                safeConcatenation: false,
                preserveBlankLines: false
            },
            moz: {
                comprehensionExpressionStartsWithAssignment: false,
                starlessGenerator: false
            },
            sourceMap: null,
            sourceMapRoot: null,
            sourceMapWithCode: false,
            directive: false,
            raw: true,
            verbatim: null,
            sourceCode: null
        };
    }

    function stringRepeat(str, num) {
        let result = '';

        for (num |= 0; num > 0; num >>>= 1, str += str) {
            if (num & 1) {
                result += str;
            }
        }

        return result;
    }

    function hasLineTerminator(str) {
        return (/[\r\n]/g).test(str);
    }

    function endsWithLineTerminator(str) {
        const len = str.length;
        return len && esutils.code.isLineTerminator(str.charCodeAt(len - 1));
    }

    function merge(target, override) {
        for (const key in override) {
            if (Object.hasOwnProperty.call(override, key)) {
                target[key] = override[key];
            }
        }
        return target;
    }

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

    function generateNumber(value) {
        if (value !== value) {
            throw new Error('Numeric literal whose value is NaN');
        }
        if (value < 0 || (value === 0 && 1 / value < 0)) {
            throw new Error('Numeric literal whose value is negative');
        }

        if (value === 1 / 0) {
            return json ? 'null' : renumber ? '1e400' : '1e+400';
        }

        let result = `${  value}`;
        if (!renumber || result.length < 3) {
            return result;
        }

        let point = result.indexOf('.');
        if (!json && result.charCodeAt(0) === 0x30  /* 0 */ && point === 1) {
            point = 0;
            result = result.slice(1);
        }
        let temp = result;
        result = result.replace('e+', 'e');
        let exponent = 0;
        let pos;
        if ((pos = temp.indexOf('e')) > 0) {
            exponent = +temp.slice(pos + 1);
            temp = temp.slice(0, pos);
        }
        if (point >= 0) {
            exponent -= temp.length - point - 1;
            temp = `${+(temp.slice(0, point) + temp.slice(point + 1))  }`;
        }
        pos = 0;
        while (temp.charCodeAt(temp.length + pos - 1) === 0x30  /* 0 */) {
            --pos;
        }
        if (pos !== 0) {
            exponent -= pos;
            temp = temp.slice(0, pos);
        }
        if (exponent !== 0) {
            temp += `e${  exponent}`;
        }
        if ((temp.length < result.length ||
                    (hexadecimal && value > 1e12 && Math.floor(value) === value && (temp = `0x${  value.toString(16)}`).length < result.length)) &&
                +temp === value) {
            result = temp;
        }

        return result;
    }

    // Generate valid RegExp expression.
    // This function is based on https://github.com/Constellation/iv Engine

    function escapeRegExpCharacter(ch, previousIsBackslash) {
        // not handling '\' and handling \u2028 or \u2029 to unicode escape sequence
        if ((ch & ~1) === 0x2028) {
            return (previousIsBackslash ? 'u' : '\\u') + ((ch === 0x2028) ? '2028' : '2029');
        } else if (ch === 10 || ch === 13) {  // \n, \r
            return (previousIsBackslash ? '' : '\\') + ((ch === 10) ? 'n' : 'r');
        }
        return String.fromCharCode(ch);
    }

    function generateRegExp(reg) {
        let result = reg.toString();

        if (reg.source) {
            // extract flag from toString result
            const match = result.match(/\/([^/]*)$/);
            if (!match) {
                return result;
            }

            const [, flags] = match;
            result = '';

            let characterInBrack = false;
            let previousIsBackslash = false;
            for (const ch of reg.source) {
                const code = ch.charCodeAt();

                if (!previousIsBackslash) {
                    if (characterInBrack) {
                        if (code === 93) {  // ]
                            characterInBrack = false;
                        }
                    } else {
                        if (code === 47) {  // /
                            result += '\\';
                        } else if (code === 91) {  // [
                            characterInBrack = true;
                        }
                    }
                    result += escapeRegExpCharacter(code, previousIsBackslash);
                    previousIsBackslash = code === 92;  // \
                } else {
                    // if new RegExp("\\\n') is provided, create /\n/
                    result += escapeRegExpCharacter(code, previousIsBackslash);
                    // prevent like /\\[/]/
                    previousIsBackslash = false;
                }
            }

            return `/${  result  }/${  flags}`;
        }

        return result;
    }

    function escapeAllowedCharacter(code, next) {
        if (code === 0x08  /* \b */) {
            return '\\b';
        }

        if (code === 0x0C  /* \f */) {
            return '\\f';
        }

        if (code === 0x09  /* \t */) {
            return '\\t';
        }

        const hex = code.toString(16).toUpperCase();
        if (json || code > 0xFF) {
            return `\\u${  '0000'.slice(hex.length)  }${hex}`;
        } else if (code === 0x0000 && !esutils.code.isDecimalDigit(next)) {
            return '\\0';
        } else if (code === 0x000B  /* \v */) { // '\v'
            return '\\x0B';
        } else {
            return `\\x${  '00'.slice(hex.length)  }${hex}`;
        }
    }

    function escapeDisallowedCharacter(code) {
        if (code === 0x5C  /* \ */) {
            return '\\\\';
        }

        if (code === 0x0A  /* \n */) {
            return '\\n';
        }

        if (code === 0x0D  /* \r */) {
            return '\\r';
        }

        if (code === 0x2028) {
            return '\\u2028';
        }

        if (code === 0x2029) {
            return '\\u2029';
        }

        throw new Error('Incorrectly classified character');
    }

    function escapeDirective(str) {
        let quote = quotes === 'double' ? '"' : '\'';
        for (const [i, ch] of Object.entries(str)) {
            const code = ch.charCodeAt();
            if (code === 0x27  /* ' */) {
                quote = '"';
                break;
            } else if (code === 0x22  /* " */) {
                quote = '\'';
                break;
            } else if (code === 0x5C  /* \ */) {
                ++i;
            }
        }

        return quote + str + quote;
    }

    function escapeString(str) {
        let result = '', singleQuotes = 0, doubleQuotes = 0;

        for (const [i, ch] of Object.entries(str)) {
            const code = ch.charCodeAt();
            if (code === 0x27  /* ' */) {
                ++singleQuotes;
            } else if (code === 0x22  /* " */) {
                ++doubleQuotes;
            } else if (code === 0x2F  /* / */ && json) {
                result += '\\';
            } else if (esutils.code.isLineTerminator(code) || code === 0x5C  /* \ */) {
                result += escapeDisallowedCharacter(code);
                continue;
            } else if (!esutils.code.isIdentifierPartES5(code) && (json && code < 0x20  /* SP */ || !json && !escapeless && (code < 0x20  /* SP */ || code > 0x7E  /* ~ */))) {
                result += escapeAllowedCharacter(code, str.charCodeAt(i + 1));
                continue;
            }
            result += String.fromCharCode(code);
        }

        const single = !(quotes === 'double' || (quotes === 'auto' && doubleQuotes < singleQuotes));
        const quote = single ? '\'' : '"';

        if (!(single ? singleQuotes : doubleQuotes)) {
            return quote + result + quote;
        }

        str = result;
        result = quote;

        for (const ch of str) {
            const code = ch.charCodeAt();
            if ((code === 0x27  /* ' */ && single) || (code === 0x22  /* " */ && !single)) {
                result += '\\';
            }
            result += String.fromCharCode(code);
        }

        return result + quote;
    }

    /**
     * flatten an array to a string, where the array can contain
     * either strings or nested arrays
     */
    function flattenToString(arr) {
        let result = '';
        for (const elem of arr) {
            result += Array.isArray(elem) ? flattenToString(elem) : elem;
        }
        return result;
    }

    /**
     * convert generated to a SourceNode when source maps are enabled.
     */
    function toSourceNodeWhenNeeded(generated, node) {
        if (!sourceMap) {
            // with no source maps, generated is either an
            // array or a string.  if an array, flatten it.
            // if a string, just return it
            if (Array.isArray(generated)) {
                return flattenToString(generated);
            } else {
                return generated;
            }
        }
        if (node == null) {
            if (generated instanceof SourceNode) {
                return generated;
            } else {
                node = {};
            }
        }
        if (node.loc == null) {
            return new SourceNode(null, null, sourceMap, generated, node.name || null);
        }
        return new SourceNode(node.loc.start.line, node.loc.start.column, (sourceMap === true ? node.loc.source || null : sourceMap), generated, node.name || null);
    }

    function noEmptySpace() {
        return (space) ? space : ' ';
    }

    function join(left, right) {
        const leftSource = toSourceNodeWhenNeeded(left).toString();
        if (leftSource.length === 0) {
            return [right];
        }

        const rightSource = toSourceNodeWhenNeeded(right).toString();
        if (rightSource.length === 0) {
            return [left];
        }

        const leftCharCode = leftSource.charCodeAt(leftSource.length - 1);
        const rightCharCode = rightSource.charCodeAt(0);

        if ((leftCharCode === 0x2B  /* + */ || leftCharCode === 0x2D  /* - */) && leftCharCode === rightCharCode ||
            esutils.code.isIdentifierPartES5(leftCharCode) && esutils.code.isIdentifierPartES5(rightCharCode) ||
            leftCharCode === 0x2F  /* / */ && rightCharCode === 0x69  /* i */) { // infix word operators all start with `i`
            return [left, noEmptySpace(), right];
        } else if (esutils.code.isWhiteSpace(leftCharCode) || esutils.code.isLineTerminator(leftCharCode) ||
                esutils.code.isWhiteSpace(rightCharCode) || esutils.code.isLineTerminator(rightCharCode)) {
            return [left, right];
        }
        return [left, space, right];
    }

    function addIndent(stmt) {
        return [base, stmt];
    }

    function withIndent(fn) {
        const previousBase = base;
        base += indent;
        fn(base);
        base = previousBase;
    }

    function calculateSpaces(str) {
        let i;
        for (i = str.length - 1; i >= 0; --i) {
            if (esutils.code.isLineTerminator(str.charCodeAt(i))) {
                break;
            }
        }
        return (str.length - 1) - i;
    }

    function adjustMultilineComment(value, specialBase) {
        const array = value.split(/\r\n|[\r\n]/);
        let spaces = Number.MAX_VALUE;

        // first line doesn't have indentation
        for (let i = 1, len = array.length; i < len; ++i) {
            const line = array[i];
            let j = 0;
            while (j < line.length && esutils.code.isWhiteSpace(line.charCodeAt(j))) {
                ++j;
            }
            if (spaces > j) {
                spaces = j;
            }
        }

        let previousBase;
        if (typeof specialBase !== 'undefined') {
            // pattern like
            // {
            //   var t = 20;  /*
            //                 * this is comment
            //                 */
            // }
            previousBase = base;
            if (array[1][spaces] === '*') {
                specialBase += ' ';
            }
            base = specialBase;
        } else {
            if (spaces & 1) {
                // /*
                //  *
                //  */
                // If spaces are odd number, above pattern is considered.
                // We waste 1 space.
                --spaces;
            }
            previousBase = base;
        }

        for (let i = 1, len = array.length; i < len; ++i) {
            const sn = toSourceNodeWhenNeeded(addIndent(array[i].slice(spaces)));
            array[i] = sourceMap ? sn.join('') : sn;
        }

        base = previousBase;

        return array.join('\n');
    }

    function generateComment(comment, specialBase) {
        if (comment.type === 'Line') {
            if (endsWithLineTerminator(comment.value)) {
                return `//${  comment.value}`;
            } else {
                // Always use LineTerminator
                let result = `//${  comment.value}`;
                if (!preserveBlankLines) {
                    result += '\n';
                }
                return result;
            }
        }
        if (extra.format.indent.adjustMultilineComment && /[\n\r]/.test(comment.value)) {
            return adjustMultilineComment(`/*${  comment.value  }*/`, specialBase);
        }
        return `/*${  comment.value  }*/`;
    }

    function addComments(stmt, result) {
        if (stmt.leadingComments && stmt.leadingComments.length > 0) {
            const save = result;

            if (preserveBlankLines) {
                const [comment] = stmt.leadingComments;
                result = [];

                const extRange = comment.extendedRange;
                let { range } = comment;

                const prefix = sourceCode.substring(extRange[0], range[0]);
                let count = (prefix.match(/\n/g) || []).length;
                if (count > 0) {
                    result.push(stringRepeat('\n', count));
                    result.push(addIndent(generateComment(comment)));
                } else {
                    result.push(prefix);
                    result.push(generateComment(comment));
                }

                let prevRange = range;

                for (let i = 1, len = stmt.leadingComments.length; i < len; i++) {
                    const comment = stmt.leadingComments[i];
                    ({ range } = comment);

                    const infix = sourceCode.substring(prevRange[1], range[0]);
                    const count = (infix.match(/\n/g) || []).length;
                    result.push(stringRepeat('\n', count));
                    result.push(addIndent(generateComment(comment)));

                    prevRange = range;
                }

                const suffix = sourceCode.substring(range[1], extRange[1]);
                count = (suffix.match(/\n/g) || []).length;
                result.push(stringRepeat('\n', count));
            } else {
                const [comment] = stmt.leadingComments;
                result = [];
                if (safeConcatenation && stmt.type === Syntax.Program && stmt.body.length === 0) {
                    result.push('\n');
                }
                result.push(generateComment(comment));
                if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                    result.push('\n');
                }

                for (let i = 1, len = stmt.leadingComments.length; i < len; ++i) {
                    const comment = stmt.leadingComments[i];
                    const fragment = [generateComment(comment)];
                    if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        fragment.push('\n');
                    }
                    result.push(addIndent(fragment));
                }
            }

            result.push(addIndent(save));
        }

        if (stmt.trailingComments) {

            if (preserveBlankLines) {
                const [comment] = stmt.trailingComments;
                const extRange = comment.extendedRange;
                const { range } = comment;

                const prefix = sourceCode.substring(extRange[0], range[0]);
                const count = (prefix.match(/\n/g) || []).length;

                if (count > 0) {
                    result.push(stringRepeat('\n', count));
                    result.push(addIndent(generateComment(comment)));
                } else {
                    result.push(prefix);
                    result.push(generateComment(comment));
                }
            } else {
                const tailingToStatement = !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString());
                const specialBase = stringRepeat(' ', calculateSpaces(toSourceNodeWhenNeeded([base, result, indent]).toString()));
                for (let i = 0, len = stmt.trailingComments.length; i < len; ++i) {
                    const comment = stmt.trailingComments[i];
                    if (tailingToStatement) {
                        // We assume target like following script
                        //
                        // var t = 20;  /**
                        //               * This is comment of t
                        //               */
                        if (i === 0) {
                            // first case
                            result = [result, indent];
                        } else {
                            result = [result, specialBase];
                        }
                        result.push(generateComment(comment, specialBase));
                    } else {
                        result = [result, addIndent(generateComment(comment))];
                    }
                    if (i !== len - 1 && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                        result = [result, '\n'];
                    }
                }
            }
        }

        return result;
    }

    function generateBlankLines(start, end, result) {
        let newlineCount = 0;

        for (let j = start; j < end; j++) {
            if (sourceCode[j] === '\n') {
                newlineCount++;
            }
        }

        for (let j = 1; j < newlineCount; j++) {
            result.push(newline);
        }
    }

    function parenthesize(text, current, should) {
        if (current < should) {
            return ['(', text, ')'];
        }
        return text;
    }

    function generateVerbatimString(string) {
        const result = string.split(/\r\n|\n/);
        for (let i = 1, iz = result.length; i < iz; i++) {
            result[i] = newline + base + result[i];
        }
        return result;
    }

    function generateVerbatim(expr, precedence) {
        const verbatim = expr[extra.verbatim];

        let result;
        if (typeof verbatim === 'string') {
            result = parenthesize(generateVerbatimString(verbatim), Precedence.Sequence, precedence);
        } else {
            // verbatim is object
            result = generateVerbatimString(verbatim.content);
            const prec = (verbatim.precedence != null) ? verbatim.precedence : Precedence.Sequence;
            result = parenthesize(result, prec, precedence);
        }

        return toSourceNodeWhenNeeded(result, expr);
    }

    function generateIdentifier(node) {
        return toSourceNodeWhenNeeded(node.name, node);
    }

    function generateAsyncPrefix(node, spaceRequired) {
        return node.async ? `async${  spaceRequired ? noEmptySpace() : space}` : '';
    }

    function generateStarSuffix(node) {
        const isGenerator = node.generator && !extra.moz.starlessGenerator;
        return isGenerator ? `*${  space}` : '';
    }

    function generateMethodPrefix(prop) {
        const func = prop.value;
        let prefix = '';
        if (func.async) {
            prefix += generateAsyncPrefix(func, !prop.computed);
        }
        if (func.generator) {
            // avoid space before method name
            prefix += generateStarSuffix(func) ? '*' : '';
        }
        return prefix;
    }

    class CodeGenerator {
        // Helpers.

        maybeBlock (stmt, flags) {
            const that = this;

            const noLeadingComment = !extra.comment || !stmt.leadingComments;

            if (stmt.type === Syntax.BlockStatement && noLeadingComment) {
                return [space, this.generateStatement(stmt, flags)];
            }

            if (stmt.type === Syntax.EmptyStatement && noLeadingComment) {
                return ';';
            }

            let result;
            withIndent(function () {
                result = [
                    newline,
                    addIndent(that.generateStatement(stmt, flags))
                ];
            });

            return result;
        }

        maybeBlockSuffix (stmt, result) {
            const ends = endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString());
            if (stmt.type === Syntax.BlockStatement && (!extra.comment || !stmt.leadingComments) && !ends) {
                return [result, space];
            }
            if (ends) {
                return [result, base];
            }
            return [result, newline, base];
        }

        generatePattern (node, precedence, flags) {
            if (node.type === Syntax.Identifier) {
                return generateIdentifier(node);
            }
            return this.generateExpression(node, precedence, flags);
        }

        generateFunctionParams (node) {
            let result;
            let hasDefault = false;

            if (node.type === Syntax.ArrowFunctionExpression &&
                    !node.rest && (!node.defaults || node.defaults.length === 0) &&
                    node.params.length === 1 && node.params[0].type === Syntax.Identifier) {
                // arg => { } case
                result = [generateAsyncPrefix(node, true), generateIdentifier(node.params[0])];
            } else {
                result = node.type === Syntax.ArrowFunctionExpression ? [generateAsyncPrefix(node, false)] : [];
                result.push('(');
                if (node.defaults) {
                    hasDefault = true;
                }
                for (let i = 0, iz = node.params.length; i < iz; ++i) {
                    if (hasDefault && node.defaults[i]) {
                        // Handle default values.
                        result.push(this.generateAssignment(node.params[i], node.defaults[i], '=', Precedence.Assignment, E_TTT));
                    } else {
                        result.push(this.generatePattern(node.params[i], Precedence.Assignment, E_TTT));
                    }
                    if (i + 1 < iz) {
                        result.push(`,${  space}`);
                    }
                }

                if (node.rest) {
                    if (node.params.length) {
                        result.push(`,${  space}`);
                    }
                    result.push('...');
                    result.push(generateIdentifier(node.rest));
                }

                result.push(')');
            }

            return result;
        }

        generateFunctionBody (node) {
            const result = this.generateFunctionParams(node);

            if (node.type === Syntax.ArrowFunctionExpression) {
                result.push(space);
                result.push('=>');
            }

            if (node.expression) {
                result.push(space);
                let expr = this.generateExpression(node.body, Precedence.Assignment, E_TTT);
                if (expr.toString().charAt(0) === '{') {
                    expr = ['(', expr, ')'];
                }
                result.push(expr);
            } else {
                result.push(this.maybeBlock(node.body, S_TTFF));
            }

            return result;
        }

        generateIterationForStatement (operator, stmt, flags) {
            const that = this;
            let result = [`for${  stmt.await ? `${noEmptySpace()  }await` : ''  }${space  }(`];
            withIndent(function () {
                if (stmt.left.type === Syntax.VariableDeclaration) {
                    withIndent(function () {
                        result.push(stmt.left.kind + noEmptySpace());
                        result.push(that.generateStatement(stmt.left.declarations[0], S_FFFF));
                    });
                } else {
                    result.push(that.generateExpression(stmt.left, Precedence.Call, E_TTT));
                }

                result = join(result, operator);
                result = [join(
                    result,
                    that.generateExpression(stmt.right, Precedence.Assignment, E_TTT)
                ), ')'];
            });
            result.push(this.maybeBlock(stmt.body, flags));
            return result;
        }

        generatePropertyKey (expr, computed) {
            const result = [];

            if (computed) {
                result.push('[');
            }

            result.push(this.generateExpression(expr, Precedence.Sequence, E_TTT));

            if (computed) {
                result.push(']');
            }

            return result;
        }

        generateAssignment (left, right, operator, precedence, flags) {
            if (Precedence.Assignment < precedence) {
                flags |= F_ALLOW_IN;
            }

            return parenthesize(
                [
                    this.generateExpression(left, Precedence.Call, flags),
                    space + operator + space,
                    this.generateExpression(right, Precedence.Assignment, flags)
                ],
                Precedence.Assignment,
                precedence
            );
        }

        semicolon (flags) {
            if (!semicolons && flags & F_SEMICOLON_OPT) {
                return '';
            }
            return ';';
        }

        generateExpression (expr, precedence, flags) {
            const type = expr.type || Syntax.Property;

            if (extra.verbatim && Object.hasOwnProperty.call(expr, extra.verbatim)) {
                return generateVerbatim(expr, precedence);
            }

            let result = this[type](expr, precedence, flags);

            if (extra.comment) {
                result = addComments(expr, result);
            }
            return toSourceNodeWhenNeeded(result, expr);
        }

        generateStatement (stmt, flags) {
            let result = this[stmt.type](stmt, flags);

            // Attach comments

            if (extra.comment) {
                result = addComments(stmt, result);
            }

            const fragment = toSourceNodeWhenNeeded(result).toString();
            if (stmt.type === Syntax.Program && !safeConcatenation && newline === '' &&  fragment.charAt(fragment.length - 1) === '\n') {
                result = sourceMap ? toSourceNodeWhenNeeded(result).replaceRight(/\s+$/, '') : fragment.replace(/\s+$/, '');
            }

            return toSourceNodeWhenNeeded(result, stmt);
        }
    }

    // Statements.

    CodeGenerator.Statement = {

        BlockStatement (stmt, flags) {
            const that = this;
            let result = ['{', newline];

            withIndent(function () {
                // handle functions without any code
                if (stmt.body.length === 0 && preserveBlankLines) {
                    const { range } = stmt;
                    if (range[1] - range[0] > 2) {
                        const content = sourceCode.substring(range[0] + 1, range[1] - 1);
                        if (content[0] === '\n') {
                            result = ['{'];
                        }
                        result.push(content);
                    }
                }

                let bodyFlags = S_TFFF;
                if (flags & F_FUNC_BODY) {
                    bodyFlags |= F_DIRECTIVE_CTX;
                }

                for (let i = 0, iz = stmt.body.length; i < iz; ++i) {
                    if (preserveBlankLines) {
                        // handle spaces before the first line
                        if (i === 0) {
                            if (stmt.body[0].leadingComments) {
                                const range = stmt.body[0].leadingComments[0].extendedRange;
                                const content = sourceCode.substring(range[0], range[1]);
                                if (content[0] === '\n') {
                                    result = ['{'];
                                }
                            }
                            if (!stmt.body[0].leadingComments) {
                                generateBlankLines(stmt.range[0], stmt.body[0].range[0], result);
                            }
                        }

                        // handle spaces between lines
                        if (i > 0) {
                            if (!stmt.body[i - 1].trailingComments  && !stmt.body[i].leadingComments) {
                                generateBlankLines(stmt.body[i - 1].range[1], stmt.body[i].range[0], result);
                            }
                        }
                    }

                    if (i === iz - 1) {
                        bodyFlags |= F_SEMICOLON_OPT;
                    }

                    let fragment;
                    if (stmt.body[i].leadingComments && preserveBlankLines) {
                        fragment = that.generateStatement(stmt.body[i], bodyFlags);
                    } else {
                        fragment = addIndent(that.generateStatement(stmt.body[i], bodyFlags));
                    }

                    result.push(fragment);
                    if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        if (preserveBlankLines && i < iz - 1) {
                            // don't add a new line if there are leading coments
                            // in the next statement
                            if (!stmt.body[i + 1].leadingComments) {
                                result.push(newline);
                            }
                        } else {
                            result.push(newline);
                        }
                    }

                    if (preserveBlankLines) {
                        // handle spaces after the last line
                        if (i === iz - 1) {
                            if (!stmt.body[i].trailingComments) {
                                generateBlankLines(stmt.body[i].range[1], stmt.range[1], result);
                            }
                        }
                    }
                }
            });

            result.push(addIndent('}'));
            return result;
        },

        BreakStatement (stmt, flags) {
            if (stmt.label) {
                return `break ${  stmt.label.name  }${this.semicolon(flags)}`;
            }
            return `break${  this.semicolon(flags)}`;
        },

        ContinueStatement (stmt, flags) {
            if (stmt.label) {
                return `continue ${  stmt.label.name  }${this.semicolon(flags)}`;
            }
            return `continue${  this.semicolon(flags)}`;
        },

        ClassBody (stmt, flags) {
            const result = [ '{', newline], that = this;

            withIndent(function (indent) {
                for (let i = 0, iz = stmt.body.length; i < iz; ++i) {
                    result.push(indent);
                    result.push(that.generateExpression(stmt.body[i], Precedence.Sequence, E_TTT));
                    if (i + 1 < iz) {
                        result.push(newline);
                    }
                }
            });

            if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(base);
            result.push('}');
            return result;
        },

        ClassDeclaration (stmt, flags) {
            let result  = ['class'];
            if (stmt.id) {
                result = join(result, this.generateExpression(stmt.id, Precedence.Sequence, E_TTT));
            }
            if (stmt.superClass) {
                const fragment = join('extends', this.generateExpression(stmt.superClass, Precedence.Unary, E_TTT));
                result = join(result, fragment);
            }
            result.push(space);
            result.push(this.generateStatement(stmt.body, S_TFFT));
            return result;
        },

        DirectiveStatement (stmt, flags) {
            if (extra.raw && stmt.raw) {
                return stmt.raw + this.semicolon(flags);
            }
            return escapeDirective(stmt.directive) + this.semicolon(flags);
        },

        DoWhileStatement (stmt, flags) {
            // Because `do 42 while (cond)` is Syntax Error. We need semicolon.
            let result = join('do', this.maybeBlock(stmt.body, S_TFFF));
            result = this.maybeBlockSuffix(stmt.body, result);
            return join(result, [
                `while${  space  }(`,
                this.generateExpression(stmt.test, Precedence.Sequence, E_TTT),
                `)${  this.semicolon(flags)}`
            ]);
        },

        CatchClause (stmt, flags) {
            const that = this;
            let result;
            withIndent(function () {
                if (stmt.param) {
                    result = [
                        `catch${  space  }(`,
                        that.generateExpression(stmt.param, Precedence.Sequence, E_TTT),
                        ')'
                    ];

                    if (stmt.guard) {
                        const guard = that.generateExpression(stmt.guard, Precedence.Sequence, E_TTT);
                        result.splice(2, 0, ' if ', guard);
                    }
                } else {
                    result = ['catch'];
                }
            });
            result.push(this.maybeBlock(stmt.body, S_TFFF));
            return result;
        },

        DebuggerStatement (stmt, flags) {
            return `debugger${  this.semicolon(flags)}`;
        },

        EmptyStatement (stmt, flags) {
            return ';';
        },

        ExportDefaultDeclaration (stmt, flags) {
            let result = [ 'export' ];

            const bodyFlags = (flags & F_SEMICOLON_OPT) ? S_TFFT : S_TFFF;

            // export default HoistableDeclaration[Default]
            // export default AssignmentExpression[In] ;
            result = join(result, 'default');
            if (isStatement(stmt.declaration)) {
                result = join(result, this.generateStatement(stmt.declaration, bodyFlags));
            } else {
                result = join(result, this.generateExpression(stmt.declaration, Precedence.Assignment, E_TTT) + this.semicolon(flags));
            }
            return result;
        },

        ExportNamedDeclaration (stmt, flags) {
            const that = this;
            let result = [ 'export' ];

            const bodyFlags = (flags & F_SEMICOLON_OPT) ? S_TFFT : S_TFFF;

            // export VariableStatement
            // export Declaration[Default]
            if (stmt.declaration) {
                return join(result, this.generateStatement(stmt.declaration, bodyFlags));
            }

            // export ExportClause[NoReference] FromClause ;
            // export ExportClause ;
            if (stmt.specifiers) {
                if (stmt.specifiers.length === 0) {
                    result = join(result, `{${  space  }}`);
                } else if (stmt.specifiers[0].type === Syntax.ExportBatchSpecifier) {
                    result = join(result, this.generateExpression(stmt.specifiers[0], Precedence.Sequence, E_TTT));
                } else {
                    result = join(result, '{');
                    withIndent(function (indent) {
                        result.push(newline);
                        for (let i = 0, iz = stmt.specifiers.length; i < iz; ++i) {
                            result.push(indent);
                            result.push(that.generateExpression(stmt.specifiers[i], Precedence.Sequence, E_TTT));
                            if (i + 1 < iz) {
                                result.push(`,${  newline}`);
                            }
                        }
                    });
                    if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                        result.push(newline);
                    }
                    result.push(`${base  }}`);
                }

                if (stmt.source) {
                    result = join(result, [
                        `from${  space}`,
                        // ModuleSpecifier
                        this.generateExpression(stmt.source, Precedence.Sequence, E_TTT),
                        this.semicolon(flags)
                    ]);
                } else {
                    result.push(this.semicolon(flags));
                }
            }
            return result;
        },

        ExportAllDeclaration (stmt, flags) {
            // export * FromClause ;
            return [
                `export${  space}`,
                `*${  space}`,
                `from${  space}`,
                // ModuleSpecifier
                this.generateExpression(stmt.source, Precedence.Sequence, E_TTT),
                this.semicolon(flags)
            ];
        },

        ExpressionStatement (stmt, flags) {
            function isClassPrefixed(fragment) {
                if (fragment.slice(0, 5) !== 'class') {
                    return false;
                }
                const code = fragment.charCodeAt(5);
                return code === 0x7B  /* '{' */ || esutils.code.isWhiteSpace(code) || esutils.code.isLineTerminator(code);
            }

            function isFunctionPrefixed(fragment) {
                if (fragment.slice(0, 8) !== 'function') {
                    return false;
                }
                const code = fragment.charCodeAt(8);
                return code === 0x28 /* '(' */ || esutils.code.isWhiteSpace(code) || code === 0x2A  /* '*' */ || esutils.code.isLineTerminator(code);
            }

            function isAsyncPrefixed(fragment) {
                if (fragment.slice(0, 5) !== 'async') {
                    return false;
                }
                if (!esutils.code.isWhiteSpace(fragment.charCodeAt(5))) {
                    return false;
                }
                let i, iz;
                for (i = 6, iz = fragment.length; i < iz; ++i) {
                    if (!esutils.code.isWhiteSpace(fragment.charCodeAt(i))) {
                        break;
                    }
                }
                if (i === iz) {
                    return false;
                }
                if (fragment.slice(i, i + 8) !== 'function') {
                    return false;
                }
                const code = fragment.charCodeAt(i + 8);
                return code === 0x28 /* '(' */ || esutils.code.isWhiteSpace(code) || code === 0x2A  /* '*' */ || esutils.code.isLineTerminator(code);
            }

            let result = [this.generateExpression(stmt.expression, Precedence.Sequence, E_TTT)];
            // 12.4 '{', 'function', 'class' is not allowed in this position.
            // wrap expression with parentheses
            const fragment = toSourceNodeWhenNeeded(result).toString();
            if (fragment.charCodeAt(0) === 0x7B  /* '{' */ ||  // ObjectExpression
                    isClassPrefixed(fragment) ||
                    isFunctionPrefixed(fragment) ||
                    isAsyncPrefixed(fragment) ||
                    (directive && (flags & F_DIRECTIVE_CTX) && stmt.expression.type === Syntax.Literal && typeof stmt.expression.value === 'string')) {
                result = ['(', result, `)${  this.semicolon(flags)}`];
            } else {
                result.push(this.semicolon(flags));
            }
            return result;
        },

        ImportDeclaration (stmt, flags) {
            // ES6: 15.2.1 valid import declarations:
            //     - import ImportClause FromClause ;
            //     - import ModuleSpecifier ;
            const that = this;

            // If no ImportClause is present,
            // this should be `import ModuleSpecifier` so skip `from`
            // ModuleSpecifier is StringLiteral.
            if (stmt.specifiers.length === 0) {
                // import ModuleSpecifier ;
                return [
                    'import',
                    space,
                    // ModuleSpecifier
                    this.generateExpression(stmt.source, Precedence.Sequence, E_TTT),
                    this.semicolon(flags)
                ];
            }

            // import ImportClause FromClause ;
            let result = [
                'import'
            ];
            let cursor = 0;

            // ImportedBinding
            if (stmt.specifiers[cursor].type === Syntax.ImportDefaultSpecifier) {
                result = join(result, [
                    this.generateExpression(stmt.specifiers[cursor], Precedence.Sequence, E_TTT)
                ]);
                ++cursor;
            }

            if (stmt.specifiers[cursor]) {
                if (cursor !== 0) {
                    result.push(',');
                }

                if (stmt.specifiers[cursor].type === Syntax.ImportNamespaceSpecifier) {
                    // NameSpaceImport
                    result = join(result, [
                        space,
                        this.generateExpression(stmt.specifiers[cursor], Precedence.Sequence, E_TTT)
                    ]);
                } else {
                    // NamedImports
                    result.push(`${space  }{`);

                    if ((stmt.specifiers.length - cursor) === 1) {
                        // import { ... } from "...";
                        result.push(space);
                        result.push(this.generateExpression(stmt.specifiers[cursor], Precedence.Sequence, E_TTT));
                        result.push(`${space  }}${  space}`);
                    } else {
                        // import {
                        //    ...,
                        //    ...,
                        // } from "...";
                        withIndent(function (indent) {
                            result.push(newline);
                            for (let i = cursor, iz = stmt.specifiers.length; i < iz; ++i) {
                                result.push(indent);
                                result.push(that.generateExpression(stmt.specifiers[i], Precedence.Sequence, E_TTT));
                                if (i + 1 < iz) {
                                    result.push(`,${  newline}`);
                                }
                            }
                        });
                        if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                            result.push(newline);
                        }
                        result.push(`${base  }}${  space}`);
                    }
                }
            }

            result = join(result, [
                `from${  space}`,
                // ModuleSpecifier
                this.generateExpression(stmt.source, Precedence.Sequence, E_TTT),
                this.semicolon(flags)
            ]);
            return result;
        },

        VariableDeclarator (stmt, flags) {
            const itemFlags = (flags & F_ALLOW_IN) ? E_TTT : E_FTT;
            if (stmt.init) {
                return [
                    this.generateExpression(stmt.id, Precedence.Assignment, itemFlags),
                    space,
                    '=',
                    space,
                    this.generateExpression(stmt.init, Precedence.Assignment, itemFlags)
                ];
            }
            return this.generatePattern(stmt.id, Precedence.Assignment, itemFlags);
        },

        VariableDeclaration (stmt, flags) {
            // VariableDeclarator is typed as Statement,
            // but joined with comma (not LineTerminator).
            // So if comment is attached to target node, we should specialize.
            const that = this;

            const result = [ stmt.kind ];

            const bodyFlags = (flags & F_ALLOW_IN) ? S_TFFF : S_FFFF;

            function block() {
                const [node] = stmt.declarations;
                if (extra.comment && node.leadingComments) {
                    result.push('\n');
                    result.push(addIndent(that.generateStatement(node, bodyFlags)));
                } else {
                    result.push(noEmptySpace());
                    result.push(that.generateStatement(node, bodyFlags));
                }

                for (let i = 1, iz = stmt.declarations.length; i < iz; ++i) {
                    const node = stmt.declarations[i];
                    if (extra.comment && node.leadingComments) {
                        result.push(`,${  newline}`);
                        result.push(addIndent(that.generateStatement(node, bodyFlags)));
                    } else {
                        result.push(`,${  space}`);
                        result.push(that.generateStatement(node, bodyFlags));
                    }
                }
            }

            if (stmt.declarations.length > 1) {
                withIndent(block);
            } else {
                block();
            }

            result.push(this.semicolon(flags));

            return result;
        },

        ThrowStatement (stmt, flags) {
            return [join(
                'throw',
                this.generateExpression(stmt.argument, Precedence.Sequence, E_TTT)
            ), this.semicolon(flags)];
        },

        TryStatement (stmt, flags) {
            let result = ['try', this.maybeBlock(stmt.block, S_TFFF)];
            result = this.maybeBlockSuffix(stmt.block, result);

            if (stmt.handlers) {
                // old interface
                for (let i = 0, iz = stmt.handlers.length; i < iz; ++i) {
                    result = join(result, this.generateStatement(stmt.handlers[i], S_TFFF));
                    if (stmt.finalizer || i + 1 !== iz) {
                        result = this.maybeBlockSuffix(stmt.handlers[i].body, result);
                    }
                }
            } else {
                const guardedHandlers = stmt.guardedHandlers || [];

                for (let i = 0, iz = guardedHandlers.length; i < iz; ++i) {
                    result = join(result, this.generateStatement(guardedHandlers[i], S_TFFF));
                    if (stmt.finalizer || i + 1 !== iz) {
                        result = this.maybeBlockSuffix(guardedHandlers[i].body, result);
                    }
                }

                // new interface
                if (stmt.handler) {
                    if (Array.isArray(stmt.handler)) {
                        for (let i = 0, iz = stmt.handler.length; i < iz; ++i) {
                            result = join(result, this.generateStatement(stmt.handler[i], S_TFFF));
                            if (stmt.finalizer || i + 1 !== iz) {
                                result = this.maybeBlockSuffix(stmt.handler[i].body, result);
                            }
                        }
                    } else {
                        result = join(result, this.generateStatement(stmt.handler, S_TFFF));
                        if (stmt.finalizer) {
                            result = this.maybeBlockSuffix(stmt.handler.body, result);
                        }
                    }
                }
            }
            if (stmt.finalizer) {
                result = join(result, ['finally', this.maybeBlock(stmt.finalizer, S_TFFF)]);
            }
            return result;
        },

        SwitchStatement (stmt, flags) {
            const that = this;
            let result;
            withIndent(function () {
                result = [
                    `switch${  space  }(`,
                    that.generateExpression(stmt.discriminant, Precedence.Sequence, E_TTT),
                    `)${  space  }{${  newline}`
                ];
            });
            if (stmt.cases) {
                let bodyFlags = S_TFFF;
                for (let i = 0, iz = stmt.cases.length; i < iz; ++i) {
                    if (i === iz - 1) {
                        bodyFlags |= F_SEMICOLON_OPT;
                    }
                    const fragment = addIndent(this.generateStatement(stmt.cases[i], bodyFlags));
                    result.push(fragment);
                    if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            }
            result.push(addIndent('}'));
            return result;
        },

        SwitchCase (stmt, flags) {
            const that = this;
            let result;
            withIndent(function () {
                if (stmt.test) {
                    result = [
                        join('case', that.generateExpression(stmt.test, Precedence.Sequence, E_TTT)),
                        ':'
                    ];
                } else {
                    result = ['default:'];
                }

                let i = 0;
                const iz = stmt.consequent.length;
                if (iz && stmt.consequent[0].type === Syntax.BlockStatement) {
                    const fragment = that.maybeBlock(stmt.consequent[0], S_TFFF);
                    result.push(fragment);
                    i = 1;
                }

                if (i !== iz && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                    result.push(newline);
                }

                let bodyFlags = S_TFFF;
                for (; i < iz; ++i) {
                    if (i === iz - 1 && flags & F_SEMICOLON_OPT) {
                        bodyFlags |= F_SEMICOLON_OPT;
                    }
                    const fragment = addIndent(that.generateStatement(stmt.consequent[i], bodyFlags));
                    result.push(fragment);
                    if (i + 1 !== iz && !endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            });
            return result;
        },

        IfStatement (stmt, flags) {
            const that = this;
            let result;
            withIndent(function () {
                result = [
                    `if${  space  }(`,
                    that.generateExpression(stmt.test, Precedence.Sequence, E_TTT),
                    ')'
                ];
            });
            const semicolonOptional = flags & F_SEMICOLON_OPT;
            let bodyFlags = S_TFFF;
            if (semicolonOptional) {
                bodyFlags |= F_SEMICOLON_OPT;
            }
            if (stmt.alternate) {
                result.push(this.maybeBlock(stmt.consequent, S_TFFF));
                result = this.maybeBlockSuffix(stmt.consequent, result);
                if (stmt.alternate.type === Syntax.IfStatement) {
                    result = join(result, ['else ', this.generateStatement(stmt.alternate, bodyFlags)]);
                } else {
                    result = join(result, join('else', this.maybeBlock(stmt.alternate, bodyFlags)));
                }
            } else {
                result.push(this.maybeBlock(stmt.consequent, bodyFlags));
            }
            return result;
        },

        ForStatement (stmt, flags) {
            const that = this;
            let result;
            withIndent(function () {
                result = [`for${  space  }(`];
                if (stmt.init) {
                    if (stmt.init.type === Syntax.VariableDeclaration) {
                        result.push(that.generateStatement(stmt.init, S_FFFF));
                    } else {
                        // F_ALLOW_IN becomes false.
                        result.push(that.generateExpression(stmt.init, Precedence.Sequence, E_FTT));
                        result.push(';');
                    }
                } else {
                    result.push(';');
                }

                if (stmt.test) {
                    result.push(space);
                    result.push(that.generateExpression(stmt.test, Precedence.Sequence, E_TTT));
                    result.push(';');
                } else {
                    result.push(';');
                }

                if (stmt.update) {
                    result.push(space);
                    result.push(that.generateExpression(stmt.update, Precedence.Sequence, E_TTT));
                    result.push(')');
                } else {
                    result.push(')');
                }
            });

            result.push(this.maybeBlock(stmt.body, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF));
            return result;
        },

        ForInStatement (stmt, flags) {
            return this.generateIterationForStatement('in', stmt, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF);
        },

        ForOfStatement (stmt, flags) {
            return this.generateIterationForStatement('of', stmt, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF);
        },

        LabeledStatement (stmt, flags) {
            return [`${stmt.label.name  }:`, this.maybeBlock(stmt.body, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF)];
        },

        Program (stmt, flags) {
            const iz = stmt.body.length;
            const result = [safeConcatenation && iz > 0 ? '\n' : ''];
            let bodyFlags = S_TFTF;
            for (let i = 0; i < iz; ++i) {
                if (!safeConcatenation && i === iz - 1) {
                    bodyFlags |= F_SEMICOLON_OPT;
                }

                if (preserveBlankLines) {
                    // handle spaces before the first line
                    if (i === 0) {
                        if (!stmt.body[0].leadingComments) {
                            generateBlankLines(stmt.range[0], stmt.body[i].range[0], result);
                        }
                    }

                    // handle spaces between lines
                    if (i > 0) {
                        if (!stmt.body[i - 1].trailingComments && !stmt.body[i].leadingComments) {
                            generateBlankLines(stmt.body[i - 1].range[1], stmt.body[i].range[0], result);
                        }
                    }
                }

                const fragment = addIndent(this.generateStatement(stmt.body[i], bodyFlags));
                result.push(fragment);
                if (i + 1 < iz && !endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                    if (preserveBlankLines) {
                        if (!stmt.body[i + 1].leadingComments) {
                            result.push(newline);
                        }
                    } else {
                        result.push(newline);
                    }
                }

                if (preserveBlankLines) {
                    // handle spaces after the last line
                    if (i === iz - 1) {
                        if (!stmt.body[i].trailingComments) {
                            generateBlankLines(stmt.body[i].range[1], stmt.range[1], result);
                        }
                    }
                }
            }
            return result;
        },

        FunctionDeclaration (stmt, flags) {
            return [
                generateAsyncPrefix(stmt, true),
                'function',
                generateStarSuffix(stmt) || noEmptySpace(),
                stmt.id ? generateIdentifier(stmt.id) : '',
                this.generateFunctionBody(stmt)
            ];
        },

        ReturnStatement (stmt, flags) {
            if (stmt.argument) {
                return [join(
                    'return',
                    this.generateExpression(stmt.argument, Precedence.Sequence, E_TTT)
                ), this.semicolon(flags)];
            }
            return [`return${  this.semicolon(flags)}`];
        },

        WhileStatement (stmt, flags) {
            const that = this;
            let result;
            withIndent(function () {
                result = [
                    `while${  space  }(`,
                    that.generateExpression(stmt.test, Precedence.Sequence, E_TTT),
                    ')'
                ];
            });
            result.push(this.maybeBlock(stmt.body, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF));
            return result;
        },

        WithStatement (stmt, flags) {
            const that = this;
            let result;
            withIndent(function () {
                result = [
                    `with${  space  }(`,
                    that.generateExpression(stmt.object, Precedence.Sequence, E_TTT),
                    ')'
                ];
            });
            result.push(this.maybeBlock(stmt.body, flags & F_SEMICOLON_OPT ? S_TFFT : S_TFFF));
            return result;
        }

    };

    merge(CodeGenerator.prototype, CodeGenerator.Statement);

    // Expressions.

    CodeGenerator.Expression = {

        SequenceExpression (expr, precedence, flags) {
            if (Precedence.Sequence < precedence) {
                flags |= F_ALLOW_IN;
            }
            const result = [];
            for (let i = 0, iz = expr.expressions.length; i < iz; ++i) {
                result.push(this.generateExpression(expr.expressions[i], Precedence.Assignment, flags));
                if (i + 1 < iz) {
                    result.push(`,${  space}`);
                }
            }
            return parenthesize(result, Precedence.Sequence, precedence);
        },

        AssignmentExpression (expr, precedence, flags) {
            return this.generateAssignment(expr.left, expr.right, expr.operator, precedence, flags);
        },

        ArrowFunctionExpression (expr, precedence, flags) {
            return parenthesize(this.generateFunctionBody(expr), Precedence.ArrowFunction, precedence);
        },

        ConditionalExpression (expr, precedence, flags) {
            if (Precedence.Conditional < precedence) {
                flags |= F_ALLOW_IN;
            }
            return parenthesize(
                [
                    this.generateExpression(expr.test, Precedence.LogicalOR, flags),
                    `${space  }?${  space}`,
                    this.generateExpression(expr.consequent, Precedence.Assignment, flags),
                    `${space  }:${  space}`,
                    this.generateExpression(expr.alternate, Precedence.Assignment, flags)
                ],
                Precedence.Conditional,
                precedence
            );
        },

        LogicalExpression (expr, precedence, flags) {
            return this.BinaryExpression(expr, precedence, flags);
        },

        BinaryExpression (expr, precedence, flags) {
            const currentPrecedence = BinaryPrecedence[expr.operator];
            const leftPrecedence = expr.operator === '**' ? Precedence.Postfix : currentPrecedence;
            const rightPrecedence = expr.operator === '**' ? currentPrecedence : currentPrecedence + 1;

            if (currentPrecedence < precedence) {
                flags |= F_ALLOW_IN;
            }

            let fragment = this.generateExpression(expr.left, leftPrecedence, flags);

            const leftSource = fragment.toString();

            let result;
            if (leftSource.charCodeAt(leftSource.length - 1) === 0x2F /* / */ && esutils.code.isIdentifierPartES5(expr.operator.charCodeAt(0))) {
                result = [fragment, noEmptySpace(), expr.operator];
            } else {
                result = join(fragment, expr.operator);
            }

            fragment = this.generateExpression(expr.right, rightPrecedence, flags);

            if (expr.operator === '/' && fragment.toString().charAt(0) === '/' ||
            expr.operator.slice(-1) === '<' && fragment.toString().slice(0, 3) === '!--') {
                // If '/' concats with '/' or `<` concats with `!--`, it is interpreted as comment start
                result.push(noEmptySpace());
                result.push(fragment);
            } else {
                result = join(result, fragment);
            }

            if (expr.operator === 'in' && !(flags & F_ALLOW_IN)) {
                return ['(', result, ')'];
            }
            return parenthesize(result, currentPrecedence, precedence);
        },

        CallExpression (expr, precedence, flags) {
            // F_ALLOW_UNPARATH_NEW becomes false.
            const result = [this.generateExpression(expr.callee, Precedence.Call, E_TTF)];
            result.push('(');
            for (let i = 0, iz = expr['arguments'].length; i < iz; ++i) {
                result.push(this.generateExpression(expr['arguments'][i], Precedence.Assignment, E_TTT));
                if (i + 1 < iz) {
                    result.push(`,${  space}`);
                }
            }
            result.push(')');

            if (!(flags & F_ALLOW_CALL)) {
                return ['(', result, ')'];
            }
            return parenthesize(result, Precedence.Call, precedence);
        },

        NewExpression (expr, precedence, flags) {
            const { length } = expr['arguments'];

            // F_ALLOW_CALL becomes false.
            // F_ALLOW_UNPARATH_NEW may become false.
            const itemFlags = (flags & F_ALLOW_UNPARATH_NEW && !parentheses && length === 0) ? E_TFT : E_TFF;

            const result = join(
                'new',
                this.generateExpression(expr.callee, Precedence.New, itemFlags)
            );

            if (!(flags & F_ALLOW_UNPARATH_NEW) || parentheses || length > 0) {
                result.push('(');
                for (let i = 0, iz = length; i < iz; ++i) {
                    result.push(this.generateExpression(expr['arguments'][i], Precedence.Assignment, E_TTT));
                    if (i + 1 < iz) {
                        result.push(`,${  space}`);
                    }
                }
                result.push(')');
            }

            return parenthesize(result, Precedence.New, precedence);
        },

        MemberExpression (expr, precedence, flags) {
            // F_ALLOW_UNPARATH_NEW becomes false.
            const result = [this.generateExpression(expr.object, Precedence.Call, (flags & F_ALLOW_CALL) ? E_TTF : E_TFF)];

            if (expr.computed) {
                result.push('[');
                result.push(this.generateExpression(expr.property, Precedence.Sequence, flags & F_ALLOW_CALL ? E_TTT : E_TFT));
                result.push(']');
            } else {
                if (expr.object.type === Syntax.Literal && typeof expr.object.value === 'number') {
                    const fragment = toSourceNodeWhenNeeded(result).toString();
                    // When the following conditions are all true,
                    //   1. No floating point
                    //   2. Don't have exponents
                    //   3. The last character is a decimal digit
                    //   4. Not hexadecimal OR octal number literal
                    // we should add a floating point.
                    if (
                        fragment.indexOf('.') < 0 &&
                            !/[eExX]/.test(fragment) &&
                            esutils.code.isDecimalDigit(fragment.charCodeAt(fragment.length - 1)) &&
                            !(fragment.length >= 2 && fragment.charCodeAt(0) === 48)  // '0'
                    ) {
                        result.push(' ');
                    }
                }
                result.push('.');
                result.push(generateIdentifier(expr.property));
            }

            return parenthesize(result, Precedence.Member, precedence);
        },

        MetaProperty (expr, precedence, flags) {
            const result = [
                typeof expr.meta === 'string' ? expr.meta : generateIdentifier(expr.meta),
                '.',
                typeof expr.property === 'string' ? expr.property : generateIdentifier(expr.property)
            ];
            return parenthesize(result, Precedence.Member, precedence);
        },

        UnaryExpression (expr, precedence, flags) {
            const fragment = this.generateExpression(expr.argument, Precedence.Unary, E_TTT);

            let result;
            if (space === '') {
                result = join(expr.operator, fragment);
            } else {
                result = [expr.operator];
                if (expr.operator.length > 2) {
                    // delete, void, typeof
                    // get `typeof []`, not `typeof[]`
                    result = join(result, fragment);
                } else {
                    // Prevent inserting spaces between operator and argument if it is unnecessary
                    // like, `!cond`
                    const leftSource = toSourceNodeWhenNeeded(result).toString();
                    const leftCharCode = leftSource.charCodeAt(leftSource.length - 1);
                    const rightCharCode = fragment.toString().charCodeAt(0);

                    if (((leftCharCode === 0x2B  /* + */ || leftCharCode === 0x2D  /* - */) && leftCharCode === rightCharCode) ||
                            (esutils.code.isIdentifierPartES5(leftCharCode) && esutils.code.isIdentifierPartES5(rightCharCode))) {
                        result.push(noEmptySpace());
                        result.push(fragment);
                    } else {
                        result.push(fragment);
                    }
                }
            }
            return parenthesize(result, Precedence.Unary, precedence);
        },

        YieldExpression (expr, precedence, flags) {
            let result;
            if (expr.delegate) {
                result = 'yield*';
            } else {
                result = 'yield';
            }
            if (expr.argument) {
                result = join(
                    result,
                    this.generateExpression(expr.argument, Precedence.Yield, E_TTT)
                );
            }
            return parenthesize(result, Precedence.Yield, precedence);
        },

        AwaitExpression (expr, precedence, flags) {
            const result = join(
                expr.all ? 'await*' : 'await',
                this.generateExpression(expr.argument, Precedence.Await, E_TTT)
            );
            return parenthesize(result, Precedence.Await, precedence);
        },

        UpdateExpression (expr, precedence, flags) {
            if (expr.prefix) {
                return parenthesize(
                    [
                        expr.operator,
                        this.generateExpression(expr.argument, Precedence.Unary, E_TTT)
                    ],
                    Precedence.Unary,
                    precedence
                );
            }
            return parenthesize(
                [
                    this.generateExpression(expr.argument, Precedence.Postfix, E_TTT),
                    expr.operator
                ],
                Precedence.Postfix,
                precedence
            );
        },

        FunctionExpression (expr, precedence, flags) {
            const result = [
                generateAsyncPrefix(expr, true),
                'function'
            ];
            if (expr.id) {
                result.push(generateStarSuffix(expr) || noEmptySpace());
                result.push(generateIdentifier(expr.id));
            } else {
                result.push(generateStarSuffix(expr) || space);
            }
            result.push(this.generateFunctionBody(expr));
            return result;
        },

        ArrayPattern (expr, precedence, flags) {
            return this.ArrayExpression(expr, precedence, flags, true);
        },

        ArrayExpression (expr, precedence, flags, isPattern) {
            const that = this;
            if (!expr.elements.length) {
                return '[]';
            }
            const multiline = isPattern ? false : expr.elements.length > 1;
            const result = ['[', multiline ? newline : ''];
            withIndent(function (indent) {
                for (let i = 0, iz = expr.elements.length; i < iz; ++i) {
                    if (!expr.elements[i]) {
                        if (multiline) {
                            result.push(indent);
                        }
                        if (i + 1 === iz) {
                            result.push(',');
                        }
                    } else {
                        result.push(multiline ? indent : '');
                        result.push(that.generateExpression(expr.elements[i], Precedence.Assignment, E_TTT));
                    }
                    if (i + 1 < iz) {
                        result.push(`,${  multiline ? newline : space}`);
                    }
                }
            });
            if (multiline && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(multiline ? base : '');
            result.push(']');
            return result;
        },

        RestElement(expr, precedence, flags) {
            return `...${  this.generatePattern(expr.argument)}`;
        },

        ClassExpression (expr, precedence, flags) {
            let result = ['class'];
            if (expr.id) {
                result = join(result, this.generateExpression(expr.id, Precedence.Sequence, E_TTT));
            }
            if (expr.superClass) {
                const fragment = join('extends', this.generateExpression(expr.superClass, Precedence.Unary, E_TTT));
                result = join(result, fragment);
            }
            result.push(space);
            result.push(this.generateStatement(expr.body, S_TFFT));
            return result;
        },

        MethodDefinition (expr, precedence, flags) {
            let result;
            if (expr['static']) {
                result = [`static${  space}`];
            } else {
                result = [];
            }
            let fragment;
            if (expr.kind === 'get' || expr.kind === 'set') {
                fragment = [
                    join(expr.kind, this.generatePropertyKey(expr.key, expr.computed)),
                    this.generateFunctionBody(expr.value)
                ];
            } else {
                fragment = [
                    generateMethodPrefix(expr),
                    this.generatePropertyKey(expr.key, expr.computed),
                    this.generateFunctionBody(expr.value)
                ];
            }
            return join(result, fragment);
        },

        Property (expr, precedence, flags) {
            if (expr.kind === 'get' || expr.kind === 'set') {
                return [
                    expr.kind, noEmptySpace(),
                    this.generatePropertyKey(expr.key, expr.computed),
                    this.generateFunctionBody(expr.value)
                ];
            }

            if (expr.shorthand) {
                if (expr.value.type === 'AssignmentPattern') {
                    return this.AssignmentPattern(expr.value, Precedence.Sequence, E_TTT);
                }
                return this.generatePropertyKey(expr.key, expr.computed);
            }

            if (expr.method) {
                return [
                    generateMethodPrefix(expr),
                    this.generatePropertyKey(expr.key, expr.computed),
                    this.generateFunctionBody(expr.value)
                ];
            }

            return [
                this.generatePropertyKey(expr.key, expr.computed),
                `:${  space}`,
                this.generateExpression(expr.value, Precedence.Assignment, E_TTT)
            ];
        },

        ObjectExpression (expr, precedence, flags) {
            const that = this;

            if (!expr.properties.length) {
                return '{}';
            }
            const multiline = expr.properties.length > 1;

            let fragment;
            withIndent(function () {
                fragment = that.generateExpression(expr.properties[0], Precedence.Sequence, E_TTT);
            });

            if (!multiline) {
                // issues 4
                // Do not transform from
                //   dejavu.Class.declare({
                //       method2: function () {}
                //   });
                // to
                //   dejavu.Class.declare({method2: function () {
                //       }});
                if (!hasLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                    return [ '{', space, fragment, space, '}' ];
                }
            }

            let result;
            withIndent(function (indent) {
                result = [ '{', newline, indent, fragment ];

                if (multiline) {
                    result.push(`,${  newline}`);
                    for (let i = 1, iz = expr.properties.length; i < iz; ++i) {
                        result.push(indent);
                        result.push(that.generateExpression(expr.properties[i], Precedence.Sequence, E_TTT));
                        if (i + 1 < iz) {
                            result.push(`,${  newline}`);
                        }
                    }
                }
            });

            if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(base);
            result.push('}');
            return result;
        },

        AssignmentPattern(expr, precedence, flags) {
            return this.generateAssignment(expr.left, expr.right, '=', precedence, flags);
        },

        ObjectPattern (expr, precedence, flags) {
            const that = this;
            if (!expr.properties.length) {
                return '{}';
            }

            let multiline = false;
            if (expr.properties.length === 1) {
                const [property] = expr.properties;
                if (
                    property.type === Syntax.Property
                    && property.value.type !== Syntax.Identifier
                ) {
                    multiline = true;
                }
            } else {
                for (const property of expr.properties) {
                    if (
                        property.type === Syntax.Property
                        && !property.shorthand
                    ) {
                        multiline = true;
                        break;
                    }
                }
            }
            const result = ['{', multiline ? newline : '' ];

            withIndent(function (indent) {
                for (let i = 0, iz = expr.properties.length; i < iz; ++i) {
                    result.push(multiline ? indent : '');
                    result.push(that.generateExpression(expr.properties[i], Precedence.Sequence, E_TTT));
                    if (i + 1 < iz) {
                        result.push(`,${  multiline ? newline : space}`);
                    }
                }
            });

            if (multiline && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(multiline ? base : '');
            result.push('}');
            return result;
        },

        ThisExpression (expr, precedence, flags) {
            return 'this';
        },

        Super (expr, precedence, flags) {
            return 'super';
        },

        Identifier (expr, precedence, flags) {
            return generateIdentifier(expr);
        },

        ImportDefaultSpecifier (expr, precedence, flags) {
            return generateIdentifier(expr.id || expr.local);
        },

        ImportNamespaceSpecifier (expr, precedence, flags) {
            const result = ['*'];
            const id = expr.id || expr.local;
            if (id) {
                result.push(`${space  }as${  noEmptySpace()  }${generateIdentifier(id)}`);
            }
            return result;
        },

        ImportSpecifier (expr, precedence, flags) {
            const { imported } = expr;
            const result = [ imported.name ];
            const { local } = expr;
            if (local && local.name !== imported.name) {
                result.push(`${noEmptySpace()  }as${  noEmptySpace()  }${generateIdentifier(local)}`);
            }
            return result;
        },

        ExportSpecifier (expr, precedence, flags) {
            const { local } = expr;
            const result = [ local.name ];
            const { exported } = expr;
            if (exported && exported.name !== local.name) {
                result.push(`${noEmptySpace()  }as${  noEmptySpace()  }${generateIdentifier(exported)}`);
            }
            return result;
        },

        Literal (expr, precedence, flags) {
            if (Object.hasOwnProperty.call(expr, 'raw') && parse && extra.raw) {
                try {
                    const raw = parse(expr.raw).body[0].expression;
                    if (raw.type === Syntax.Literal) {
                        if (raw.value === expr.value) {
                            return expr.raw;
                        }
                    }
                } catch (e) {
                    // not use raw property
                }
            }

            if (expr.regex) {
                return `/${  expr.regex.pattern  }/${  expr.regex.flags}`;
            }

            if (expr.value === null) {
                return 'null';
            }

            if (typeof expr.value === 'string') {
                return escapeString(expr.value);
            }

            if (typeof expr.value === 'number') {
                return generateNumber(expr.value);
            }

            if (typeof expr.value === 'boolean') {
                return expr.value ? 'true' : 'false';
            }

            return generateRegExp(expr.value);
        },

        GeneratorExpression (expr, precedence, flags) {
            return this.ComprehensionExpression(expr, precedence, flags);
        },

        ComprehensionExpression (expr, precedence, flags) {
            // GeneratorExpression should be parenthesized with (...), ComprehensionExpression with [...]
            // Due to https://bugzilla.mozilla.org/show_bug.cgi?id=883468 position of expr.body can differ in Spidermonkey and ES6

            const that = this;
            let result = (expr.type === Syntax.GeneratorExpression) ? ['('] : ['['];

            let fragment;
            if (extra.moz.comprehensionExpressionStartsWithAssignment) {
                fragment = this.generateExpression(expr.body, Precedence.Assignment, E_TTT);
                result.push(fragment);
            }

            if (expr.blocks) {
                withIndent(function () {
                    for (let i = 0, iz = expr.blocks.length; i < iz; ++i) {
                        fragment = that.generateExpression(expr.blocks[i], Precedence.Sequence, E_TTT);
                        if (i > 0 || extra.moz.comprehensionExpressionStartsWithAssignment) {
                            result = join(result, fragment);
                        } else {
                            result.push(fragment);
                        }
                    }
                });
            }

            if (expr.filter) {
                result = join(result, `if${  space}`);
                fragment = this.generateExpression(expr.filter, Precedence.Sequence, E_TTT);
                result = join(result, [ '(', fragment, ')' ]);
            }

            if (!extra.moz.comprehensionExpressionStartsWithAssignment) {
                fragment = this.generateExpression(expr.body, Precedence.Assignment, E_TTT);

                result = join(result, fragment);
            }

            result.push((expr.type === Syntax.GeneratorExpression) ? ')' : ']');
            return result;
        },

        ComprehensionBlock (expr, precedence, flags) {
            let fragment;
            if (expr.left.type === Syntax.VariableDeclaration) {
                fragment = [
                    expr.left.kind, noEmptySpace(),
                    this.generateStatement(expr.left.declarations[0], S_FFFF)
                ];
            } else {
                fragment = this.generateExpression(expr.left, Precedence.Call, E_TTT);
            }

            fragment = join(fragment, expr.of ? 'of' : 'in');
            fragment = join(fragment, this.generateExpression(expr.right, Precedence.Sequence, E_TTT));

            return [ `for${  space  }(`, fragment, ')' ];
        },

        SpreadElement (expr, precedence, flags) {
            return [
                '...',
                this.generateExpression(expr.argument, Precedence.Assignment, E_TTT)
            ];
        },

        TaggedTemplateExpression (expr, precedence, flags) {
            let itemFlags = E_TTF;
            if (!(flags & F_ALLOW_CALL)) {
                itemFlags = E_TFF;
            }
            const result = [
                this.generateExpression(expr.tag, Precedence.Call, itemFlags),
                this.generateExpression(expr.quasi, Precedence.Primary, E_FFT)
            ];
            return parenthesize(result, Precedence.TaggedTemplate, precedence);
        },

        TemplateElement (expr, precedence, flags) {
            // Don't use "cooked". Since tagged template can use raw template
            // representation. So if we do so, it breaks the script semantics.
            return expr.value.raw;
        },

        TemplateLiteral (expr, precedence, flags) {
            const result = [ '`' ];
            for (let i = 0, iz = expr.quasis.length; i < iz; ++i) {
                result.push(this.generateExpression(expr.quasis[i], Precedence.Primary, E_TTT));
                if (i + 1 < iz) {
                    result.push(`\${${  space}`);
                    result.push(this.generateExpression(expr.expressions[i], Precedence.Sequence, E_TTT));
                    result.push(`${space  }}`);
                }
            }
            result.push('`');
            return result;
        },

        ModuleSpecifier (expr, precedence, flags) {
            return this.Literal(expr, precedence, flags);
        },

        ImportExpression(expr, precedence, flag) {
            return parenthesize([
                'import(',
                this.generateExpression(expr.source, Precedence.Assignment, E_TTT),
                ')'
            ], Precedence.Call, precedence);
        },

    };

    merge(CodeGenerator.prototype, CodeGenerator.Expression);

    function generateInternal(node) {
        const codegen = new CodeGenerator();
        if (isStatement(node)) {
            return codegen.generateStatement(node, S_TFFF);
        }

        if (isExpression(node)) {
            return codegen.generateExpression(node, Precedence.Sequence, E_TTT);
        }

        throw new Error(`Unknown node type: ${  node.type}`);
    }

    function generate(node, options) {
        const defaultOptions = getDefaultOptions();
        if (options != null) {
            // Obsolete options
            //
            //   `options.indent`
            //   `options.base`
            //
            // Instead of them, we can use `option.format.indent`.
            if (typeof options.indent === 'string') {
                defaultOptions.format.indent.style = options.indent;
            }
            if (typeof options.base === 'number') {
                defaultOptions.format.indent.base = options.base;
            }
            options = updateDeeply(defaultOptions, options);
            indent = options.format.indent.style;
            if (typeof options.base === 'string') {
                ({ base } = options);
            } else {
                base = stringRepeat(indent, options.format.indent.base);
            }
        } else {
            options = defaultOptions;
            indent = options.format.indent.style;
            base = stringRepeat(indent, options.format.indent.base);
        }
        ({
            json, renumber, escapeless, newline,
            space, parentheses, semicolons, safeConcatenation
        } = options.format);
        hexadecimal = json ? false : options.format.hexadecimal;
        quotes = json ? 'double' : options.format.quotes;
        if (options.format.compact) {
            newline = space = indent = base = '';
        }
        ({ directive, sourceMap, sourceCode } = options);
        parse = json ? null : options.parse;
        preserveBlankLines = options.format.preserveBlankLines && sourceCode !== null;
        extra = options;

        if (sourceMap) {
            if (!exports.browser) {
                // We assume environment is node.js
                // And prevent from including source-map by browserify
                ({ SourceNode } = require('source-map'));
            } else {
                ({ SourceNode } = global.sourceMap);
            }
        }

        const result = generateInternal(node);

        let pair;

        if (!sourceMap) {
            pair = { code: result.toString(), map: null };
            return options.sourceMapWithCode ? pair : pair.code;
        }


        pair = result.toStringWithSourceMap({
            file: options.file,
            sourceRoot: options.sourceMapRoot
        });

        if (options.sourceContent) {
            pair.map.setSourceContent(options.sourceMap,
                options.sourceContent);
        }

        if (options.sourceMapWithCode) {
            return pair;
        }

        return pair.map.toString();
    }

    const FORMAT_MINIFY = {
        indent: {
            style: '',
            base: 0
        },
        renumber: true,
        hexadecimal: true,
        quotes: 'auto',
        escapeless: true,
        compact: true,
        parentheses: false,
        semicolons: false
    };

    const FORMAT_DEFAULTS = getDefaultOptions().format;

    exports.version = require('./package.json').version;
    exports.generate = generate;
    exports.attachComments = estraverse.attachComments;
    exports.Precedence = updateDeeply({}, Precedence);
    exports.browser = false;
    exports.FORMAT_MINIFY = FORMAT_MINIFY;
    exports.FORMAT_DEFAULTS = FORMAT_DEFAULTS;
}());
/* vim: set sw=4 ts=4 et tw=80 : */
